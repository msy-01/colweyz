import { Router } from 'express';
import { firestoreSyncTimestamp } from '../lib/firestore-sync.js';
import {
  normalizeDailyEntrySnapshot,
  normalizeDailyFinanceSnapshot,
  resolveFinanceDate,
} from '../lib/finance-data.js';
import { upsertFinancialConfigFromApi } from '../lib/financial-config.js';
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
    const payload = await upsertFinancialConfigFromApi(req.body as Record<string, unknown>);
    const fsAt = firestoreSyncTimestamp();
    const config = await prisma.financialConfig.update({
      where: { id: payload.id },
      data: { firestoreUpdatedAt: fsAt },
    });
    res.status(201).json({
      ...config,
      updatedAt: config.updatedAt.toISOString(),
      createdAt: config.createdAt.toISOString(),
    });
  } catch (error) {
    console.error('POST /finance/configs error:', error);
    const msg = error instanceof Error ? error.message : 'Erreur serveur';
    res.status(msg.includes('requis') ? 400 : 500).json({ error: msg });
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
    const data = req.body as Record<string, unknown>;
    const date = resolveFinanceDate(String(data.date ?? ''), data);
    if (!date) {
      res.status(400).json({ error: 'date requise (YYYY-MM-DD)' });
      return;
    }
    const snap = normalizeDailyEntrySnapshot({ ...data, date });
    const entry = await prisma.dailyEntry.upsert({
      where: { date },
      create: {
        date,
        exchangeRate: snap.exchangeRate,
        entries: snap.entries,
        productOrder: snap.productOrder,
      },
      update: {
        exchangeRate: snap.exchangeRate,
        entries: snap.entries,
        productOrder: snap.productOrder,
      },
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
    const data = req.body as Record<string, unknown>;
    const date = resolveFinanceDate(String(data.date ?? ''), data);
    if (!date) {
      res.status(400).json({ error: 'date requise (YYYY-MM-DD)' });
      return;
    }
    const snap = normalizeDailyFinanceSnapshot({ ...data, date });
    const entry = await prisma.dailyFinance.upsert({
      where: { date },
      create: {
        date,
        otherRevenues: snap.otherRevenues,
        otherExpenses: snap.otherExpenses,
      },
      update: {
        otherRevenues: snap.otherRevenues,
        otherExpenses: snap.otherExpenses,
      },
    });
    res.status(201).json(entry);
  } catch (error) {
    console.error('POST /finance/daily-finance error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
