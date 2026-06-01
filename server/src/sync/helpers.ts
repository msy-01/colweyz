import { prisma } from '../lib/prisma.js';

/** Extrait un timestamp comparable depuis un document Firestore. */
/** Horodatage source pour les bons d'achat (Firestore utilise souvent `date`, pas `updatedAt`). */
export function getPurchaseOrderSourceUpdatedAt(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const candidates = [
    data.updatedAt,
    data.date,
    data.validatedAt,
    data.paidAt,
    data.deliveredAt,
    data.createdAt,
  ];
  let best: number | null = null;
  let bestStr: string | null = null;
  for (const c of candidates) {
    if (typeof c !== 'string' || c.length === 0) continue;
    const t = parseTimestamp(c);
    if (t !== null && (best === null || t > best)) {
      best = t;
      bestStr = c;
    }
  }
  return bestStr;
}

export function getSourceUpdatedAt(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const candidates = [
    data.updatedAt,
    data.updateAt,
    data.updated_at,
    data.createdAt,
    data.created_at,
    data.date,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Horodatage effectif = max(champs doc, metadata Firestore updateTime). */
export function getEffectiveSourceUpdatedAt(
  collectionName: string,
  data: Record<string, unknown>,
  firestoreUpdateTime?: string | null
): string | null {
  const fromDoc =
    collectionName === 'purchase_orders'
      ? getPurchaseOrderSourceUpdatedAt(data)
      : getSourceUpdatedAt(data);

  if (fromDoc) {
    const t = parseTimestamp(fromDoc);
    if (t !== null) return new Date(t).toISOString();
  }

  if (firestoreUpdateTime) {
    const t = parseTimestamp(firestoreUpdateTime);
    if (t !== null) return new Date(t).toISOString();
  }
  
  return null;
}

/**
 * Ignore les événements Firestore plus anciens que ce qui est déjà en base.
 */
export async function shouldSkipStaleUpdate(
  collectionName: string,
  docId: string,
  sourceUpdatedAt: string | null,
  extra?: { productId?: string; dateEffet?: string; docPath?: string }
): Promise<boolean> {
  // Orders: l'ancienne app ne met pas toujours `updatedAt` à jour ; PG.updatedAt reflète
  // le dernier import/align, pas Firestore → ne jamais ignorer un événement live.
  if (collectionName === 'orders') return false;

  if (!sourceUpdatedAt) return false;
  const incoming = parseTimestamp(sourceUpdatedAt);
  if (incoming === null) return false;

  const existing = await getExistingTimestamp(collectionName, docId, extra);
  if (existing === null) return false;

  return incoming <= existing;
}

async function getExistingTimestamp(
  collectionName: string,
  docId: string,
  extra?: { productId?: string; dateEffet?: string; docPath?: string }
): Promise<number | null> {
  switch (collectionName) {
    case 'orders': {
      const row = await prisma.order.findUnique({ where: { id: docId }, select: { updatedAt: true } });
      return row ? row.updatedAt.getTime() : null;
    }
    case 'products': {
      const row = await prisma.product.findUnique({
        where: { id: docId },
        select: { firestoreUpdatedAt: true, updatedAt: true },
      });
      return parseTimestamp(row?.firestoreUpdatedAt) ?? row?.updatedAt.getTime() ?? null;
    }
    case 'financial_configs': {
      if (!extra?.productId || !extra?.dateEffet) return null;
      const stableId = financialConfigStableId(
        extra.productId,
        extra.dateEffet,
        extra.docPath
      );
      const row = await prisma.financialConfig.findUnique({
        where: { id: stableId },
        select: { firestoreUpdatedAt: true, updatedAt: true },
      });
      return parseTimestamp(row?.firestoreUpdatedAt) ?? row?.updatedAt.getTime() ?? null;
    }
    case 'stock_operations': {
      const row = await prisma.stockOperation.findUnique({
        where: { id: docId },
        select: { firestoreCreatedAt: true, updatedAt: true },
      });
      return parseTimestamp(row?.firestoreCreatedAt) ?? row?.updatedAt.getTime() ?? null;
    }
    case 'fund_requests': {
      const row = await prisma.fundRequest.findUnique({
        where: { id: docId },
        select: { dbUpdatedAt: true },
      });
      return row?.dbUpdatedAt.getTime() ?? null;
    }
    case 'daily_entries':
      // Toujours appliquer Firestore : les saisies pub/ventes viennent surtout de l'ancienne app.
      return null;
    case 'daily_finance': {
      const row = await prisma.dailyFinance.findUnique({ where: { date: docId }, select: { updatedAt: true } });
      return row?.updatedAt.getTime() ?? null;
    }
    case 'drivers': {
      const row = await prisma.driver.findUnique({ where: { id: docId }, select: { updatedAt: true } });
      return row?.updatedAt.getTime() ?? null;
    }
    case 'zones': {
      const row = await prisma.zone.findUnique({ where: { id: docId }, select: { updatedAt: true } });
      return row?.updatedAt.getTime() ?? null;
    }
    case 'stockLivreurs': {
      const row = await prisma.stockLivreur.findUnique({ where: { id: docId }, select: { updatedAt: true } });
      return row?.updatedAt.getTime() ?? null;
    }
    case 'users': {
      const row = await prisma.systemUser.findUnique({ where: { id: docId }, select: { updatedAt: true } });
      return row?.updatedAt.getTime() ?? null;
    }
    case 'purchase_orders': {
      const row = await prisma.purchaseOrder.findUnique({
        where: { id: docId },
        select: {
          date: true,
          validatedAt: true,
          paidAt: true,
          deliveredAt: true,
          firestoreCreatedAt: true,
        },
      });
      if (!row) return null;
      const times = [row.date, row.validatedAt, row.paidAt, row.deliveredAt, row.firestoreCreatedAt]
        .map((v) => parseTimestamp(v))
        .filter((t): t is number => t !== null);
      return times.length > 0 ? Math.max(...times) : null;
    }
    case 'accounting_entries': {
      const row = await prisma.accountingEntry.findUnique({
        where: { id: docId },
        select: { firestoreCreatedAt: true, updatedAt: true },
      });
      return parseTimestamp(row?.firestoreCreatedAt) ?? row?.updatedAt.getTime() ?? null;
    }
    case 'settings': {
      const row = await prisma.appSettings.findUnique({ where: { id: 'global' }, select: { updatedAt: true } });
      return row?.updatedAt.getTime() ?? null;
    }
    case 'config': {
      const row = await prisma.appConfig.findUnique({ where: { key: docId }, select: { updatedAt: true } });
      return row?.updatedAt.getTime() ?? null;
    }
    case 'claude_analysis': {
      const row = await prisma.claudeAnalysis.findUnique({ where: { date: docId }, select: { updatedAt: true } });
      return row?.updatedAt.getTime() ?? null;
    }
    default:
      return null;
  }
}

/**
 * Au premier onSnapshot, Firestore renvoie tous les docs en "added".
 * Si le seed a déjà rempli la collection, on ignore ce replay.
 */
export async function shouldSkipInitialReplay(
  collectionName: string,
  docChanges: { type: string }[]
): Promise<boolean> {
  // Never skip the initial replay. It is required to catch any events
  // that were missed while the worker was offline. 
  // Stale updates will be filtered out by shouldSkipStaleUpdate later.
  return false;
}

/** Résout productId + dateEffet pour les docs campagnes/{pid}/configs/{date}. */
export function financialConfigStableId(
  productId: string,
  dateEffet: string,
  docPath?: string
): string {
  if (docPath) return docPath.replace(/\//g, '__');
  return `campagnes__${productId}__configs__${dateEffet}`;
}

export function resolveFinancialConfigMeta(
  docId: string,
  data: Record<string, unknown>,
  docPath?: string
): { productId: string; dateEffet: string } | null {
  const productId =
    (data.productId as string) ||
    (data.product_id as string) ||
    extractPathSegment(docPath, 'campagnes');
  const dateEffet = (data.dateEffet as string) || (data.date_effet as string) || docId;
  if (!productId) return null;
  return { productId, dateEffet };
}

function extractPathSegment(path: string | undefined, segment: string): string | null {
  if (!path) return null;
  const parts = path.split('/');
  const idx = parts.indexOf(segment);
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

export async function logSyncEvent(
  collectionName: string,
  documentId: string,
  operation: string,
  sourceUpdatedAt: string | null
): Promise<void> {
  try {
    await prisma.syncLog.upsert({
      where: {
        collectionName_documentId_sourceUpdatedAt_operation: {
          collectionName,
          documentId,
          sourceUpdatedAt: sourceUpdatedAt ?? 'unknown',
          operation,
        },
      },
      create: {
        collectionName,
        documentId,
        sourceUpdatedAt: sourceUpdatedAt ?? 'unknown',
        operation,
      },
      update: { processedAt: new Date() },
    });
  } catch {
    // Déjà traité — idempotent
  }
}
