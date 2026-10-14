import sharp from 'sharp';
import type { Page } from 'playwright-core';
import { advance, alignWindow, count, eventually, hasText, id, loginUi, reset, s3Keys, see, seedAddress, seedUser, startE2e, textOf, withPage, type E2eEnv, API } from './support';
import { gif } from '../support/images';

// E2E của USR chạy bằng Jest và playwright-core điều khiển Chromium thật: API thật trên PostgreSQL thật (CSDL `ecom_e2e`), kho ảnh là dịch vụ S3 giả
// trong tiến trình của máy chủ E2E (client S3 thật của USR nói chuyện với nó qua HTTP), bản build production của web. Mỗi test: CSDL sạch, ngữ cảnh trình duyệt mới.
let env: E2eEnv;
beforeAll(async () => { env = await startE2e(); }, 420_000);
afterAll(async () => { await env?.stop(); });
beforeEach(async () => { await reset(); });
const e2e = (name: string, fn: (page: Page) => Promise<void>) => it(name, () => withPage(env.browser, fn), 150_000);
const field = (page: Page, testid: string, name: string) => page.locator(`[data-testid="${testid}"][data-field="${name}"]`);
const val = (page: Page, testid: string) => id(page, testid).inputValue();
const row = (page: Page, receiver: string) => id(page, 'usr-address-list-row').filter({ hasText: receiver });
/** Trình duyệt không được bật hộp thoại (alert) trong suốt test: bằng chứng chuỗi giống HTML không thực thi (SB-12). */
const noDialogs = (page: Page): string[] => { const seen: string[] = []; page.on('dialog', (d) => { seen.push(d.message()); void d.dismiss(); }); return seen; };
const jpeg = (): Promise<Buffer> => sharp({ create: { width: 300, height: 200, channels: 3, background: '#e11d48' } }).jpeg().toBuffer();
const upload = (page: Page, name: string, buffer: Buffer, mimeType: string) => id(page, 'usr-profile-avatar-upload').setInputFiles({ name, mimeType, buffer });

