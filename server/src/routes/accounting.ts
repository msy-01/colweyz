import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/accounting/entries
router.get('/entries', async (_req, res) => {
  try {
    const entries = await prisma.accountingEntry.findMany({
      include: { lines: true },
      orderBy: { date: 'desc' }
    });
    res.json(entries);
  } catch (error) {
    console.error('GET /accounting/entries error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/accounting/entries
router.post('/entries', async (req, res) => {
  try {
    const { lines, ...data } = req.body;
    
    const entry = await prisma.accountingEntry.upsert({
      where: { id: data.id },
      create: {
        ...data,
        firestoreCreatedAt: data.createdAt || new Date().toISOString(),
        lines: lines ? { createMany: { data: lines } } : undefined
      },
      update: {
        ...data,
        // Replace lines on update
        lines: undefined
      },
      include: { lines: true }
    });

    // If updating, replace lines
    if (lines) {
      await prisma.accountingEntryLine.deleteMany({ where: { accountingEntryId: data.id } });
      await prisma.accountingEntryLine.createMany({
        data: lines.map((line: any) => ({ ...line, accountingEntryId: data.id }))
      });
    }

    const result = await prisma.accountingEntry.findUnique({
      where: { id: entry.id },
      include: { lines: true }
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('POST /accounting/entries error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/accounting/entries/:id
router.delete('/entries/:id', async (req, res) => {
  try {
    await prisma.accountingEntry.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /accounting/entries/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
