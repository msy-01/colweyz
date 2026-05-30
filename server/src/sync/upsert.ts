import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { paymentMethodFromFirestore } from '../lib/payment-method.js';
import { isPostgresSyncEcho } from '../lib/firestore-sync.js';
import {
  financialConfigStableId,
  getEffectiveSourceUpdatedAt,
  getSourceUpdatedAt,
  logSyncEvent,
  resolveFinancialConfigMeta,
  shouldSkipStaleUpdate,
} from './helpers.js';

export type SyncContext = {
  collectionName: string;
  docId: string;
  docPath?: string;
  /** updateTime Firestore (metadata), ISO string */
  firestoreUpdateTime?: string | null;
};

export async function processUpsert(
  ctx: SyncContext,
  data: Record<string, unknown> | null,
  operation: 'set' | 'delete',
  options?: { force?: boolean }
): Promise<void> {
  const { collectionName, docId } = ctx;

  if (operation === 'delete' || !data) {
    await handleDelete(ctx);
    return;
  }

  // Éviter boucle reverse→forward, sauf :
  // - orders : l'ancienne app peut laisser _syncSource sur un doc modifié ensuite
  // - --force (resync manuel) : doit toujours réimporter
  const isEcho = isPostgresSyncEcho(data);
  const skipEcho =
    isEcho &&
    !options?.force &&
    collectionName !== 'financial_configs' &&
    collectionName !== 'orders';

  if (skipEcho) {
    return;
  }

  const sourceUpdatedAt = getEffectiveSourceUpdatedAt(
    collectionName,
    data,
    ctx.firestoreUpdateTime
  );
  const fcMeta =
    collectionName === 'financial_configs'
      ? resolveFinancialConfigMeta(docId, data, ctx.docPath)
      : null;
  const staleExtra = fcMeta
    ? { ...fcMeta, docPath: ctx.docPath }
    : undefined;

  if (
    !options?.force &&
    (await shouldSkipStaleUpdate(collectionName, docId, sourceUpdatedAt, staleExtra))
  ) {
    return;
  }

  await logSyncEvent(collectionName, docId, 'upsert', sourceUpdatedAt);

  try {
    switch (collectionName) {
      case 'orders':
        await upsertOrder(docId, data);
        break;
      case 'stockLivreurs':
        await upsertStockLivreur(docId, data);
        break;
      case 'stock_operations':
        await upsertStockOperation(docId, data);
        break;
      case 'drivers':
        await upsertDriver(docId, data);
        break;
      case 'zones':
        await upsertZone(docId, data);
        break;
      case 'products':
        await upsertProduct(docId, data);
        break;
      case 'fund_requests':
        await upsertFundRequest(docId, data);
        break;
      case 'users':
        await upsertUser(docId, data);
        break;
      case 'financial_configs':
        await upsertFinancialConfig(docId, data, ctx.docPath);
        break;
      case 'daily_entries':
        await upsertDailyEntry(docId, data);
        break;
      case 'daily_finance':
        await upsertDailyFinance(docId, data);
        break;
      case 'purchase_orders':
        await upsertPurchaseOrder(docId, data);
        break;
      case 'accounting_entries':
        await upsertAccountingEntry(docId, data);
        break;
      case 'settings':
        await upsertSettings(data);
        break;
      case 'config':
        await upsertConfig(docId, data);
        break;
      case 'claude_analysis':
        await upsertClaudeAnalysis(docId, data);
        break;
      default:
        console.warn(`[sync] Collection non gérée: ${collectionName}`);
    }
  } catch (error) {
    console.error(`[sync] Erreur upsert ${collectionName}/${docId}:`, error);
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function upsertOrder(id: string, data: Record<string, unknown>) {
  const zoneId = (data.zoneId as string) || null;
  const driverId = (data.driverId as string) || null;

  const payload = {
    date: (data.date as string) || '',
    clientName: (data.clientName as string) || 'Inconnu',
    clientPhone: (data.clientPhone as string) || null,
    address: (data.address as string) || 'Non précisée',
    productDetails: (data.productDetails as string) || null,
    productId: (data.productId as string) || null,
    amount: (data.amount as number) || 0,
    deliveryCost: (data.deliveryCost as number) ?? null,
    status: (data.status as string) || 'validé',
    remuneration: (data.remuneration as number) ?? null,
    paymentMethod: paymentMethodFromFirestore(data),
    cancelReason: (data.cancelReason as string) || null,
    shippingFee: (data.shippingFee as number) ?? null,
    isPrePaid: (data.isPrePaid as boolean) ?? null,
    regionalPaymentStatus: (data.regionalPaymentStatus as string) || null,
    assignedAt: (data.assignedAt as string) || null,
    deliveredAt: (data.deliveredAt as string) || null,
    postponedAt: (data.postponedAt as string) || null,
    scheduledAt: (data.scheduledAt as string) || null,
    importedAt: (data.importedAt as string) || null,
    refusedBy: (data.refusedBy as string) || null,
    purchaseCost: (data.purchaseCost as number) ?? null,
    remarks: (data.remarks as string) || null,
    shippingRemarks: (data.shippingRemarks as string) || null,
    assignmentRemarks: (data.assignmentRemarks as string) || null,
    isDepotDelivery: (data.isDepotDelivery as boolean) ?? null,
    sortieDepotLogged: (data.sortieDepotLogged as boolean) ?? null,
    livraisonDepotConfirmee: (data.livraisonDepotConfirmee as boolean) ?? null,
    linkedOrderIds: (data.linkedOrderIds as string[]) || [],
    zoneId,
    driverId,
    products: data.products ?? [],
    logs: data.logs ?? [],
  };

  await prisma.order.upsert({
    where: { id },
    create: { id, ...payload },
    update: payload,
  });
}

async function upsertStockLivreur(id: string, data: Record<string, unknown>) {
  const livreurId = data.livreurId as string;
  const produitId = data.produitId as string;
  if (!livreurId || !produitId) return;

  const [driverOk, productOk] = await Promise.all([
    prisma.driver.findUnique({ where: { id: livreurId } }),
    prisma.product.findUnique({ where: { id: produitId } }),
  ]);
  if (!driverOk || !productOk) return;

  const payload = {
    livreurId,
    produitId,
    produitNom: (data.produitNom as string) || 'Inconnu',
    si: (data.SI as number) ?? (data.si as number) ?? 0,
    entrees: (data.entrees as number) || 0,
    sorties: (data.sorties as number) || 0,
    sf: (data.SF as number) ?? (data.sf as number) ?? 0,
    ajustementManuel: (data.ajustementManuel as number) ?? 0,
    motifDernierAjustement: (data.motifDernierAjustement as string) || null,
    dateDernierAjustement: (data.dateDernierAjustement as string) || null,
    ajustePar: (data.ajustePar as string) || null,
  };

  await prisma.stockLivreur.upsert({
    where: { id },
    create: { id, ...payload },
    update: payload,
  });
}

async function upsertStockOperation(id: string, data: Record<string, unknown>) {
  const productId = data.productId as string;
  if (!productId) return;

  const productExists = await prisma.product.findUnique({ where: { id: productId } });
  if (!productExists) return;

  const payload = {
    date: (data.date as string) || new Date().toISOString(),
    productId,
    productName: (data.productName as string) || 'Inconnu',
    quantity: (data.quantity as number) || 0,
    type: (data.type as string) || 'entree',
    source: (data.source as string) || null,
    livreurId: (data.livreurId as string) || null,
    entiteType: (data.entiteType as string) || null,
    entiteId: (data.entiteId as string) || null,
    commandeId: (data.commandeId as string) || null,
    referenceId: (data.referenceId as string) || null,
    notes: (data.notes as string) || null,
    annule: (data.annule as boolean) || false,
    annuleLe: (data.annuleLe as string) || null,
    annuleMotif: (data.annuleMotif as string) || null,
    firestoreCreatedAt: (data.createdAt as string) || null,
  };

  await prisma.stockOperation.upsert({
    where: { id },
    create: { id, ...payload },
    update: payload,
  });
}

async function upsertDriver(id: string, data: Record<string, unknown>) {
  const payload = {
    name: (data.name as string) || 'Inconnu',
    phone: (data.phone as string) || '',
    username: (data.username as string) || null,
    initialBalance: (data.initialBalance as number) || 0,
    status: (data.status as string) || 'disponible',
    color: (data.color as string) || null,
    uid: (data.uid as string) || null,
  };

  await prisma.driver.upsert({
    where: { id },
    create: { id, ...payload },
    update: payload,
  });
}

async function upsertZone(id: string, data: Record<string, unknown>) {
  const payload = {
    name: (data.name as string) || 'Zone',
    rate: (data.rate as number) || 0,
    type: (data.type as string) || 'local',
  };

  await prisma.zone.upsert({
    where: { id },
    create: { id, ...payload },
    update: payload,
  });
}

async function upsertProduct(id: string, data: Record<string, unknown>) {
  const payload = {
    title: (data.title as string) || 'Sans titre',
    description: (data.description as string) || null,
    vendor: (data.vendor as string) || null,
    productType: (data.productType as string) || (data.product_type as string) || null,
    status: (data.status as string) || 'active',
    source: (data.source as string) || 'shopify',
    sellingPrice: (data.sellingPrice as number) ?? null,
    purchasePrice: (data.purchasePrice as number) ?? null,
    mainStock: (data.mainStock as number) ?? 0,
    totalInventory: (data.totalInventory as number) ?? null,
    stockGlobal: (data.stockGlobal as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    stockLivreurs: (data.stockLivreurs as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    tags: (data.tags as string[]) || [],
    firestoreCreatedAt: (data.createdAt as string) || null,
    firestoreUpdatedAt: getSourceUpdatedAt(data),
  };

  await prisma.product.upsert({
    where: { id },
    create: { id, ...payload },
    update: payload,
  });

  const variants = data.variants as Array<Record<string, unknown>> | undefined;
  if (variants?.length) {
    for (const v of variants) {
      const variantId = (v.id?.toString()) || `${id}-${v.title}`;
      await prisma.productVariant.upsert({
        where: { id: variantId },
        create: {
          id: variantId,
          productId: id,
          title: (v.title as string) || 'Default',
          sku: (v.sku as string) || null,
          price: parseFloat(String(v.price)) || 0,
          inventoryQuantity: (v.inventoryQuantity as number) ?? (v.inventory_quantity as number) ?? 0,
          weight: (v.weight as number) ?? null,
          weightUnit: (v.weightUnit as string) || (v.weight_unit as string) || null,
        },
        update: {
          title: (v.title as string) || 'Default',
          sku: (v.sku as string) || null,
          price: parseFloat(String(v.price)) || 0,
          inventoryQuantity: (v.inventoryQuantity as number) ?? (v.inventory_quantity as number) ?? 0,
        },
      });
    }
  }
}

async function upsertFundRequest(id: string, data: Record<string, unknown>) {
  const driverId = data.driverId as string;
  if (!driverId) return;

  const driverExists = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driverExists) return;

  const payload = {
    driverId,
    amount: (data.amount as number) || 0,
    type: (data.type as string) || null,
    status: (data.status as string) || 'pending',
    paymentMethod: (data.paymentMethod as string) || null,
    createdAt: (data.createdAt as string) || new Date().toISOString(),
    confirmedAt: (data.confirmedAt as string) || null,
  };

  await prisma.fundRequest.upsert({
    where: { id },
    create: { id, ...payload },
    update: payload,
  });
}

async function upsertUser(id: string, data: Record<string, unknown>) {
  await prisma.systemUser.upsert({
    where: { id },
    create: {
      id,
      username: (data.username as string) || id,
      passwordHash: '',
      role: (data.role as string) || 'staff',
      permissions: (data.permissions as string[]) || [],
    },
    update: {
      username: (data.username as string) || id,
      role: (data.role as string) || 'staff',
      permissions: (data.permissions as string[]) || [],
    },
  });
}

async function upsertFinancialConfig(
  docId: string,
  data: Record<string, unknown>,
  docPath?: string
) {
  const meta = resolveFinancialConfigMeta(docId, data, docPath);
  if (!meta) return;

  const { productId, dateEffet } = meta;
  const productExists = await prisma.product.findUnique({ where: { id: productId } });
  if (!productExists) return;

  const id = financialConfigStableId(productId, dateEffet, docPath);
  const payload = {
    cau: (data.cau as number) ?? (data.caUnitaire as number) ?? 0,
    appro: (data.appro as number) ?? (data.coutAppro as number) ?? 0,
    dailyBudgetUsd: (data.dailyBudgetUsd as number) ?? (data.budgetJournalier as number) ?? 0,
    isCampaignActive: (data.isCampaignActive as boolean) ?? true,
    dateEffet,
    firestoreUpdatedAt: getSourceUpdatedAt(data),
  };

  await prisma.financialConfig.upsert({
    where: { id },
    create: { id, productId, ...payload },
    update: payload,
  });
}

async function upsertDailyEntry(docId: string, data: Record<string, unknown>) {
  const date = (data.date as string) || docId;
  await prisma.dailyEntry.upsert({
    where: { date },
    create: {
      date,
      exchangeRate: (data.exchangeRate as number) || 600,
      entries: data.entries ?? {},
      productOrder: (data.productOrder as string[]) || [],
    },
    update: {
      exchangeRate: (data.exchangeRate as number) || 600,
      entries: data.entries ?? {},
      productOrder: (data.productOrder as string[]) || [],
    },
  });
}

async function upsertDailyFinance(docId: string, data: Record<string, unknown>) {
  const date = (data.date as string) || docId;
  await prisma.dailyFinance.upsert({
    where: { date },
    create: {
      date,
      otherRevenues: data.otherRevenues ?? [],
      otherExpenses: data.otherExpenses ?? [],
    },
    update: {
      otherRevenues: data.otherRevenues ?? [],
      otherExpenses: data.otherExpenses ?? [],
    },
  });
}

async function upsertPurchaseOrder(id: string, data: Record<string, unknown>) {
  const payload = {
    number: (data.number as string) || '',
    date: (data.date as string) || '',
    totalAmount: (data.totalAmount as number) || 0,
    transportFees: (data.transportFees as number) ?? null,
    status: (data.status as string) || 'draft',
    source: (data.source as string) || null,
    supplierName: (data.supplierName as string) || null,
    firestoreCreatedAt: (data.createdAt as string) || null,
    validatedAt: (data.validatedAt as string) || null,
    paidAt: (data.paidAt as string) || null,
    deliveredAt: (data.deliveredAt as string) || null,
    linkedOrderIds: (data.linkedOrderIds as string[]) || [],
    ponctuelStockUpdated: (data.ponctuelStockUpdated as boolean) || false,
    fournisseur: (data.fournisseur as Prisma.InputJsonValue) ?? Prisma.JsonNull,
  };

  await prisma.purchaseOrder.upsert({
    where: { id },
    create: { id, ...payload },
    update: payload,
  });

  const items = data.items as Array<Record<string, unknown>> | undefined;
  if (items?.length) {
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
    for (const item of items) {
      await prisma.purchaseOrderItem.create({
        data: {
          purchaseOrderId: id,
          productId: (item.productId as string) || '',
          productName: (item.productName as string) || '',
          quantity: (item.quantity as number) || 0,
          unitPrice: (item.unitPrice as number) || 0,
          total: (item.total as number) || 0,
          source: (item.source as string) || 'stock',
        },
      });
    }
  }

  const documents = data.documents as Array<Record<string, unknown>> | undefined;
  if (documents?.length) {
    await prisma.purchaseOrderDocument.deleteMany({ where: { purchaseOrderId: id } });
    for (const doc of documents) {
      await prisma.purchaseOrderDocument.create({
        data: {
          purchaseOrderId: id,
          name: (doc.name as string) || '',
          type: (doc.type as string) || '',
          data: (doc.data as string) || '',
          label: (doc.label as string) || '',
          date: (doc.date as string) || '',
        },
      });
    }
  }
}

async function upsertAccountingEntry(id: string, data: Record<string, unknown>) {
  await prisma.accountingEntry.upsert({
    where: { id },
    create: {
      id,
      date: (data.date as string) || '',
      pieceNumber: (data.pieceNumber as string) || '',
      label: (data.label as string) || '',
      isManual: (data.isManual as boolean) ?? true,
      origine: (data.origine as string) || 'manuel',
      modifiable: (data.modifiable as boolean) ?? true,
      attachmentUrl: (data.attachmentUrl as string) || null,
      firestoreCreatedAt: (data.createdAt as string) || null,
    },
    update: {
      date: (data.date as string) || '',
      pieceNumber: (data.pieceNumber as string) || '',
      label: (data.label as string) || '',
      isManual: (data.isManual as boolean) ?? true,
      origine: (data.origine as string) || 'manuel',
      modifiable: (data.modifiable as boolean) ?? true,
      attachmentUrl: (data.attachmentUrl as string) || null,
    },
  });

  const lines = data.lines as Array<Record<string, unknown>> | undefined;
  if (lines?.length) {
    await prisma.accountingEntryLine.deleteMany({ where: { accountingEntryId: id } });
    for (const line of lines) {
      await prisma.accountingEntryLine.create({
        data: {
          accountingEntryId: id,
          accountId: (line.accountId as string) || '',
          label: (line.label as string) || '',
          debit: (line.debit as number) || 0,
          credit: (line.credit as number) || 0,
        },
      });
    }
  }
}

async function upsertSettings(data: Record<string, unknown>) {
  await prisma.appSettings.upsert({
    where: { id: 'global' },
    create: {
      id: 'global',
      adminPhone: (data.adminPhone as string) || '',
      logoUrl: (data.logoUrl as string) || null,
      shopifyDomain: (data.shopifyDomain as string) || null,
      shopifyAccessToken: (data.shopifyAccessToken as string) || null,
      ignoredShopifyIds: (data.ignoredShopifyIds as string[]) || [],
    },
    update: {
      adminPhone: (data.adminPhone as string) || '',
      logoUrl: (data.logoUrl as string) || null,
      shopifyDomain: (data.shopifyDomain as string) || null,
      ignoredShopifyIds: (data.ignoredShopifyIds as string[]) || [],
    },
  });
}

async function upsertConfig(key: string, data: Record<string, unknown>) {
  const value = data.value !== undefined
    ? (typeof data.value === 'string' ? data.value : JSON.stringify(data.value))
    : JSON.stringify(data);

  await prisma.appConfig.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function upsertClaudeAnalysis(date: string, data: Record<string, unknown>) {
  const analysis = (data.analysis as string) || '';
  await prisma.claudeAnalysis.upsert({
    where: { date },
    create: { date, analysis },
    update: { analysis },
  });
}

// ─── Deletes (deleteMany = idempotent, pas d'erreur si déjà absent) ─────────

async function handleDelete(ctx: SyncContext): Promise<void> {
  const { collectionName, docId } = ctx;

  await logSyncEvent(collectionName, docId, 'delete', null);

  try {
    let deleted = 0;

    switch (collectionName) {
      case 'orders':
        ({ count: deleted } = await prisma.order.deleteMany({ where: { id: docId } }));
        break;
      case 'stockLivreurs':
        ({ count: deleted } = await prisma.stockLivreur.deleteMany({ where: { id: docId } }));
        break;
      case 'stock_operations':
        ({ count: deleted } = await prisma.stockOperation.deleteMany({ where: { id: docId } }));
        break;
      case 'drivers':
        ({ count: deleted } = await prisma.driver.deleteMany({ where: { id: docId } }));
        break;
      case 'zones':
        ({ count: deleted } = await prisma.zone.deleteMany({ where: { id: docId } }));
        break;
      case 'products':
        ({ count: deleted } = await prisma.product.deleteMany({ where: { id: docId } }));
        break;
      case 'fund_requests':
        ({ count: deleted } = await prisma.fundRequest.deleteMany({ where: { id: docId } }));
        break;
      case 'users':
        ({ count: deleted } = await prisma.systemUser.deleteMany({ where: { id: docId } }));
        break;
      case 'financial_configs': {
        const meta = ctx.docPath
          ? resolveFinancialConfigMeta(docId, {}, ctx.docPath)
          : null;
        if (meta) {
          const stableId = financialConfigStableId(meta.productId, meta.dateEffet, ctx.docPath);
          ({ count: deleted } = await prisma.financialConfig.deleteMany({ where: { id: stableId } }));
        }
        break;
      }
      case 'daily_entries':
        ({ count: deleted } = await prisma.dailyEntry.deleteMany({ where: { date: docId } }));
        break;
      case 'daily_finance':
        ({ count: deleted } = await prisma.dailyFinance.deleteMany({ where: { date: docId } }));
        break;
      case 'purchase_orders':
        ({ count: deleted } = await prisma.purchaseOrder.deleteMany({ where: { id: docId } }));
        break;
      case 'accounting_entries':
        ({ count: deleted } = await prisma.accountingEntry.deleteMany({ where: { id: docId } }));
        break;
      case 'config':
        ({ count: deleted } = await prisma.appConfig.deleteMany({ where: { key: docId } }));
        break;
      case 'claude_analysis':
        ({ count: deleted } = await prisma.claudeAnalysis.deleteMany({ where: { date: docId } }));
        break;
      default:
        console.warn(`[sync] Suppression non gérée: ${collectionName}/${docId}`);
    }

    if (deleted === 0 && collectionName !== 'financial_configs') {
      // Firestore signale une suppression d'un doc jamais importé en PG — normal
      return;
    }
  } catch (error: unknown) {
    console.error(`[sync] Erreur delete ${collectionName}/${docId}:`, error);
  }
}

export async function reconcileDeletions(collectionName: string, activeIds: Set<string>): Promise<number> {
  let deletedCount = 0;
  try {
    switch (collectionName) {
      case 'orders': {
        const rows = await prisma.order.findMany({ select: { id: true } });
        for (const r of rows) {
          if (!activeIds.has(r.id)) {
            await handleDelete({ collectionName, docId: r.id });
            deletedCount++;
          }
        }
        break;
      }
      case 'stock_operations': {
        const rows = await prisma.stockOperation.findMany({ select: { id: true } });
        for (const r of rows) {
          if (!activeIds.has(r.id)) {
            await handleDelete({ collectionName, docId: r.id });
            deletedCount++;
          }
        }
        break;
      }
      case 'purchase_orders': {
        const rows = await prisma.purchaseOrder.findMany({ select: { id: true } });
        for (const r of rows) {
          if (!activeIds.has(r.id)) {
            await handleDelete({ collectionName, docId: r.id });
            deletedCount++;
          }
        }
        break;
      }
      case 'fund_requests': {
        const rows = await prisma.fundRequest.findMany({ select: { id: true } });
        for (const r of rows) {
          if (!activeIds.has(r.id)) {
            await handleDelete({ collectionName, docId: r.id });
            deletedCount++;
          }
        }
        break;
      }
      case 'daily_entries': {
        const rows = await prisma.dailyEntry.findMany({ select: { date: true } });
        for (const r of rows) {
          if (!activeIds.has(r.date)) {
            await handleDelete({ collectionName, docId: r.date });
            deletedCount++;
          }
        }
        break;
      }
      case 'stockLivreurs': {
        const rows = await prisma.stockLivreur.findMany({ select: { id: true } });
        for (const r of rows) {
          if (!activeIds.has(r.id)) {
            await handleDelete({ collectionName, docId: r.id });
            deletedCount++;
          }
        }
        break;
      }
      case 'products': {
        const rows = await prisma.product.findMany({ select: { id: true } });
        for (const r of rows) {
          if (!activeIds.has(r.id)) {
            await handleDelete({ collectionName, docId: r.id });
            deletedCount++;
          }
        }
        break;
      }
      // For financial_configs we skip because IDs are mapped differently.
      // A full db:align can be used if needed.
    }
  } catch (err) {
    console.error(`[sync] Erreur reconcileDeletions ${collectionName}:`, err);
  }
  return deletedCount;
}
