import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Trang nhận token ở fragment không được rò token qua Referer khi tải tài nguyên hay mở liên kết ngoài (AUTH-SEC T10, SB-28).
  async headers() {
    return ['/reset-password', '/verify-email'].map((source) => ({ source, headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }));
  },
  eslint: { ignoreDuringBuilds: true }, // lint chạy ở gốc repo bằng `pnpm lint`
  // gốc monorepo (tránh Next đoán nhầm lockfile ở thư mục cha)
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
};
export default nextConfig;
