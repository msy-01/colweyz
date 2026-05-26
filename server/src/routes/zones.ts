import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { sanitizeZoneBody } from '../lib/sanitize.js';

const router = Router();
router.use(authMiddleware);

// GET /api/zones
router.get('/', async (_req, res) => {
  try {
    const zones = await prisma.zone.findMany({ orderBy: { name: 'asc' } });
    res.json(zones);
  } catch (error) {
    console.error('GET /zones error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/zones
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    const zone = await prisma.zone.upsert({
      where: { id: data.id },
      create: data,
      update: data
    });
    res.status(201).json(zone);
  } catch (error) {
    console.error('POST /zones error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/zones/:id — upsert
router.put('/:id', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const data = sanitizeZoneBody(req.body, id);
    const zone = await prisma.zone.upsert({
      where: { id },
      create: data,
      update: data
    });
    res.json(zone);
  } catch (error) {
    console.error('PUT /zones/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/zones/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    await prisma.zone.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /zones/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
