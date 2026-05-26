import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { ensureStockDriver } from '../lib/stock-drivers.js';

const DEPOT_ID = 'depot_delta';

const router = Router();
router.use(authMiddleware);

// GET /api/stock/livreurs
router.get('/livreurs', async (_req, res) => {
  try {
    const entries = await prisma.stockLivreur.findMany();
    res.json(entries);
  } catch (error) {
    console.error('GET /stock/livreurs error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/stock/operations
router.get('/operations', async (req, res) => {
  try {
    const { productId, livreurId, limit: limitStr } = req.query;
    const where: any = {};
    if (productId) where.productId = productId as string;
    if (livreurId) where.livreurId = livreurId as string;
    const take = limitStr ? parseInt(limitStr as string) : undefined;

    const ops = await prisma.stockOperation.findMany({
      where,
      orderBy: { date: 'desc' },
      take
    });
    res.json(ops);
  } catch (error) {
    console.error('GET /stock/operations error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock/operations — Log a stock operation
router.post('/operations', async (req, res) => {
  try {
    const data = req.body;
    const id = data.id || `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const op = await prisma.stockOperation.create({
      data: {
        id,
        ...data,
        firestoreCreatedAt: new Date().toISOString()
      }
    });
    res.status(201).json(op);
  } catch (error) {
    console.error('POST /stock/operations error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock/transfer — Atomic stock transfer (Prisma transaction)
router.post('/transfer', async (req, res) => {
  try {
    const { productId, productName, sourceId, destinationId, quantity, adminId } = req.body;

    if (!productId || !sourceId || !destinationId || !quantity) {
      res.status(400).json({ error: 'Paramètres manquants' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Source: deduct
      if (sourceId === 'global') {
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) throw new Error('Produit non trouvé');

        const sg = (product.stockGlobal as any) || { si: product.mainStock || 0, entrees: 0, sorties: 0, sf: product.mainStock || 0, ajustementManuel: 0 };
        sg.sorties = (sg.sorties || 0) + quantity;
        sg.sf = (sg.si || 0) + (sg.entrees || 0) - sg.sorties + (sg.ajustementManuel || 0);

        await tx.product.update({
          where: { id: productId },
          data: { stockGlobal: sg, mainStock: sg.sf }
        });
      } else {
        await upsertStockLivreur(tx, sourceId, productId, productName, { sorties: quantity });
      }

      // Destination: add
      if (destinationId === 'global') {
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) throw new Error('Produit non trouvé');

        const sg = (product.stockGlobal as any) || { si: product.mainStock || 0, entrees: 0, sorties: 0, sf: product.mainStock || 0, ajustementManuel: 0 };
        sg.entrees = (sg.entrees || 0) + quantity;
        sg.sf = (sg.si || 0) + sg.entrees - (sg.sorties || 0) + (sg.ajustementManuel || 0);

        await tx.product.update({
          where: { id: productId },
          data: { stockGlobal: sg, mainStock: sg.sf }
        });
      } else {
        await upsertStockLivreur(tx, destinationId, productId, productName, { entrees: quantity });
      }

      // Determine transfer type
      let type = 'transfert_driver_to_driver';
      if (sourceId === 'global' && destinationId === DEPOT_ID) type = 'transfert_global_to_depot';
      else if (sourceId === 'global') type = 'transfert_global_to_driver';
      else if (sourceId === DEPOT_ID && destinationId === 'global') type = 'transfert_depot_to_global';
      else if (destinationId === 'global') type = 'transfert_driver_to_global';
      else if (sourceId === DEPOT_ID) type = 'transfert_depot_to_driver';
      else if (destinationId === DEPOT_ID) type = 'transfert_driver_to_depot';

      // Log operation
      const opId = `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await tx.stockOperation.create({
        data: {
          id: opId,
          date: new Date().toISOString(),
          productId,
          productName: productName || 'Produit',
          type,
          quantity,
          livreurId: sourceId === 'global' ? undefined : sourceId,
          entiteId: destinationId === 'global' ? undefined : destinationId,
          source: `Transfert par ${adminId}`,
          firestoreCreatedAt: new Date().toISOString()
        }
      });
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('POST /stock/transfer error:', error);
    res.status(500).json({ error: error.message || 'Erreur de transfert' });
  }
});

// POST /api/stock/cancel-operation
router.post('/cancel-operation', async (req, res) => {
  try {
    const { opId, adminId } = req.body;

    await prisma.$transaction(async (tx) => {
      const op = await tx.stockOperation.findUnique({ where: { id: opId } });
      if (!op) throw new Error('Opération non trouvée');
      if (op.annule) throw new Error('Opération déjà annulée');

      const { productId, quantity, livreurId, entiteId } = op;

      // Reverse source
      if (livreurId) {
        await upsertStockLivreur(tx, livreurId, productId, op.productName, { sorties: -(quantity || 0) });
      } else {
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (product) {
          const sg = (product.stockGlobal as any) || { si: 0, entrees: 0, sorties: 0, sf: 0, ajustementManuel: 0 };
          sg.sorties = (sg.sorties || 0) - (quantity || 0);
          sg.sf = (sg.si || 0) + (sg.entrees || 0) - sg.sorties + (sg.ajustementManuel || 0);
          await tx.product.update({ where: { id: productId }, data: { stockGlobal: sg, mainStock: sg.sf } });
        }
      }

      // Reverse destination
      if (entiteId) {
        await upsertStockLivreur(tx, entiteId, productId, op.productName, { entrees: -(quantity || 0) });
      } else {
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (product) {
          const sg = (product.stockGlobal as any) || { si: 0, entrees: 0, sorties: 0, sf: 0, ajustementManuel: 0 };
          sg.entrees = (sg.entrees || 0) - (quantity || 0);
          sg.sf = (sg.si || 0) + sg.entrees - (sg.sorties || 0) + (sg.ajustementManuel || 0);
          await tx.product.update({ where: { id: productId }, data: { stockGlobal: sg, mainStock: sg.sf } });
        }
      }

      // Mark cancelled
      await tx.stockOperation.update({
        where: { id: opId },
        data: {
          annule: true,
          annuleLe: new Date().toISOString(),
          annuleMotif: `Annulation par ${adminId}`
        }
      });
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('POST /stock/cancel-operation error:', error);
    res.status(500).json({ error: error.message || 'Erreur d\'annulation' });
  }
});

// POST /api/stock/recalculate-all — Full stock recalculation
router.post('/recalculate-all', async (_req, res) => {
  try {
    const products = await prisma.product.findMany();
    const allOps = await prisma.stockOperation.findMany({
      where: { annule: { not: true } },
      orderBy: { date: 'asc' }
    });
    const stLivreurs = await prisma.stockLivreur.findMany();

    for (const product of products) {
      const productId = product.id;
      const productName = product.title.toLowerCase().trim();

      const ops = allOps.filter(op =>
        op.productId === productId ||
        op.productName.toLowerCase().trim() === productName
      );

      let gEntrees = 0, gSorties = 0, gAjustements = 0;
      const livStats: Record<string, { entrees: number; sorties: number; ajustements: number }> = {};

      for (const op of ops) {
        const qty = op.quantity || 0;
        const type = op.type;
        const srcId = op.livreurId;
        const dstId = op.entiteId;
        const isGlobalSource = !srcId || srcId === 'global';
        const isGlobalDest = !dstId || dstId === 'global';

        if (isGlobalDest && isGlobalSource) {
          if (['entree', 'retour'].includes(type)) gEntrees += qty;
          else if (['sortie', 'vente'].includes(type)) gSorties += qty;
          else if (type === 'si_ajustement') gAjustements += qty;
        } else {
          if (isGlobalDest) {
            if (['entree', 'retour', 'transfert_driver_to_global', 'transfert_depot_to_global'].includes(type)) gEntrees += qty;
            else if (type === 'si_ajustement') gAjustements += qty;
          }
          if (isGlobalSource) {
            if (['sortie', 'vente', 'transfert_global_to_driver', 'transfert_global_to_depot'].includes(type)) gSorties += qty;
            else if (type === 'si_ajustement') gAjustements -= qty;
          }
        }

        // Driver/Depot impact
        const targetedIds = new Set<string>();
        if (srcId && srcId !== 'global') targetedIds.add(srcId);
        if (dstId && dstId !== 'global') targetedIds.add(dstId);

        for (const id of targetedIds) {
          if (!livStats[id]) livStats[id] = { entrees: 0, sorties: 0, ajustements: 0 };
          if (dstId === id) {
            if (['entree', 'retour', 'transfert_global_to_driver', 'transfert_global_to_depot', 'transfert_driver_to_depot', 'transfert_depot_to_driver'].includes(type)) {
              livStats[id].entrees += qty;
            } else if (type === 'si_ajustement') {
              livStats[id].ajustements += qty;
            }
          } else if (srcId === id) {
            if (['sortie', 'vente', 'transfert_driver_to_global', 'transfert_depot_to_global', 'transfert_driver_to_depot', 'transfert_depot_to_driver'].includes(type)) {
              livStats[id].sorties += qty;
            } else if (type === 'si_ajustement') {
              livStats[id].ajustements -= qty;
            }
          }
        }
      }

      // Update global stock
      const sg = (product.stockGlobal as any) || { si: product.mainStock || 0 };
      const siGlobal = sg.si ?? product.mainStock ?? 0;
      const sfGlobal = siGlobal + gEntrees - gSorties + gAjustements;

      await prisma.product.update({
        where: { id: productId },
        data: {
          stockGlobal: {
            si: siGlobal,
            entrees: gEntrees,
            sorties: gSorties,
            ajustementManuel: gAjustements,
            sf: sfGlobal
          },
          mainStock: sfGlobal
        }
      });

      // Update StockLivreurs
      for (const [livId, stats] of Object.entries(livStats)) {
        const existing = stLivreurs.find(e => e.livreurId === livId && e.produitId === productId);
        const si = existing?.si || 0;
        const newSF = si + stats.entrees - stats.sorties + stats.ajustements;

        if (existing) {
          await prisma.stockLivreur.update({
            where: { id: existing.id },
            data: {
              entrees: stats.entrees,
              sorties: stats.sorties,
              ajustementManuel: stats.ajustements,
              sf: newSF
            }
          });
        }
      }
    }

    res.json({ success: true, message: 'Le recalcul des stocks est terminé.' });
  } catch (error: any) {
    console.error('POST /stock/recalculate-all error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/stock/adjust-global
router.post('/adjust-global', async (req, res) => {
  try {
    const { productId, newSF, reason, adminId } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) { res.status(404).json({ error: 'Produit non trouvé' }); return; }

    const sg = (product.stockGlobal as any) || { si: product.mainStock || 0, entrees: 0, sorties: 0, ajustementManuel: 0 };
    const currentSF = (sg.si || 0) + (sg.entrees || 0) - (sg.sorties || 0) + (sg.ajustementManuel || 0);
    const diff = newSF - currentSF;

    if (diff !== 0) {
      // Log adjustment
      await prisma.stockOperation.create({
        data: {
          id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          date: new Date().toISOString(),
          productId,
          productName: product.title,
          type: 'si_ajustement',
          quantity: diff,
          entiteType: 'global',
          source: 'ajustement_manuel_service',
          notes: reason,
          firestoreCreatedAt: new Date().toISOString()
        }
      });
    }

    const sfBrut = (sg.si || 0) + (sg.entrees || 0) - (sg.sorties || 0);
    const newDelta = newSF - sfBrut;

    await prisma.product.update({
      where: { id: productId },
      data: {
        stockGlobal: {
          ...sg,
          ajustementManuel: newDelta,
          sf: newSF,
          motifDernierAjustement: reason,
          dateDernierAjustement: new Date().toISOString(),
          ajustePar: adminId
        },
        mainStock: newSF
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('POST /stock/adjust-global error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock/adjust-livreur
router.post('/adjust-livreur', async (req, res) => {
  try {
    const { livreurId, productId, newSF, reason, adminId } = req.body;
    const compositeId = `${livreurId}_${productId}`;

    const existing = await prisma.stockLivreur.findUnique({
      where: { livreurId_produitId: { livreurId, produitId: productId } }
    });

    if (!existing) {
      await ensureStockDriver(prisma, livreurId);
      const product = await prisma.product.findUnique({ where: { id: productId } });
      await prisma.stockLivreur.create({
        data: {
          id: compositeId,
          livreurId,
          produitId: productId,
          produitNom: product?.title || 'Inconnu',
          si: 0, entrees: 0, sorties: 0, sf: newSF,
          ajustementManuel: newSF,
          motifDernierAjustement: reason,
          dateDernierAjustement: new Date().toISOString(),
          ajustePar: adminId
        }
      });
    } else {
      const currentSF = (existing.si || 0) + (existing.entrees || 0) - (existing.sorties || 0) + (existing.ajustementManuel || 0);
      const diff = newSF - currentSF;

      if (diff !== 0) {
        await prisma.stockOperation.create({
          data: {
            id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            date: new Date().toISOString(),
            productId,
            productName: existing.produitNom,
            type: 'si_ajustement',
            quantity: diff,
            livreurId,
            entiteType: livreurId === DEPOT_ID ? 'depot' : 'livreur',
            entiteId: livreurId,
            source: 'ajustement_manuel_service',
            notes: reason,
            firestoreCreatedAt: new Date().toISOString()
          }
        });
      }

      const sfBrut = (existing.si || 0) + (existing.entrees || 0) - (existing.sorties || 0);
      const newDelta = newSF - sfBrut;

      await prisma.stockLivreur.update({
        where: { livreurId_produitId: { livreurId, produitId: productId } },
        data: {
          ajustementManuel: newDelta,
          sf: newSF,
          motifDernierAjustement: reason,
          dateDernierAjustement: new Date().toISOString(),
          ajustePar: adminId
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('POST /stock/adjust-livreur error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Helper: upsert stock livreur entry within a transaction
async function upsertStockLivreur(
  tx: any,
  livreurId: string,
  productId: string,
  productName: string,
  delta: { entrees?: number; sorties?: number }
) {
  const existing = await tx.stockLivreur.findUnique({
    where: { livreurId_produitId: { livreurId, produitId: productId } }
  });

  if (existing) {
    const newEntrees = (existing.entrees || 0) + (delta.entrees || 0);
    const newSorties = (existing.sorties || 0) + (delta.sorties || 0);
    const newSF = (existing.si || 0) + newEntrees - newSorties + (existing.ajustementManuel || 0);

    await tx.stockLivreur.update({
      where: { livreurId_produitId: { livreurId, produitId: productId } },
      data: { entrees: newEntrees, sorties: newSorties, sf: newSF }
    });
  } else {
    await ensureStockDriver(tx, livreurId);
    const id = `${livreurId}_${productId}`;
    const entrees = delta.entrees || 0;
    const sorties = delta.sorties || 0;
    await tx.stockLivreur.create({
      data: {
        id,
        livreurId,
        produitId: productId,
        produitNom: productName,
        si: 0,
        entrees: Math.max(0, entrees),
        sorties: Math.max(0, sorties),
        sf: entrees - sorties,
        ajustementManuel: 0
      }
    });
  }
}

export default router;
