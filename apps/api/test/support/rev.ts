import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { Test } from 'supertest';
import { EventsService, JobRunner, OutboxRelay, PlatformModule } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { CatalogApi } from '../../src/modules/catalog';
import { CatalogModule } from '../../src/modules/catalog/catalog.module';
import { RatingService } from '../../src/modules/catalog/rating.service';
import { OrderModule } from '../../src/modules/order';
import { ImageService } from '../../src/modules/review/image.service';
import { ModerationService } from '../../src/modules/review/moderation.service';
import { ReadService } from '../../src/modules/review/read.service';
import { ReviewModule } from '../../src/modules/review';
import { ReviewService } from '../../src/modules/review/review.service';
import { ORIGIN } from './app';
import { createAuthApp, http, q, seedSession, seedUser, type AuthApp } from './auth';
import { FakeS3 } from './fake-s3';
import type { S3Cfg } from './real-s3';
import { insertOrder } from './order-fixture';
import { call as callJson, type CallOpts } from './usr';
import { seedCategory, seedProduct as seedProductPrd, who, type SeedProduct, type Who } from './prd';

export { q, who, http, seedCategory, type Who };
/** Sản phẩm dựng thẳng (fixture của PRD); ảnh sản phẩm (nếu có) ghi vào kho giả của `t`. */
export const seedProduct = (t: AuthApp, o: SeedProduct): Promise<string> => seedProductPrd(t as never, o);
export const call = callJson;

export interface RevApp extends AuthApp {
  fake: FakeS3; reviews: ReviewService; images: ImageService; moderation: ModerationService; reads: ReadService; jobs: JobRunner; ratings: RatingService; catalog: CatalogApi; category: string;
}

/**
 * Ứng dụng thật (PlatformModule + AuthModule + CatalogModule + OrderModule + ReviewModule), PostgreSQL thật; client S3 thật của platform nói chuyện với dịch vụ S3 giả trong tiến trình.
 * Pool lớn hơn mặc định test để chạy giao dịch song song thật. Đồng hồ giả đặt về GIỜ THẬT lúc dựng (không mốc ngày cố định): `created_at` ghi theo đồng hồ của ứng dụng, so với `now()` của CSDL.
 */
export async function createRevApp(o: { env?: Record<string, string>; level?: string; poolMax?: number; s3?: S3Cfg } = {}): Promise<RevApp> {
  const fake = new FakeS3();
  await fake.start();
  const c: S3Cfg = o.s3 ?? { endpoint: fake.url, bucket: fake.bucket, region: 'us-east-1', accessKey: fake.accessKey, secretKey: fake.secretKey }; // kho thật (MinIO) khi có `s3`, `fake` khi đó không được dùng
  const storage = { STORAGE_ENDPOINT: c.endpoint, STORAGE_BUCKET: c.bucket, STORAGE_REGION: c.region, STORAGE_ACCESS_KEY: c.accessKey, STORAGE_SECRET_KEY: c.secretKey };
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, CatalogModule, OrderModule, ReviewModule], controllers: [], level: o.level, env: { TRUST_PROXY_HOPS: '1', DB_POOL_MAX: String(o.poolMax ?? 16), ...storage, ...(o.env ?? {}) } });
  t.clock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  const closeBase = t.close;
  return Object.assign(t, {
    fake, reviews: t.app.get(ReviewService), images: t.app.get(ImageService), moderation: t.app.get(ModerationService), reads: t.app.get(ReadService), jobs: t.app.get(JobRunner),
    ratings: t.app.get(RatingService), catalog: t.app.get(CatalogApi), category: '',
    close: async () => { await closeBase(); await fake.stop(); },
  });
}

/** Đặt REVIEW_PRE_MODERATION cho ứng dụng thử (đọc lại ở mỗi lần dùng); trả hàm khôi phục. */
export function preModeration(t: AuthApp, on: boolean): () => void {
  const orig = t.config.get.bind(t.config) as (n: string) => unknown;
  const spy = jest.spyOn(t.config, 'get').mockImplementation(((n: string) => (n === 'REVIEW_PRE_MODERATION' ? on : orig(n))) as never);
  return () => spy.mockRestore();
}

