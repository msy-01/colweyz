import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { sanitizeOrderBody } from '../lib/sanitize.js';
import { fetchGoogleSheetCsv } from '../lib/fetch-google-sheet.js';
import Papa from 'papaparse';
import { modePaiementFromPaymentMethod } from '../lib/payment-method.js';
import { regionalOrdersWhere } from '../lib/regional-orders.js';

function mapOrderResponse(o: Record<string, unknown>, lite: boolean) {
  const base = {
    ...o,
    modePaiement: modePaiementFromPaymentMethod(o.paymentMethod as string | null | undefined),
  };
  if (lite) {
    return { ...base, logs: [] };
  }
  return base;
}

async function resolveOrderRelations(data: ReturnType<typeof sanitizeOrderBody>) {
  if (data.driverId) {
    const driver = await prisma.driver.findUnique({ where: { id: data.driverId } });
    if (!driver) data.driverId = null;
  }
  if (data.zoneId) {
    const zone = await prisma.zone.findUnique({ where: { id: data.zoneId } });
    if (!zone) data.zoneId = null;
  }
  return data;
}

const router = Router();
router.use(authMiddleware);

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { status, date, driverId, zoneId, limit: limitStr, lite: liteStr } = req.query;
    const lite = liteStr === '1' || liteStr === 'true';

    const where: Record<string, unknown> = {};
    if (status) where.status = status as string;
    if (date) where.date = date as string;
    if (driverId) where.driverId = driverId as string;
    if (zoneId) where.zoneId = zoneId as string;

    const take = limitStr ? parseInt(limitStr as string) : undefined;

    const orders = await prisma.order.findMany({
      where,
      orderBy: { date: 'desc' },
      take
    });

    res.json(orders.map((o) => mapOrderResponse(o as Record<string, unknown>, lite)));
  } catch (error) {
    console.error('GET /orders error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/orders/regional — sous-ensemble expéditions (évite de charger 2000+ commandes)
router.get('/regional', async (_req, res) => {
  try {
    const where = await regionalOrdersWhere(prisma);
    const orders = await prisma.order.findMany({
      where,
      orderBy: { date: 'desc' },
    });
    res.json(
      orders.map((o) => mapOrderResponse(o as Record<string, unknown>, false))
    );
  } catch (error) {
    console.error('GET /orders/regional error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) { res.status(404).json({ error: 'Commande non trouvée' }); return; }
    
    const mappedOrder = {
      ...order,
      modePaiement: modePaiementFromPaymentMethod(order.paymentMethod),
    };

    res.json(mappedOrder);
  } catch (error) {
    console.error('GET /orders/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/orders — création ou mise à jour (upsert)
router.post('/', async (req, res) => {
  try {
    const id = String(req.body.id || `CW${Date.now()}`);
    let data = sanitizeOrderBody(req.body, id);
    data = await resolveOrderRelations(data);

    const order = await prisma.order.upsert({
      where: { id },
      create: data,
      update: data
    });
    res.status(201).json(order);
  } catch (error) {
    console.error('POST /orders error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/orders/:id — upsert (nouvelle commande avec id déjà généré côté client)
router.put('/:id', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    let data = sanitizeOrderBody(req.body, id);
    data = await resolveOrderRelations(data);

    const order = await prisma.order.upsert({
      where: { id },
      create: data,
      update: data
    });
    res.json(order);
  } catch (error) {
    console.error('PUT /orders/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/orders/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    await prisma.order.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /orders/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/orders/import-batch — bulk upsert orders
router.post('/import-batch', async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) {
      res.status(400).json({ error: 'Format invalide: orders doit être un tableau' });
      return;
    }

    let imported = 0;
    for (const order of orders) {
      // Preserve existing status/assignments if order already exists
      const existing = await prisma.order.findUnique({ where: { id: order.id } });
      
      if (existing) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            clientName: order.clientName,
            clientPhone: order.clientPhone,
            address: order.address,
            productDetails: order.productDetails,
            amount: order.amount,
            date: order.date,
            products: order.products || existing.products,
            updatedAt: new Date()
          }
        });
      } else {
        await prisma.order.create({
          data: {
            ...order,
            products: order.products || [],
            logs: order.logs || [],
            linkedOrderIds: order.linkedOrderIds || []
          }
        });
      }
      imported++;
    }

    res.json({ count: imported });
  } catch (error) {
    console.error('POST /orders/import-batch error:', error);
    res.status(500).json({ error: 'Erreur lors de l\'import' });
  }
});

// POST /api/orders/import — import from Google Sheet CSV URL
router.post('/import', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).json({ error: 'URL manquante' });
      return;
    }

    const csvText = await fetchGoogleSheetCsv(url);

    // Get products for matching
    const products = await prisma.product.findMany();

    const result = await new Promise<{ count: number; ignored: number }>((resolve, reject) => {
      Papa.parse(csvText, {
        header: false,
        skipEmptyLines: true,
        complete: async (results) => {
          try {
            let importedCount = 0;
            let ignoredCount = 0;

            for (const row of results.data as any[][]) {
              const values = Array.isArray(row) ? row : Object.values(row);
              if (values.length < 2) continue;

              let id = values[1] ? String(values[1]).trim() : '';
              let date = values[2] ? String(values[2]).trim() : '';

              // Corriger les lignes Sheet avec colonnes ID/date inversées
              const idLooksLikeDate = /^\d{4}-\d{2}-\d{2}/.test(id);
              const dateLooksLikeOrderId = /^#?CW\d+/i.test(date) || /^#\w+/.test(date);
              if (idLooksLikeDate && dateLooksLikeOrderId) {
                [id, date] = [date, id];
              }
              if (id && !id.startsWith('#') && /^CW\d+/i.test(id)) {
                id = `#${id}`;
              }

              const statusRaw = values[10] ? String(values[10]).trim().toLowerCase() : '';

              if (!id || id.length <= 2) { ignoredCount++; continue; }
              // Rejeter les faux IDs (dates, texte libre) — évite les doublons type id=2026-05-22
              if (!/^#CW\d+/i.test(id)) { ignoredCount++; continue; }
              if (!statusRaw.includes('valid')) { ignoredCount++; continue; }

              const rawAmount = values[8] ? String(values[8]) : '0';
              const amount = parseInt(rawAmount.replace(/\D/g, '') || '0');

              const existing = await prisma.order.findUnique({ where: { id } });
              if (existing) { ignoredCount++; continue; }

              await prisma.order.create({
                data: {
                  id,
                  date,
                  clientName: values[3] ? String(values[3]) : 'Inconnu',
                  clientPhone: values[5] ? String(values[5]) : '',
                  address: values[4] ? String(values[4]) : 'Non précisée',
                  productDetails: values[6] ? String(values[6]) : '',
                  amount,
                  status: 'validé',
                  remarks: values[9] ? String(values[9]).trim() : '',
                  products: [],
                  logs: [{ id: Date.now().toString(), text: 'Importé via Google Drive', author: 'Système', createdAt: new Date().toISOString() }],
                  linkedOrderIds: []
                }
              });
              importedCount++;
            }

            resolve({ count: importedCount, ignored: ignoredCount });
          } catch (err) {
            reject(err);
          }
        },
        error: reject
      });
    });

    res.json(result);
  } catch (error) {
    console.error('POST /orders/import error:', error);
    res.status(500).json({ error: 'Erreur lors de l\'import' });
  }
});

export default router;
