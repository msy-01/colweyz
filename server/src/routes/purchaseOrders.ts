import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { sanitizePurchaseOrderBody } from '../lib/sanitize.js';

const router = Router();
router.use(authMiddleware);

// GET /api/purchase-orders
router.get('/', async (_req, res) => {
  try {
    const pos = await prisma.purchaseOrder.findMany({
      include: { items: true, documents: true },
      orderBy: { date: 'desc' }
    });
    res.json(pos);
  } catch (error) {
    console.error('GET /purchase-orders error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/purchase-orders/:id
router.get('/:id', async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { items: true, documents: true }
    });
    if (!po) { res.status(404).json({ error: 'Bon non trouvé' }); return; }
    res.json(po);
  } catch (error) {
    console.error('GET /purchase-orders/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/purchase-orders
router.post('/', async (req, res) => {
  try {
    const { items, documents, ...data } = req.body;
    
    const po = await prisma.purchaseOrder.upsert({
      where: { id: data.id },
      create: {
        ...data,
        linkedOrderIds: data.linkedOrderIds || [],
        items: items ? { createMany: { data: items } } : undefined,
        documents: documents ? { createMany: { data: documents } } : undefined
      },
      update: data,
      include: { items: true, documents: true }
    });
    res.status(201).json(po);
  } catch (error) {
    console.error('POST /purchase-orders error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/purchase-orders/:id
router.put('/:id', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const { items, documents } = req.body;
    const data = sanitizePurchaseOrderBody(req.body);

    if (items) {
      await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      if (items.length > 0) {
        await prisma.purchaseOrderItem.createMany({
          data: items.map((item: Record<string, unknown>) => ({
            id: randomUUID(),
            productId: String(item.productId ?? ''),
            productName: String(item.productName ?? ''),
            quantity: Number(item.quantity) || 0,
            unitPrice: Number(item.unitPrice) || 0,
            total: Number(item.total) || 0,
            source: String(item.source ?? 'stock'),
            purchaseOrderId: id,
          }))
        });
      }
    }

    if (documents) {
      await prisma.purchaseOrderDocument.deleteMany({ where: { purchaseOrderId: id } });
      if (documents.length > 0) {
        await prisma.purchaseOrderDocument.createMany({
          data: documents.map((doc: Record<string, unknown>) => ({
            id: String(doc.id ?? randomUUID()),
            name: String(doc.name ?? ''),
            type: String(doc.type ?? ''),
            data: String(doc.data ?? ''),
            label: String(doc.label ?? ''),
            date: String(doc.date ?? new Date().toISOString()),
            purchaseOrderId: id,
          }))
        });
      }
    }

    const po = await prisma.purchaseOrder.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
      include: { items: true, documents: true }
    });
    res.json(po);
  } catch (error) {
    console.error('PUT /purchase-orders/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/purchase-orders/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.purchaseOrder.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /purchase-orders/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
