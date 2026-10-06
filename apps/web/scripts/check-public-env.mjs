// PRJ-REQ-20261006-095422735 BR7 / PRJ-SEC T3: build web thất bại nếu biến NEXT_PUBLIC_* có tên chứa bí mật.
// Chỉ in TÊN biến, không in giá trị.
const FORBIDDEN = /(SECRET|KEY|PASSWORD|TOKEN)/i;
const bad = Object.keys(process.env).filter((n) => n.startsWith('NEXT_PUBLIC_') && FORBIDDEN.test(n));
if (bad.length) {
  process.stderr.write(`Build web bị chặn: biến NEXT_PUBLIC_* có tên chứa SECRET, KEY, PASSWORD hoặc TOKEN: ${bad.join(', ')}\n`);
  process.exit(1);
}
