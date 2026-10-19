export const q = (p: { $queryRawUnsafe: (s: string) => unknown; $executeRawUnsafe: (s: string) => unknown }) => p.$queryRawUnsafe('SELECT 1');
export const e = (p: { $executeRawUnsafe: (s: string) => unknown }) => p.$executeRawUnsafe('DELETE FROM sales_x');
