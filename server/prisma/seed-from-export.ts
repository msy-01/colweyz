/**
 * seed-from-export.ts
 *
 * Importe le backup Firestore JSON dans PostgreSQL.
 * Usage: npx tsx prisma/seed-from-export.ts [path-to-export.json] [--align]
 *   --align : supprime en PG tout ce qui n'est pas dans le dump (référence = Firestore export)
 * Default: colweyz_firebase_dump_2026-05-23.json à la racine du projet
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcrypt';
import { paymentMethodFromFirestore } from '../src/lib/payment-method.js';

const prisma = new PrismaClient({ log: ['warn', 'error'] });

const argv = process.argv.slice(2).filter((a) => a !== '--align');
const ALIGN_MODE = process.argv.includes('--align');
const KEEP_DRIVER_IDS = ['depot_delta'];

const EXPORT_PATH =
  argv[0] ||
  path.join(process.cwd(), '..', 'colweyz_firebase_dump_2026-05-23.json');

interface BackupData {
  drivers?: any[];
  zones?: any[];
  orders?: any[];
  users?: any[];
  fund_requests?: any[];
  products?: any[];
  adhoc_products?: any[];
  financial_configs?: any[];
  daily_entries?: any[];
  daily_finance?: any[];
  purchase_orders?: any[];
  accounting_entries?: any[];
  stockLivreurs?: any[];
  stock_livreurs?: any[]; // alias (anciens exports)
  stock_operations?: any[];
  settings?: any[] | any;
  config?: any[] | Record<string, any>;
  claude_analysis?: any[];
  user_preferences?: any[];
  logs_ajustements?: any[];
  campagnes?: any[];
  exportedAt?: string;
}

/** dateEffet unique pour configs plates (historique par updatedAt + id doc). */
function resolveFinancialDateEffet(fc: {
  id?: string;
  dateEffet?: string;
  date_effet?: string;
  updatedAt?: string;
}): string {
  if (fc.dateEffet || fc.date_effet) return fc.dateEffet || fc.date_effet!;
  const day = typeof fc.updatedAt === 'string' ? fc.updatedAt.slice(0, 10) : null;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) return `${day}#${fc.id || 'x'}`;
  return `import-${fc.id || 'x'}`;
}

function prepareBackupData(data: BackupData): BackupData {
  if (!data.stockLivreurs?.length && data.stock_livreurs?.length) {
    data.stockLivreurs = data.stock_livreurs;
    console.log(`ℹ️  Alias stock_livreurs → stockLivreurs (${data.stockLivreurs.length} entrées)`);
  }

  data.products = data.products || [];

  if (data.adhoc_products?.length) {
    let added = 0;
    for (const a of data.adhoc_products) {
      if (!data.products!.some((p) => p.id === a.id)) {
        data.products!.push({
          id: a.id,
          title: a.name || 'Produit ponctuel',
          source: 'ponctuel',
          purchasePrice: a.purchasePrice,
          sellingPrice: a.purchasePrice,
          status: 'active',
        });
        added++;
      }
    }
    if (added) console.log(`ℹ️  adhoc_products → products (+${added})`);
  }

  const productIds = new Set(data.products.map((p) => p.id));
  let stubs = 0;
  for (const op of data.stock_operations || []) {
    if (op.productId && !productIds.has(op.productId)) {
      productIds.add(op.productId);
      data.products.push({
        id: op.productId,
        title: op.productName || 'Produit (stock)',
        source: 'ponctuel',
        status: 'active',
      });
      stubs++;
    }
  }
  if (stubs) console.log(`ℹ️  Produits stub pour stock_operations (+${stubs})`);

  return data;
}

