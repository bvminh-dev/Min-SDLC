import type { Request, Response } from 'express';
import { UploadError, readSingleFile as readUpload, type UploadRead } from '../platform';
import { ImageError } from './image';

export type { UploadRead };

/** Đọc một tệp multipart có giới hạn kích thước bằng bộ đọc chung của platform; lỗi đổi sang `ImageError` của USR (`bad_form`, `too_large`). */
export async function readSingleFile(req: Request, res: Response, maxBytes: number, onBytes: (n: number) => void): Promise<UploadRead> {
  try {
    return await readUpload(req, res, maxBytes, onBytes);
  } catch (e) {
    throw e instanceof UploadError ? new ImageError(e.reason) : e;
  }
}
