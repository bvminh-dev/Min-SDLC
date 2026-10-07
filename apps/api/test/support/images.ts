import { crc32 } from 'node:zlib';
import sharp from 'sharp';

// Ảnh dựng bằng mã cho test USR (không tệp nhị phân trong repo). Kích thước nhỏ để test nhanh.
const noise = (w: number, h: number, channels: 3 | 4 = 3): Buffer => {
  const b = Buffer.alloc(w * h * channels);
  for (let i = 0; i < b.length; i++) b[i] = (i * 31 + (i >> 5) * 17) & 0xff;
  return b;
};
export const raw = (w: number, h: number) => ({ raw: { width: w, height: h, channels: 3 as const } });

/** JPEG thật có EXIF kèm GPS (vĩ độ 10.7769, kinh độ 106.7009) và máy ảnh. */
export const jpegWithExif = (w = 160, h = 90): Promise<Buffer> =>
  sharp(noise(w, h), raw(w, h)).jpeg({ quality: 80 })
    .withExif({ IFD0: { Make: 'TestCam', Model: 'T1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '10/1 46/1 997/100', GPSLongitudeRef: 'E', GPSLongitude: '106/1 42/1 32/100' } }).toBuffer();
export const png = (w = 120, h = 80): Promise<Buffer> => sharp(noise(w, h), raw(w, h)).png().toBuffer();
export const webp = (w = 100, h = 100): Promise<Buffer> => sharp(noise(w, h), raw(w, h)).webp().toBuffer();
/** WebP động `frames` khung hình: khung đầu đỏ, các khung sau xanh lá đậm dần (khác nhau để bộ mã hóa không gộp khung). */
export async function animatedWebp(frames = 12, w = 64, h = 64): Promise<Buffer> {
  const frame = (rgb: [number, number, number]) => Buffer.from(Array.from({ length: w * h }, () => rgb).flat());
  const all = Buffer.concat(Array.from({ length: frames }, (_, i) => frame(i === 0 ? [255, 0, 0] : [0, 40 + i * 15, 0])));
  return sharp(all, { raw: { width: w, height: h * frames, channels: 3, pageHeight: h } }).webp({ loop: 0, delay: Array(frames).fill(100) }).toBuffer();
}
export const gif = (): Buffer => Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1');
export const svgWithScript = (): Buffer => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const php = (): Buffer => Buffer.from('<?php echo 1; ?>');

/** Đệm JPEG bằng các đoạn chú thích (COM) ngay sau SOI cho tới đúng `size` byte. */
export function padJpeg(jpeg: Buffer, size: number): Buffer {
  let pad = size - jpeg.length;
  if (pad < 0) throw new Error('JPEG gốc đã lớn hơn kích thước đích');
  const parts: Buffer[] = [];
  while (pad > 0) {
    let seg = Math.min(pad, 65_537); // 2 byte marker + 2 byte độ dài + tối đa 65533 byte dữ liệu
    if (pad - seg > 0 && pad - seg < 4) seg -= 4; // không để lại phần dư nhỏ hơn một đoạn tối thiểu
    const head = Buffer.from([0xff, 0xfe, ((seg - 2) >> 8) & 0xff, (seg - 2) & 0xff]);
    parts.push(head, Buffer.alloc(seg - 4, 0x20));
    pad -= seg;
  }
  return Buffer.concat([jpeg.subarray(0, 2), ...parts, jpeg.subarray(2)]);
}

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
/** PNG nhỏ (vài chục byte) KHAI kích thước lớn trong IHDR: "bom giải nén" cho chặn đọc tiêu đề. */
export function pngClaiming(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0; // 8 bit, xám
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])), chunk('IEND', Buffer.alloc(0))]);
}
