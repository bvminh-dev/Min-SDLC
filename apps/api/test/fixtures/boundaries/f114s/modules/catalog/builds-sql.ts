import { Prisma } from '@prisma/client';
export const frag = Prisma.sql`SELECT code FROM orders WHERE id = ${1}`;
export const raw = Prisma.raw('SELECT 1 FROM orders');
export const own = Prisma.sql`SELECT id FROM products`;
