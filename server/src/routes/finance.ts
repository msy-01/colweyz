import { Router } from 'express';
import { firestoreSyncTimestamp } from '../lib/firestore-sync.js';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ═══════════════════════════════════════════
// FINANCIAL CONFIGS (campagnes/{pid}/configs/{date})
// ═══════════════════════════════════════════

// GET /api/finance/configs
router.get('/configs', async (_req, res) => {
  try {
    const configs = await prisma.financialConfig.findMany({
      orderBy: { dateEffet: 'desc' }
    });
    res.json(
      configs.map((c) => ({
        ...c,
        updatedAt: c.updatedAt.toISOString(),
        createdAt: c.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error('GET /finance/configs error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/finance/configs
router.post('/configs', async (req, res) => {
  try {
    const data = req.body;
    const dateEffet = data.dateEffet || new Date().toISOString().split('T')[0];

    const fsAt = firestoreSyncTimestamp();
    const config = await prisma.financialConfig.upsert({
      where: {
        productId_dateEffet: {
          productId: data.productId,
          dateEffet
        }
      },
      create: { ...data, dateEffet, firestoreUpdatedAt: fsAt },
      update: { ...data, dateEffet, firestoreUpdatedAt: fsAt }
    });
    res.status(201).json(config);
  } catch (error) {
    console.error('POST /finance/configs error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════
// DAILY ENTRIES
// ═══════════════════════════════════════════

// GET /api/finance/daily-entries
router.get('/daily-entries', async (_req, res) => {
  try {
    const entries = await prisma.dailyEntry.findMany({
      orderBy: { date: 'desc' }
    });
    res.json(
      entries.map((e) => ({
        ...e,
        updatedAt: e.updatedAt.toISOString(),
        createdAt: e.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error('GET /finance/daily-entries error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/finance/daily-entries
router.post('/daily-entries', async (req, res) => {
  try {
    const data = req.body;
    const entry = await prisma.dailyEntry.upsert({
      where: { date: data.date },
      create: {
        date: data.date,
        exchangeRate: data.exchangeRate,
        entries: data.entries,
        productOrder: data.productOrder || []
      },
      update: {
        exchangeRate: data.exchangeRate,
        entries: data.entries,
        productOrder: data.productOrder || []
      }
    });
    res.status(201).json(entry);
  } catch (error) {
    console.error('POST /finance/daily-entries error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════
// DAILY FINANCE (OTHER REVENUES/EXPENSES)
// ═══════════════════════════════════════════

// GET /api/finance/daily-finance
router.get('/daily-finance', async (_req, res) => {
  try {
    const data = await prisma.dailyFinance.findMany({
      orderBy: { date: 'desc' }
    });
    res.json(data);
  } catch (error) {
    console.error('GET /finance/daily-finance error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/finance/daily-finance/:date
router.get('/daily-finance/:date', async (req, res) => {
  try {
    const entry = await prisma.dailyFinance.findFirst({
      where: { date: req.params.date }
    });
    res.json(entry);
  } catch (error) {
    console.error('GET /finance/daily-finance/:date error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/finance/daily-finance
router.post('/daily-finance', async (req, res) => {
  try {
    const data = req.body;
    const entry = await prisma.dailyFinance.upsert({
      where: { date: data.date },
      create: {
        date: data.date,
        otherRevenues: data.otherRevenues || [],
        otherExpenses: data.otherExpenses || []
      },
      update: {
        otherRevenues: data.otherRevenues || [],
        otherExpenses: data.otherExpenses || []
      }
    });
    res.status(201).json(entry);
  } catch (error) {
    console.error('POST /finance/daily-finance error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
