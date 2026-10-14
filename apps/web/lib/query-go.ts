// Đổi tham số truy vấn trên URL, phần thuần (không React, không `next/navigation`) để test được: dùng chung cho mọi trang danh sách có bộ lọc (REV-REV-12, bài học L135).

/** Áp `change` lên chuỗi truy vấn `current`: giá trị rỗng hay null là xóa khóa; đổi bộ lọc thì về trang 1, trừ khi `keepPage` hay `change` tự đặt `page`. */
export function nextQuery(current: string, change: Record<string, string | null>, keepPage = false): string {
  const n = new URLSearchParams(current);
  for (const [k, v] of Object.entries(change)) { if (v) n.set(k, v); else n.delete(k); }
  if (!keepPage && !('page' in change)) n.delete('page');
  return n.toString();
}

/**
 * Cộng dồn các lần đổi liền nhau. `useSearchParams()` chỉ cập nhật sau khi Next đổi trang xong, nên lần đổi thứ hai trong cùng khoảng đó dựng URL từ chuỗi CŨ của lần render và làm sống lại bộ lọc
 * lần đầu vừa bỏ. `next` nhớ chuỗi vừa dựng và dùng nó làm nền cho tới khi `settle()` (gọi khi `useSearchParams` đã đổi) xóa đi.
 */
export class QueryAccumulator {
  private queued: string | null = null;
  settle(): void { this.queued = null; }
  next(current: string, change: Record<string, string | null>, keepPage = false): string {
    const s = nextQuery(this.queued ?? current, change, keepPage);
    this.queued = s;
    return s;
  }
}

/** URL đích từ gốc `base` và chuỗi truy vấn (không có dấu hỏi thừa khi rỗng). */
export const withQuery = (base: string, query: string): string => (query ? `${base}?${query}` : base);
