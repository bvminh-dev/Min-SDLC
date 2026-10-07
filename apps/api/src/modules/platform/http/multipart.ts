import type { Request } from 'express';

// Ngoại lệ hẹp của quy tắc "chỉ nhận application/json" (ADR-016, SB-13): endpoint tải tệp khai đúng method và đường dẫn ở đây.
// Request vẫn qua giới hạn tần suất, CSRF (Origin) và quyền như mọi endpoint; chỉ bước kiểm kiểu nội dung và bộ đọc JSON được bỏ qua,
// còn việc đọc luồng (giới hạn kích thước) do handler làm. Kiểu khác (text/plain...) và route khác vẫn 415.
const routes = new Set<string>();
const norm = (p: string): string => p.replace(/\/+$/, '') || '/';

export const allowMultipart = (method: string, path: string): void => { routes.add(`${method.toUpperCase()} ${norm(path)}`); };
export const isAllowedMultipart = (req: Request): boolean => routes.has(`${req.method} ${norm(req.path)}`) && !!req.is('multipart/form-data');