async function reconcileToDump(data: BackupData): Promise<void> {
  console.log('\n🧹 Réconciliation PG ← dump (suppression des extras)...\n');

  const orderIds = (data.orders || []).map((o) => o.id);
  const driverIds = [...(data.drivers || []).map((d) => d.id), ...KEEP_DRIVER_IDS];
  const zoneIds = (data.zones || []).map((z) => z.id);
  const userIds = (data.users || []).map((u) => u.id);
  const productIds = (data.products || []).map((p) => p.id);
  const fundIds = (data.fund_requests || []).map((f) => f.id);
  const stockLivIds = (data.stockLivreurs || []).map(
    (sl) => sl.id || `${sl.livreurId}_${sl.produitId}`
  );
  const stockOpIds = (data.stock_operations || []).map((o) => o.id);
  const poIds = (data.purchase_orders || []).map((p) => p.id);
  const dailyDates = (data.daily_entries || []).map((d) => d.date);
  const dailyFinanceDates = (data.daily_finance || []).map((d) => d.date);
  const accountingIds = (data.accounting_entries || []).map((a) => a.id);
  const claudeDates = (data.claude_analysis || []).map((c) => c.date);

  const configArr = data.config
    ? Array.isArray(data.config)
      ? data.config
      : Object.entries(data.config).map(([key, value]) => ({ key, value }))
    : [];
  const allowedConfigKeys = new Set<string>([
    ...configArr.map((c: { key?: string; id?: string }) => c.key || c.id || '').filter(Boolean),
    ...(data.user_preferences || [])
      .map((p: { id?: string; key?: string }) => p.id || p.key || '')
      .filter(Boolean),
  ]);

  const notIn = <T>(ids: T[]) => (ids.length > 0 ? { notIn: ids } : undefined);

  const r = await prisma.$transaction([
    prisma.stockOperation.deleteMany({ where: { id: notIn(stockOpIds) } }),
    prisma.stockLivreur.deleteMany({ where: { id: notIn(stockLivIds) } }),
    prisma.fundRequest.deleteMany({ where: { id: notIn(fundIds) } }),
    prisma.order.deleteMany({ where: { id: notIn(orderIds) } }),
    prisma.purchaseOrder.deleteMany({ where: { id: notIn(poIds) } }),
    ...(dailyDates.length
      ? [prisma.dailyEntry.deleteMany({ where: { date: notIn(dailyDates) } })]
      : []),
    ...(dailyFinanceDates.length
      ? [prisma.dailyFinance.deleteMany({ where: { date: notIn(dailyFinanceDates) } })]
      : []),
    ...(accountingIds.length
      ? [prisma.accountingEntry.deleteMany({ where: { id: notIn(accountingIds) } })]
      : []),
    ...(claudeDates.length
      ? [prisma.claudeAnalysis.deleteMany({ where: { date: notIn(claudeDates) } })]
      : []),
    prisma.driver.deleteMany({ where: { id: notIn(driverIds) } }),
    prisma.zone.deleteMany({ where: { id: notIn(zoneIds) } }),
    prisma.systemUser.deleteMany({ where: { id: notIn(userIds) } }),
    prisma.product.deleteMany({ where: { id: notIn(productIds) } }),
    ...(allowedConfigKeys.size
      ? [
          prisma.appConfig.deleteMany({
            where: { key: notIn([...allowedConfigKeys]) },
          }),
        ]
      : []),
    prisma.syncState.deleteMany({ where: { collectionName: { startsWith: 'reverse_' } } }),
    prisma.syncLog.deleteMany(),
  ]);

  const deleted = r.reduce((sum, x) => sum + x.count, 0);
  console.log(`   Total documents supprimés: ${deleted}`);
  console.log('');
}

