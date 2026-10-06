import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true }, // lint chạy ở gốc repo bằng `pnpm lint`
  // gốc monorepo (tránh Next đoán nhầm lockfile ở thư mục cha)
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
};
export default nextConfig;
