import { newPrisma, roleDbUrl, truncateAll } from '../support/db';
import { countOf, createPayApp, payRow, pgCode, q, seedPayment, seedRefund, type PayApp } from '../support/pay';

// Quyền của vai trò ứng dụng trên bảng tiền và thứ tự nhật ký webhook (PAY-DB-20261006-103701241, migration 20261013000100_payment_hardening; REV-PAY-13).
describe('PAY quyền DELETE của vai trò ứng dụng và thời điểm nhật ký webhook', () => {
  let t: PayApp;
  beforeAll(async () => { t = await createPayApp(); });
  afterAll(() => { t.gw.reset(); return t.close(); });
  beforeEach(async () => { await truncateAll(t.prisma); });

  it('PAY-TC-20261013-193715898 (PAY-SEC T23, SB-32, REV-PAY-13): vai trò ứng dụng thật (ecom_app) không DELETE được payments, payment_attempts, refunds (42501) nhưng vẫn đọc, thêm và đổi trạng thái theo vòng đời; payment_webhook_logs vẫn không UPDATE được và chỉ DELETE được dòng quá 12 tháng', async () => {
    const pay = await seedPayment(t, { status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    const rid = await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'requested' });
    await q(t, `INSERT INTO payment_webhook_logs (txn_ref, payload, signature_valid, rsp_code, result, created_at) VALUES ('${'b'.repeat(16)}01', '{}', true, '01', 'unknown_txn', now() - interval '1 month')`);
    const app = newPrisma(roleDbUrl('ecom_app'));
    try {
      expect(await pgCode(app.$executeRaw`DELETE FROM refunds WHERE id = ${rid}::uuid`)).toBe('42501');
      expect(await pgCode(app.$executeRaw`DELETE FROM payment_attempts WHERE id = ${pay.attempts[0].id}::uuid`)).toBe('42501');
      expect(await pgCode(app.$executeRaw`DELETE FROM payments WHERE id = ${pay.id}::uuid`)).toBe('42501');
      expect(await pgCode(app.$executeRaw`DELETE FROM refunds`)).toBe('42501'); // không có điều kiện cũng bị từ chối
      expect(await countOf(t, 'refunds')).toBe(1);
      expect(await countOf(t, 'payment_attempts')).toBe(1);
      expect(await payRow(t, pay.id)).toBeDefined();
      // vòng đời hợp lệ vẫn chạy bằng vai trò ứng dụng (UPDATE và INSERT giữ nguyên)
      expect(await app.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM payments`).toEqual([{ n: 1 }]);
      expect(await pgCode(app.$executeRaw`UPDATE refunds SET status = 'failed'::refund_status, failure_reason = 'gateway-no-answer', resolved_at = now() WHERE id = ${rid}::uuid`)).toBe('ok');
      expect(await pgCode(app.$executeRaw`UPDATE payments SET status = 'refunded'::payment_status, version = version + 1 WHERE id = ${pay.id}::uuid`)).toBe('ok');
      // nhật ký webhook: chỉ thêm (UPDATE thu quyền); DELETE dòng mới bị trigger chặn (23000), dòng quá 12 tháng xóa được
      expect(await pgCode(app.$executeRaw`UPDATE payment_webhook_logs SET rsp_code = '00'`)).toBe('42501');
      expect(await pgCode(app.$executeRaw`DELETE FROM payment_webhook_logs`)).toBe('23000');
      await q(t, `INSERT INTO payment_webhook_logs (txn_ref, payload, signature_valid, rsp_code, result, created_at) VALUES ('${'c'.repeat(16)}01', '{}', true, '01', 'unknown_txn', now() - interval '14 months')`);
      expect(await countOf(t, 'payment_webhook_logs')).toBe(2);
    } finally { await app.$disconnect(); }
    // bảng quyền trong danh mục: không còn DELETE của app_runtime ở ba bảng tiền
    const grants = await q<{ table_name: string; p: string }>(t, `SELECT table_name, privilege_type AS p FROM information_schema.role_table_grants WHERE grantee = 'app_runtime' AND table_name IN ('payments', 'payment_attempts', 'refunds') ORDER BY 1, 2`);
    expect(grants.filter((g) => g.p === 'DELETE')).toEqual([]);
    expect(grants.filter((g) => g.p === 'UPDATE').map((g) => g.table_name).sort()).toEqual(['payment_attempts', 'payments', 'refunds']); // UPDATE giữ: ba bảng đổi trạng thái theo vòng đời
  });

  it('PAY-TC-20261013-193922887 (PAY-DB mục 3, SB-32): created_at của payment_webhook_logs mặc định clock_timestamp(): hai dòng chèn trong CÙNG một giao dịch có thời điểm khác nhau và đọc theo created_at đúng thứ tự chèn', async () => {
    const [{ d }] = await q<{ d: string }>(t, `SELECT pg_get_expr(adbin, adrelid) AS d FROM pg_attrdef a JOIN pg_attribute c ON c.attrelid = a.adrelid AND c.attnum = a.adnum WHERE a.adrelid = 'payment_webhook_logs'::regclass AND c.attname = 'created_at'`);
    expect(d).toBe('clock_timestamp()');
    await t.prisma.$transaction(async (tx) => {
      for (const code of ['01', '02', '04', '97', '99']) await tx.$executeRaw`INSERT INTO payment_webhook_logs (payload, signature_valid, rsp_code, result) VALUES ('{}'::jsonb, true, ${code}, 'unknown_txn')`;
    });
    const rows = await q<{ rsp_code: string; created_at: Date }>(t, `SELECT rsp_code, created_at FROM payment_webhook_logs ORDER BY created_at, id`);
    expect(rows.map((r) => r.rsp_code)).toEqual(['01', '02', '04', '97', '99']);
    const [{ distinct }] = await q<{ distinct: number }>(t, `SELECT count(DISTINCT created_at)::int AS distinct FROM payment_webhook_logs`);
    expect(distinct).toBe(5);
  });
  it('PAY-TC-20261013-194320040 (job `payment-webhook-retention`, Job dọn nhật ký webhook (ADR-022), SB-32, SB-34): job xóa theo lô đúng dòng quá 12 tháng, không đụng dòng mới và bảng tiền; không có dòng quá hạn thì không xóa gì; chạy lại không đổi gì (idempotent)', async () => {
    const ins = (months: number, n: number) => q(t, `INSERT INTO payment_webhook_logs (payload, signature_valid, rsp_code, result, created_at) SELECT '{}', true, '01', 'unknown_txn', now() - interval '${months} months' - make_interval(secs => g) FROM generate_series(1, ${n}) g`);
    const pay = await seedPayment(t, { status: 'succeeded', attemptNo: 1, attempts: 'auto' });
    await seedRefund(t, { paymentId: pay.id, attemptId: pay.attempts[0].id, status: 'succeeded' });
    await ins(2, 30); // chỉ dòng mới: không xóa gì
    expect(await t.reconcile.purgeWebhookLogs()).toBe(0);
    expect(await countOf(t, 'payment_webhook_logs')).toBe(30);
    await ins(13, 1500); // hơn một lô (1000)
    expect(await t.reconcile.purgeWebhookLogs()).toBe(1500);
    expect(await countOf(t, 'payment_webhook_logs')).toBe(30);
    expect(await countOf(t, 'payment_webhook_logs', `created_at < now() - interval '12 months'`)).toBe(0);
    expect(await t.reconcile.purgeWebhookLogs()).toBe(0);
    expect([await countOf(t, 'payments'), await countOf(t, 'payment_attempts'), await countOf(t, 'refunds')]).toEqual([1, 1, 1]); // bảng tiền không bao giờ bị job dọn
  }, 120_000);
});