async function seed() {
  console.log(`\n📂 Loading backup from: ${EXPORT_PATH}`);
  if (ALIGN_MODE) console.log('   Mode: --align (PG = copie exacte du dump)\n');
  else console.log('');

  if (!fs.existsSync(EXPORT_PATH)) {
    console.error(`❌ File not found: ${EXPORT_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(EXPORT_PATH, 'utf8');
  let data: BackupData = JSON.parse(raw);
  data = prepareBackupData(data);

  if (data.exportedAt) {
    console.log(`📅 Exporté le: ${data.exportedAt}`);
  }

  const counts: Record<string, number> = {};
  const skipped: string[] = [];

  // ═══════════════════════════════════════════
  // 1. ZONES
  // ═══════════════════════════════════════════
  if (data.zones?.length) {
    console.log(`🗺️  Importing ${data.zones.length} zones...`);
    for (const z of data.zones) {
      await prisma.zone.upsert({
        where: { id: z.id },
        create: {
          id: z.id,
          name: z.name,
          rate: z.rate || 0,
          type: z.type || 'local'
        },
        update: {
          name: z.name,
          rate: z.rate || 0,
          type: z.type || 'local'
        }
      });
    }
    counts.zones = data.zones.length;
  }

  // ═══════════════════════════════════════════
  // 2. DRIVERS (password → bcrypt hash)
  // ═══════════════════════════════════════════
  if (data.drivers?.length) {
    console.log(`🚗 Importing ${data.drivers.length} drivers...`);
    for (const d of data.drivers) {
      const passwordHash = d.password ? await bcrypt.hash(d.password, 10) : null;
      await prisma.driver.upsert({
        where: { id: d.id },
        create: {
          id: d.id,
          name: d.name || 'Inconnu',
          phone: d.phone || '',
          username: d.username || null,
          passwordHash,
          initialBalance: d.initialBalance || 0,
          status: d.status || 'disponible',
          color: d.color || null,
          uid: d.uid || null
        },
        update: {
          name: d.name || 'Inconnu',
          phone: d.phone || '',
          username: d.username || null,
          passwordHash,
          initialBalance: d.initialBalance || 0,
          status: d.status || 'disponible',
          color: d.color || null,
          uid: d.uid || null
        }
      });
    }
    counts.drivers = data.drivers.length;
  }

  // ═══════════════════════════════════════════
  // 3. SYSTEM USERS (password → bcrypt hash)
  // ═══════════════════════════════════════════
  if (data.users?.length) {
    console.log(`👤 Importing ${data.users.length} users...`);
    for (const u of data.users) {
      const passwordHash = u.password ? await bcrypt.hash(u.password, 10) : '';
      await prisma.systemUser.upsert({
        where: { id: u.id },
        create: {
          id: u.id,
          username: u.username,
          passwordHash,
          role: u.role || 'staff',
          permissions: u.permissions || []
        },
        update: {
          username: u.username,
          passwordHash,
          role: u.role || 'staff',
          permissions: u.permissions || []
        }
      });
    }
    counts.users = data.users.length;
  }

  // ═══════════════════════════════════════════
  // 4. PRODUCTS (+ variants + images)
  // ═══════════════════════════════════════════
  if (data.products?.length) {
    console.log(`📦 Importing ${data.products.length} products...`);
    for (const p of data.products) {
      await prisma.product.upsert({
        where: { id: p.id },
        create: {
          id: p.id,
          title: p.title || 'Sans titre',
          description: p.description || null,
          vendor: p.vendor || null,
          productType: p.productType || p.product_type || null,
          status: p.status || 'active',
          source: p.source || (p.variants?.length ? 'shopify' : 'ponctuel'),
          sellingPrice: p.sellingPrice || null,
          purchasePrice: p.purchasePrice || null,
          mainStock: p.mainStock || 0,
          totalInventory: p.totalInventory || null,
          stockGlobal: p.stockGlobal || null,
          stockLivreurs: p.stockLivreurs || null,
          tags: p.tags || [],
          firestoreCreatedAt: p.createdAt || null,
          firestoreUpdatedAt: p.updatedAt || null
        },
        update: {
          title: p.title || 'Sans titre',
          sellingPrice: p.sellingPrice || null,
          purchasePrice: p.purchasePrice || null,
          mainStock: p.mainStock || 0,
          stockGlobal: p.stockGlobal || null,
          stockLivreurs: p.stockLivreurs || null,
          tags: p.tags || []
        }
      });

      // Variants
      if (p.variants?.length) {
        for (const v of p.variants) {
          const variantId = v.id?.toString() || `${p.id}-${v.title}`;
          await prisma.productVariant.upsert({
            where: { id: variantId },
            create: {
              id: variantId,
              productId: p.id,
              title: v.title || 'Default',
              sku: v.sku || null,
              price: parseFloat(v.price) || 0,
              inventoryQuantity: v.inventoryQuantity || v.inventory_quantity || 0,
              weight: v.weight || null,
              weightUnit: v.weightUnit || v.weight_unit || null
            },
            update: {
              title: v.title || 'Default',
              sku: v.sku || null,
              price: parseFloat(v.price) || 0,
              inventoryQuantity: v.inventoryQuantity || v.inventory_quantity || 0
            }
          });
        }
      }

      // Images
      if (p.images?.length) {
        for (const img of p.images) {
          const imgId = img.id?.toString() || `${p.id}-img-${Math.random().toString(36).substr(2, 6)}`;
          await prisma.productImage.upsert({
            where: { id: imgId },
            create: {
              id: imgId,
              productId: p.id,
              src: img.src,
              alt: img.alt || null
            },
            update: {
              src: img.src,
              alt: img.alt || null
            }
          });
        }
      }
    }
    counts.products = data.products.length;
  }

  // ═══════════════════════════════════════════
  // 5. ORDERS
  // ═══════════════════════════════════════════
  if (data.orders?.length) {
    console.log(`📋 Importing ${data.orders.length} orders...`);
    let orderCount = 0;
    const validZoneIds = new Set((await prisma.zone.findMany({ select: { id: true } })).map(z => z.id));
    const validDriverIds = new Set((await prisma.driver.findMany({ select: { id: true } })).map(d => d.id));

    for (const o of data.orders) {
      const zoneId = o.zoneId && validZoneIds.has(o.zoneId) ? o.zoneId : null;
      const driverId = o.driverId && validDriverIds.has(o.driverId) ? o.driverId : null;

      await prisma.order.upsert({
        where: { id: o.id },
        create: {
          id: o.id,
          date: o.date || '',
          clientName: o.clientName || 'Inconnu',
          clientPhone: o.clientPhone || null,
          address: o.address || 'Non précisée',
          productDetails: o.productDetails || null,
          productId: o.productId || null,
          amount: o.amount ?? 0,
          deliveryCost: o.deliveryCost ?? null,
          status: o.status || 'validé',
          remuneration: o.remuneration ?? null,
          paymentMethod: paymentMethodFromFirestore(o),
          cancelReason: o.cancelReason || null,
          shippingFee: o.shippingFee ?? null,
          isPrePaid: o.isPrePaid ?? null,
          regionalPaymentStatus: o.regionalPaymentStatus || null,
          assignedAt: o.assignedAt || null,
          deliveredAt: o.deliveredAt || null,
          postponedAt: o.postponedAt || null,
          scheduledAt: o.scheduledAt || null,
          importedAt: o.importedAt || null,
          refusedBy: o.refusedBy || null,
          purchaseCost: o.purchaseCost ?? null,
          remarks: o.remarks || null,
          shippingRemarks: o.shippingRemarks || null,
          assignmentRemarks: o.assignmentRemarks || null,
          isDepotDelivery: o.isDepotDelivery ?? null,
          sortieDepotLogged: o.sortieDepotLogged ?? null,
          livraisonDepotConfirmee: o.livraisonDepotConfirmee ?? null,
          linkedOrderIds: o.linkedOrderIds || [],
          zoneId,
          driverId,
          products: o.products || [],
          logs: o.logs || []
        },
        update: {
          date: o.date || '',
          clientName: o.clientName || 'Inconnu',
          clientPhone: o.clientPhone || null,
          address: o.address || 'Non précisée',
          productDetails: o.productDetails || null,
          productId: o.productId || null,
          amount: o.amount ?? 0,
          deliveryCost: o.deliveryCost ?? null,
          status: o.status || 'validé',
          remuneration: o.remuneration ?? null,
          paymentMethod: paymentMethodFromFirestore(o),
          cancelReason: o.cancelReason || null,
          shippingFee: o.shippingFee ?? null,
          isPrePaid: o.isPrePaid ?? null,
          regionalPaymentStatus: o.regionalPaymentStatus || null,
          assignedAt: o.assignedAt || null,
          deliveredAt: o.deliveredAt || null,
          postponedAt: o.postponedAt || null,
          scheduledAt: o.scheduledAt || null,
          importedAt: o.importedAt || null,
          refusedBy: o.refusedBy || null,
          purchaseCost: o.purchaseCost ?? null,
          remarks: o.remarks || null,
          shippingRemarks: o.shippingRemarks || null,
          assignmentRemarks: o.assignmentRemarks || null,
          isDepotDelivery: o.isDepotDelivery ?? null,
          sortieDepotLogged: o.sortieDepotLogged ?? null,
          livraisonDepotConfirmee: o.livraisonDepotConfirmee ?? null,
          linkedOrderIds: o.linkedOrderIds || [],
          zoneId,
          driverId,
          products: o.products || [],
          logs: o.logs || [],
        },
      });
      orderCount++;
      if (orderCount % 200 === 0) console.log(`   ... ${orderCount}/${data.orders.length} orders`);
    }
    counts.orders = data.orders.length;
  }

  // ═══════════════════════════════════════════
  // 6. FUND REQUESTS
  // ═══════════════════════════════════════════
  if (data.fund_requests?.length) {
    console.log(`💰 Importing ${data.fund_requests.length} fund requests...`);
    const validDriverIds = new Set((await prisma.driver.findMany({ select: { id: true } })).map(d => d.id));

    for (const fr of data.fund_requests) {
      if (!validDriverIds.has(fr.driverId)) continue;
      await prisma.fundRequest.upsert({
        where: { id: fr.id },
        create: {
          id: fr.id,
          driverId: fr.driverId,
          amount: fr.amount || 0,
          type: fr.type || null,
          status: fr.status || 'pending',
          paymentMethod: fr.paymentMethod || null,
          createdAt: fr.createdAt || new Date().toISOString(),
          confirmedAt: fr.confirmedAt || null
        },
        update: {
          status: fr.status || 'pending'
        }
      });
    }
    counts.fund_requests = data.fund_requests.length;
  }

  // ═══════════════════════════════════════════
  // 7. STOCK LIVREURS
  // ═══════════════════════════════════════════
  if (data.stockLivreurs?.length) {
    console.log(`📊 Importing ${data.stockLivreurs.length} stock livreur entries...`);
    const validDriverIds = new Set((await prisma.driver.findMany({ select: { id: true } })).map(d => d.id));
    const validProductIds = new Set((await prisma.product.findMany({ select: { id: true } })).map(p => p.id));

    for (const sl of data.stockLivreurs) {
      const livreurId = sl.livreurId;
      const produitId = sl.produitId;
      
      if (!validDriverIds.has(livreurId) || !validProductIds.has(produitId)) continue;
      
      const id = sl.id || `${livreurId}_${produitId}`;

      await prisma.stockLivreur.upsert({
        where: { livreurId_produitId: { livreurId, produitId } },
        create: {
          id,
          livreurId,
          produitId,
          produitNom: sl.produitNom || 'Inconnu',
          si: sl.SI || 0,
          entrees: sl.entrees || 0,
          sorties: sl.sorties || 0,
          sf: sl.SF || 0,
          ajustementManuel: sl.ajustementManuel || 0,
          motifDernierAjustement: sl.motifDernierAjustement || null,
          dateDernierAjustement: sl.dateDernierAjustement || null,
          ajustePar: sl.ajustePar || null
        },
        update: {
          si: sl.SI || 0,
          entrees: sl.entrees || 0,
          sorties: sl.sorties || 0,
          sf: sl.SF || 0,
          ajustementManuel: sl.ajustementManuel || 0
        }
      });
    }
    counts.stockLivreurs = data.stockLivreurs.length;
  }

  // ═══════════════════════════════════════════
  // 8. STOCK OPERATIONS
  // ═══════════════════════════════════════════
  if (data.stock_operations?.length) {
    console.log(`🔄 Importing ${data.stock_operations.length} stock operations...`);
    const validProductIds = new Set((await prisma.product.findMany({ select: { id: true } })).map(p => p.id));
    let opCount = 0;
    let skipped = 0;

    for (const op of data.stock_operations) {
      if (!validProductIds.has(op.productId)) { skipped++; continue; }

      await prisma.stockOperation.upsert({
        where: { id: op.id },
        create: {
          id: op.id,
          date: op.date || new Date().toISOString(),
          productId: op.productId,
          productName: op.productName || 'Inconnu',
          quantity: op.quantity || 0,
          type: op.type || 'entree',
          source: op.source || null,
          livreurId: op.livreurId || null,
          entiteType: op.entiteType || null,
          entiteId: op.entiteId || null,
          commandeId: op.commandeId || null,
          referenceId: op.referenceId || null,
          notes: op.notes || null,
          annule: op.annule || false,
          annuleLe: op.annuleLe || null,
          annuleMotif: op.annuleMotif || null,
          firestoreCreatedAt: op.createdAt || null
        },
        update: {
          annule: op.annule || false
        }
      });
      opCount++;
      if (opCount % 500 === 0) console.log(`   ... ${opCount}/${data.stock_operations.length} operations`);
    }
    counts.stock_operations = opCount;
    if (skipped > 0) console.log(`   ⚠️  ${skipped} operations skipped (missing product)`);
  }

  // ═══════════════════════════════════════════
  // 9. FINANCIAL CONFIGS
  // ═══════════════════════════════════════════
  if (data.financial_configs?.length) {
    if (ALIGN_MODE) {
      const removed = await prisma.financialConfig.deleteMany();
      console.log(`💹 Reset financial_configs (${removed.count} lignes PG supprimées)`);
    }
    console.log(`💹 Importing ${data.financial_configs.length} financial configs...`);
    let fcImported = 0;
    for (const fc of data.financial_configs) {
      const dateEffet = resolveFinancialDateEffet(fc);
      const productId = fc.productId || fc.product_id;
      if (!productId) continue;

      const exists = await prisma.product.findUnique({ where: { id: productId } });
      if (!exists) continue;

      await prisma.financialConfig.upsert({
        where: { productId_dateEffet: { productId, dateEffet } },
        create: {
          productId,
          cau: fc.cau || fc.caUnitaire || 0,
          appro: fc.appro || fc.coutAppro || 0,
          dailyBudgetUsd: fc.dailyBudgetUsd || fc.budgetJournalier || 0,
          isCampaignActive: fc.isCampaignActive ?? true,
          dateEffet,
          firestoreUpdatedAt: fc.updatedAt || null,
        },
        update: {
          cau: fc.cau || fc.caUnitaire || 0,
          appro: fc.appro || fc.coutAppro || 0,
          dailyBudgetUsd: fc.dailyBudgetUsd || fc.budgetJournalier || 0,
          isCampaignActive: fc.isCampaignActive ?? true,
          firestoreUpdatedAt: fc.updatedAt || null,
        },
      });
      fcImported++;
    }
    counts.financial_configs = fcImported;
  }

  // ═══════════════════════════════════════════
  // 10. DAILY ENTRIES
  // ═══════════════════════════════════════════
  if (data.daily_entries?.length) {
    console.log(`📅 Importing ${data.daily_entries.length} daily entries...`);
    for (const de of data.daily_entries) {
      await prisma.dailyEntry.upsert({
        where: { date: de.date },
        create: {
          date: de.date,
          exchangeRate: de.exchangeRate || 600,
          entries: de.entries || {},
          productOrder: de.productOrder || []
        },
        update: {
          exchangeRate: de.exchangeRate || 600,
          entries: de.entries || {},
          productOrder: de.productOrder || []
        }
      });
    }
    counts.daily_entries = data.daily_entries.length;
  }

  // ═══════════════════════════════════════════
  // 11. DAILY FINANCE
  // ═══════════════════════════════════════════
  if (data.daily_finance?.length) {
    console.log(`📊 Importing ${data.daily_finance.length} daily finance entries...`);
    for (const df of data.daily_finance) {
      await prisma.dailyFinance.upsert({
        where: { date: df.date },
        create: {
          date: df.date,
          otherRevenues: df.otherRevenues || [],
          otherExpenses: df.otherExpenses || []
        },
        update: {
          otherRevenues: df.otherRevenues || [],
          otherExpenses: df.otherExpenses || []
        }
      });
    }
    counts.daily_finance = data.daily_finance.length;
  }

  // ═══════════════════════════════════════════
  // 12. PURCHASE ORDERS (+ items + documents)
  // ═══════════════════════════════════════════
  if (data.purchase_orders?.length) {
    console.log(`🛒 Importing ${data.purchase_orders.length} purchase orders...`);
    for (const po of data.purchase_orders) {
      await prisma.purchaseOrder.upsert({
        where: { id: po.id },
        create: {
          id: po.id,
          number: po.number || '',
          date: po.date || '',
          totalAmount: po.totalAmount || 0,
          transportFees: po.transportFees ?? null,
          status: po.status || 'draft',
          source: po.source || null,
          supplierName: po.supplierName || null,
          firestoreCreatedAt: po.createdAt || null,
          validatedAt: po.validatedAt || null,
          paidAt: po.paidAt || null,
          deliveredAt: po.deliveredAt || null,
          linkedOrderIds: po.linkedOrderIds || [],
          ponctuelStockUpdated: po.ponctuelStockUpdated || false,
          fournisseur: po.fournisseur || null
        },
        update: {
          number: po.number || '',
          date: po.date || '',
          totalAmount: po.totalAmount || 0,
          transportFees: po.transportFees ?? null,
          status: po.status || 'draft',
          source: po.source || null,
          supplierName: po.supplierName || null,
          firestoreCreatedAt: po.createdAt || null,
          validatedAt: po.validatedAt || null,
          paidAt: po.paidAt || null,
          deliveredAt: po.deliveredAt || null,
          linkedOrderIds: po.linkedOrderIds || [],
          ponctuelStockUpdated: po.ponctuelStockUpdated || false,
          fournisseur: po.fournisseur || null,
        }
      });

      // Items
      if (po.items?.length) {
        // Delete existing items first (idempotent)
        await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
        for (const item of po.items) {
          await prisma.purchaseOrderItem.create({
            data: {
              purchaseOrderId: po.id,
              productId: item.productId || '',
              productName: item.productName || '',
              quantity: item.quantity || 0,
              unitPrice: item.unitPrice || 0,
              total: item.total || 0,
              source: item.source || 'stock'
            }
          });
        }
      }

      // Documents
      if (po.documents?.length) {
        await prisma.purchaseOrderDocument.deleteMany({ where: { purchaseOrderId: po.id } });
        for (const doc of po.documents) {
          await prisma.purchaseOrderDocument.create({
            data: {
              purchaseOrderId: po.id,
              name: doc.name || '',
              type: doc.type || '',
              data: doc.data || '',
              label: doc.label || '',
              date: doc.date || ''
            }
          });
        }
      }
    }
    counts.purchase_orders = data.purchase_orders.length;
  }

  // ═══════════════════════════════════════════
  // 13. ACCOUNTING ENTRIES (+ lines)
  // ═══════════════════════════════════════════
  if (data.accounting_entries?.length) {
    console.log(`📗 Importing ${data.accounting_entries.length} accounting entries...`);
    for (const ae of data.accounting_entries) {
      await prisma.accountingEntry.upsert({
        where: { id: ae.id },
        create: {
          id: ae.id,
          date: ae.date || '',
          pieceNumber: ae.pieceNumber || '',
          label: ae.label || '',
          isManual: ae.isManual ?? true,
          origine: ae.origine || (ae.isManual ? 'manuel' : 'finance'),
          modifiable: ae.modifiable ?? ae.isManual ?? true,
          attachmentUrl: ae.attachmentUrl || null,
          firestoreCreatedAt: ae.createdAt || null
        },
        update: {}
      });

      if (ae.lines?.length) {
        await prisma.accountingEntryLine.deleteMany({ where: { accountingEntryId: ae.id } });
        for (const line of ae.lines) {
          await prisma.accountingEntryLine.create({
            data: {
              accountingEntryId: ae.id,
              accountId: line.accountId || '',
              label: line.label || '',
              debit: line.debit || 0,
              credit: line.credit || 0
            }
          });
        }
      }
    }
    counts.accounting_entries = data.accounting_entries.length;
  }

  // ═══════════════════════════════════════════
  // 14. SETTINGS
  // ═══════════════════════════════════════════
  const settings = Array.isArray(data.settings) ? data.settings[0] : data.settings;
  if (settings) {
    console.log(`⚙️  Importing settings...`);
    await prisma.appSettings.upsert({
      where: { id: 'global' },
      create: {
        id: 'global',
        adminPhone: settings.adminPhone || '',
        logoUrl: settings.logoUrl || null,
        shopifyDomain: settings.shopifyDomain || null,
        shopifyAccessToken: settings.shopifyAccessToken || null,
        ignoredShopifyIds: settings.ignoredShopifyIds || []
      },
      update: {
        adminPhone: settings.adminPhone || '',
        logoUrl: settings.logoUrl || null,
        shopifyDomain: settings.shopifyDomain || null,
        ignoredShopifyIds: settings.ignoredShopifyIds || []
      }
    });
    counts.settings = 1;
  }

  // ═══════════════════════════════════════════
  // 15. CONFIG (key-value pairs)
  // ═══════════════════════════════════════════
  if (data.config) {
    console.log(`🔧 Importing config...`);
    const configs = Array.isArray(data.config) ? data.config : Object.entries(data.config).map(([k, v]) => ({ key: k, ...(typeof v === 'object' ? v as any : { value: v }) }));
    for (const c of configs) {
      const key = c.key || c.id;
      const value = c.value ?? '';
      await prisma.appConfig.upsert({
        where: { key },
        create: { key, value: typeof value === 'string' ? value : JSON.stringify(value) },
        update: { value: typeof value === 'string' ? value : JSON.stringify(value) }
      });
    }
    counts.config = configs.length;
  }

  // ═══════════════════════════════════════════
  // 15b. USER PREFERENCES → app_config (filtres UI, dates, etc.)
  // ═══════════════════════════════════════════
  if (data.user_preferences?.length) {
    console.log(`🎛️  Importing ${data.user_preferences.length} user preferences → app_config...`);
    let prefCount = 0;
    for (const pref of data.user_preferences) {
      const key = pref.id || pref.key;
      if (!key) continue;
      const value = pref.value !== undefined
        ? (typeof pref.value === 'string' ? pref.value : JSON.stringify(pref.value))
        : '';
      await prisma.appConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      prefCount++;
    }
    counts.user_preferences = prefCount;
  }

  // Collections présentes dans l'export mais sans table PostgreSQL dédiée
  if (data.logs_ajustements?.length) {
    skipped.push(`logs_ajustements (${data.logs_ajustements.length} docs — historique ajustements, non importé)`);
  }
  if (data.campagnes?.length) {
    skipped.push(`campagnes (${data.campagnes.length} docs — utiliser financial_configs)`);
  }

  // ═══════════════════════════════════════════
  // 16. SYNC STATE (initial)
  // ═══════════════════════════════════════════
  console.log(`\n📊 Updating sync_state...`);
  for (const [collection, count] of Object.entries(counts)) {
    await prisma.syncState.upsert({
      where: { collectionName: collection },
      create: {
        collectionName: collection,
        lastSyncedAt: new Date(),
        documentsCount: count
      },
      update: {
        lastSyncedAt: new Date(),
        documentsCount: count
      }
    });
  }

  // ═══════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log('  ✅  SEED COMPLETE');
  console.log('════════════════════════════════════════');
  for (const [collection, count] of Object.entries(counts)) {
    console.log(`  ${collection.padEnd(25)} ${count}`);
  }
  if (skipped.length) {
    console.log('\n  ⚠️  Non importé (pas de table PG) :');
    for (const s of skipped) console.log(`     - ${s}`);
  }
  console.log('════════════════════════════════════════\n');

  if (ALIGN_MODE) {
    await reconcileToDump(data);
    await ensureDepotDriver();
    console.log('✅ Alignement terminé — PostgreSQL = dump Firestore\n');
  }
}

async function ensureDepotDriver(): Promise<void> {
  const { ensureStockDriver } = await import('../src/lib/stock-drivers.js');
  await ensureStockDriver(prisma, 'depot_delta');
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
