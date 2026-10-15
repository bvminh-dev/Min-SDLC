'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Ghi route hiện tại vào `<html data-page>` để icons.css gắn icon cho tiêu đề trang (không hiện gì ra giao diện). */
export function PageMark() {
  const path = usePathname();
  useEffect(() => { document.documentElement.dataset.page = path; }, [path]);
  return null;
}
