import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/fund-requests
router.get('/', async (_req, res) => {
  try {
    const requests = await prisma.fundRequest.findMany({
      include: { driver: { select: { id: true, name: true, phone: true } } },
      orderBy: { dbCreatedAt: 'desc' }
    });
    res.json(requests);
  } catch (error) {
    console.error('GET /fund-requests error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/fund-requests
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    const request = await prisma.fundRequest.upsert({
      where: { id: data.id },
      create: {
        ...data,
        createdAt: data.createdAt || new Date().toISOString()
      },
      update: data
    });
    res.status(201).json(request);
  } catch (error) {
    console.error('POST /fund-requests error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/fund-requests/:id
router.put('/:id', async (req, res) => {
  try {
    const request = await prisma.fundRequest.update({
      where: { id: req.params.id },
      data: req.body
    });
    res.json(request);
  } catch (error) {
    console.error('PUT /fund-requests/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/fund-requests/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.fundRequest.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /fund-requests/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
