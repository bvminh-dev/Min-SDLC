import type { Page } from 'playwright-core';
import { jpegWithExif } from '../support/images';
import {
  advance, alignWindow, count, eventually, hasText, id, loginUi, orderState, relay, reset, reviewState, see, seedAddress, seedCategory, seedOrder, seedProduct, seedReview, seedShippingMethod, seedStock, seedUser, setPreModeration,
  startE2e, textOf, urlIs, withPage, type E2eEnv, API} from './support';

// E2E của REV chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật (AppModule, mọi module thật) trên PostgreSQL thật (`ecom_e2e`), bản build production của web, kho ảnh giả tự dựng (CHƯA thử với S3 thật
// khi không có STORAGE_TEST_ENDPOINT). Dữ liệu mồi dựng thẳng (đơn đã giao, đánh giá) hoặc luồng THẬT đặt hàng COD, bàn giao, giao hàng của CHK, SHP, ORD, rồi đánh giá và kiểm duyệt qua giao diện.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); await setPreModeration(true); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 240_000);
const A = 'a@x.vn', ADMIN = 'admin@x.vn';
const contains = (re: RegExp, s: string) => expect(s).toMatch(re);

async function shop() {
  await seedUser({ email: A, name: 'Nguyễn Văn An' });
  await seedUser({ email: ADMIN, role: 'admin', name: 'Quản Trị' });
  const cat = await seedCategory('Áo');
  const p1 = await seedProduct({ name: 'Áo thun cổ tròn', category_id: cat, price: 150000 });
  return { cat, p1 };
}
const productPage = (page: Page, product: string) => page.goto(`/products/${product}/reviews`);
const radio = (page: Page, n: number) => id(page, 'rev-review-form-rating').getByRole('radio', { name: `${n} sao` });

