import { createServer, type Server } from 'node:http';
import { createServer as net } from 'node:net';
import { DEFAULT_PORT_BASE, PORT_SPAN, currentPorts, isPortBusy, pickPortBase, portBaseFrom, portsFrom, staleE2eAt } from '../support/e2e-ports';

// Hạ tầng E2E: cổng cơ sở cấu hình được (E2E_PORT_BASE) để E2E chạy được khi cổng 3100 đến 3103 bị dự án khác giữ, nhưng không bao giờ né một E2E CŨ còn sống (xanh giả).
const free: PickDepsFree = { busy: async () => false, stale: async () => false };
type PickDepsFree = Parameters<typeof pickPortBase>[1];

const listen = (port: number): Promise<Server> => new Promise((res, rej) => { const s = createServer((_q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end('{"ok":true}'); }); s.once('error', rej); s.listen(port, '127.0.0.1', () => res(s)); });
const close = (s: Server): Promise<void> => new Promise((r) => { s.close(() => r()); });
const freeBase = async (): Promise<number> => {
  for (let b = 41000; b < 60000; b += 8) if (!(await Promise.all([0, 1, 2, 3].map((i) => isPortBusy(b + i)))).some(Boolean)) return b;
  throw new Error('không có cổng trống');
};

describe('cổng E2E cấu hình được (E2E_PORT_BASE)', () => {
  it('mặc định 3100 và bốn cổng liên tiếp: web, API, điều khiển, S3', () => {
    expect(portBaseFrom({})).toBe(DEFAULT_PORT_BASE);
    expect(DEFAULT_PORT_BASE).toBe(3100);
    expect(portsFrom(3100)).toEqual({ base: 3100, web: 3100, api: 3101, ctl: 3102, s3: 3103 });
    expect(portsFrom(3300)).toEqual({ base: 3300, web: 3300, api: 3301, ctl: 3302, s3: 3303 });
    expect(currentPorts({ E2E_PORT_BASE: '3300' }).ctl).toBe(3302);
    expect(PORT_SPAN).toBe(4);
  });

  it('E2E_PORT_BASE không phải số nguyên hợp lệ thì ném lỗi nêu tên biến (không lặng lẽ về 3100)', () => {
    for (const bad of ['abc', '33.5', '-1', '80', '65534', '0x1000', '3 300']) expect(() => portBaseFrom({ E2E_PORT_BASE: bad })).toThrow(/E2E_PORT_BASE/);
    expect(portBaseFrom({ E2E_PORT_BASE: '' })).toBe(3100);
    expect(portBaseFrom({ E2E_PORT_BASE: '65532' })).toBe(65532);
  });

  it('đặt E2E_PORT_BASE rõ thì dùng đúng giá trị đó, kể cả khi cổng bận (startE2e sẽ từ chối, nêu cổng)', async () => {
    expect(await pickPortBase({ E2E_PORT_BASE: '3300' }, { busy: async () => true, stale: async () => true })).toBe(3300);
  });

  it('mặc định còn trống thì giữ 3100', async () => {
    expect(await pickPortBase({}, free)).toBe(3100);
  });

  it('3100 bận vì dự án khác (không phải E2E của mình) thì dịch sang cơ sở kế còn trống, bỏ qua cơ sở có cổng lẻ bận', async () => {
    const busyPorts = new Set([3100, 3105]); // 3100: dự án khác; 3105: cổng API của cơ sở 3104
    const picked = await pickPortBase({}, { busy: async (p) => busyPorts.has(p), stale: async () => false });
    expect(picked).toBe(3108);
    expect(picked % PORT_SPAN).toBe(DEFAULT_PORT_BASE % PORT_SPAN);
  });

  it('cổng bị E2E CŨ giữ (cổng điều khiển trả /health) thì ném lỗi, không né sang cổng khác (tránh xanh giả); cả khi E2E cũ nằm ở cơ sở đã tự dịch', async () => {
    await expect(pickPortBase({}, { busy: async () => true, stale: async (p) => p === 3102 })).rejects.toThrow(/3100 đến 3103.*E2E cũ/);
    await expect(pickPortBase({}, { busy: async (p) => p >= 3100 && p < 3108, stale: async (p) => p === 3106 })).rejects.toThrow(/3104 đến 3107.*E2E cũ/);
  });

  it('thật: tiến trình lạ giữ cổng web thì isPortBusy báo bận (cổng kế bên trống); máy chủ có /health trên cổng điều khiển thì staleE2eAt nhận ra', async () => {
    const base = await freeBase();
    const raw = net();
    await new Promise<void>((r) => raw.listen(base, r));
    try {
      expect(await isPortBusy(base)).toBe(true);
      expect(await isPortBusy(base + 1)).toBe(false);
      expect(await staleE2eAt(base + 2)).toBe(false);
    } finally { await new Promise<void>((r) => raw.close(() => r())); }
    const stale = await listen(base + 2);
    try { expect(await staleE2eAt(base + 2)).toBe(true); } finally { await close(stale); }
    expect(await staleE2eAt(base + 2)).toBe(false);
  });
});
