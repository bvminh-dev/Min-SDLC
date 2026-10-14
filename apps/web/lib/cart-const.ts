// Hằng số của CRT dùng ở giao diện (khớp giới hạn của CRT-API: số lượng 1..99, 50 dòng, thành phố 1..50 ký tự, mã 1..50 ký tự).
export const CITY_MAX = 50;

/** Số lượng ở huy hiệu: 99 trở lên hiện "99+" (ui/add-to-cart). Hàm thuần, ở tệp này để test API import được không kéo theo `window` của `lib/cart.ts`. */
export const badgeText = (n: number): string => (n >= 99 ? '99+' : String(n));