export const key = (): string => randomUUID();
/** Gọi API có Idempotency-Key (mặc định mới mỗi lần); `key: null` là không gửi. */
export function createReview(t: AuthApp, cookie: string | undefined, productId: string, body: unknown, o: CallOpts & { key?: string | null; headers?: Record<string, string> } = {}): Test {
  let r = callJson(t, 'post', `/products/${productId}/reviews`, { cookie, body, origin: o.origin, contentType: o.contentType, ip: o.ip });
  const k = o.key === undefined ? key() : o.key;
  if (k !== null) r = r.set('Idempotency-Key', k);
  for (const [h, v] of Object.entries(o.headers ?? {})) r = r.set(h, v);
  return r;
}
export const patchReview = (t: AuthApp, cookie: string | undefined, id: string, body: unknown, o: CallOpts = {}) => callJson(t, 'patch', `/reviews/${id}`, { cookie, body, ...o });
export const deleteReview = (t: AuthApp, cookie: string | undefined, id: string, o: CallOpts = {}) => callJson(t, 'delete', `/reviews/${id}`, { cookie, ...o });
export const moderate = (t: AuthApp, cookie: string | undefined, id: string, action: 'approve' | 'reject' | 'hide' | 'unhide', body: unknown = {}, o: CallOpts = {}) =>
  callJson(t, 'post', `/admin/reviews/${id}/${action}`, { cookie, body, ...o });

let counter = 0;
export interface Delivered { order: { id: string; code: string; user: string }; item: string }
/** Đơn của `user` với một dòng cho `product` ở trạng thái `status` (mặc định `delivered` cách đây `daysAgo` ngày), dựng thẳng trong CSDL (fixture, không qua CHK). `deliveredAt` ghi đè mốc giao. */
export async function seedOrderItem(t: AuthApp, user: string, product: string, o: { status?: 'pending' | 'confirmed' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'expired' | 'returned'; daysAgo?: number; deliveredAt?: Date; extra?: string[] } = {}): Promise<Delivered> {
  const now = t.clock.now();
  const status = o.status ?? 'delivered';
  const deliveredAt = o.deliveredAt ?? new Date(now.getTime() - (o.daysAgo ?? 10) * 86_400_000);
  const items = [{ product, name: `Hàng ${++counter}` }, ...(o.extra ?? []).map((p) => ({ product: p, name: `Hàng ${++counter}` }))];
  const order = await insertOrder(t.prisma, now, { user, status, items, deliveredAt, createdAt: new Date(Math.min(deliveredAt.getTime(), now.getTime()) - 4 * 3600_000), method: 'vnpay' });
  const [row] = await q<{ id: string }>(t, `SELECT id FROM order_items WHERE order_id = '${order.id}' AND product_id = '${product}'`);
  return { order, item: row.id };
}

export interface SeedReview {
  user: string; product: string; status?: 'pending' | 'published' | 'rejected' | 'hidden' | 'deleted'; rating?: number; comment?: string | null; createdAt?: Date; publishedAt?: Date | null; editedAt?: Date | null;
  reason?: string | null; orderItem?: string; images?: number; moderatedBy?: string | null; deletedByRole?: 'customer' | 'admin'; imageAgeMs?: number;
}
/** Đánh giá dựng thẳng trong CSDL (fixture, không qua API; không outbox, không audit): cột kèm theo cho khớp CHECK; tự dựng đơn đã giao nếu chưa có `orderItem`. Trả id. */
export async function seedReview(t: RevApp | AuthApp, o: SeedReview): Promise<string> {
  const status = o.status ?? 'published';
  const created = o.createdAt ?? t.clock.now();
  const item = o.orderItem ?? (await seedOrderItem(t, o.user, o.product, { daysAgo: 20 })).item;
  const published = o.publishedAt !== undefined ? o.publishedAt : status === 'published' || status === 'hidden' ? created : null;
  const deleted = status === 'deleted' ? t.clock.now() : null;
  const reason = o.reason !== undefined ? o.reason : status === 'rejected' || status === 'hidden' ? 'Lý do kiểm duyệt' : null;
  const [r] = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO reviews (user_id, product_id, order_item_id, status, rating, comment, moderation_reason, moderated_by, moderated_at, published_at, edited_at, deleted_at, deleted_by_role, created_at, updated_at)
    VALUES (${o.user}::uuid, ${o.product}::uuid, ${item}::uuid, ${status}::review_status, ${o.rating ?? 5}, ${o.comment === undefined ? 'Rất tốt' : o.comment}, ${reason}, ${o.moderatedBy ?? null}::uuid,
            ${o.moderatedBy ? created : null}::timestamptz, ${published}::timestamptz, ${o.editedAt ?? null}::timestamptz, ${deleted}::timestamptz, ${deleted ? (o.deletedByRole ?? 'customer') : null}::review_actor_role,
            ${created}::timestamptz, ${created}::timestamptz) RETURNING id`;
  for (let i = 1; i <= (o.images ?? 0); i++) await seedImageRow(t, o.user, r.id, i, o.imageAgeMs);
  return r.id;
}
/** Dòng ảnh dựng thẳng (kèm object trong kho giả nếu `t.fake`): chưa gắn khi `review` rỗng. */
export async function seedImageRow(t: AuthApp | RevApp, user: string, review: string | null, position: number | null, ageMs = 0, o: { orphanedAgeMs?: number; noObject?: boolean } = {}): Promise<{ id: string; key: string }> {
  const key = `reviews/${randomUUID()}.webp`;
  const fake = (t as RevApp).fake;
  if (fake && !o.noObject) fake.seed(key, Buffer.from('x'), new Date(t.clock.now().getTime() - ageMs));
  const created = new Date(t.clock.now().getTime() - ageMs);
  const orphaned = o.orphanedAgeMs === undefined ? null : new Date(t.clock.now().getTime() - o.orphanedAgeMs);
  const [r] = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO review_images (user_id, review_id, position, storage_key, width, height, bytes, orphaned_at, created_at, updated_at)
    VALUES (${user}::uuid, ${review}::uuid, ${position}, ${key}, 100, 80, 1, ${orphaned}::timestamptz, ${created}::timestamptz, ${created}::timestamptz) RETURNING id`;
  return { id: r.id, key };
}

