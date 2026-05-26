import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { modePaiementFromPaymentMethod } from '../lib/payment-method.js';

const router = Router();
router.use(authMiddleware);

function isCashOrder(o: {
  paymentMethod: string | null;
}): boolean {
  const modePaiement = modePaiementFromPaymentMethod(o.paymentMethod);
  return (
    modePaiement === 'Espèces' ||
    (!modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod))
  );
}

/** GET /api/stats/colweyz-debt — même formule que Livraisons / Balances (solde global). */
router.get('/colweyz-debt', async (req, res) => {
  try {
    const driverId = typeof req.query.driverId === 'string' ? req.query.driverId : undefined;

    const [orders, drivers, zones] = await Promise.all([
      prisma.order.findMany({
        where: {
          status: { in: ['livré', 'terminé'] },
          ...(driverId ? { driverId } : {}),
        },
        select: {
          amount: true,
          remuneration: true,
          paymentMethod: true,
          status: true,
          zoneId: true,
        },
      }),
      prisma.driver.findMany({ select: { id: true, initialBalance: true } }),
      prisma.zone.findMany({ select: { id: true, type: true } }),
    ]);

    const zoneType = new Map(zones.map((z) => [z.id, z.type]));
    const isRegional = (o: { status: string; zoneId: string | null }) => {
      const regionalStatuses = [
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
      ];
      return (
        regionalStatuses.includes(o.status) ||
        (o.zoneId != null && zoneType.get(o.zoneId) === 'regional')
      );
    };

    const totalCash = orders
      .filter(isCashOrder)
      .reduce((s, o) => s + (o.amount ?? 0), 0);
    const totalRemun = orders.reduce(
      (s, o) => (isRegional(o) ? s : s + (o.remuneration ?? 0)),
      0
    );
    const initial = driverId
      ? drivers.find((d) => d.id === driverId)?.initialBalance ?? 0
      : drivers.reduce((s, d) => s + (d.initialBalance ?? 0), 0);

    const balance = initial + totalRemun - totalCash;
    const amountDueColweyz = balance < 0 ? Math.abs(balance) : 0;

    res.json({
      amountDueColweyz,
      balance,
      totalCash,
      totalRemun,
      initialBalance: initial,
      orderCount: orders.length,
    });
  } catch (error) {
    console.error('GET /stats/colweyz-debt error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
