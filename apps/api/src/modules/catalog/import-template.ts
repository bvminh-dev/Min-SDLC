import { strToU8, zipSync } from 'fflate';

export const TEMPLATE_FILENAME = 'mau-import-san-pham.xlsx';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const TEMPLATE_HEADERS = ['Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Giá bán', 'Giá vốn', 'ĐVT', 'Tồn kho'] as const;

// Nội dung hướng dẫn (trang thứ hai): chữ thường, không dòng nào bắt đầu bằng = + - @ nên không bao giờ thành công thức khi mở bằng Excel (SB-43).
const GUIDE = [
  'Hướng dẫn nhập sản phẩm từ Excel hoặc CSV',
  'Cột bắt buộc: Mã hàng và Tên hàng. Mã hàng gồm chữ, số, dấu gạch ngang hoặc gạch dưới, dài 3 đến 40 ký tự.',
  'Nhóm hàng: nối các cấp bằng dấu >> (ví dụ Thời trang>>Áo). Nhóm hàng phải có sẵn trong hệ thống, hệ thống không tự tạo nhóm hàng.',
  'Giá bán và Giá vốn: số nguyên đồng, không dấu phân cách. Sản phẩm mới bắt buộc có Giá bán. Ô trống nghĩa là giữ nguyên giá trị hiện có.',
  'ĐVT và Tồn kho được bỏ qua, không ghi vào hệ thống. Tồn kho đầu kỳ nhập ở màn Kho hàng.',
  'Tối đa 2000 dòng dữ liệu và 5 MB mỗi tệp. Sản phẩm mới ở trạng thái Nháp, cần thêm ảnh rồi mới công bố.',
  'Ô không được bắt đầu bằng các ký tự: dấu bằng, dấu cộng, dấu trừ, dấu a còng. Dòng bắt đầu như vậy bị từ chối.',
  'Bước Xem trước không ghi gì; chỉ khi bấm Xác nhận hệ thống mới ghi các dòng hợp lệ.',
];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i: number): string => String.fromCharCode(65 + i);
const sheet = (rows: string[][]): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
  rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')
}</sheetData></worksheet>`;

let cached: Buffer | undefined;
/** Tệp mẫu .xlsx: hằng số do server dựng (không dữ liệu thật, không công thức, không macro, không dòng dữ liệu mẫu để khỏi import nhầm mã mẫu; PRD-REQ-20261015-092431230 BR2, BR3). */
export function templateXlsx(): Buffer {
  if (cached) return cached;
  const x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files = {
    '[Content_Types].xml': `${x}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `${x}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${x}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sản phẩm" sheetId="1" r:id="rId1"/><sheet name="Hướng dẫn" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${x}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheet([[...TEMPLATE_HEADERS]]),
    'xl/worksheets/sheet2.xml': sheet(GUIDE.map((l) => [l])),
  };
  cached = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6, mtime: new Date('2026-01-01T00:00:00Z') }));
  return cached;
}
