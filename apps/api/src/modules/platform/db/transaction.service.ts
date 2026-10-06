import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import { ConfigService } from '../config/config';
import { DomainError } from '../errors/registry';
import { AppLogger } from '../logging/logger';
import { isRetryableTx } from './db-errors';
import { PrismaService } from './prisma.service';

export type Tx = Prisma.TransactionClient;

interface TxStore { afterCommit: Array<() => void> }
/** Danh sách việc chạy SAU commit của giao dịch hiện tại (cho events.publishAfterCommit). */
export const txStore = new AsyncLocalStorage<TxStore>();

/**
 * Tiện ích giao dịch (ADR-012, PRJ-REQ-20261006-095422563 BR5): READ COMMITTED, hạn 10 giây,
 * thử lại tối đa 3 lần khi 40001/40P01. Service module nhận `tx` của bên gọi, không tự mở giao dịch lồng.
 */
@Injectable()
export class TransactionService {
  private readonly log: AppLogger;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, logger: AppLogger) {
    this.log = logger.for('transaction');
  }

  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const retries = this.config.get('DB_TRANSACTION_RETRIES');
    for (let attempt = 0; ; attempt++) {
      const store: TxStore = { afterCommit: [] };
      try {
        const result = await txStore.run(store, () =>
          this.prisma.$transaction(fn, { isolationLevel: 'ReadCommitted', timeout: this.config.get('DB_TRANSACTION_TIMEOUT_MS'), maxWait: 5000 }),
        );
        for (const hook of store.afterCommit) hook();
        return result;
      } catch (e) {
        if (!isRetryableTx(e)) throw e;
        if (attempt >= retries) {
          this.log.error('giao dịch bị hủy sau hết lượt thử lại', { attempts: attempt + 1 });
          throw new DomainError('internal-error');
        }
        this.log.warn('giao dịch bị hủy (40001/40P01), thử lại', { attempt: attempt + 1 });
      }
    }
  }
}
