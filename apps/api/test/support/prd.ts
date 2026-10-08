import type { Test } from 'supertest';
import { PlatformModule } from '../../src/modules/platform';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { CatalogApi } from '../../src/modules/catalog';
import { CatalogModule } from '../../src/modules/catalog/catalog.module';
import { ImageService } from '../../src/modules/catalog/image.service';
import { RatingService } from '../../src/modules/catalog/rating.service';
import { searchTextOf, slugify } from '../../src/modules/catalog/text';
import { ORIGIN } from './app';
import { FakeS3 } from './fake-s3';
import type { S3Cfg } from './real-s3';
import { createAuthApp, http, q, seedSession, seedUser, type AuthApp, type SeedUser } from './auth';
import { call as callJson } from './usr';

export interface PrdApp extends AuthApp { fake: FakeS3; catalog: CatalogApi; images: ImageService; ratings: RatingService }

/** Ứng dụng thật (PlatformModule + AuthModule + CatalogModule), PostgreSQL thật, client S3 thật của platform nói chuyện với dịch vụ S3 giả trong tiến trình. */
export async function createPrdApp(o: { env?: Record<string, string>; level?: string; s3?: S3Cfg } = {}): Promise<PrdApp> {
  const fake = new FakeS3();
  await fake.start();
  const c = o.s3 ?? { endpoint: fake.url, bucket: fake.bucket, region: 'us-east-1', accessKey: fake.accessKey, secretKey: fake.secretKey };
  const storage = { STORAGE_ENDPOINT: c.endpoint, STORAGE_BUCKET: c.bucket, STORAGE_REGION: c.region, STORAGE_ACCESS_KEY: c.accessKey, STORAGE_SECRET_KEY: c.secretKey };
  const t = await createAuthApp({ imports: [PlatformModule, AuthModule, CatalogModule], controllers: [], level: o.level, env: { TRUST_PROXY_HOPS: '1', ...storage, ...(o.env ?? {}) } });
  const closeBase = t.close;
  return Object.assign(t, {
    fake, catalog: t.app.get(CatalogApi), images: t.app.get(ImageService), ratings: t.app.get(RatingService),
    close: async () => { await closeBase(); await fake.stop(); },
  });
}

export const call = callJson;
export interface Who extends SeedUser { cookie: string }
/** Người dùng có phiên (cookie dựng thẳng trong CSDL). */
export async function who(t: AuthApp, role: 'customer' | 'staff' | 'admin', email = `${role}@shop.vn`): Promise<Who> {
  const u = await seedUser(t, { email, role });
  return { ...u, cookie: (await seedSession(t, u.id)).cookie };
}

/** Tải ảnh multipart lên sản phẩm: một phần `file` (tên tùy ý, chỉ nội dung quyết định). */
export function uploadImage(t: AuthApp, cookie: string | undefined, productId: string, file: Buffer | null, o: { filename?: string; field?: string; origin?: string | null } = {}): Test {
  let r = http(t).post(`/api/v1/admin/products/${productId}/images`);
  if (cookie) r = r.set('Cookie', cookie);
  if (o.origin !== null) r = r.set('Origin', o.origin ?? ORIGIN);
  if (file) r = r.attach(o.field ?? 'file', file, { filename: o.filename ?? 'a.bin' });
  return r;
}

let n = 0;
/** Danh mục dựng thẳng trong CSDL (fixture); `depth` tính từ cha. */
export async function seedCategory(t: AuthApp, name: string, parent?: string | null, slug?: string): Promise<string> {
  const depth = parent ? (await q<{ depth: number }>(t, `SELECT depth FROM categories WHERE id = '${parent}'`))[0].depth + 1 : 1;
  const s = slug ?? `${slugify(name)}-${++n}`;
  const rows = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO categories (name, slug, parent_id, depth, created_at, updated_at) VALUES (${name}, ${s}, ${parent ?? null}::uuid, ${depth}, ${t.clock.now()}::timestamptz, ${t.clock.now()}::timestamptz) RETURNING id`;
  return rows[0].id;
}

export interface SeedProduct { name?: string; sku?: string; category: string; price?: number; status?: 'draft' | 'active' | 'archived'; description?: string | null; images?: number; ratingCount?: number; ratingSum?: number; publishedAt?: Date | null; version?: number; updatedAt?: Date }
/** Sản phẩm dựng thẳng trong CSDL; `images` ảnh có thật trong kho giả (khóa `products/<uuid>.webp`). Trả id. */
export async function seedProduct(t: PrdApp, o: SeedProduct): Promise<string> {
  const i = ++n;
  const name = o.name ?? `Sản phẩm ${i}`, sku = (o.sku ?? `SP-${String(i).padStart(4, '0')}`).toUpperCase();
  const status = o.status ?? 'active';
  const published = o.publishedAt === undefined ? (status === 'draft' ? null : new Date(t.clock.now().getTime() - i * 1000)) : o.publishedAt;
  const now = t.clock.now();
  const rows = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO products (category_id, name, sku, description, price, status, version, published_at, rating_count, rating_sum, search_text, created_at, updated_at)
    VALUES (${o.category}::uuid, ${name}, ${sku}, ${o.description ?? null}, ${o.price ?? 100000}, ${status}::product_status, ${o.version ?? 1}, ${published}::timestamptz, ${o.ratingCount ?? 0}, ${o.ratingSum ?? 0},
            ${searchTextOf(name, sku)}, ${now}::timestamptz, ${(o.updatedAt ?? now)}::timestamptz) RETURNING id`;
  const id = rows[0].id;
  for (let k = 1; k <= (o.images ?? 0); k++) await seedImage(t, id, k);
  return id;
}
export async function seedImage(t: PrdApp, productId: string, position: number, o: { ageMs?: number } = {}): Promise<string> {
  const key = `products/${crypto.randomUUID()}.webp`;
  t.fake.seed(key, Buffer.from('x'), new Date(t.clock.now().getTime() - (o.ageMs ?? 0)));
  const rows = await t.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO product_images (product_id, storage_key, content_type, width, height, bytes, position) VALUES (${productId}::uuid, ${key}, 'webp'::image_type, 10, 10, 1, ${position}) RETURNING id`;
  return rows[0].id;
}
export const auditOf = (t: AuthApp, action: string) =>
  q<{ actor_id: string; actor_role: string; target_id: string; before: any; after: any }>(t, `SELECT actor_id, actor_role, target_id, before, after FROM audit_logs WHERE action = '${action}' ORDER BY created_at, id`);
export const productRow = async (t: AuthApp, id: string) => (await q<any>(t, `SELECT status, version, price::int AS price, sku, name, category_id, published_at, rating_count, rating_sum FROM products WHERE id = '${id}'`))[0];
export const outbox = (t: AuthApp, type?: string) => q<{ type: string; aggregate_id: string; payload: any; id: string }>(t, `SELECT id, type, aggregate_id, payload FROM outbox_events ${type ? `WHERE type = '${type}'` : ''} ORDER BY occurred_at, id`);
export const count = async (t: AuthApp, table: string, where = 'TRUE'): Promise<number> => (await q<{ n: number }>(t, `SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n;
export { http, q };
