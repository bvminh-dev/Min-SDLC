import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Cho phép mở dev server qua ngrok (Next dev chặn request cross-origin tới /_next/*; chỉ ảnh hưởng `next dev`).
  allowedDevOrigins: ['russ-nonevolving-zaida.ngrok-free.dev'],
  // Trang nhận token ở fragment không được rò token qua Referer khi tải tài nguyên hay mở liên kết ngoài (AUTH-SEC T10, SB-28).
  async headers() {
    return ['/reset-password', '/verify-email'].map((source) => ({ source, headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }));
  },
  // Mở web qua ngrok: trình duyệt (Chrome Local Network Access) chặn trang public gọi thẳng localhost:3802.
  // Đặt NEXT_PUBLIC_API_BASE_URL=/api/v1 để web gọi cùng origin, Next chuyển tiếp sang API dev ở localhost:3802.
  // Ảnh (MinIO ở localhost:9210) cũng bị chặn như vậy: API đặt STORAGE_PUBLIC_BASE_URL=/media (cùng origin nên chạy được cả ở localhost lẫn ngrok), Next chuyển /media/* sang MinIO dev (localhost:9210/ecom-test, khớp STORAGE_ENDPOINT/STORAGE_BUCKET).
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: 'http://localhost:3802/api/v1/:path*' },
      { source: '/media/:path*', destination: 'http://localhost:9210/ecom-test/:path*' },
    ];
  },
  eslint: { ignoreDuringBuilds: true }, // lint chạy ở gốc repo bằng `pnpm lint`
  // gốc monorepo (tránh Next đoán nhầm lockfile ở thư mục cha)
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
};
export default nextConfig;