describe('E2E USR (trình duyệt thật, API thật)', () => {
  e2e('USR-E2E-20261006-102054347: customer sửa hồ sơ, tải ảnh sai rồi tải ảnh đúng và xóa ảnh (có kiểm trạng thái giới hạn tải ảnh và thoát khỏi nó, chuỗi giống HTML không thực thi)', async (page) => {
    const dialogs = noDialogs(page);
    await seedUser({ email: 'u1@shop.vn', name: 'Nguyễn An' });
    await loginUi(page, 'u1@shop.vn');
    await page.goto('/account/profile');
    await eventually(async () => expect(await val(page, 'usr-profile-full-name')).toBe('Nguyễn An'));
    expect(await textOf(id(page, 'usr-profile-email'))).toBe('u1@shop.vn');
    expect(await textOf(id(page, 'usr-profile-email-verified'))).toBe('Đã xác minh');

    await id(page, 'usr-profile-full-name').fill('');
    await id(page, 'usr-profile-phone').fill('12345');
    await id(page, 'usr-profile-save').click();
    await see(field(page, 'usr-profile-field-error', 'full_name'));
    await see(field(page, 'usr-profile-field-error', 'phone'));
    expect([await val(page, 'usr-profile-full-name'), await val(page, 'usr-profile-phone')]).toEqual(['', '12345']); // nội dung giữ nguyên

    await id(page, 'usr-profile-full-name').fill('Nguyễn Văn An');
    await id(page, 'usr-profile-phone').fill('+84 901 234 567');
    await id(page, 'usr-profile-save').click();
    await see(id(page, 'usr-profile-saved'));
    await eventually(async () => expect(await val(page, 'usr-profile-phone')).toBe('0901234567')); // giá trị chuẩn hóa từ server

    await upload(page, 'anim.gif', gif(), 'image/gif');
    await eventually(async () => expect(await id(page, 'usr-profile-avatar-error').getAttribute('data-reason')).toBe('unsupported_type'));
    expect(await id(page, 'usr-profile-avatar-image').getAttribute('data-has-image')).toBe('false'); // ảnh không đổi
    expect(await s3Keys()).toEqual([]);

    await upload(page, 'me.jpg', await jpeg(), 'image/jpeg');
    await eventually(async () => expect(await id(page, 'usr-profile-avatar-image').getAttribute('data-has-image')).toBe('true'));
    await count(id(page, 'usr-profile-avatar-uploading'), 0); // đã hiện rồi mất
    await see(id(page, 'usr-profile-avatar-remove'));
    await count(id(page, 'usr-profile-avatar-error'), 0);
    await eventually(async () => expect(await s3Keys()).toHaveLength(1));
    await eventually(async () => expect(await id(page, 'usr-profile-avatar-image').locator('img').evaluate((i) => { const im = i as unknown as { complete: boolean; naturalWidth: number }; return im.complete && im.naturalWidth; })).toBe(512)); // ảnh lưu 512 và tải được từ kho

    await id(page, 'usr-profile-avatar-remove').click();
    await eventually(async () => expect(await id(page, 'usr-profile-avatar-image').getAttribute('data-has-image')).toBe('false'));
    await count(id(page, 'usr-profile-avatar-remove'), 0);
    await eventually(async () => expect(await s3Keys()).toEqual([]));

    // chuỗi giống HTML hiển thị như chữ (USR-TC-20261006-102053348 tầng giao diện)
    await id(page, 'usr-profile-full-name').fill('<script>alert(1)</script>');
    await id(page, 'usr-profile-save').click();
    await eventually(async () => expect(await val(page, 'usr-profile-full-name')).toBe('<script>alert(1)</script>'));
    await id(page, 'auth-account-menu-trigger').click();
    await hasText(id(page, 'auth-account-menu-name'), '<script>alert(1)</script>');
    expect(await page.locator('main script, header script').count()).toBe(0);

    // bị giới hạn tải ảnh (10 lần mỗi giờ) rồi thoát khỏi trạng thái đó khi hết giờ chờ, không phải tải lại trang (bài học L45)
    await page.clock.install();
    const png64 = (await sharp({ create: { width: 40, height: 40, channels: 3, background: '#22c55e' } }).png().toBuffer()).toString('base64');
    await page.evaluate(async ([b64, api]) => { // 8 lần tải tự động: cùng gif và me.jpg ở trên là 10 lần trong giờ này
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      for (let i = 0; i < 8; i++) {
        const f = new FormData(); f.append('file', new Blob([bytes], { type: 'image/png' }), 'x.png');
        const r = await fetch(`${api}/me/avatar`, { method: 'PUT', body: f, credentials: 'include' });
        if (r.status !== 200) throw new Error(`tải ${i}: ${r.status}`);
      }
    }, [png64, API]);
    await upload(page, 'again.jpg', await jpeg(), 'image/jpeg'); // lần tải thứ 11 của giờ này
    await see(id(page, 'usr-profile-avatar-rate-limited'));
    expect(await id(page, 'usr-profile-avatar-upload').isDisabled()).toBe(true);
    await page.clock.fastForward(3_700_000);
    await count(id(page, 'usr-profile-avatar-rate-limited'), 0);
    await eventually(async () => expect(await id(page, 'usr-profile-avatar-upload').isDisabled()).toBe(false));
    expect(dialogs).toEqual([]);
  });

  e2e('USR-E2E-20261006-102054373 và USR-E2E-20261007-085336817 (trạng thái bị giới hạn: banner, nút khóa, thoát khi hết giờ): customer đổi mật khẩu: sai mật khẩu hiện tại, bị giới hạn rồi đổi thành công', async (page) => {
    await alignWindow(3600); await seedUser({ email: 'u1@shop.vn', password: 'Old-Password-1' }); // alignWindow: năm lần sai (cửa sổ 15 phút) và mười lần gọi (cửa sổ 1 giờ) nằm trọn một cửa sổ mỗi loại, không đỏ khi chạy qua ranh giới giờ (REV-REV-14)
    await loginUi(page, 'u1@shop.vn', 'Old-Password-1');
    await page.goto('/account/password');
    await see(id(page, 'usr-change-password-form'));

    const submit = async (current: string, next: string) => {
      await id(page, 'usr-change-password-current').fill(current);
      await id(page, 'usr-change-password-new').fill(next);
      await id(page, 'usr-change-password-submit').click();
    };
    await submit('Wrong-Password-1', 'New-Password-22');
    await see(field(page, 'usr-change-password-field-error', 'current_password'));
    await eventually(async () => expect(await val(page, 'usr-change-password-current')).toBe('')); // ô lỗi được xóa trắng

    await submit('Old-Password-1', 'short');
    await see(field(page, 'usr-change-password-field-error', 'new_password'));

    for (let i = 0; i < 4; i++) { // tổng 5 lần sai
      await submit('Wrong-Password-1', 'New-Password-22');
      await eventually(async () => expect(await val(page, 'usr-change-password-current')).toBe(''));
    }
    await page.clock.install(); // để tua giờ chờ của giao diện (không phải đồng hồ máy chủ)
    await submit('Old-Password-1', 'New-Password-22');
    await see(id(page, 'usr-change-password-rate-limited'));
    expect(await textOf(id(page, 'usr-change-password-rate-limited'))).toMatch(/\d+ phút/);
    expect(await id(page, 'usr-change-password-submit').isDisabled()).toBe(true);
    await page.clock.fastForward(16 * 60_000); // hết giờ chờ: banner mất và nút mở lại, không phải tải lại trang
    await count(id(page, 'usr-change-password-rate-limited'), 0);
    await eventually(async () => expect(await id(page, 'usr-change-password-submit').isDisabled()).toBe(false));

    await advance(16 * 60_000); // đồng hồ máy chủ lùi qua cửa sổ 15 phút
    await page.reload();
    await see(id(page, 'usr-change-password-form'));
    await submit('Old-Password-1', 'New-Password-22');
    await see(id(page, 'usr-change-password-success'));
    expect(await textOf(id(page, 'usr-change-password-success'))).toMatch(/0 thiết bị khác/);
    await see(id(page, 'auth-account-menu-trigger')); // vẫn đăng nhập (đã có phiên mới)
    expect(await val(page, 'usr-change-password-current')).toBe('');
  });

  e2e('USR-E2E-20261006-102054399: customer dựng sổ địa chỉ: địa chỉ đầu mặc định, thêm, đặt mặc định, sửa, xóa mặc định', async (page) => {
    const dialogs = noDialogs(page);
    await seedUser({ email: 'u1@shop.vn' });
    await loginUi(page, 'u1@shop.vn');
    await page.goto('/account/addresses');
    await see(id(page, 'usr-address-list-empty'));
    await id(page, 'usr-address-list-add').click();

    const fill = async (o: { receiver: string; phone: string; line1: string; ward: string; district?: string; city: string; makeDefault?: boolean }) => {
      await id(page, 'usr-address-form-receiver').fill(o.receiver);
      await id(page, 'usr-address-form-phone').fill(o.phone);
      await id(page, 'usr-address-form-line1').fill(o.line1);
      await id(page, 'usr-address-form-ward').fill(o.ward);
      await id(page, 'usr-address-form-district').fill(o.district ?? '');
      await id(page, 'usr-address-form-city').fill(o.city);
      if (o.makeDefault !== undefined) await id(page, 'usr-address-form-default').setChecked(o.makeDefault);
    };
    await see(id(page, 'usr-address-form-default-locked')); // sổ rỗng: địa chỉ đầu tiên luôn mặc định
    await fill({ receiver: 'Nguyễn An', phone: '0901234567', line1: '12 Lê Lợi', ward: 'Bến Nghé', district: 'Quận 1', city: 'TP. Hồ Chí Minh' });
    await id(page, 'usr-address-form-submit').click();
    await count(id(page, 'usr-address-list-row'), 1);
    await see(row(page, 'Nguyễn An').getByTestId('usr-address-list-default-badge'));

    await id(page, 'usr-address-list-add').click();
    await fill({ receiver: 'Trần Bình', phone: '0987654321', line1: '45 Nguyễn Huệ', ward: 'Bến Nghé', city: 'TP. Hồ Chí Minh', makeDefault: false });
    await id(page, 'usr-address-form-submit').click();
    await count(id(page, 'usr-address-list-row'), 2);
    await count(row(page, 'Nguyễn An').getByTestId('usr-address-list-default-badge'), 1);
    await count(row(page, 'Trần Bình').getByTestId('usr-address-list-default-badge'), 0);

    await row(page, 'Trần Bình').getByTestId('usr-address-list-set-default').click();
    await see(id(page, 'usr-address-list-default-toast'));
    await count(row(page, 'Trần Bình').getByTestId('usr-address-list-default-badge'), 1);
    await count(row(page, 'Nguyễn An').getByTestId('usr-address-list-default-badge'), 0);
    expect(await id(page, 'usr-address-list-row').first().innerText()).toContain('Trần Bình'); // thẻ mặc định lên đầu

    await row(page, 'Nguyễn An').getByTestId('usr-address-list-edit').click();
    await eventually(async () => expect(await val(page, 'usr-address-form-line1')).toBe('12 Lê Lợi'));
    await id(page, 'usr-address-form-line1').fill('99 Pasteur');
    await id(page, 'usr-address-form-submit').click();
    await count(id(page, 'usr-address-list-row'), 2);
    expect(await row(page, 'Nguyễn An').innerText()).toContain('99 Pasteur');

    await row(page, 'Trần Bình').getByTestId('usr-address-list-delete').click();
    await id(page, 'usr-address-list-delete-confirm').click();
    await see(id(page, 'usr-address-list-deleted-toast'));
    await count(id(page, 'usr-address-list-row'), 1);
    await count(row(page, 'Nguyễn An').getByTestId('usr-address-list-default-badge'), 1); // địa chỉ còn lại thành mặc định

    // chuỗi giống HTML hiển thị như chữ (USR-TC-20261006-102053919 tầng giao diện)
    await id(page, 'usr-address-list-add').click();
    await fill({ receiver: 'Lê Cường', phone: '0912345678', line1: '<img src=x onerror=alert(1)>', ward: 'P1', city: 'Hà Nội', makeDefault: false });
    await id(page, 'usr-address-form-submit').click();
    await count(id(page, 'usr-address-list-row'), 2);
    expect(await row(page, 'Lê Cường').innerText()).toContain('<img src=x onerror=alert(1)>');
    expect(await page.locator('main img').count()).toBe(0);
    expect(dialogs).toEqual([]);
  });

  e2e('USR-E2E-20261006-102054425: customer chạm giới hạn 10 địa chỉ ở cả danh sách và form', async (page) => {
    await seedUser({ email: 'u1@shop.vn' });
    for (let i = 0; i < 9; i++) await seedAddress({ email: 'u1@shop.vn', receiver: `Người ${i}`, is_default: i === 0, age_ms: (9 - i) * 60_000 });
    await loginUi(page, 'u1@shop.vn');
    const tabA = page, tabB = await page.context().newPage();
    for (const p of [tabA, tabB]) {
      await p.goto('/account/addresses/new');
      await see(id(p, 'usr-address-form-form'));
    }
    const fillAndSubmit = async (p: Page, name: string) => {
      await id(p, 'usr-address-form-receiver').fill(name);
      await id(p, 'usr-address-form-phone').fill('0901234567');
      await id(p, 'usr-address-form-line1').fill('1 Lê Lợi');
      await id(p, 'usr-address-form-ward').fill('Bến Nghé');
      await id(p, 'usr-address-form-city').fill('TP. Hồ Chí Minh');
      await id(p, 'usr-address-form-submit').click();
    };
    await fillAndSubmit(tabA, 'Tab A');
    await count(id(tabA, 'usr-address-list-row'), 10);
    await see(id(tabA, 'usr-address-list-limit-notice'));
    expect(await id(tabA, 'usr-address-list-add').isDisabled()).toBe(true);

    await fillAndSubmit(tabB, 'Tab B');
    await see(id(tabB, 'usr-address-form-limit-reached'));
    expect(await val(tabB, 'usr-address-form-receiver')).toBe('Tab B'); // ô giữ nguyên nội dung
    await see(id(tabB, 'usr-address-form-limit-reached').getByRole('link'));
    await tabB.close();
  });

  e2e('USR-E2E-20261006-102054450: staff tra cứu khách theo email, thấy bản che, rồi gặp email không có', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'staff' });
    await seedUser({ email: 'an.nguyen@shop.vn', name: 'Nguyễn An', phone: '0901234567', avatar: true });
    await seedAddress({ email: 'an.nguyen@shop.vn', line1: '12 Lê Lợi', is_default: true });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/admin/customers');
    expect(await val(page, 'usr-customer-lookup-email')).toBe('');
    await count(id(page, 'usr-customer-lookup-result'), 0);

    await id(page, 'usr-customer-lookup-email').fill('An.Nguyen@Shop.vn');
    await id(page, 'usr-customer-lookup-submit').click();
    await see(id(page, 'usr-customer-lookup-result'));
    await hasText(id(page, 'usr-customer-lookup-name'), 'Nguyễn An');
    await hasText(id(page, 'usr-customer-lookup-result-email'), 'an***@shop.vn');
    await hasText(id(page, 'usr-customer-lookup-phone'), '090****567');
    await hasText(id(page, 'usr-customer-lookup-status'), 'Hoạt động');
    await see(id(page, 'usr-customer-lookup-masked-notice'));
    const card = await id(page, 'usr-customer-lookup-result').innerText();
    expect(card).not.toContain('12 Lê Lợi'); // staff không có khối địa chỉ hay ảnh
    await count(id(page, 'usr-customer-lookup-addresses'), 0);
    await count(id(page, 'usr-customer-lookup-avatar'), 0);

    await id(page, 'usr-customer-lookup-email').fill('ghost@shop.vn');
    await id(page, 'usr-customer-lookup-submit').click();
    await see(id(page, 'usr-customer-lookup-not-found'));
    await count(id(page, 'usr-customer-lookup-result'), 0);

    const sent: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/admin/customers')) sent.push(r.url()); });
    await id(page, 'usr-customer-lookup-email').fill('an');
    await id(page, 'usr-customer-lookup-submit').click();
    await see(id(page, 'usr-customer-lookup-field-error'));
    expect(sent).toEqual([]); // không có yêu cầu nào gửi lên máy chủ

    // mở thẻ bằng đường dẫn có id: staff nhận màn không có quyền (USR-REQ ...117 BR1)
    await page.goto('/admin/customers/99999999-9999-4999-8999-999999999999');
    await see(id(page, 'auth-access-denied-container'));
  });

  e2e('USR-E2E-20261006-102054475 và USR-E2E-20261007-085336850 (trạng thái bị giới hạn: banner, nút khóa, thoát khi hết giờ): admin tra cứu khách theo email và thấy hồ sơ đầy đủ kèm địa chỉ; bị giới hạn rồi thoát khỏi trạng thái đó', async (page) => {
    const dialogs = noDialogs(page);
    await seedUser({ email: 'ad1@shop.vn', role: 'admin' });
    await seedUser({ email: 'an.nguyen@shop.vn', name: 'Nguyễn An', phone: '0901234567', avatar: true });
    await seedUser({ email: 'xss@shop.vn', name: '<script>alert(1)</script>' });
    await seedAddress({ email: 'an.nguyen@shop.vn', receiver: 'Nguyễn An', line1: '12 Lê Lợi', is_default: true, age_ms: 120_000 });
    await seedAddress({ email: 'an.nguyen@shop.vn', receiver: 'Trần Bình', line1: '45 Nguyễn Huệ', age_ms: 60_000 });
    await loginUi(page, 'ad1@shop.vn');
    await page.goto('/admin/customers');
    await page.clock.install();

    await alignWindow(); // 31 lần tra cứu của bậc D (30 mỗi phút) phải nằm trọn một cửa sổ cố định: không có dòng này thì test đỏ khi chạy qua ranh giới phút (đỏ chập chờn ở review PAY)
    await id(page, 'usr-customer-lookup-email').fill('an.nguyen@shop.vn');
    await id(page, 'usr-customer-lookup-submit').click();
    await hasText(id(page, 'usr-customer-lookup-result-email'), 'an.nguyen@shop.vn');
    await hasText(id(page, 'usr-customer-lookup-phone'), '0901234567');
    await eventually(async () => expect(await id(page, 'usr-customer-lookup-avatar').getAttribute('data-has-image')).toBe('true'));
    await count(id(page, 'usr-customer-lookup-addresses').locator('li'), 2);
    await count(id(page, 'usr-customer-lookup-masked-notice'), 0);

    await id(page, 'usr-customer-lookup-email').fill('xss@shop.vn'); // tên giống HTML hiển thị như chữ (USR-TC-20261006-102053348 tầng giao diện)
    await id(page, 'usr-customer-lookup-submit').click();
    await hasText(id(page, 'usr-customer-lookup-name'), '<script>alert(1)</script>');
    expect(await page.locator('main script').count()).toBe(0);

    // tra cứu thứ 31 trong một phút: 2 lần trên giao diện, 28 lần tự động (cùng phiên trình duyệt), rồi lần thứ 31 trên giao diện
    await page.evaluate(async (api) => {
      for (let i = 0; i < 28; i++) {
        const r = await fetch(`${api}/admin/customers?email=ghost${i}@shop.vn`, { credentials: 'include' });
        if (r.status !== 404) throw new Error(`lần ${i}: ${r.status}`);
      }
    }, API);
    await id(page, 'usr-customer-lookup-email').fill('an.nguyen@shop.vn');
    await id(page, 'usr-customer-lookup-submit').click();
    await see(id(page, 'usr-customer-lookup-rate-limited'));
    expect(await textOf(id(page, 'usr-customer-lookup-rate-limited'))).toMatch(/\d+ giây/);
    expect(await id(page, 'usr-customer-lookup-submit').isDisabled()).toBe(true);
    await page.clock.fastForward(61_000); // hết giờ chờ: banner mất, nút mở lại
    await count(id(page, 'usr-customer-lookup-rate-limited'), 0);
    await eventually(async () => expect(await id(page, 'usr-customer-lookup-submit').isDisabled()).toBe(false));
    expect(dialogs).toEqual([]);
  });

  e2e('USR-E2E-20261006-102054499: staff sửa họ tên của chính mình và không thấy liên kết sổ địa chỉ', async (page) => {
    await seedUser({ email: 's1@shop.vn', role: 'staff', name: 'Staff Một' });
    await loginUi(page, 's1@shop.vn');
    await page.goto('/account/profile');
    await eventually(async () => expect(await val(page, 'usr-profile-full-name')).toBe('Staff Một'));
    await see(id(page, 'usr-profile-password-link'));
    await count(id(page, 'usr-profile-addresses-link'), 0);

    await id(page, 'usr-profile-full-name').fill('Hà Staff');
    await id(page, 'usr-profile-save').click();
    await see(id(page, 'usr-profile-saved'));

    await id(page, 'usr-profile-password-link').click();
    await see(id(page, 'usr-change-password-form'));

    // staff vào sổ địa chỉ của customer: màn không có quyền, không dựng sổ địa chỉ
    await page.goto('/account/addresses');
    await see(id(page, 'auth-access-denied-container'));
    await count(id(page, 'usr-address-list-row'), 0);
  });
});
