import { argon2, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Băm mật khẩu argon2id bằng `node:crypto` (Node 24; ADR-015), không thêm phụ thuộc. Chuỗi lưu theo PHC: tham số nằm trong chuỗi
// nên đổi cấu hình thì phát hiện được băm cũ để băm lại (SB-01).
const argon2p = promisify(argon2);
export interface ArgonParams { memory: number; passes: number; parallelism: number }
const TAG_LENGTH = 32;
const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const derive = (password: string, salt: Buffer, p: ArgonParams, tagLength = TAG_LENGTH): Promise<Buffer> =>
  argon2p('argon2id', { message: Buffer.from(password, 'utf8'), nonce: salt, parallelism: p.parallelism, tagLength, memory: p.memory, passes: p.passes }) as Promise<Buffer>;

export async function hashPassword(password: string, p: ArgonParams): Promise<string> {
  const salt = randomBytes(16);
  const tag = await derive(password, salt, p);
  return `$argon2id$v=19$m=${p.memory},t=${p.passes},p=${p.parallelism}$${b64(salt)}$${b64(tag)}`;
}

export const parseHash = (phc: string): (ArgonParams & { salt: Buffer; tag: Buffer }) | null => {
  const m = PHC.exec(phc);
  return m ? { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]), salt: Buffer.from(m[4], 'base64'), tag: Buffer.from(m[5], 'base64') } : null;
};

export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const h = parseHash(phc);
  if (!h) return false;
  const tag = await derive(password, h.salt, h, h.tag.length);
  return tag.length === h.tag.length && timingSafeEqual(tag, h.tag);
}

/** Băm cũ dùng tham số khác cấu hình hiện hành thì phải băm lại sau khi đăng nhập đúng. */
export const needsRehash = (phc: string, p: ArgonParams): boolean => {
  const h = parseHash(phc);
  return !h || h.memory !== p.memory || h.passes !== p.passes || h.parallelism !== p.parallelism;
};

/** Token ngẫu nhiên 256 bit, dạng URL-safe 43 ký tự (phiên, xác minh email, đặt lại mật khẩu). Chỉ băm SHA-256 được lưu (ADR-015). */
export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43,64}$/;
