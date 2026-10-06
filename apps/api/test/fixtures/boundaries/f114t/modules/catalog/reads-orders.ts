export async function bad(prisma: any) {
  const a = await prisma.order.findMany();
  const b = await prisma.$queryRaw`SELECT * FROM orders WHERE id = ${1}`;
  const own = await prisma.product.findMany();
  return [a, b, own];
}
