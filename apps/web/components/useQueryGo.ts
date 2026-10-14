'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { QueryAccumulator, withQuery } from '../lib/query-go';

/**
 * Đổi tham số truy vấn trên URL của trang `base` (`change`: giá trị rỗng là xóa; đổi bộ lọc thì về trang 1 trừ khi `keepPage` hay `change` có `page`). Hai lần đổi liền nhau trước khi `useSearchParams`
 * kịp cập nhật CỘNG DỒN trên chuỗi truy vấn của lần đổi trước, không lấy chuỗi cũ của lần render (nếu không, lần đổi thứ hai làm sống lại bộ lọc lần đầu vừa bỏ; REV-E2E-20261006-104528550, REV-REV-12).
 * Mọi trang danh sách có bộ lọc dùng hook này, không tự dựng chuỗi truy vấn từ `useSearchParams()` của lần render.
 */
export function useQueryGo(base: string) {
  const router = useRouter();
  const sp = useSearchParams();
  const acc = useRef(new QueryAccumulator());
  useEffect(() => { acc.current.settle(); }, [sp]);
  return useCallback((change: Record<string, string | null>, keepPage = false, replace = false) => {
    const url = withQuery(base, acc.current.next(sp.toString(), change, keepPage));
    if (replace) router.replace(url, { scroll: false }); else router.push(url, { scroll: false });
  }, [sp, router, base]);
}
