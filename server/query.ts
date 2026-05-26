import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.order.findUnique({ where: { id: "CWB5012" } }).then(console.log).catch(console.error).finally(() => prisma.$disconnect());
