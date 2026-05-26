import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { prisma } from './lib/prisma.js';

// Route imports
import authRoutes from './routes/auth.js';
import driversRoutes from './routes/drivers.js';
import zonesRoutes from './routes/zones.js';
import ordersRoutes from './routes/orders.js';
import usersRoutes from './routes/users.js';
import productsRoutes from './routes/products.js';
import stockRoutes from './routes/stock.js';
import financeRoutes from './routes/finance.js';
import purchaseOrdersRoutes from './routes/purchaseOrders.js';
import accountingRoutes from './routes/accounting.js';
import settingsRoutes from './routes/settings.js';
import fundRequestsRoutes from './routes/fundRequests.js';
import claudeRoutes from './routes/claude.js';
import statsRoutes from './routes/stats.js';
import { ensureStockDriver } from './lib/stock-drivers.js';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/drivers', driversRoutes);
app.use('/api/zones', zonesRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/fund-requests', fundRequestsRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/stats', statsRoutes);

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Start
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[ColWeyz API] Serveur démarré sur http://localhost:${PORT}`);
  console.log(`[ColWeyz API] Health check: http://localhost:${PORT}/api/health`);
  try {
    await ensureStockDriver(prisma, 'depot_delta');
  } catch (e) {
    console.warn('[ColWeyz API] Impossible de créer le pseudo-livreur depot_delta:', e);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[ColWeyz API] SIGTERM reçu, arrêt gracieux...');
  await prisma.$disconnect();
  process.exit(0);
});
