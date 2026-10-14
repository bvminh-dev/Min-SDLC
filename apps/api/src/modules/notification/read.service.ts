import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError, PrismaService, paginate, toPage } from '../platform';
import { NOTIFICATION_RETENTION_DAYS } from './config';
import { isUuid } from './db';
import type { ListQuery } from './policy';

const NIL = '00000000-0000-0000-0000-000000000000';
const COLS = Prisma.raw('id, type::text AS type, title, body, link, status::text AS status, read_at, created_at');
interface Row { id: string; type: string; title: string; body: string; link: string | null; status: 'unread' | 'read'; read_at: Date | null; created_at: Date }
/** Phần tử trả về (NTF-REQ-20261006-103209345 BR3): không `user_id`, `event_id`, `data`, trạng thái gửi email. */
const view = (r: Row) => ({ id: r.id, type: r.type, title: r.title, body: r.body, link: r.link, status: r.status, read_at: r.read_at ? r.read_at.toISOString() : null, created_at: r.created_at.toISOString() });
/** Hạn lưu 180 ngày tính ở truy vấn, không phụ thuộc job dọn đã chạy chưa (BR4). `now()` của CSDL: cùng đồng hồ với `created_at`. */
const WINDOW = Prisma.sql`created_at > now() - make_interval(days => ${NOTIFICATION_RETENTION_DAYS}::int)`;

/**
 * Đọc và đánh dấu thông báo của CHÍNH NGƯỜI GỌI (NTF-REQ-20261006-103209256, -103209345; NTF-DB mục Giao dịch và khóa 7, 8): `user_id` luôn lấy từ phiên và luôn nằm trong mọi câu SELECT và UPDATE
 * (SB-05, SB-06); không có đường đọc thông báo của người khác, kể cả staff và admin. Thông báo của người khác, không có, quá hạn lưu và id sai dạng cùng là 404 cùng nội dung.
 */
@Injectable()
export class ReadService {
  constructor(private readonly prisma: PrismaService) {}

  private async unread(userId: string): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId}::uuid AND status = 'unread'::notification_status AND ${WINDOW}`;
    return n;
  }

  async count(userId: string): Promise<{ unread_count: number }> { return { unread_count: await this.unread(userId) }; }

  async list(userId: string, q: ListQuery) {
    const where: Prisma.Sql[] = [Prisma.sql`user_id = ${userId}::uuid`, WINDOW];
    if (q.status) where.push(Prisma.sql`status = ${q.status}::notification_status`);
    if (q.type) where.push(Prisma.sql`type = ${q.type}::notification_type`);
    const cond = Prisma.join(where, ' AND ');
    const { skip, take } = paginate(q);
    const [rows, [{ n }], unread] = await Promise.all([
      this.prisma.$queryRaw<Row[]>(Prisma.sql`SELECT ${COLS} FROM notifications WHERE ${cond} ORDER BY created_at DESC, id DESC LIMIT ${take} OFFSET ${skip}`),
      this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM notifications WHERE ${cond}`),
      this.unread(userId),
    ]);
    return { ...toPage(rows.map(view), n, q), unread_count: unread };
  }

  /**
   * Một câu UPDATE `WHERE id = $1 AND user_id = $2 AND status = 'unread'`: hai yêu cầu song song chỉ một thắng, `read_at` giữ giá trị của lần thắng (BR6); không dòng nào đổi thì SELECT cùng điều kiện sở hữu để
   * phân biệt đã `read` (200, giữ `read_at` cũ) và không có (404). Id sai dạng chạy cùng đường với uuid nil để thời gian phản hồi không lộ khác biệt (T1).
   */
  async markRead(userId: string, rawId: string) {
    const id = isUuid(rawId) ? rawId : NIL;
    let [row] = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      UPDATE notifications SET status = 'read'::notification_status, read_at = now(), updated_at = now()
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND status = 'unread'::notification_status AND ${WINDOW} RETURNING ${COLS}`);
    if (!row) {
      [row] = await this.prisma.$queryRaw<Row[]>(Prisma.sql`SELECT ${COLS} FROM notifications WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND ${WINDOW}`);
      if (!row) throw new DomainError('not-found');
    }
    return { notification: view(row), unread_count: await this.unread(userId) };
  }

  /** Đánh dấu mọi thông báo chưa đọc tạo từ `up_to` trở về trước (mặc định và trần là lúc nhận yêu cầu); thông báo tạo sau đó giữ `unread` (BR3). */
  async markAll(userId: string, upToMs: number | undefined) {
    const upTo = upToMs === undefined ? null : new Date(upToMs);
    const updated = await this.prisma.$executeRaw`
      UPDATE notifications SET status = 'read'::notification_status, read_at = now(), updated_at = now()
      WHERE user_id = ${userId}::uuid AND status = 'unread'::notification_status AND created_at <= LEAST(COALESCE(${upTo}::timestamptz, now()), now())`;
    return { updated, unread_count: await this.unread(userId) };
  }
}
