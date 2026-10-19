export const read = (p: { $queryRaw: (s: TemplateStringsArray) => unknown }) =>
  p.$queryRaw`SELECT id FROM orders`;
