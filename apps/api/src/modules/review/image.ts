import sharp, { type Metadata } from 'sharp';
import { IMAGE_MAX_EDGE, IMAGE_MAX_PIXELS } from './config';

// Xử lý ảnh đánh giá (REV-REQ-20261006-103135207 BR2 đến BR5, ADR-010, ADR-018, REV-SEC T8): loại tệp theo magic bytes (không theo đuôi hay Content-Type của client), kích thước đọc từ tiêu đề trước khi
// giải mã (bom giải nén không cấp bộ nhớ theo kích thước khai báo), giải mã lại, bỏ metadata (EXIF, GPS), cạnh dài tối đa 1600, mã hóa WebP. Ảnh động lấy khung đầu.
// Khác avatar của USR: không cắt vuông, không phóng to ảnh nhỏ; dữ liệu thừa SAU phần kết thúc của JPEG (polyglot) không làm hỏng ảnh vì ảnh được mã hóa lại hoàn toàn (REV-TC-20261006-104524981).
export type ImageReason = 'type' | 'size' | 'dimensions' | 'corrupt';
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

export interface Processed { webp: Buffer; width: number; height: number }

/** Trả WebP không metadata cùng kích thước thật, hoặc ném ImageError. */
export async function processReviewImage(input: Buffer): Promise<Processed> {
  if (!input.length) throw new ImageError('corrupt');
  if (!sniff(input)) throw new ImageError('type');
  let meta: Metadata;
  // chỉ đọc tiêu đề (limitInputPixels tắt ở bước này); trần 25 megapixel kiểm ngay dưới, TRƯỚC khi giải mã
  try { meta = await sharp(input, { failOn: 'error', limitInputPixels: false }).metadata(); } catch { throw new ImageError('corrupt'); }
  if (!meta.width || !meta.height) throw new ImageError('corrupt');
  if (meta.width * meta.height > IMAGE_MAX_PIXELS) throw new ImageError('dimensions');
  try {
    const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: IMAGE_MAX_PIXELS, pages: 1 })
      .rotate() // theo EXIF orientation trước khi metadata bị bỏ
      .resize(IMAGE_MAX_EDGE, IMAGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }) // sharp bỏ EXIF, ICC, XMP khi không yêu cầu giữ
      .toBuffer({ resolveWithObject: true });
    return { webp: data, width: info.width, height: info.height };
  } catch { throw new ImageError('corrupt'); }
}
