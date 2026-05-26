/** Statuts et filtre SQL alignés sur pages/RegionalOrders.tsx */

export const REGIONAL_ORDER_STATUSES = [
  'regional_en_attente',
  'expedition_en_cours',
  'expedition_livree',
  'regional_contacte',
  'regional_relance',
  'regional_prete',
  'regional_injoignable',
  'regional_injoignable_x2',
  'regional_injoignable_x3',
  'regional_reporte',
  'regional_annule',
] as const;

export async function regionalOrdersWhere(prisma: {
  zone: { findMany: (args: { where: { type: string }; select: { id: true } }) => Promise<{ id: string }[]> };
}) {
  const regionalZones = await prisma.zone.findMany({
    where: { type: 'regional' },
    select: { id: true },
  });
  const regionalZoneIds = regionalZones.map((z) => z.id);

  return {
    OR: [
      { status: { in: [...REGIONAL_ORDER_STATUSES] } },
      ...(regionalZoneIds.length > 0
        ? [{ status: 'validé' as const, zoneId: { in: regionalZoneIds } }]
        : []),
    ],
  };
}
