import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import { sanitizeDriverBody } from '../lib/sanitize.js';

const router = Router();
router.use(authMiddleware);

// GET /api/drivers
router.get('/', async (_req, res) => {
  try {
    const drivers = await prisma.driver.findMany({ orderBy: { name: 'asc' } });
    res.json(drivers);
  } catch (error) {
    console.error('GET /drivers error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/drivers/:id
router.get('/:id', async (req, res) => {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: req.params.id } });
    if (!driver) { res.status(404).json({ error: 'Livreur non trouvé' }); return; }
    res.json(driver);
  } catch (error) {
    console.error('GET /drivers/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/drivers
router.post('/', async (req, res) => {
  try {
    const id = req.body.id || `drv-${Date.now()}`;
    const base = sanitizeDriverBody(req.body, id);
    const passwordHash = req.body.password
      ? await bcrypt.hash(String(req.body.password), 10)
      : null;

    const driver = await prisma.driver.upsert({
      where: { id },
      create: { ...base, passwordHash },
      update: { ...base, ...(passwordHash ? { passwordHash } : {}) }
    });
    const { passwordHash: _, ...safe } = driver;
    res.status(201).json(safe);
  } catch (error) {
    console.error('POST /drivers error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/drivers/:id — upsert (création via formulaire avec id déjà défini)
router.put('/:id', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const base = sanitizeDriverBody(req.body, id);
    const passwordHash = req.body.password
      ? await bcrypt.hash(String(req.body.password), 10)
      : undefined;

    const driver = await prisma.driver.upsert({
      where: { id },
      create: { ...base, passwordHash: passwordHash ?? null },
      update: { ...base, ...(passwordHash ? { passwordHash } : {}) }
    });
    const { passwordHash: _, ...safe } = driver;
    res.json(safe);
  } catch (error) {
    console.error('PUT /drivers/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/drivers/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.driver.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /drivers/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
