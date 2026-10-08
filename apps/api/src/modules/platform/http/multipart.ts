import type { Request } from 'express';

// Ngoại lệ hẹp của quy tắc "chỉ nhận application/json" (ADR-016, SB-13): endpoint tải tệp khai đúng method và đường dẫn ở đây
// (đoạn `:tên` khớp đúng một đoạn đường dẫn, ví dụ `/api/v1/admin/products/:id/images`).
// Request vẫn qua giới hạn tần suất, CSRF (Origin) và quyền như mọi endpoint; chỉ bước kiểm kiểu nội dung và bộ đọc JSON được bỏ qua,
// còn việc đọc luồng (giới hạn kích thước) do handler làm. Kiểu khác (text/plain...) và route khác vẫn 415.
const routes = new Map<string, RegExp>();
const norm = (p: string): string => p.replace(/\/+$/, '') || '/';
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const allowMultipart = (method: string, path: string): void => {
  const re = new RegExp(`^${norm(path).split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : escape(seg))).join('/')}$`);
  routes.set(`${method.toUpperCase()} ${norm(path)}`, re);
};
export const isAllowedMultipart = (req: Request): boolean => {
  const path = norm(req.path);
  return [...routes].some(([k, re]) => k.startsWith(`${req.method} `) && re.test(path)) && !!req.is('multipart/form-data');
};
