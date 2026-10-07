import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock, DomainError, PrismaService, TransactionService, type Tx } from '../platform';
import { ADDRESS_LIMIT, ADDRESS_PURGE_DAYS } from './config';
import type { AddressCreate, AddressPatch } from './policy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface AddressDto {
  id: string; receiver: string; phone: string; line1: string; ward: string; district: string | null; city: string;
  is_default: boolean; created_at: Date; updated_at: Date;
}
/** Dạng CHK đọc qua giao diện nội bộ (architecture.md, bảng Giao diện module; USR-REQ ...767 BR8). */
export type AddressForCheckout = Omit<AddressDto, 'created_at'>;

const COLS = Prisma.sql`id, receiver, phone::text AS phone, line1, ward, district, city, is_default, created_at, updated_at`;
const CONTENT = ['receiver', 'phone', 'line1', 'ward', 'district', 'city'] as const;

/**
 * Sổ địa chỉ của customer (USR-DB mục 1 đến 5, 10). Mọi truy vấn có `user_id` lấy từ phiên và `deleted_at IS NULL` (SB-06); mọi ghi chạy trong giao dịch
 * có khóa tư vấn theo người dùng nên hai request của cùng một người nối tiếp nhau (đúng 10, đúng một mặc định, SB-33).
 */
@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService, private readonly transactions: TransactionService, private readonly clock: Clock) {}

  private lock(tx: Tx, userId: string): Promise<unknown> {
    return tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`usr:addr:${userId}`}, 0))) l`;
  }

  async list(userId: string): Promise<AddressDto[]> {
    return this.prisma.$queryRaw<AddressDto[]>`
      SELECT ${COLS} FROM addresses WHERE user_id = ${userId}::uuid AND deleted_at IS NULL ORDER BY is_default DESC, created_at DESC, id DESC`;
  }

  /** CHK: danh sách để chọn (không truyền tx). */
  async listAddresses(userId: string): Promise<AddressForCheckout[]> {
    return (await this.list(userId)).map(({ created_at: _c, ...rest }) => rest);
  }

  /** CHK: một địa chỉ của chính người dùng; null khi của người khác, đã xóa hoặc không có. */
  async getAddress(userId: string, addressId: string): Promise<AddressForCheckout | null> {
    if (!UUID.test(addressId)) return null;
    const rows = await this.prisma.$queryRaw<AddressDto[]>`
      SELECT ${COLS} FROM addresses WHERE id = ${addressId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL`;
    if (!rows[0]) return null;
    const { created_at: _c, ...rest } = rows[0];
    return rest;
  }

  async create(userId: string, b: AddressCreate): Promise<AddressDto> {
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      await this.lock(tx, userId);
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM addresses WHERE user_id = ${userId}::uuid AND deleted_at IS NULL`;
      if (Number(n) >= ADDRESS_LIMIT) throw new DomainError('address-limit-reached', { extra: { code: 'address_limit_reached' } });
      const isDefault = Number(n) === 0 || b.is_default === true; // địa chỉ đầu tiên luôn mặc định (BR4)
      if (isDefault) await tx.$executeRaw`UPDATE addresses SET is_default = false WHERE user_id = ${userId}::uuid AND is_default AND deleted_at IS NULL`; // không đổi updated_at
      const rows = await tx.$queryRaw<AddressDto[]>`
        INSERT INTO addresses (user_id, receiver, phone, line1, ward, district, city, is_default, created_at, updated_at)
        VALUES (${userId}::uuid, ${b.receiver}, ${b.phone}, ${b.line1}, ${b.ward}, ${b.district ?? null}, ${b.city}, ${isDefault}, ${now}::timestamptz, ${now}::timestamptz)
        RETURNING ${COLS}`;
      return rows[0];
    });
  }

  async update(userId: string, addressId: string, p: AddressPatch): Promise<AddressDto> {
    if (!UUID.test(addressId)) throw new DomainError('not-found');
    const now = this.clock.now();
    return this.transactions.run(async (tx) => {
      await this.lock(tx, userId);
      const [cur] = await tx.$queryRaw<AddressDto[]>`
        SELECT ${COLS} FROM addresses WHERE id = ${addressId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!cur) throw new DomainError('not-found'); // không tồn tại, của người khác, đã xóa: cùng một kết quả (SB-06)
      if (p.is_default === false && cur.is_default) {
        throw new DomainError('cannot-unset-default', { errors: [{ field: 'is_default', code: 'cannot_unset_default' }], extra: { code: 'cannot_unset_default' } });
      }
      const next = { ...cur } as Record<string, unknown>;
      let contentChanged = false;
      for (const k of CONTENT) {
        if (p[k] === undefined) continue;
        if (next[k] !== p[k]) contentChanged = true; // updated_at chỉ đổi khi nội dung đổi giá trị thật sự (BR7)
        next[k] = p[k];
      }
      if (p.is_default === true && !cur.is_default) {
        await tx.$executeRaw`UPDATE addresses SET is_default = false WHERE user_id = ${userId}::uuid AND is_default AND deleted_at IS NULL`;
        next.is_default = true;
      }
      const rows = await tx.$queryRaw<AddressDto[]>`
        UPDATE addresses SET receiver = ${next.receiver as string}, phone = ${next.phone as string}, line1 = ${next.line1 as string}, ward = ${next.ward as string},
          district = ${next.district as string | null}, city = ${next.city as string}, is_default = ${next.is_default as boolean},
          updated_at = ${contentChanged ? now : cur.updated_at}::timestamptz
        WHERE id = ${addressId}::uuid RETURNING ${COLS}`;
      return rows[0];
    });
  }

  async remove(userId: string, addressId: string): Promise<void> {
    if (!UUID.test(addressId)) throw new DomainError('not-found');
    const now = this.clock.now();
    await this.transactions.run(async (tx) => {
      await this.lock(tx, userId);
      const [cur] = await tx.$queryRaw<{ is_default: boolean }[]>`
        SELECT is_default FROM addresses WHERE id = ${addressId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE`;
      if (!cur) throw new DomainError('not-found'); // xóa lần hai cũng 404 (BR4)
      await tx.$executeRaw`UPDATE addresses SET deleted_at = ${now}::timestamptz, is_default = false WHERE id = ${addressId}::uuid`;
      if (cur.is_default) { // địa chỉ mới tạo nhất còn lại thành mặc định, cùng giao dịch (BR3)
        await tx.$executeRaw`
          UPDATE addresses SET is_default = true WHERE id = (
            SELECT id FROM addresses WHERE user_id = ${userId}::uuid AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1)`;
      }
    });
  }

  /** Job `usr.purge-deleted-addresses` (ADR-022, USR-DB mục 10): xóa cứng địa chỉ xóa mềm quá 30 ngày. Trả số dòng đã xóa. */
  async purgeDeleted(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - ADDRESS_PURGE_DAYS * 24 * 3600_000);
    return this.prisma.$executeRaw`DELETE FROM addresses WHERE deleted_at < ${cutoff}::timestamptz`;
  }
}
