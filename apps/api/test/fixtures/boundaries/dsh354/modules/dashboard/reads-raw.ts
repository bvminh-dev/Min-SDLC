export async function bad(prisma: any) {
  return prisma.$queryRaw`SELECT count(*) FROM orders`;
}
