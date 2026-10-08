import { Prisma } from '@prisma/client';
export const own = Prisma.sql`SELECT code FROM orders`;
