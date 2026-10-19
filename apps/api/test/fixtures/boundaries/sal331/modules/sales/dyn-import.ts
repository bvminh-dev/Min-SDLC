export const load = async () => (await import('@prisma/client')).PrismaClient;
