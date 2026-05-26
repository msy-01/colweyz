import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/settings/public — logo + téléphone admin (page de connexion, sans JWT)
router.get('/public', async (_req, res) => {
  try {
    const settings = await prisma.appSettings.findUnique({ where: { id: 'global' } });
    res.json({
      logoUrl: settings?.logoUrl ?? null,
      adminPhone: settings?.adminPhone ?? '221770000000',
    });
  } catch (error) {
    console.error('GET /settings/public error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.use(authMiddleware);

// GET /api/settings
router.get('/', async (_req, res) => {
  try {
    let settings = await prisma.appSettings.findUnique({ where: { id: 'global' } });
    if (!settings) {
      settings = await prisma.appSettings.create({
        data: {
          id: 'global',
          adminPhone: '221770000000',
          shopifyDomain: '',
          shopifyAccessToken: '',
          ignoredShopifyIds: []
        }
      });
    }
    // Don't expose Shopify token to frontend
    const { shopifyAccessToken, ...safe } = settings;
    res.json(safe);
  } catch (error) {
    console.error('GET /settings error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/settings
router.put('/', async (req, res) => {
  try {
    const settings = await prisma.appSettings.upsert({
      where: { id: 'global' },
      create: { id: 'global', ...req.body },
      update: req.body
    });
    const { shopifyAccessToken, ...safe } = settings;
    res.json(safe);
  } catch (error) {
    console.error('PUT /settings error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/settings/config/:key
router.get('/config/:key', async (req, res) => {
  try {
    const config = await prisma.appConfig.findUnique({ where: { key: req.params.key } });
    res.json(config ? { value: config.value } : { value: null });
  } catch (error) {
    console.error('GET /settings/config/:key error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/settings/config/:key
router.put('/config/:key', async (req, res) => {
  try {
    const { value } = req.body;
    const config = await prisma.appConfig.upsert({
      where: { key: req.params.key },
      create: { key: req.params.key, value: typeof value === 'string' ? value : JSON.stringify(value) },
      update: { value: typeof value === 'string' ? value : JSON.stringify(value) }
    });
    res.json(config);
  } catch (error) {
    console.error('PUT /settings/config/:key error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/settings/claude-analysis/:date
router.get('/claude-analysis/:date', async (req, res) => {
  try {
    const analysis = await prisma.claudeAnalysis.findUnique({
      where: { date: req.params.date }
    });
    res.json(analysis ? { analysis: analysis.analysis } : { analysis: null });
  } catch (error) {
    console.error('GET /settings/claude-analysis error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/settings/claude-analysis
router.post('/claude-analysis', async (req, res) => {
  try {
    const { date, analysis } = req.body;
    await prisma.claudeAnalysis.upsert({
      where: { date },
      create: { date, analysis },
      update: { analysis }
    });
    res.json({ success: true });
  } catch (error) {
    console.error('POST /settings/claude-analysis error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
