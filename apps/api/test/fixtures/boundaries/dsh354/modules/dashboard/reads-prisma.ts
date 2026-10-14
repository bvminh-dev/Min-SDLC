export async function bad(prisma: any) {
  return prisma.order.findMany();
}
