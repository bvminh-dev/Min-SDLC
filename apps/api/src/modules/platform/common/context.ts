import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// correlation_id đi theo AsyncLocalStorage (PRJ-REQ-20261006-095422908 BR6). Chỉ mang mã truy vết, KHÔNG mang giao dịch (ADR-012 loại CLS cho giao dịch).
interface Ctx { correlationId: string }
const als = new AsyncLocalStorage<Ctx>();

export const currentCorrelationId = (): string | undefined => als.getStore()?.correlationId;
export const runWithCorrelation = <T>(correlationId: string, fn: () => T): T => als.run({ correlationId }, fn);
export const newCorrelationId = (): string => randomUUID();
