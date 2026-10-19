// Nơi DUY NHẤT của web đọc biến môi trường: chỉ NEXT_PUBLIC_* (lộ ra trình duyệt, không bí mật; build chặn tên chứa SECRET, KEY, PASSWORD, TOKEN).
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3802/api/v1';
