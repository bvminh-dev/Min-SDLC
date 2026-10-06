export async function good(prisma: any) {
  const a = await prisma.order.findMany();
  const b = await prisma.$queryRaw`SELECT * FROM orders WHERE id = ${1}`;
  return [a, b];
}
