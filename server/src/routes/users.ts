import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/users
router.get('/', async (_req, res) => {
  try {
    const users = await prisma.systemUser.findMany();
    // Don't expose password hashes
    const safe = users.map(({ passwordHash, ...u }) => u);
    res.json(safe);
  } catch (error) {
    console.error('GET /users error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/users
router.post('/', async (req, res) => {
  try {
    const { password, ...data } = req.body;
    const passwordHash = password ? await bcrypt.hash(password, 10) : '';

    const user = await prisma.systemUser.upsert({
      where: { id: data.id },
      create: { ...data, passwordHash },
      update: { ...data, ...(password ? { passwordHash } : {}) }
    });

    const { passwordHash: _, ...safe } = user;
    res.status(201).json(safe);
  } catch (error) {
    console.error('POST /users error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/:id — upsert
router.put('/:id', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id);
    const { password, username, role, permissions } = req.body;
    const base = {
      id,
      username: String(username ?? req.body.username ?? id),
      role: String(role ?? 'staff'),
      permissions: Array.isArray(permissions) ? permissions : [],
    };
    const passwordHash = password ? await bcrypt.hash(String(password), 10) : undefined;

    const user = await prisma.systemUser.upsert({
      where: { id },
      create: {
        ...base,
        passwordHash: passwordHash ?? await bcrypt.hash('changeme', 10),
      },
      update: {
        ...base,
        ...(passwordHash ? { passwordHash } : {}),
      }
    });

    const { passwordHash: _, ...safe } = user;
    res.json(safe);
  } catch (error) {
    console.error('PUT /users/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.systemUser.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /users/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
