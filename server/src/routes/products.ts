import { Router } from 'express';
import { firestoreSyncTimestamp } from '../lib/firestore-sync.js';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/products
router.get('/', async (_req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: { variants: true, images: true },
      orderBy: { title: 'asc' }
    });
    res.json(products);
  } catch (error) {
    console.error('GET /products error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { variants: true, images: true }
    });
    if (!product) { res.status(404).json({ error: 'Produit non trouvé' }); return; }
    res.json(product);
  } catch (error) {
    console.error('GET /products/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/products
router.post('/', async (req, res) => {
  try {
    const { variants, images, ...data } = req.body;
    const product = await prisma.product.upsert({
      where: { id: data.id },
      create: {
        ...data,
        tags: data.tags || [],
        variants: variants ? { createMany: { data: variants } } : undefined,
        images: images ? { createMany: { data: images } } : undefined
      },
      update: data
    });
    res.status(201).json(product);
  } catch (error) {
    console.error('POST /products error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/products/:id
router.put('/:id', async (req, res) => {
  try {
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: { ...req.body, firestoreUpdatedAt: firestoreSyncTimestamp() }
    });
    res.json(product);
  } catch (error) {
    console.error('PUT /products/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Add to ignored list if Shopify product
    const product = await prisma.product.findUnique({ where: { id } });
    if (product && (product.source === 'shopify' || /^\d+$/.test(id))) {
      const settings = await prisma.appSettings.findUnique({ where: { id: 'global' } });
      if (settings) {
        const ignored = settings.ignoredShopifyIds || [];
        if (!ignored.includes(id)) {
          await prisma.appSettings.update({
            where: { id: 'global' },
            data: { ignoredShopifyIds: [...ignored, id] }
          });
        }
      }
    }

    // Delete product (cascades to variants, images, stock entries)
    await prisma.product.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /products/:id error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/products/shopify-sync — Sync from Shopify API
router.post('/shopify-sync', async (_req, res) => {
  try {
    const settings = await prisma.appSettings.findUnique({ where: { id: 'global' } });
    const domain = process.env.SHOPIFY_DOMAIN?.trim() || settings?.shopifyDomain;
    const token =
      process.env.SHOPIFY_ACCESS_TOKEN?.trim() || settings?.shopifyAccessToken;

    if (!domain || !token) {
      res.status(400).json({ error: 'Configuration Shopify manquante (Paramètres ou .env)' });
      return;
    }

    let shopDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!shopDomain.includes('.')) shopDomain = `${shopDomain}.myshopify.com`;

    const url = `https://${shopDomain}/admin/api/2024-01/products.json?limit=250&status=active`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      const isTimeout =
        msg.includes('abort') ||
        msg.includes('ETIMEDOUT') ||
        (fetchErr instanceof Error &&
          'cause' in fetchErr &&
          String((fetchErr as { cause?: unknown }).cause).includes('ETIMEDOUT'));
      console.warn(
        `POST /products/shopify-sync: ${isTimeout ? 'timeout réseau' : 'fetch échoué'} (${shopDomain})`
      );
      res.status(isTimeout ? 503 : 502).json({
        error: isTimeout
          ? 'Impossible de joindre Shopify (timeout réseau). Vérifiez internet / VPN.'
          : `Erreur réseau Shopify: ${msg}`,
      });
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ error: errorText });
      return;
    }

    const data = await response.json() as any;
    const shopifyProducts = (data.products || []) as any[];

    const ignoredIds = new Set(settings?.ignoredShopifyIds || []);

    const activeProducts = shopifyProducts
      .filter((sp: any) => sp.status === 'active' && !ignoredIds.has(sp.id.toString()));

    let synced = 0;
    for (const sp of activeProducts) {
      const productId = sp.id.toString();

      // Upsert product — preserve sellingPrice, purchasePrice, mainStock
      const existing = await prisma.product.findUnique({ where: { id: productId } });

      await prisma.product.upsert({
        where: { id: productId },
        create: {
          id: productId,
          title: sp.title,
          description: sp.body_html,
          vendor: sp.vendor,
          productType: sp.product_type,
          status: sp.status,
          source: 'shopify',
          tags: sp.tags ? sp.tags.split(',').map((t: string) => t.trim()) : [],
          totalInventory: sp.variants.reduce((acc: number, v: any) => acc + (v.inventory_quantity || 0), 0),
          firestoreCreatedAt: sp.created_at,
          firestoreUpdatedAt: sp.updated_at
        },
        update: {
          title: sp.title,
          description: sp.body_html,
          vendor: sp.vendor,
          productType: sp.product_type,
          status: sp.status,
          tags: sp.tags ? sp.tags.split(',').map((t: string) => t.trim()) : [],
          totalInventory: sp.variants.reduce((acc: number, v: any) => acc + (v.inventory_quantity || 0), 0),
          firestoreUpdatedAt: sp.updated_at,
          // Preserve custom prices
          ...(existing ? {
            sellingPrice: existing.sellingPrice,
            purchasePrice: existing.purchasePrice,
            mainStock: existing.mainStock
          } : {})
        }
      });

      // Sync variants
      await prisma.productVariant.deleteMany({ where: { productId } });
      for (const v of sp.variants) {
        await prisma.productVariant.create({
          data: {
            id: v.id.toString(),
            productId,
            title: v.title,
            sku: v.sku,
            price: parseFloat(v.price),
            inventoryQuantity: v.inventory_quantity || 0,
            weight: v.weight,
            weightUnit: v.weight_unit
          }
        });
      }

      // Sync images
      await prisma.productImage.deleteMany({ where: { productId } });
      for (const img of sp.images) {
        await prisma.productImage.create({
          data: {
            id: img.id.toString(),
            productId,
            src: img.src,
            alt: img.alt
          }
        });
      }

      synced++;
    }

    // Delete non-active products from DB (not ponctuel)
    const activeIds = activeProducts.map((sp: any) => sp.id.toString());
    await prisma.product.deleteMany({
      where: {
        source: { not: 'ponctuel' },
        id: { notIn: activeIds }
      }
    });

    res.json({ synced, total: shopifyProducts.length });
  } catch (error) {
    console.error('POST /products/shopify-sync error:', error);
    res.status(500).json({ error: 'Erreur de synchronisation Shopify' });
  }
});

// POST /api/products/ponctuel — Add ad-hoc product
router.post('/ponctuel', async (req, res) => {
  try {
    const { nom, prixAchat, prixVente } = req.body;

    // Check if already exists
    const existing = await prisma.product.findFirst({
      where: { source: 'ponctuel', title: nom.trim() }
    });
    if (existing) {
      res.json(existing);
      return;
    }

    const product = await prisma.product.create({
      data: {
        id: crypto.randomUUID(),
        title: nom.trim(),
        status: 'active',
        source: 'ponctuel',
        purchasePrice: prixAchat || 0,
        sellingPrice: prixVente || 0,
        tags: [],
        stockGlobal: { si: 0, entrees: 0, sorties: 0, sf: 0 }
      }
    });

    res.status(201).json(product);
  } catch (error) {
    console.error('POST /products/ponctuel error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
