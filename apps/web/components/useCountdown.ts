'use client';
import { useEffect, useState } from 'react';

/** Trạng thái "bị giới hạn" có thời hạn (429, Retry-After): trả số giây còn lại, về 0 thì trạng thái kết thúc (nút mở lại, banner mất), không giữ mãi tới khi tải lại trang. */
export function useCountdown(): { left: number; start: (seconds?: number) => void; clear: () => void } {
  const [until, setUntil] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (until === null) { setLeft(0); return; }
    const tick = () => { const s = Math.ceil((until - Date.now()) / 1000); if (s <= 0) { setUntil(null); setLeft(0); } else setLeft(s); };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  return { left, start: (s) => setUntil(Date.now() + (s && s > 0 ? s : 60) * 1000), clear: () => setUntil(null) };
}
