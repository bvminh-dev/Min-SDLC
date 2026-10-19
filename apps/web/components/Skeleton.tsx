import type { HTMLAttributes, ReactNode } from 'react';

// Khung chờ kiểu Facebook: khối xám đúng hình nội dung (avatar + dòng tiêu đề + dòng phụ), độ rộng các dòng lệch nhau theo thứ tự.
// Độ rộng cố định theo chỉ số (không random) để SSR và CSR khớp nhau. Màu và làn sóng sáng dùng chung: xem `.skeleton` trong globals.css.
const W = ['78%', '62%', '90%', '70%', '54%'];
const S = ['46%', '34%', '58%', '40%'];

export const Bone = ({ w, h = 14, round, className = '' }: { w?: number | string; h?: number | string; round?: boolean; className?: string }) =>
  <span className={`skeleton${round ? ' sk-round' : ''}${className ? ` ${className}` : ''}`} style={{ width: w, height: h }} aria-hidden="true" />;

type Box = { testid?: string } & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;
const Wrap = ({ testid, className, children, ...r }: Box & { children: ReactNode }) => <div {...r} className={className} data-testid={testid} aria-busy="true">{children}</div>;

/** Danh sách dòng: [avatar tròn | thumb vuông | không] + `lines` dòng chữ (dòng đầu dài, dòng sau ngắn) + viên thuốc bên phải. */
export function SkRows({ n = 5, lead = 'circle', lines = 2, trail = false, ...box }: { n?: number; lead?: 'circle' | 'square' | false; lines?: number; trail?: boolean } & Box) {
  return (
    <Wrap {...box} className={`sk-rows${box.className ? ` ${box.className}` : ''}`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="sk-row">
          {lead && <Bone round={lead === 'circle'} className="sk-lead" />}
          <div className="sk-col">{Array.from({ length: lines }, (_, j) => <Bone key={j} w={j ? S[(i + j) % 4] : W[i % 5]} h={j ? 11 : 14} />)}</div>
          {trail && <Bone w={64} h={24} round />}
        </div>
      ))}
    </Wrap>
  );
}

/** Lưới thẻ sản phẩm: ảnh vuông + tên + giá. */
export function SkGrid({ n = 4, ...box }: { n?: number } & Box) {
  return (
    <Wrap {...box} className="ct-grid">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="sk-card"><Bone className="sk-img" /><Bone w={W[i % 5]} /><Bone w={S[i % 4]} h={12} /></div>
      ))}
    </Wrap>
  );
}

/** Vài dòng chữ rời (đoạn văn, ô nhỏ, KPI). */
export function SkLines({ n = 3, ...box }: { n?: number } & Box) {
  return <Wrap {...box} className="sk-lines">{Array.from({ length: n }, (_, i) => <Bone key={i} w={i === n - 1 && n > 1 ? S[i % 4] : W[i % 5]} />)}</Wrap>;
}

/** Khối có tiêu đề + dòng chữ (chi tiết, tóm tắt, thẻ địa chỉ). */
export function SkPanel({ n = 3, ...box }: { n?: number } & Box) {
  return (
    <Wrap {...box} className="panel sk-lines">
      <Bone w="38%" h={18} />{Array.from({ length: n }, (_, i) => <Bone key={i} w={i === n - 1 ? S[i % 4] : W[i % 5]} />)}
    </Wrap>
  );
}

/** Form: nhãn ngắn + ô nhập cho mỗi trường. */
export function SkForm({ n = 3, ...box }: { n?: number } & Box) {
  return (
    <Wrap {...box} className="sk-lines sk-form">
      {Array.from({ length: n }, (_, i) => <div key={i} className="sk-lines"><Bone w={S[i % 4]} h={12} /><Bone h={40} /></div>)}
    </Wrap>
  );
}