export const reviewRow = async (t: AuthApp, id: string) => (await q<any>(t, `SELECT id, user_id, product_id, order_item_id, status::text AS status, rating::int AS rating, comment, moderation_reason, moderated_by, moderated_at, published_at, edited_at, deleted_at, deleted_by_role::text AS deleted_by_role, created_at, updated_at FROM reviews WHERE id = '${id}'`))[0];
export const reviewsOf = (t: AuthApp, user: string, product?: string) => q<any>(t, `SELECT id, status::text AS status, rating::int AS rating, order_item_id FROM reviews WHERE user_id = '${user}' ${product ? `AND product_id = '${product}'` : ''} ORDER BY created_at, id`);
export const revCount = async (t: AuthApp, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM reviews WHERE ${where}`))[0].n;
export const imageRows = (t: AuthApp, where = 'TRUE') => q<{ id: string; user_id: string; review_id: string | null; position: number | null; storage_key: string; width: number; height: number; bytes: number; orphaned_at: Date | null; created_at: Date }>(t, `SELECT id, user_id, review_id, position, storage_key, width, height, bytes, orphaned_at, created_at FROM review_images WHERE ${where} ORDER BY created_at, position, id`);
export const revOutbox = (t: AuthApp, review?: string) =>
  q<{ id: string; type: string; aggregate_type: string; aggregate_id: string; payload: any; correlation_id: string; occurred_at: Date; dispatched_at: Date | null }>(
    t, `SELECT id, type, aggregate_type, aggregate_id, payload, correlation_id, occurred_at, dispatched_at FROM outbox_events WHERE type LIKE 'Review%' ${review ? `AND aggregate_id = '${review}'` : ''} ORDER BY occurred_at, id`);
export const revTypes = async (t: AuthApp, review?: string): Promise<string[]> => (await revOutbox(t, review)).map((e) => e.type);
export const revAudits = (t: AuthApp, target?: string) =>
  q<{ actor_id: string | null; actor_role: string; action: string; target_type: string; target_id: string; before: any; after: any; reason: string | null; created_at: Date }>(
    t, `SELECT actor_id, actor_role, action, target_type, target_id, before, after, reason, created_at FROM audit_logs WHERE action LIKE 'review.%' ${target ? `AND target_id = '${target}'` : ''} ORDER BY created_at, id`);
export const countOf = async (t: AuthApp, table: string, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n;
/** Ảnh chụp số dòng của bảng REV, outbox và audit (để khẳng định "không đổi gì"). */
export const snapshot = async (t: AuthApp): Promise<number[]> => [await countOf(t, 'reviews'), await countOf(t, 'review_images'), await countOf(t, 'outbox_events'), await countOf(t, 'audit_logs')];

/** Tải ảnh multipart: một phần `file` (tên và đuôi tùy ý, chỉ nội dung quyết định). */
export function uploadImage(t: AuthApp, cookie: string | undefined, file: Buffer | null, o: { filename?: string; field?: string; origin?: string | null; contentType?: string; ip?: string } = {}): Test {
  let r = http(t).post('/api/v1/review-images');
  if (cookie) r = r.set('Cookie', cookie);
  if (o.origin !== null) r = r.set('Origin', o.origin ?? ORIGIN);
  if (o.ip) r = r.set('X-Forwarded-For', o.ip);
  if (file) r = r.attach(o.field ?? 'file', file, { filename: o.filename ?? 'a.bin', contentType: o.contentType });
  return r;
}
/** Giao event cho mọi consumer qua relay (như PRD nhận event thật qua outbox). */
export async function relayAll(t: RevApp): Promise<void> {
  const relay = t.app.get(OutboxRelay);
  for (let i = 0; i < 20; i++) { const r = await relay.runOnce(new Date(Date.now() + 3_600_000 * (i + 1))); if (r.picked === 0) return; }
}
export { EventsService };
/** Trang chủ của sản phẩm cho PRD: điểm tổng hợp. */
export const productRating = async (t: AuthApp, id: string) => (await q<{ rating_count: number; rating_sum: number }>(t, `SELECT rating_count, rating_sum FROM products WHERE id = '${id}'`))[0];


export interface World { cat: string; p1: string; a: Who; b: Who; c: Who; staff: Who; admin: Who }
/** Dữ liệu mồi chung đầu thư mục tests của REV: customer A, B, C, staff S, admin D, sản phẩm P1 `active` "Áo thun cổ tròn". Họ tên: A "Nguyễn Văn An" (che thành "An N."), B "Lê", C "Trần Thị Bích Ngọc" (AUTH có CHECK họ tên không rỗng nên ca "Khách hàng" thử ở hàm `maskName`). */
export async function world(t: RevApp): Promise<World> {
  const cat = await seedCategory(t, 'Áo');
  const p1 = await seedProduct(t, { category: cat, name: 'Áo thun cổ tròn', images: 1 });
  const named = async (email: string, role: 'customer' | 'staff' | 'admin', name: string): Promise<Who> => {
    const u = await seedUser(t, { email, role, name });
    const year = new Date(t.clock.now().getTime() + 365 * 86_400_000);
    return { ...u, cookie: (await seedSession(t, u.id, { expiresAt: year, absoluteExpiresAt: year })).cookie }; // phiên sống lâu: test tua đồng hồ giả hàng giờ
  };
  const [a, b, c, staff, admin] = [await named('a@shop.vn', 'customer', 'Nguyễn Văn An'), await named('b@shop.vn', 'customer', 'Lê'), await named('c@shop.vn', 'customer', 'Trần Thị Bích Ngọc'), await named('s@shop.vn', 'staff', 'Nhân Viên'), await named('d@shop.vn', 'admin', 'Quản Trị')];
  return { cat, p1, a, b, c, staff, admin };
}
/** Khách có đơn đã giao chứa `product`, sẵn sàng đánh giá (mặc định giao 10 ngày trước). */
export const eligible = (t: RevApp, who: Who, product: string, daysAgo = 10): Promise<Delivered> => seedOrderItem(t, who.id, product, { daysAgo });

/** PNG hợp lệ đệm bằng chunk phụ (tEXt) trước IEND cho tới đúng `size` byte. */
export function padPng(png: Buffer, size: number): Buffer {
  let pad = size - png.length;
  if (pad < 0) throw new Error('PNG gốc đã lớn hơn kích thước đích');
  const iend = png.length - 12;
  const chunk = (data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from('tEXt', 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const parts: Buffer[] = [];
  while (pad > 0) {
    let n = Math.min(pad, 1_000_000 + 12);
    if (pad - n > 0 && pad - n < 12) n -= 12; // không để lại phần dư nhỏ hơn một chunk tối thiểu
    parts.push(chunk(Buffer.alloc(n - 12, 0x20)));
    pad -= n;
  }
  return Buffer.concat([png.subarray(0, iend), ...parts, png.subarray(iend)]);
}

/** Gài trigger tạm làm mọi INSERT vào `table` ném lỗi (thử rollback của giao dịch: audit lỗi, outbox lỗi); luôn gỡ khi xong. `when` giới hạn dòng (điều kiện SQL trên NEW). */
export async function failingTrigger<T>(t: AuthApp, table: string, fn: () => Promise<T>, when = 'TRUE'): Promise<T> {
  const name = `tmp_fail_${table}`;
  await q(t, `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN IF ${when} THEN RAISE EXCEPTION 'tmp failure injected'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await q(t, `CREATE TRIGGER ${name} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try { return await fn(); } finally { await q(t, `DROP TRIGGER IF EXISTS ${name} ON ${table}`); await q(t, `DROP FUNCTION IF EXISTS ${name}()`); }
}

let lastTick = 0;
/**
 * Đặt đồng hồ giả về GIỜ THẬT (làm tròn giây) nhưng luôn tiến hơn lần đặt trước ít nhất 61 giây: bộ đếm bậc C của giới hạn tần suất nằm trong bộ nhớ của ứng dụng (không bị `truncateAll` xóa)
 * và theo cửa sổ cố định theo đồng hồ, nên mỗi test cần một cửa sổ riêng để số lần gọi của test trước không làm test sau bị 429.
 */
export function freshClock(t: AuthApp): void {
  lastTick = Math.max(Date.now(), lastTick + 61_000);
  t.clock.set(new Date(Math.floor(lastTick / 1000) * 1000));
}
