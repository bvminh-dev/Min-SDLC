import sharp, { type Metadata } from 'sharp';
import { IMAGE_MAX_BYTES, IMAGE_MAX_EDGE, IMAGE_MAX_PIXELS } from './config';

// Xử lý ảnh sản phẩm (PRD-REQ-20261006-095502592 BR3, PRD-SEC T7, ADR-018, SB-10): loại tệp theo magic bytes (không tin tên tệp hay Content-Type của client),
// kích thước đọc từ tiêu đề TRƯỚC khi giải mã (chặn bom giải nén), giải mã lại và mã hóa lại cùng định dạng (bỏ EXIF, ICC, XMP), cạnh dài tối đa 1600 px.
export type ImageReason = 'too_large' | 'unsupported_type' | 'corrupt' | 'dimensions_exceeded' | 'bad_form';
export class ImageError extends Error {
  constructor(readonly reason: ImageReason) { super(reason); }
}
sharp.cache(false); // không giữ bộ đệm ảnh trong bộ nhớ tiến trình

export type ImageKind = 'jpeg' | 'png' | 'webp';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const EXT: Record<ImageKind, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
export const MIME: Record<ImageKind, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function sniff(b: Buffer): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export interface ProcessedImage { body: Buffer; kind: ImageKind; width: number; height: number }

/** Trả ảnh đã xử lý lại hoặc ném ImageError. Tệp quá giới hạn dung lượng đã bị chặn khi đọc luồng; kết quả vượt 5 MB vẫn bị từ chối (CHECK của product_images.bytes). */
export async function processProductImage(input: Buffer): Promise<ProcessedImage> {
  if (!input.length) throw new ImageError('corrupt');
  const kind = sniff(input);
  if (!kind) throw new ImageError('unsupported_type');
  let meta: Metadata;
  // chỉ đọc tiêu đề (limitInputPixels tắt ở bước này); trần 25 megapixel kiểm ngay dưới, trước khi giải mã
  try { meta = await sharp(input, { failOn: 'error', limitInputPixels: false }).metadata(); } catch { throw new ImageError('corrupt'); }
  if (!meta.width || !meta.height) throw new ImageError('corrupt');
  if (meta.width * meta.height > IMAGE_MAX_PIXELS) throw new ImageError('dimensions_exceeded');
  try {
    const pipe = sharp(input, { failOn: 'truncated', limitInputPixels: IMAGE_MAX_PIXELS, pages: 1 }) // tệp cụt bị từ chối, cảnh báo nhẹ thì cho qua
      .rotate() // theo EXIF orientation trước khi metadata bị bỏ
      .resize(IMAGE_MAX_EDGE, IMAGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true });
    const { data, info } = await (kind === 'jpeg' ? pipe.jpeg({ quality: 85 }) : kind === 'png' ? pipe.png() : pipe.webp({ quality: 85 })).toBuffer({ resolveWithObject: true });
    if (data.length > IMAGE_MAX_BYTES) throw new ImageError('too_large');
    return { body: data, kind, width: info.width, height: info.height };
  } catch (e) {
    throw e instanceof ImageError ? e : new ImageError('corrupt');
  }
}
