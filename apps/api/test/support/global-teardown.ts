import { sweepRunRoot } from './tmp-root';

export default function globalTeardown(): void {
  if (process.env.ECOM_RUN_TMP) sweepRunRoot(process.env.ECOM_RUN_TMP);
}