describe('E2E REV (trình duyệt thật, API thật)', () => {
  e2e('REV-E2E-20261006-104528360: customer viết đánh giá có ảnh, chờ duyệt và thấy ở Đánh giá của tôi', async (page) => {
    const { p1 } = await shop();
    await seedOrder({ email: A, status: 'delivered', items: [{ product: p1, name: 'Áo thun cổ tròn' }] } as never);
    await loginUi(page, A);
    await productPage(page, p1);
    await id(page, 'rev-product-reviews-write-button').click();
    await see(id(page, 'rev-review-form-verified'));
    await radio(page, 4).click();
    await id(page, 'rev-review-form-comment').fill('Vải mát, đúng size');
    await hasText(id(page, 'rev-review-form-comment-counter'), '18 / 2000');
    await id(page, 'rev-review-form-image-input').setInputFiles({ name: 'anh.jpg', mimeType: 'image/jpeg', buffer: await jpegWithExif(1200, 900) });
    await see(id(page, 'rev-review-form-image-item'));
    await count(id(page, 'rev-review-form-image-uploading'), 0);
    await hasText(id(page, 'rev-review-form-image-count'), '1 / 5');
    await id(page, 'rev-review-form-submit').click();
    await see(id(page, 'rev-review-form-success-pending'));
    expect(await textOf(id(page, 'rev-review-form-success-pending'))).toContain('sẽ hiện sau khi được duyệt');
    await page.goto('/me/reviews');
    await hasText(id(page, 'rev-my-reviews-item-status'), 'Chờ duyệt');
    contains(/4/, await textOf(id(page, 'rev-my-reviews-item-rating')));
    await see(id(page, 'rev-my-reviews-item-edit'));
    await see(id(page, 'rev-my-reviews-item-delete'));
    await count(id(page, 'rev-my-reviews-item-images').locator('img'), 1);
    const st = await reviewState({ email: A, product_id: p1 });
    expect([st?.status, st?.rating, st?.images, st?.events]).toEqual(['pending', 4, 1, []]);
  });

  e2e('REV-E2E-20261006-104528391: admin duyệt đánh giá chờ duyệt và đánh giá hiện công khai', async (page) => {
    const { p1 } = await shop();
    await seedUser({ email: 'b@x.vn', name: 'Lê Thị Bình' });
    const r1 = await seedReview({ email: A, product_id: p1, status: 'pending', rating: 5, age_ms: 7200_000, comment: 'cũ nhất' });
    await seedReview({ email: 'b@x.vn', product_id: p1, status: 'pending', rating: 3, age_ms: 3600_000, comment: 'mới hơn' });
    await loginUi(page, ADMIN);
    await page.goto('/admin/reviews');
    await see(id(page, 'rev-admin-moderation-list'));
    expect(await id(page, 'rev-admin-moderation-tabs').getByRole('tab', { selected: true }).innerText()).toContain('Chờ duyệt');
    await hasText(id(page, 'rev-admin-moderation-pending-count'), '2');
    await count(id(page, 'rev-admin-moderation-row'), 2);
    contains(/cũ nhất/, await textOf(id(page, 'rev-admin-moderation-row-comment')));
    await id(page, 'rev-admin-moderation-row-approve').first().click();
    await see(id(page, 'rev-admin-moderation-action-success'));
    await hasText(id(page, 'rev-admin-moderation-pending-count'), '1');
    await count(id(page, 'rev-admin-moderation-row'), 1);
    await productPage(page, p1);
    await count(id(page, 'rev-product-reviews-item'), 1);
    await see(id(page, 'rev-product-reviews-item-verified'));
    contains(/^1\b/, await textOf(id(page, 'rev-product-reviews-count')));
    expect((await reviewState({ id: r1.id }))?.events).toEqual(['ReviewPublished']);
  });

  e2e('REV-E2E-20261006-104528424: admin từ chối đánh giá bắt buộc có lý do', async (page) => {
    const { p1 } = await shop();
    const r = await seedReview({ email: A, product_id: p1, status: 'pending', comment: 'Gọi 0909 để mua rẻ' });
    await loginUi(page, ADMIN);
    await page.goto('/admin/reviews');
    await id(page, 'rev-admin-moderation-row-reject').click();
    await see(id(page, 'rev-admin-moderation-reject-dialog'));
    let posts = 0;
    page.on('request', (rq) => { if (rq.method() === 'POST' && rq.url().includes('/reject')) posts++; });
    await id(page, 'rev-admin-moderation-reject-confirm').click();
    await hasText(id(page, 'rev-admin-moderation-reason-error'), 'Vui lòng nhập lý do');
    await see(id(page, 'rev-admin-moderation-reject-dialog'));
    expect(posts).toBe(0);
    await id(page, 'rev-admin-moderation-reject-reason').fill('Chứa số điện thoại liên hệ');
    await id(page, 'rev-admin-moderation-reject-confirm').click();
    await see(id(page, 'rev-admin-moderation-action-success'));
    await count(id(page, 'rev-admin-moderation-row'), 0);
    await id(page, 'rev-admin-moderation-tabs').getByRole('tab', { name: /Bị từ chối/ }).click();
    await hasText(id(page, 'rev-admin-moderation-row-reason'), 'Chứa số điện thoại liên hệ');
    expect((await reviewState({ id: r.id }))?.status).toBe('rejected');
  });

  e2e('REV-E2E-20261006-104528456: customer xem lý do đánh giá bị từ chối, không có nút sửa mà có nút xóa để viết lại', async (page) => {
    const { cat, p1 } = await shop();
    const p2 = await seedProduct({ name: 'Tất cổ cao', category_id: cat });
    await seedReview({ email: A, product_id: p1, status: 'published', rating: 4, age_ms: 7200_000 });
    await seedReview({ email: A, product_id: p2, status: 'rejected', rating: 2, reason: 'Chứa số điện thoại liên hệ', age_ms: 3600_000 });
    await loginUi(page, A);
    await page.goto('/me/reviews');
    await id(page, 'rev-my-reviews-filter-status').getByRole('button', { name: 'Bị từ chối' }).click();
    await count(id(page, 'rev-my-reviews-item'), 1);
    await hasText(id(page, 'rev-my-reviews-item-status'), 'Bị từ chối');
    await hasText(id(page, 'rev-my-reviews-item-reason'), 'Chứa số điện thoại liên hệ');
    await count(id(page, 'rev-my-reviews-item-edit'), 0);
    await id(page, 'rev-my-reviews-item-delete').click();
    await id(page, 'rev-my-reviews-delete-confirm').click();
    await see(id(page, 'rev-my-reviews-delete-success'));
    await count(id(page, 'rev-my-reviews-item'), 0);
    await id(page, 'rev-my-reviews-filter-status').getByRole('button', { name: 'Bị ẩn' }).click();
    await see(id(page, 'rev-my-reviews-empty-filter'));
    await id(page, 'rev-my-reviews-filter-status').getByRole('button', { name: 'Bị từ chối' }).click();
    await see(id(page, 'rev-my-reviews-empty-filter'));
    // viết lại được sau khi xóa
    const g = await page.evaluate(async ({ api, p }) => (await fetch(`${api}/products/${p}/review-eligibility`, { credentials: 'include' })).json(), { api: API, p: p2 });
    expect(g).toEqual({ eligible: true, reason: null });
  });

  e2e('REV-E2E-20261006-104528486: customer sửa bình luận đánh giá đã đăng (tắt kiểm duyệt trước) và công khai hiện nhãn đã chỉnh sửa', async (page) => {
    const { p1 } = await shop();
    await setPreModeration(false);
    await seedReview({ email: A, product_id: p1, status: 'published', rating: 5, comment: 'Tốt' });
    await loginUi(page, A);
    await page.goto('/me/reviews');
    await id(page, 'rev-my-reviews-item-edit').click();
    await see(id(page, 'rev-review-form-save'));
    await count(id(page, 'rev-review-form-submit'), 0);
    await count(id(page, 'rev-review-form-edit-notice'), 0);
    expect(await id(page, 'rev-review-form-comment').inputValue()).toBe('Tốt');
    await id(page, 'rev-review-form-comment').fill('');
    await id(page, 'rev-review-form-comment').fill('Đã dùng một tháng, vẫn tốt');
    await id(page, 'rev-review-form-save').click();
    await urlIs(page, /\/me\/reviews/);
    await see(id(page, 'rev-review-form-save-success'));
    await productPage(page, p1);
    await hasText(id(page, 'rev-product-reviews-item-comment'), 'Đã dùng một tháng, vẫn tốt');
    await see(id(page, 'rev-product-reviews-item-edited'));
    expect((await reviewState({ email: A, product_id: p1 }))?.events).toEqual([]);
  });

  e2e('REV-E2E-20261006-104528519: customer xóa đánh giá đã đăng và danh sách công khai không còn nó', async (page) => {
    const { cat } = await shop();
    const p = await seedProduct({ name: 'Tất cổ cao', category_id: cat });
    await seedReview({ email: A, product_id: p, status: 'published', rating: 4 });
    await loginUi(page, A);
    await page.goto('/me/reviews');
    await id(page, 'rev-my-reviews-item-delete').click();
    await see(id(page, 'rev-my-reviews-delete-dialog'));
    await id(page, 'rev-my-reviews-delete-dismiss').click();
    await count(id(page, 'rev-my-reviews-delete-dialog'), 0);
    await count(id(page, 'rev-my-reviews-item'), 1);
    await id(page, 'rev-my-reviews-item-delete').click();
    await id(page, 'rev-my-reviews-delete-confirm').click();
    await see(id(page, 'rev-my-reviews-delete-success'));
    await see(id(page, 'rev-my-reviews-empty'));
    await productPage(page, p);
    await see(id(page, 'rev-product-reviews-empty'));
    contains(/^0\b/, await textOf(id(page, 'rev-product-reviews-count')));
  });

  e2e('REV-E2E-20261006-104528550: guest xem đánh giá, lọc theo sao và đổi sắp xếp', async (page) => {
    const { p1 } = await shop();
    for (const [i, rating] of [5, 4, 4, 2].entries()) {
      await seedUser({ email: `u${i}@x.vn`, name: `Khách ${i}` });
      await seedReview({ email: `u${i}@x.vn`, product_id: p1, status: 'published', rating, age_ms: (10 - i) * 600_000 });
    }
    await productPage(page, p1);
    await hasText(id(page, 'rev-product-reviews-avg'), '3,8');
    contains(/^4\b/, await textOf(id(page, 'rev-product-reviews-count')));
    await count(id(page, 'rev-product-reviews-distribution').locator('li'), 5);
    await see(id(page, 'rev-product-reviews-login-prompt'));
    await count(id(page, 'rev-product-reviews-write-button'), 0);
    await id(page, 'rev-product-reviews-filter-rating').selectOption({ label: '4 sao' });
    await count(id(page, 'rev-product-reviews-item'), 2);
    for (const r of await id(page, 'rev-product-reviews-item-rating').all()) contains(/4/, await r.innerText());
    contains(/^4\b/, await textOf(id(page, 'rev-product-reviews-count')));
    await id(page, 'rev-product-reviews-filter-rating').selectOption({ label: 'Tất cả sao' });
    await id(page, 'rev-product-reviews-sort').selectOption({ label: 'Điểm thấp' }); // NGAY SAU lần đổi trước, không chờ: hai lần đổi URL liền nhau cộng dồn (lần sau không dùng chuỗi truy vấn cũ làm sống lại bộ lọc 4 sao)
    await count(id(page, 'rev-product-reviews-item'), 4);
    expect(page.url()).not.toMatch(/rating=/);
    expect(page.url()).toMatch(/sort=lowest/);
    contains(/2/, await id(page, 'rev-product-reviews-item-rating').first().innerText());
  });

  e2e('REV-E2E-20261006-104528580: customer chưa nhận hàng thấy lý do chưa đánh giá được', async (page) => {
    const { cat } = await shop();
    const hat = await seedProduct({ name: 'Mũ lưỡi trai', category_id: cat });
    await seedOrder({ email: A, status: 'shipped', items: [{ product: hat, name: 'Mũ lưỡi trai' }] } as never);
    await loginUi(page, A);
    await productPage(page, hat);
    await hasText(id(page, 'rev-product-reviews-ineligible-reason'), 'Bạn có thể đánh giá sau khi nhận hàng');
    await count(id(page, 'rev-product-reviews-write-button'), 0);
    await see(id(page, 'rev-product-reviews-empty'));
  });

  e2e('REV-E2E-20261006-104528614: admin ẩn đánh giá đã đăng, đánh giá biến khỏi trang công khai, rồi bỏ ẩn thì hiện lại', async (page) => {
    const { p1 } = await shop();
    await seedUser({ email: 'b@x.vn', name: 'Lê Bình' });
    await seedReview({ email: A, product_id: p1, status: 'published', rating: 1, comment: 'tệ', age_ms: 7200_000 });
    await seedReview({ email: 'b@x.vn', product_id: p1, status: 'published', rating: 5, comment: 'tốt', age_ms: 3600_000 });
    await loginUi(page, ADMIN);
    await page.goto('/admin/reviews');
    await id(page, 'rev-admin-moderation-tabs').getByRole('tab', { name: /Đã đăng/ }).click();
    await count(id(page, 'rev-admin-moderation-row'), 2);
    const row1 = id(page, 'rev-admin-moderation-row').filter({ hasText: 'tệ' });
    await row1.getByTestId('rev-admin-moderation-row-hide').click();
    await see(id(page, 'rev-admin-moderation-hide-dialog'));
    await id(page, 'rev-admin-moderation-hide-reason').fill('Lời lẽ xúc phạm');
    await id(page, 'rev-admin-moderation-hide-confirm').click();
    await see(id(page, 'rev-admin-moderation-action-success'));
    await count(id(page, 'rev-admin-moderation-row'), 1);
    await id(page, 'rev-admin-moderation-tabs').getByRole('tab', { name: /Bị ẩn/ }).click();
    await count(id(page, 'rev-admin-moderation-row'), 1);
    await hasText(id(page, 'rev-admin-moderation-row-reason'), 'Lời lẽ xúc phạm');
    await productPage(page, p1);
    contains(/^1\b/, await textOf(id(page, 'rev-product-reviews-count')));
    await count(id(page, 'rev-product-reviews-list').getByText('tệ'), 0);
    await page.goto('/admin/reviews?status=hidden');
    await id(page, 'rev-admin-moderation-row-unhide').click();
    await see(id(page, 'rev-admin-moderation-action-success'));
    await count(id(page, 'rev-admin-moderation-row'), 0);
    await productPage(page, p1);
    await eventually(async () => { contains(/^2\b/, await textOf(id(page, 'rev-product-reviews-count'))); });
    await see(id(page, 'rev-product-reviews-list').getByText('tệ'));
  });

  e2e('REV-E2E-20261006-140000006: customer sửa đánh giá đã đăng khi bật kiểm duyệt trước thấy cảnh báo, đánh giá về chờ duyệt và biến khỏi trang công khai', async (page) => {
    const { cat } = await shop();
    const p = await seedProduct({ name: 'Tất cổ cao', category_id: cat });
    await seedReview({ email: A, product_id: p, status: 'published', rating: 5, comment: 'Êm' });
    await loginUi(page, A);
    await page.goto('/me/reviews');
    await id(page, 'rev-my-reviews-item-edit').click();
    await see(id(page, 'rev-review-form-edit-notice'));
    await id(page, 'rev-review-form-comment').fill('Êm, dùng một tháng chưa sờn');
    await id(page, 'rev-review-form-save').click();
    await see(id(page, 'rev-review-form-save-success'));
    contains(/sẽ hiện lại sau khi được duyệt/, await textOf(id(page, 'rev-review-form-save-success')));
    await urlIs(page, /\/me\/reviews/);
    await hasText(id(page, 'rev-my-reviews-item-status'), 'Chờ duyệt');
    await productPage(page, p);
    await see(id(page, 'rev-product-reviews-empty'));
    contains(/^0\b/, await textOf(id(page, 'rev-product-reviews-count')));
    expect((await reviewState({ email: A, product_id: p }))?.events).toEqual(['ReviewUnpublished']);
  });

  e2e('REV-SEC-20261006-103618395 T7 (DOM): bình luận và tên người viết chứa HTML hiện thành chữ thường ở trang công khai, Đánh giá của tôi và hàng đợi, không chạy script', async (page) => {
    const { p1 } = await shop();
    const html = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>đậm</b>';
    await seedUser({ email: 'x@x.vn', name: 'Nguyễn Văn <svg onload=window.__xss=3>' });
    await seedReview({ email: 'x@x.vn', product_id: p1, status: 'published', rating: 3, comment: html, reason: undefined });
    await seedReview({ email: A, product_id: p1, status: 'pending', rating: 4, comment: html });
    const clean = async (p: Page, testid: string) => {
      const box = id(p, testid).first();
      await see(box);
      expect(await box.innerText()).toContain(html); // đúng từng ký tự, hiện như chữ
      expect(await box.locator('img, script, b, svg').count()).toBe(0);
      expect(await p.evaluate(() => (globalThis as unknown as { __xss?: number }).__xss)).toBeUndefined();
    };
    await productPage(page, p1);
    await clean(page, 'rev-product-reviews-item-comment');
    expect(await id(page, 'rev-product-reviews-item-reviewer').first().locator('img, script, svg').count()).toBe(0);
    await loginUi(page, A);
    await page.goto('/me/reviews');
    await clean(page, 'rev-my-reviews-item-comment');
    await withPage(env.browser, async (adminPage) => {
      await loginUi(adminPage, ADMIN);
      await adminPage.goto('/admin/reviews');
      await clean(adminPage, 'rev-admin-moderation-row-comment');
    });
  });

  e2e('REV-SEC-20261006-103618395 T8 (sửa không cắt ảnh): sửa chỉ bình luận giữ nguyên ảnh đã gắn; gỡ một ảnh trong form thì đánh giá còn một ảnh', async (page) => {
    const { p1 } = await shop();
    const r = await seedReview({ email: A, product_id: p1, status: 'pending', rating: 4, comment: 'gốc', images: 2 });
    await loginUi(page, A);
    await page.goto(`/me/reviews/${r.id}/edit`);
    await count(id(page, 'rev-review-form-image-item'), 2);
    await id(page, 'rev-review-form-comment').fill('đã sửa bình luận');
    await id(page, 'rev-review-form-save').click();
    await see(id(page, 'rev-review-form-save-success'));
    let st = await reviewState({ id: r.id });
    expect([st?.comment, st?.images]).toEqual(['đã sửa bình luận', 2]); // ảnh không bị cắt khi chỉ sửa chữ
    await page.goto(`/me/reviews/${r.id}/edit`);
    await count(id(page, 'rev-review-form-image-item'), 2);
    await id(page, 'rev-review-form-image-remove').first().click();
    await hasText(id(page, 'rev-review-form-image-count'), '1 / 5');
    await id(page, 'rev-review-form-save').click();
    await see(id(page, 'rev-review-form-save-success'));
    st = await reviewState({ id: r.id });
    expect([st?.comment, st?.images]).toEqual(['đã sửa bình luận', 1]);
  });

  e2e('REV-SEC-20261006-103618395 T6 (trạng thái có thời hạn có đường thoát): form viết đánh giá bị 429 báo thử lại sau và khóa nút gửi; hết thời gian chờ thì nút gửi mở lại', async (page) => {
    await seedUser({ email: A, name: 'Nguyễn Văn An' });
    const cat = await seedCategory('Áo');
    const products: string[] = [];
    for (let i = 0; i < 11; i++) products.push(await seedProduct({ name: `Sản phẩm ${i}`, category_id: cat }));
    await seedOrder({ email: A, status: 'delivered', items: products.map((product, i) => ({ product, name: `Sản phẩm ${i}` })) } as never);
    await alignWindow(3600); // bậc B: 10 lần tạo mỗi giờ, cửa sổ cố định 3600 giây
    await loginUi(page, A);
    const create = (product: string) => page.evaluate(async ({ api, product }) => {
      const r = await fetch(`${api}/products/${product}/reviews`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ rating: 5 }) });
      return { status: r.status, retry: Number(r.headers.get('Retry-After')) };
    }, { api: API, product });
    for (let i = 0; i < 10; i++) expect((await create(products[i])).status).toBe(201);
    const probe = await create(products[10]); // lần thứ 11: 429, cho biết còn bao lâu hết cửa sổ
    expect(probe.status).toBe(429);
    await advance((probe.retry - 25) * 1000); // còn khoảng 25 giây: đủ để mở form, đủ ngắn để chờ hết giờ
    await loginUi(page, A); // phiên cũ hết hạn nhàn rỗi 30 phút theo đồng hồ đã tua; bộ đếm của bậc B gắn theo người dùng nên vẫn còn
    await page.goto(`/products/${products[10]}/reviews/new`);
    await see(id(page, 'rev-review-form-submit'));
    await radio(page, 5).click();
    await id(page, 'rev-review-form-submit').click();
    await see(id(page, 'rev-review-form-ratelimit'));
    contains(/thử lại sau/, await textOf(id(page, 'rev-review-form-ratelimit')));
    expect(await id(page, 'rev-review-form-submit').first().isDisabled()).toBe(true);
    await eventually(async () => { expect(await id(page, 'rev-review-form-submit').first().isEnabled()).toBe(true); }, 60_000); // hết giờ chờ: nút gửi mở lại, không kẹt
    await count(id(page, 'rev-review-form-ratelimit'), 0);
    await id(page, 'rev-review-form-submit').click();
    await see(id(page, 'rev-review-form-success-pending'));
  });

  e2e('REV-SEC-20261006-103618395 T5, T16 (luồng THẬT) và REV-E2E-20261006-104528391: đặt hàng COD, bàn giao, giao hàng (CHK, SHP, ORD thật), đánh giá, admin duyệt, điểm hiện ở trang sản phẩm', async (page) => {
    await seedUser({ email: A, name: 'Nguyễn Văn An' });
    await seedUser({ email: ADMIN, role: 'admin', name: 'Quản Trị' });
    await seedAddress({ email: A, receiver: 'Nguyễn An', phone: '0901111111', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1', city: 'Hồ Chí Minh', is_default: true, age_ms: 60_000 });
    const cat = await seedCategory('Áo');
    const p1 = await seedProduct({ name: 'Áo thun cotton', category_id: cat, price: 150000 });
    await seedStock({ product_id: p1, on_hand: 10 });
    await seedShippingMethod({ name: 'Giao tiêu chuẩn', base_fee: 30000 });
    await loginUi(page, A);
    // chưa mua: chưa đánh giá được
    await productPage(page, p1);
    await hasText(id(page, 'rev-product-reviews-ineligible-reason'), 'Chỉ đánh giá được sản phẩm đã mua');
    // đặt hàng COD thật qua giao diện
    const add = await page.evaluate(async ({ api, product }) => (await fetch(`${api}/cart/items`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: product, quantity: 1 }) })).status, { api: API, product: p1 });
    expect([200, 201]).toContain(add);
    await page.goto('/cart');
    await id(page, 'crt-cart-summary-checkout-link').click();
    await urlIs(page, /\/checkout(\?|$)/);
    await see(id(page, 'chk-checkout-address-section'));
    for (const t of ['chk-checkout-shipping-option', 'chk-checkout-payment-cod']) { const l = id(page, t); await see(l); if (!(await l.first().isChecked())) await l.first().click(); }
    await id(page, 'chk-checkout-place-order').click();
    await urlIs(page, /\/checkout\/complete\?/);
    const code = (await textOf(id(page, 'chk-checkout-complete-order-code'))).trim();
    await relay(); // OrderCreated, OrderConfirmed: SHP tạo vận đơn
    await productPage(page, p1);
    await hasText(id(page, 'rev-product-reviews-ineligible-reason'), 'Bạn có thể đánh giá sau khi nhận hàng'); // đơn đã đặt nhưng chưa giao
    // admin bàn giao rồi giao hàng qua API thật của SHP (một ngữ cảnh trình duyệt riêng), event ShipmentShipped, ShipmentDelivered đi qua outbox tới ORD
    await withPage(env.browser, async (adminPage) => {
      await loginUi(adminPage, ADMIN);
      const call = (path: string, body: unknown) => adminPage.evaluate(async ({ api, path, body }) => (await fetch(`${api}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, { api: API, path, body });
      expect(await call(`/shipping/orders/${code}/shipment/ship`, { tracking_number: 'GHN123456789' })).toBe(200);
      await relay();
      expect(await call(`/shipping/orders/${code}/shipment/deliver`, {})).toBe(200);
      await relay();
    });
    await eventually(async () => { expect((await orderState(code))?.status).toBe('delivered'); });
    await advance(0);
    await productPage(page, p1);
    await id(page, 'rev-product-reviews-write-button').click();
    await see(id(page, 'rev-review-form-verified'));
    await radio(page, 5).click();
    await id(page, 'rev-review-form-comment').fill('Giao nhanh, vải đẹp');
    await id(page, 'rev-review-form-submit').click();
    await see(id(page, 'rev-review-form-success-pending'));
    const st0 = await reviewState({ email: A, product_id: p1 });
    expect([st0?.status, st0?.prd]).toEqual(['pending', { rating_count: 0, rating_sum: 0 }]); // chưa duyệt: chưa tính điểm
    await withPage(env.browser, async (adminPage) => {
      await loginUi(adminPage, ADMIN);
      await adminPage.goto('/admin/reviews');
      await count(id(adminPage, 'rev-admin-moderation-row'), 1);
      await id(adminPage, 'rev-admin-moderation-row-approve').click();
      await see(id(adminPage, 'rev-admin-moderation-action-success'));
    });
    await relay(); // ReviewPublished tới PRD
    const st1 = await reviewState({ email: A, product_id: p1 });
    expect([st1?.status, st1?.events, st1?.prd]).toEqual(['published', ['ReviewPublished'], { rating_count: 1, rating_sum: 5 }]);
    await productPage(page, p1);
    await hasText(id(page, 'rev-product-reviews-avg'), '5,0');
    await see(id(page, 'rev-product-reviews-item-verified'));
    await page.goto(`/products/${p1}`);
    await eventually(async () => { contains(/5/, await textOf(id(page, 'prd-product-detail-rating'))); });
    await alignWindow(60);
  });
});
