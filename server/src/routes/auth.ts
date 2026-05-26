import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { generateToken, authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password, mode } = req.body;

    if (!username) {
      res.status(400).json({ error: 'Identifiant requis' });
      return;
    }

    if (mode === 'driver') {
      // Driver login — by phone or username
      const driver = await prisma.driver.findFirst({
        where: {
          OR: [
            { phone: username },
            { username: username }
          ]
        }
      });

      if (!driver) {
        res.status(401).json({ error: 'Identifiant introuvable' });
        return;
      }

      // Check password if set
      if (driver.passwordHash && password) {
        const valid = await bcrypt.compare(password, driver.passwordHash);
        if (!valid) {
          res.status(401).json({ error: 'Mot de passe incorrect' });
          return;
        }
      } else if (driver.passwordHash && !password) {
        res.status(401).json({ error: 'Mot de passe requis' });
        return;
      }

      const token = generateToken({
        userId: driver.id,
        username: driver.username || driver.phone,
        role: 'driver'
      });

      const { passwordHash: _1, ...safeDriver } = driver;
      res.json({ token, role: 'driver', user: safeDriver });
    } else {
      // Admin/Staff login
      const user = await prisma.systemUser.findUnique({
        where: { username }
      });

      if (!user) {
        res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
        return;
      }

      if (user.passwordHash) {
        const valid = await bcrypt.compare(password || '', user.passwordHash);
        if (!valid) {
          res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
          return;
        }
      }

      const token = generateToken({
        userId: user.id,
        username: user.username,
        role: user.role
      });

      const { passwordHash: _2, ...safeUser } = user;
      res.json({ token, role: user.role, user: safeUser });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Erreur de connexion' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { userId, role } = req.user!;

    if (role === 'driver') {
      const driver = await prisma.driver.findUnique({ where: { id: userId } });
      if (!driver) { res.status(404).json({ error: 'Livreur non trouvé' }); return; }
      const { passwordHash: _3, ...safeDriver } = driver;
      res.json({ role: 'driver', user: safeDriver });
    } else {
      const user = await prisma.systemUser.findUnique({ where: { id: userId } });
      if (!user) { res.status(404).json({ error: 'Utilisateur non trouvé' }); return; }
      const { passwordHash: _4, ...safeUser } = user;
      res.json({ role: user.role, user: safeUser });
    }
  } catch (error) {
    console.error('Auth /me error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
