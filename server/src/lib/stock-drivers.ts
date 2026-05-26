import type { Prisma, PrismaClient } from '@prisma/client';

type DbClient = Prisma.TransactionClient | PrismaClient;

/** Pseudo-livreurs utilisés pour le stock (pas de vrais comptes livreur). */
const STOCK_DRIVER_META: Record<string, { name: string; phone: string }> = {
  depot_delta: { name: 'Dépôt Delta', phone: '000000001' },
};

/** Garantit qu'un livreurId stock existe en base (FK stock_livreurs → drivers). */
export async function ensureStockDriver(
  tx: DbClient,
  livreurId: string
): Promise<void> {
  if (livreurId === 'global') return;

  const meta = STOCK_DRIVER_META[livreurId] ?? {
    name: livreurId,
    phone: '000000000',
  };

  await tx.driver.upsert({
    where: { id: livreurId },
    create: {
      id: livreurId,
      name: meta.name,
      phone: meta.phone,
      status: 'disponible',
    },
    update: {},
  });
}
