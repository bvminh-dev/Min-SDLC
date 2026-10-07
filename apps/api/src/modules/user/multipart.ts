import Busboy from 'busboy';
import type { Request, Response } from 'express';
import { ImageError } from './image';

/** Đệm cho phần tiêu đề multipart quanh tệp (ranh giới, tên phần, kiểu): thân request vượt tệp tối đa cộng chừng này thì dừng đọc (USR-TC ...618: <= tối đa + 64 KB). */
export const MULTIPART_SLACK = 64 * 1024;
export interface UploadRead { file: Buffer; bytesRead: number }

/**
 * Đọc đúng MỘT phần tên `file` của multipart/form-data, dừng đọc thân ngay khi vượt `maxBytes` (không đọc cả tệp rồi mới kiểm, BR2).
 * Thiếu, thừa phần hoặc form hỏng là `bad_form`; tệp vượt giới hạn là `too_large` và kết nối đóng sau phản hồi để ngừng nhận thân.
 * `bytesRead` (kể cả khi lỗi, qua `onBytes`) để log đo được việc dừng đọc.
 */
export function readSingleFile(req: Request, res: Response, maxBytes: number, onBytes: (n: number) => void): Promise<UploadRead> {
  return new Promise((resolve, reject) => {
    let done = false;
    let seen = 0;
    const declared = Number(req.headers['content-length']);
    let bb: ReturnType<typeof Busboy>;
    const fail = (reason: ConstructorParameters<typeof ImageError>[0], stop = false): void => {
      if (done) return;
      done = true;
      if (stop) { req.unpipe(bb); req.pause(); res.setHeader('Connection', 'close'); }
      onBytes(seen);
      reject(new ImageError(reason));
    };
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: maxBytes + 1, headerPairs: 16 } });
    } catch { onBytes(0); reject(new ImageError('bad_form')); return; }
    if (Number.isFinite(declared) && declared > maxBytes + MULTIPART_SLACK) { fail('too_large', true); return; } // khai báo đã quá lớn: không đọc gì

    // busboy báo `limit` khi ĐẠT giới hạn (kể cả bằng đúng), nên đặt maxBytes + 1: tệp đúng maxBytes qua, maxBytes + 1 byte thì bị cắt (BR2)
    const chunks: Buffer[] = [];
    let files = 0, bad = false, truncated = false;
    bb.on('field', () => { bad = true; });
    bb.on('file', (name, stream) => {
      if (++files > 1 || name !== 'file') { bad = true; stream.resume(); return; }
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('limit', () => { truncated = true; fail('too_large', true); });
    });
    bb.on('error', () => fail('bad_form'));
    bb.on('close', () => {
      if (done) return;
      if (truncated) return fail('too_large', true);
      if (bad || files !== 1) return fail('bad_form');
      done = true;
      onBytes(seen);
      resolve({ file: Buffer.concat(chunks), bytesRead: seen });
    });
    req.on('data', (c: Buffer) => { seen += c.length; if (seen > maxBytes + MULTIPART_SLACK) fail('too_large', true); });
    req.on('error', () => fail('bad_form'));
    req.pipe(bb);
  });
}
