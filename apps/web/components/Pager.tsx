/** Dòng "1 tới 20 trong 30 sản phẩm" và phân trang ‹ 1 2 › (ẩn khi chỉ một trang). Dùng chung hai danh sách. */
export function Pager({ testPrefix, page, limit, total, shown, onPage, disabled, unit = 'sản phẩm', summary }: { testPrefix: string; page: number; limit: number; total: number; shown: number; onPage: (p: number) => void; disabled?: boolean; unit?: string; summary?: (from: number, to: number, total: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = (page - 1) * limit + 1;
  const nums: (number | 'gap-l' | 'gap-r')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (pages <= 7 || p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (p < page && nums[nums.length - 1] !== 'gap-l') nums.push('gap-l');
    else if (p > page && nums[nums.length - 1] !== 'gap-r') nums.push('gap-r');
  }
  return (
    <div className="pager">
      <p className="hint" data-testid={`${testPrefix}-summary`}>{shown > 0 ? (summary ? summary(from, from + shown - 1, total) : `${from}–${from + shown - 1} / ${total} ${unit}`) : `${total} ${unit}`}</p>
      {pages > 1 && (
        <nav aria-label="Phân trang" className="pages" data-testid={`${testPrefix}-pagination`}>
          <button className="btn" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước"><span className="i i-left" aria-hidden="true" /></button>
          {nums.map((n) => typeof n === 'string' ? <span key={n} aria-hidden="true">…</span> : (
            <button key={n} className={`btn${n === page ? ' btn-current' : ''}`} aria-current={n === page ? 'page' : undefined} disabled={disabled} onClick={() => onPage(n)}>{n}</button>
          ))}
          <button className="btn" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)} aria-label="Trang sau"><span className="i i-right" aria-hidden="true" /></button>
        </nav>
      )}
    </div>
  );
}
