/** Ảnh đại diện hoặc chữ cái đầu trên nền pastel khi chưa có ảnh. Tên và URL luôn là văn bản (React escape), không bao giờ HTML. */
export function Avatar({ name, url, size = 72, testId }: { name: string; url?: string | null; size?: number; testId: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div data-testid={testId} data-has-image={url ? 'true' : 'false'} style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: '#dbe7ff', color: '#1d4ed8', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: size / 2.2, flex: 'none' }}>
      {url ? <img src={url} alt="Ảnh đại diện" width={size} height={size} style={{ objectFit: 'cover', width: '100%', height: '100%' }} /> : <span aria-hidden="true">{letter}</span>}
    </div>
  );
}
