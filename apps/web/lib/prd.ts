'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ApiResult } from './api';

export interface Category { id: string; name: string; slug: string; parent_id: string | null; product_count: number }
export interface FlatCategory extends Category { depth: number }

/** Cây phẳng theo thứ tự cha trước con (DFS, anh em giữ thứ tự server); mồ côi coi như gốc. */
export function flattenTree(items: Category[]): FlatCategory[] {
  const ids = new Set(items.map((c) => c.id));
  const kids = new Map<string | null, Category[]>();
  for (const c of items) { const k = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null; kids.set(k, [...(kids.get(k) ?? []), c]); }
  const out: FlatCategory[] = [];
  const walk = (parent: string | null, depth: number) => { for (const c of kids.get(parent) ?? []) { out.push({ ...c, depth }); if (depth < 8) walk(c.id, depth + 1); } };
  walk(null, 0);
  return out;
}

/** GET /categories. `status` là mã HTTP của lần tải cuối (0 khi lỗi mạng). */
export function useCategories() {
  const [items, setItems] = useState<Category[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [status, setStatus] = useState(0);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const id = ++seq.current;
    const r = await api<{ items: Category[] }>('/categories');
    if (id !== seq.current) return;
    setStatus(r.status);
    if (r.status === 200 && Array.isArray(r.body.items)) { setItems(r.body.items); setState('ready'); } else setState('error');
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { items, state, status, reload: () => { setState('loading'); return reload(); } };
}

/** 401 không phải session_expired: chuyển về đăng nhập kèm đường dẫn hiện tại (như các màn USR). Trả true khi là 401 (bên gọi dừng xử lý). */
export function useLoginRedirect(): (r: ApiResult) => boolean {
  const router = useRouter();
  const path = usePathname();
  return (r) => {
    if (r.status !== 401) return false;
    if (r.code !== 'session_expired') {
      const next = path + (typeof window === 'undefined' ? '' : window.location.search);
      router.replace(`/login?next=${encodeURIComponent(next)}&reason=expired`);
    }
    return true;
  };
}

export const rateLimitedText = (s: number): string => `Bạn thao tác quá nhanh, thử lại sau ${s} giây.`;
