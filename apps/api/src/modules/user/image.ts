import sharp, { type Metadata } from 'sharp';
import { AVATAR_MAX_PIXELS, AVATAR_SIZE } from './config';

// Xử lý ảnh đại diện (USR-REQ-20261006-101003679 BR1 đến BR4, ADR-010, ADR-018): loại tệp theo magic bytes, kích thước đọc từ tiêu đề trước khi giải mã,
// giải mã lại, bỏ metadata, cắt giữa thành vuông 512, mã hóa WebP. Không bao giờ dùng tên tệp hay Content-Type của client.
export type ImageReason = 'too_large' | 'unsupported_type' | 'corrupt' | 'dimensions_exceeded' | 'bad_form';
export class ImageError extends Error {
  constructor(readonly reason: ImageReason) { super(reason); }
}
sharp.cache(false); // không giữ bộ đệm ảnh trong bộ nhớ tiến trình

export type ImageKind = 'jpeg' | 'png' | 'webp';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniff(b: Buffer): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Tệp cụt hoặc có dữ liệu thừa sau phần kết thúc của định dạng (BR4: "chứa dữ liệu thừa bị từ chối"). */
export function malformedEnd(kind: ImageKind, b: Buffer): boolean {
  if (kind === 'jpeg') return !(b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9);
  if (kind === 'webp') return b.readUInt32LE(4) + 8 !== b.length;
  for (let off = 8; off + 12 <= b.length;) { // PNG: duyệt các chunk tới IEND, phải kết thúc đúng cuối tệp
    const size = b.readUInt32BE(off);
    const end = off + 12 + size;
    if (end > b.length) return true;
    if (b.toString('latin1', off + 4, off + 8) === 'IEND') return end !== b.length;
    off = end;
  }
  return true;
}

/** Trả WebP 512x512 không metadata, hoặc ném ImageError. Đọc kích thước từ tiêu đề trước khi giải mã nên bom giải nén không cấp bộ nhớ theo kích thước khai báo. */
export async function processAvatar(input: Buffer): Promise<Buffer> {
  if (!input.length) throw new ImageError('corrupt');
  const kind = sniff(input);
  if (!kind) throw new ImageError('unsupported_type');
  if (malformedEnd(kind, input)) throw new ImageError('corrupt');
  let meta: Metadata;
  // chỉ đọc tiêu đề (limitInputPixels tắt ở bước này); trần 25 megapixel kiểm ngay dưới, trước khi giải mã
  try { meta = await sharp(input, { failOn: 'error', limitInputPixels: false }).metadata(); } catch { throw new ImageError('corrupt'); }
  if (!meta.width || !meta.height) throw new ImageError('corrupt');
  if (meta.width * meta.height > AVATAR_MAX_PIXELS) throw new ImageError('dimensions_exceeded');
  try {
    return await sharp(input, { failOn: 'error', limitInputPixels: AVATAR_MAX_PIXELS, pages: 1 })
      .rotate() // theo EXIF orientation trước khi metadata bị bỏ
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 }) // sharp bỏ EXIF, ICC, XMP khi không yêu cầu giữ
      .toBuffer();
  } catch { throw new ImageError('corrupt'); }
}
