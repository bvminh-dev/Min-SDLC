import { seedUser } from '../support/auth';
import { truncateAll } from '../support/db';
import { freshClock, createRevApp, deleteReview, moderate, patchReview, preModeration, revAudits, revTypes, reviewRow, seedOrderItem, seedProduct, seedReview, world, call, type RevApp, type World } from '../support/rev';

const SEC = 'REV-SEC-20261006-103618395';
type St = 'pending' | 'published' | 'rejected' | 'hidden' | 'deleted';
const STATES: St[] = ['pending', 'published', 'rejected', 'hidden', 'deleted'];

// Ma trận thao tác x trạng thái (bài học: bảng quy tắc phủ từng ô): mỗi thao tác của REV (duyệt, từ chối, ẩn, bỏ ẩn, sửa, xóa của chủ, xóa của admin, đọc công khai, đọc của chủ) trên mỗi trạng thái của đánh giá,
// khẳng định mã phản hồi, trạng thái sau, event đã phát và audit. Nguồn: bảng chuyển trạng thái của REV-DB (E-22) và REV-API.
describe(`REV ma trận thao tác x trạng thái (${SEC} T12, T13, T14)`, () => {
  let t: RevApp, w: World;
  beforeAll(async () => { t = await createRevApp(); });
  afterAll(() => t.close());
  beforeEach(async () => { await truncateAll(t.prisma); t.fake.reset(); t.logs.clear(); jest.restoreAllMocks(); freshClock(t); w = await world(t); });
  /** Đánh giá của A (điểm 3) ở trạng thái `st` trên một sản phẩm mới. */
  async function one(st: St): Promise<string> {
    const p = await seedProduct(t, { category: w.cat });
    const d = await seedOrderItem(t, w.a.id, p);
    return seedReview(t, { user: w.a.id, product: p, status: st, rating: 3, orderItem: d.item, moderatedBy: w.admin.id });
  }
  const hit = async (op: string, id: string, pre: boolean) => {
    await t.prisma.$executeRaw`DELETE FROM rate_limit_counters`;
    if (op === 'approve' || op === 'hide' || op === 'unhide' || op === 'reject') return moderate(t, w.admin.cookie, id, op, op === 'hide' || op === 'reject' ? { reason: 'lý do' } : {});
    if (op === 'edit') { void pre; return patchReview(t, w.a.cookie, id, { comment: 'nội dung mới' }); }
    if (op === 'delete-owner') return deleteReview(t, w.a.cookie, id);
    return deleteReview(t, w.admin.cookie, id);
  };

  // [thao tác][trạng thái] = [mã phản hồi, trạng thái sau, event]; edit phụ thuộc kiểm duyệt trước (pre)
  const TABLE = (pre: boolean): Record<string, Record<St, [number, St, string[]]>> => ({
    approve: { pending: [200, 'published', ['ReviewPublished']], published: [409, 'published', []], rejected: [409, 'rejected', []], hidden: [409, 'hidden', []], deleted: [404, 'deleted', []] },
    reject: { pending: [200, 'rejected', []], published: [409, 'published', []], rejected: [409, 'rejected', []], hidden: [409, 'hidden', []], deleted: [404, 'deleted', []] },
    hide: { pending: [409, 'pending', []], published: [200, 'hidden', ['ReviewHidden']], rejected: [409, 'rejected', []], hidden: [409, 'hidden', []], deleted: [404, 'deleted', []] },
    unhide: { pending: [409, 'pending', []], published: [409, 'published', []], rejected: [409, 'rejected', []], hidden: [200, 'published', ['ReviewPublished']], deleted: [404, 'deleted', []] },
    edit: { pending: [200, 'pending', []], published: pre ? [200, 'pending', ['ReviewUnpublished']] : [200, 'published', []], rejected: [409, 'rejected', []], hidden: [409, 'hidden', []], deleted: [404, 'deleted', []] },
    'delete-owner': { pending: [204, 'deleted', ['ReviewDeleted']], published: [204, 'deleted', ['ReviewDeleted']], rejected: [204, 'deleted', ['ReviewDeleted']], hidden: [204, 'deleted', ['ReviewDeleted']], deleted: [404, 'deleted', []] },
    'delete-admin': { pending: [204, 'deleted', ['ReviewDeleted']], published: [204, 'deleted', ['ReviewDeleted']], rejected: [204, 'deleted', ['ReviewDeleted']], hidden: [204, 'deleted', ['ReviewDeleted']], deleted: [404, 'deleted', []] },
  });

  for (const pre of [true, false]) {
    it(`${SEC} T12: mọi thao tác trên mọi trạng thái đúng bảng chuyển (kiểm duyệt trước ${pre ? 'bật' : 'tắt'}): mã phản hồi, trạng thái sau, event, audit`, async () => {
      preModeration(t, pre);
      for (const [op, row] of Object.entries(TABLE(pre))) {
        for (const st of STATES) {
          const id = await one(st);
          const before = (await revTypes(t, id)).length;
          const r = await hit(op, id, pre);
          const [code, after, events] = row[st];
          const audits = (await revAudits(t, id)).map((a) => a.action);
          const wantAudit = code === 204 && op === 'delete-admin' ? ['review.delete'] : code === 200 && ['approve', 'reject', 'hide', 'unhide'].includes(op) ? [`review.${op}`] : [];
          expect([op, st, r.status, (await reviewRow(t, id)).status, (await revTypes(t, id)).slice(before), audits]).toEqual([op, st, code, after, events, wantAudit]);
        }
      }
    }, 120_000);
  }

  it(`${SEC} T3, T11: đọc công khai chỉ thấy published; đọc của chủ thấy mọi trạng thái trừ deleted; ma trận theo trạng thái`, async () => {
    const p = await seedProduct(t, { category: w.cat });
    const pids: Record<string, string> = {};
    for (const st of STATES) {
      const user = await seedUser(t, { email: `m-${st}@shop.vn`, name: 'Khách Hàng' });
      const d = await seedOrderItem(t, user.id, p);
      pids[st] = await seedReview(t, { user: user.id, product: p, status: st, rating: 4, orderItem: d.item, moderatedBy: w.admin.id });
    }
    const pub = await call(t, 'get', `/products/${p}/reviews`);
    expect(pub.body.items.map((i: any) => i.id)).toEqual([pids.published]);
    expect([pub.body.total, pub.body.summary.count]).toEqual([1, 1]);
  });
});
