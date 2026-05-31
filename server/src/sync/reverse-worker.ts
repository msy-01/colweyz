/**
 * Reverse sync : PostgreSQL → Firestore (migration parallèle).
 * Pousse ajouts / mises à jour par curseur `updatedAt` (ou équivalent),
 * et réconcilie les suppressions en comparant les IDs périodiquement.
 *
 * Variables : SYNC_REVERSE_ENABLED, SYNC_REVERSE_POLL_MS, SYNC_REVERSE_BATCH_SIZE,
 *             SYNC_REVERSE_DELETE_EVERY, SYNC_REVERSE_COLLECTIONS (optionnel),
 *             SYNC_REVERSE_PUSH_SHOPIFY_TOKEN (défaut false — ne pousse pas le token vers Firestore)
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../lib/prisma.js';

const SYNC_REVERSE_ENABLED = process.env.SYNC_REVERSE_ENABLED === 'true';
const POLL_MS = parseInt(process.env.SYNC_REVERSE_POLL_MS || '3000', 10);
const BATCH_SIZE = parseInt(process.env.SYNC_REVERSE_BATCH_SIZE || '200', 10);
const DELETE_RECONCILE_EVERY = parseInt(process.env.SYNC_REVERSE_DELETE_EVERY || '10', 10);

/** Liste CSV ; défaut = toutes les collections gérées */
const COLLECTIONS_ENV = (process.env.SYNC_REVERSE_COLLECTIONS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Par défaut : ne pas réécrire shopifyAccessToken dans Firestore (merge conserve la valeur existante). */
const PUSH_SHOPIFY_TOKEN = process.env.SYNC_REVERSE_PUSH_SHOPIFY_TOKEN === 'true';

if (!SYNC_REVERSE_ENABLED) {
  console.log('⚠️ Reverse sync désactivé. Mettez SYNC_REVERSE_ENABLED=true dans server/.env');
  process.exit(0);
}

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`❌ Clé Firebase Admin introuvable: ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp(
  { credential: admin.credential.cert(serviceAccount) },
  'reverse-sync'
);

const databaseId = process.env.FIREBASE_DATABASE_ID;
const firestoreDb = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

const META = { _syncSource: 'postgres' as const };

async function getCursor(key: string): Promise<Date> {
  const row = await prisma.syncState.findUnique({ where: { collectionName: key } });
  return row?.lastSyncedAt ?? new Date(0);
}

async function setCursor(key: string, cursor: Date): Promise<void> {
  await prisma.syncState.upsert({
    where: { collectionName: key },
    create: { collectionName: key, lastSyncedAt: cursor, documentsCount: 0 },
    update: { lastSyncedAt: cursor },
  });
}

// ─── Serializers (alignés sur upsert.ts / ancienne app) ─────────────────────

function serializeOrder(row: any): Record<string, unknown> {
  return {
    id: row.id,
    date: row.date,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    address: row.address,
    productDetails: row.productDetails,
    productId: row.productId,
    amount: row.amount,
    deliveryCost: row.deliveryCost,
    status: row.status,
    remuneration: row.remuneration,
    paymentMethod: row.paymentMethod,
    cancelReason: row.cancelReason,
    shippingFee: row.shippingFee,
    isPrePaid: row.isPrePaid,
    regionalPaymentStatus: row.regionalPaymentStatus,
    regionalPaidAt: row.regionalPaidAt,
    assignedAt: row.assignedAt,
    deliveredAt: row.deliveredAt,
    postponedAt: row.postponedAt,
    scheduledAt: row.scheduledAt,
    importedAt: row.importedAt,
    refusedBy: row.refusedBy,
    purchaseCost: row.purchaseCost,
    remarks: row.remarks,
    shippingRemarks: row.shippingRemarks,
    assignmentRemarks: row.assignmentRemarks,
    isDepotDelivery: row.isDepotDelivery,
    sortieDepotLogged: row.sortieDepotLogged,
    livraisonDepotConfirmee: row.livraisonDepotConfirmee,
    linkedOrderIds: Array.isArray(row.linkedOrderIds) ? row.linkedOrderIds : [],
    zoneId: row.zoneId,
    driverId: row.driverId,
    driverName: row.driverName,
    products: row.products ?? [],
    logs: row.logs ?? [],
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializeDriver(row: any): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    username: row.username,
    initialBalance: row.initialBalance,
    status: row.status,
    color: row.color,
    uid: row.uid,
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializeZone(row: any): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    rate: row.rate,
    type: row.type,
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

/** Ne pas pousser passwordHash vers Firestore */
function serializeUser(row: any): Record<string, unknown> {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    permissions: row.permissions ?? [],
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializeFundRequest(row: any): Record<string, unknown> {
  return {
    id: row.id,
    amount: row.amount,
    type: row.type,
    status: row.status,
    paymentMethod: row.paymentMethod,
    driverId: row.driverId,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    updatedAt: toIso(row.dbUpdatedAt),
    ...META,
  };
}

function serializeStockLivreur(row: any): Record<string, unknown> {
  return {
    id: row.id,
    livreurId: row.livreurId,
    produitId: row.produitId,
    produitNom: row.produitNom,
    SI: row.si,
    si: row.si,
    entrees: row.entrees,
    sorties: row.sorties,
    SF: row.sf,
    sf: row.sf,
    ajustementManuel: row.ajustementManuel,
    motifDernierAjustement: row.motifDernierAjustement,
    dateDernierAjustement: row.dateDernierAjustement,
    ajustePar: row.ajustePar,
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializeStockOperation(row: any): Record<string, unknown> {
  return {
    id: row.id,
    date: row.date,
    productId: row.productId,
    productName: row.productName,
    quantity: row.quantity,
    type: row.type,
    source: row.source,
    livreurId: row.livreurId,
    entiteType: row.entiteType,
    entiteId: row.entiteId,
    commandeId: row.commandeId,
    referenceId: row.referenceId,
    notes: row.notes,
    annule: row.annule,
    annuleLe: row.annuleLe,
    annuleMotif: row.annuleMotif,
    createdAt: row.firestoreCreatedAt,
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializeProduct(row: any): Record<string, unknown> {
  const variants = (row.variants || []).map((v: any) => ({
    id: v.id,
    title: v.title,
    sku: v.sku,
    price: v.price,
    inventory_quantity: v.inventoryQuantity,
    inventoryQuantity: v.inventoryQuantity,
    weight: v.weight,
    weight_unit: v.weightUnit,
    weightUnit: v.weightUnit,
  }));
  const images = (row.images || []).map((img: any) => ({
    id: img.id,
    src: img.src,
    alt: img.alt,
  }));
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    vendor: row.vendor,
    productType: row.productType,
    product_type: row.productType,
    status: row.status,
    source: row.source,
    sellingPrice: row.sellingPrice,
    purchasePrice: row.purchasePrice,
    mainStock: row.mainStock,
    totalInventory: row.totalInventory,
    stockGlobal: row.stockGlobal,
    stockLivreurs: row.stockLivreurs,
    tags: row.tags ?? [],
    variants,
    images,
    createdAt: row.firestoreCreatedAt,
    updatedAt: row.firestoreUpdatedAt || toIso(row.updatedAt),
    ...META,
  };
}

function serializeFinancialConfig(row: any): Record<string, unknown> {
  return {
    productId: row.productId,
    cau: row.cau,
    appro: row.appro,
    dailyBudgetUsd: row.dailyBudgetUsd,
    isCampaignActive: row.isCampaignActive,
    dateEffet: row.dateEffet,
    updatedAt: row.firestoreUpdatedAt || toIso(row.updatedAt),
    ...META,
  };
}

function serializeDailyEntry(row: any): Record<string, unknown> {
  return {
    date: row.date,
    exchangeRate: row.exchangeRate,
    entries: row.entries,
    productOrder: row.productOrder ?? [],
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializeDailyFinance(row: any): Record<string, unknown> {
  return {
    date: row.date,
    otherRevenues: row.otherRevenues,
    otherExpenses: row.otherExpenses,
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializePurchaseOrder(row: any): Record<string, unknown> {
  const items = (row.items || []).map((it: any) => ({
    productId: it.productId,
    productName: it.productName,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    total: it.total,
    source: it.source,
  }));
  const documents = (row.documents || []).map((d: any) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    data: d.data,
    label: d.label,
    date: d.date,
  }));
  return {
    id: row.id,
    number: row.number,
    date: row.date,
    totalAmount: row.totalAmount,
    transportFees: row.transportFees,
    status: row.status,
    source: row.source,
    supplierName: row.supplierName,
    createdAt: row.firestoreCreatedAt,
    validatedAt: row.validatedAt,
    paidAt: row.paidAt,
    deliveredAt: row.deliveredAt,
    linkedOrderIds: row.linkedOrderIds ?? [],
    ponctuelStockUpdated: row.ponctuelStockUpdated,
    fournisseur: row.fournisseur,
    items,
    documents,
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializeAccountingEntry(row: any): Record<string, unknown> {
  const lines = (row.lines || []).map((ln: any) => ({
    id: ln.id,
    accountId: ln.accountId,
    label: ln.label,
    debit: ln.debit,
    credit: ln.credit,
  }));
  return {
    id: row.id,
    date: row.date,
    pieceNumber: row.pieceNumber,
    label: row.label,
    isManual: row.isManual,
    origine: row.origine,
    modifiable: row.modifiable,
    attachmentUrl: row.attachmentUrl,
    createdAt: row.firestoreCreatedAt,
    lines,
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializeClaudeAnalysis(row: any): Record<string, unknown> {
  return {
    date: row.date,
    analysis: row.analysis,
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
}

function serializeSettings(row: any): Record<string, unknown> {
  const out: Record<string, unknown> = {
    adminPhone: row.adminPhone,
    logoUrl: row.logoUrl,
    shopifyDomain: row.shopifyDomain,
    ignoredShopifyIds: row.ignoredShopifyIds ?? [],
    updatedAt: toIso(row.updatedAt),
    ...META,
  };
  if (PUSH_SHOPIFY_TOKEN && row.shopifyAccessToken != null && row.shopifyAccessToken !== '') {
    out.shopifyAccessToken = row.shopifyAccessToken;
  }
  return out;
}

function serializeConfigDoc(key: string, value: string): Record<string, unknown> {
  return {
    value,
    updatedAt: new Date().toISOString(),
    ...META,
  };
}

// ─── Handlers par collection ────────────────────────────────────────────────

type CollectionHandler = {
  name: string;
  cursorKey: string;
  pushBatch: (cursor: Date) => Promise<{ count: number; last: Date }>;
  reconcileDeletes?: () => Promise<number>;
};

async function pushOrders(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.order.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('orders').doc(row.id).set(serializeOrder(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileOrders(): Promise<number> {
  const pg = await prisma.order.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('orders').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushDrivers(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.driver.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('drivers').doc(row.id).set(serializeDriver(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileDrivers(): Promise<number> {
  const pg = await prisma.driver.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('drivers').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushZones(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.zone.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('zones').doc(row.id).set(serializeZone(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileZones(): Promise<number> {
  const pg = await prisma.zone.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('zones').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushUsers(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.systemUser.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('users').doc(row.id).set(serializeUser(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileUsers(): Promise<number> {
  const pg = await prisma.systemUser.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('users').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushFundRequests(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.fundRequest.findMany({
    where: { dbUpdatedAt: { gt: cursor } },
    orderBy: { dbUpdatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('fund_requests').doc(row.id).set(serializeFundRequest(row), { merge: true });
    if (row.dbUpdatedAt > last) last = row.dbUpdatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileFundRequests(): Promise<number> {
  const pg = await prisma.fundRequest.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('fund_requests').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushProducts(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.product.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
    include: { variants: true, images: true },
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('products').doc(row.id).set(serializeProduct(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileProducts(): Promise<number> {
  const pg = await prisma.product.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('products').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushStockLivreurs(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.stockLivreur.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('stockLivreurs').doc(row.id).set(serializeStockLivreur(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileStockLivreurs(): Promise<number> {
  const pg = await prisma.stockLivreur.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('stockLivreurs').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushStockOperations(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.stockOperation.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('stock_operations').doc(row.id).set(serializeStockOperation(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileStockOperations(): Promise<number> {
  const pg = await prisma.stockOperation.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('stock_operations').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushPurchaseOrders(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.purchaseOrder.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
    include: { items: true, documents: true },
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('purchase_orders').doc(row.id).set(serializePurchaseOrder(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcilePurchaseOrders(): Promise<number> {
  const pg = await prisma.purchaseOrder.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('purchase_orders').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushDailyEntries(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.dailyEntry.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    const docId = row.date;
    await firestoreDb.collection('daily_entries').doc(docId).set(serializeDailyEntry(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileDailyEntries(): Promise<number> {
  const pg = await prisma.dailyEntry.findMany({ select: { date: true } });
  const ids = new Set(pg.map((r) => r.date));
  const snap = await firestoreDb.collection('daily_entries').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushDailyFinance(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.dailyFinance.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('daily_finance').doc(row.date).set(serializeDailyFinance(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileDailyFinance(): Promise<number> {
  const pg = await prisma.dailyFinance.findMany({ select: { date: true } });
  const ids = new Set(pg.map((r) => r.date));
  const snap = await firestoreDb.collection('daily_finance').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushAccountingEntries(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.accountingEntry.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
    include: { lines: true },
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('accounting_entries').doc(row.id).set(serializeAccountingEntry(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileAccountingEntries(): Promise<number> {
  const pg = await prisma.accountingEntry.findMany({ select: { id: true } });
  const ids = new Set(pg.map((r) => r.id));
  const snap = await firestoreDb.collection('accounting_entries').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushClaudeAnalysis(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.claudeAnalysis.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb.collection('claude_analysis').doc(row.date).set(serializeClaudeAnalysis(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileClaudeAnalysis(): Promise<number> {
  const pg = await prisma.claudeAnalysis.findMany({ select: { date: true } });
  const ids = new Set(pg.map((r) => r.date));
  const snap = await firestoreDb.collection('claude_analysis').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!ids.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushSettings(cursor: Date): Promise<{ count: number; last: Date }> {
  const row = await prisma.appSettings.findUnique({ where: { id: 'global' } });
  if (!row || row.updatedAt <= cursor) return { count: 0, last: cursor };
  await firestoreDb.collection('settings').doc('global').set(serializeSettings(row), { merge: true });
  return { count: 1, last: row.updatedAt };
}

async function pushAppConfig(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.appConfig.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    await firestoreDb
      .collection('config')
      .doc(row.key)
      .set(serializeConfigDoc(row.key, row.value), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileAppConfig(): Promise<number> {
  const pg = await prisma.appConfig.findMany({ select: { key: true } });
  const keys = new Set(pg.map((r) => r.key));
  const snap = await firestoreDb.collection('config').get();
  let n = 0;
  for (const d of snap.docs) {
    if (!keys.has(d.id)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

async function pushFinancialConfigs(cursor: Date): Promise<{ count: number; last: Date }> {
  const rows = await prisma.financialConfig.findMany({
    where: { updatedAt: { gt: cursor } },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });
  if (!rows.length) return { count: 0, last: cursor };
  let last = cursor;
  for (const row of rows) {
    const de = row.dateEffet || 'default';
    const path = `campagnes/${row.productId}/configs/${de}`;
    await firestoreDb.doc(path).set(serializeFinancialConfig(row), { merge: true });
    if (row.updatedAt > last) last = row.updatedAt;
  }
  return { count: rows.length, last };
}

async function reconcileFinancialConfigs(): Promise<number> {
  const pg = await prisma.financialConfig.findMany({
    select: { productId: true, dateEffet: true },
  });
  const keys = new Set(pg.map((r) => `${r.productId}::${r.dateEffet || 'default'}`));
  const snap = await firestoreDb.collectionGroup('configs').get();
  let n = 0;
  for (const d of snap.docs) {
    const parts = d.ref.path.split('/');
    const idx = parts.indexOf('campagnes');
    if (idx < 0 || !parts[idx + 1] || parts[idx + 2] !== 'configs') continue;
    const productId = parts[idx + 1];
    const dateEffet = parts[idx + 3] || d.id;
    const k = `${productId}::${dateEffet}`;
    if (!keys.has(k)) {
      await d.ref.delete();
      n++;
    }
  }
  return n;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const ALL_HANDLERS: CollectionHandler[] = [
  { name: 'orders', cursorKey: 'reverse_orders', pushBatch: pushOrders, reconcileDeletes: reconcileOrders },
  { name: 'drivers', cursorKey: 'reverse_drivers', pushBatch: pushDrivers, reconcileDeletes: reconcileDrivers },
  { name: 'zones', cursorKey: 'reverse_zones', pushBatch: pushZones, reconcileDeletes: reconcileZones },
  { name: 'users', cursorKey: 'reverse_users', pushBatch: pushUsers, reconcileDeletes: reconcileUsers },
  { name: 'fund_requests', cursorKey: 'reverse_fund_requests', pushBatch: pushFundRequests, reconcileDeletes: reconcileFundRequests },
  { name: 'products', cursorKey: 'reverse_products', pushBatch: pushProducts, reconcileDeletes: reconcileProducts },
  { name: 'stockLivreurs', cursorKey: 'reverse_stockLivreurs', pushBatch: pushStockLivreurs, reconcileDeletes: reconcileStockLivreurs },
  { name: 'stock_operations', cursorKey: 'reverse_stock_operations', pushBatch: pushStockOperations, reconcileDeletes: reconcileStockOperations },
  { name: 'purchase_orders', cursorKey: 'reverse_purchase_orders', pushBatch: pushPurchaseOrders, reconcileDeletes: reconcilePurchaseOrders },
  { name: 'daily_entries', cursorKey: 'reverse_daily_entries', pushBatch: pushDailyEntries, reconcileDeletes: reconcileDailyEntries },
  { name: 'daily_finance', cursorKey: 'reverse_daily_finance', pushBatch: pushDailyFinance, reconcileDeletes: reconcileDailyFinance },
  { name: 'accounting_entries', cursorKey: 'reverse_accounting_entries', pushBatch: pushAccountingEntries, reconcileDeletes: reconcileAccountingEntries },
  { name: 'claude_analysis', cursorKey: 'reverse_claude_analysis', pushBatch: pushClaudeAnalysis, reconcileDeletes: reconcileClaudeAnalysis },
  { name: 'settings', cursorKey: 'reverse_settings', pushBatch: pushSettings },
  { name: 'config', cursorKey: 'reverse_config', pushBatch: pushAppConfig, reconcileDeletes: reconcileAppConfig },
  { name: 'financial_configs', cursorKey: 'reverse_financial_configs', pushBatch: pushFinancialConfigs, reconcileDeletes: reconcileFinancialConfigs },
];

function selectHandlers(): CollectionHandler[] {
  if (!COLLECTIONS_ENV.length) return ALL_HANDLERS;
  const set = new Set(COLLECTIONS_ENV);
  return ALL_HANDLERS.filter((h) => set.has(h.name));
}

async function loop(): Promise<void> {
  const handlers = selectHandlers();
  console.log('🔁 Reverse Sync PostgreSQL → Firestore (multi-collections)');
  console.log(`   collections: ${handlers.map((h) => h.name).join(', ')}`);
  console.log(`   poll=${POLL_MS}ms batch=${BATCH_SIZE} delete-every=${DELETE_RECONCILE_EVERY}`);
  console.log(`   shopify token → Firestore: ${PUSH_SHOPIFY_TOKEN ? 'oui (SYNC_REVERSE_PUSH_SHOPIFY_TOKEN)' : 'non (valeur Firestore inchangée au merge)'}`);

  let cycle = 0;
  while (true) {
    try {
      cycle++;
      for (const h of handlers) {
        const cursor = await getCursor(h.cursorKey);
        const { count, last } = await h.pushBatch(cursor);
        if (count > 0) {
          await setCursor(h.cursorKey, last);
          console.log(`✅ reverse ${h.name}: ${count} doc(s)`);
        }

        /* Désactivé temporairement pour sécurité (Reverse Sync)
        if (h.reconcileDeletes && cycle % DELETE_RECONCILE_EVERY === 0) {
          const removed = await h.reconcileDeletes();
          if (removed > 0) {
            console.log(`🗑️ reverse ${h.name}: ${removed} suppression(s) Firestore`);
          }
        }
        */
      }
    } catch (error) {
      console.error('❌ reverse sync error:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt reverse sync...');
  await prisma.$disconnect();
  process.exit(0);
});

loop().catch(async (e) => {
  console.error('Reverse worker fatal:', e);
  await prisma.$disconnect();
  process.exit(1);
});
