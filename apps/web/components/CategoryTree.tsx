'use client';
import Link from 'next/link';
import { useState } from 'react';
import { flattenTree, type Category } from '../lib/prd';

/** Cây danh mục công khai (PRD product-list): mỗi dòng là liên kết lọc; nhánh mở sẵn, bấm mũi tên để thu gọn. Tên và số đều là văn bản React (escape). */
export function CategoryTree({ items, selected, hrefFor, onPick }: { items: Category[]; selected: string | null; hrefFor: (id: string | null) => string; onPick?: () => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = flattenTree(items);
  const hidden = (idx: number): boolean => { // ẩn nếu một tổ tiên đang thu gọn
    let depth = rows[idx].depth, pid = rows[idx].parent_id;
    for (let i = idx - 1; i >= 0 && depth > 0; i--) if (rows[i].id === pid) { if (collapsed.has(rows[i].id)) return true; depth = rows[i].depth; pid = rows[i].parent_id; }
    return false;
  };
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  return (
    <ul className="tree" data-testid="prd-product-list-category-tree">
      <li className="tree-row"><Link href={hrefFor(null)} onClick={onPick} className={selected === null ? 'tree-link tree-on' : 'tree-link'} aria-current={selected === null ? 'true' : undefined}>Tất cả sản phẩm</Link></li>
      {rows.map((c, i) => hidden(i) ? null : (
        <li key={c.id} className="tree-row" style={{ paddingLeft: c.depth * 16 }}>
          {rows[i + 1]?.parent_id === c.id
            ? <button type="button" className="tree-toggle" aria-expanded={!collapsed.has(c.id)} aria-label={`${collapsed.has(c.id) ? 'Mở' : 'Thu gọn'} ${c.name}`} onClick={() => toggle(c.id)}>{collapsed.has(c.id) ? '▸' : '▾'}</button>
            : <span className="tree-toggle" aria-hidden="true" />}
          <Link href={hrefFor(c.id)} onClick={onPick} className={selected === c.id ? 'tree-link tree-on' : 'tree-link'} aria-current={selected === c.id ? 'true' : undefined} data-testid="prd-product-list-category-item" data-id={c.id}>{c.name}</Link>
          <span className="hint" data-testid="prd-product-list-category-count">({c.product_count})</span>
        </li>
      ))}
    </ul>
  );
}
