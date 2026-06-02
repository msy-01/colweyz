/**
 * Configs rentabilité : campagnes/{productId}/configs/{dateEffet}
 * ID PostgreSQL stable = chemin Firestore avec / → __
 */
import { prisma } from './prisma.js';
import {
  financialConfigStableId,
  getSourceUpdatedAt,
  resolveFinancialConfigMeta,
} from '../sync/helpers.js';

export function parseDateEffet(raw: string | undefined | null): string {
  if (!raw) return '';
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(raw).slice(0, 10);
}

/** Clé métier pour comparer PG ↔ Firestore. */
export function financialConfigKey(productId: string, dateEffet: string): string {
  return `${productId}::${parseDateEffet(dateEffet)}`;
}

export type FinancialConfigPayload = {
  id: string;
  productId: string;
  dateEffet: string;
  cau: number;
  appro: number;
  dailyBudgetUsd: number;
  isCampaignActive: boolean;
  firestoreUpdatedAt: string | null;
};

export function buildFinancialConfigPayload(
  docId: string,
  data: Record<string, unknown>,
  docPath?: string
): FinancialConfigPayload | null {
  const meta = resolveFinancialConfigMeta(docId, data, docPath);
  if (!meta) return null;

  const dateEffet = parseDateEffet(meta.dateEffet);
  const id = financialConfigStableId(meta.productId, dateEffet, docPath);

  return {
    id,
    productId: meta.productId,
    dateEffet,
    cau: Number(data.cau ?? data.caUnitaire ?? 0) || 0,
    appro: Number(data.appro ?? data.coutAppro ?? 0) || 0,
    dailyBudgetUsd: Number(data.dailyBudgetUsd ?? data.budgetJournalier ?? 0) || 0,
    isCampaignActive: (data.isCampaignActive as boolean) ?? true,
    firestoreUpdatedAt: getSourceUpdatedAt(data),
  };
}

/** Supprime les doublons (ancien id = date seule, fc_*, etc.). */
export async function deleteFinancialConfigDuplicates(
  payload: FinancialConfigPayload,
  legacyDocId?: string
): Promise<void> {
  await prisma.financialConfig.deleteMany({
    where: {
      productId: payload.productId,
      dateEffet: payload.dateEffet,
      id: { not: payload.id },
    },
  });
  if (legacyDocId && legacyDocId !== payload.id) {
    await prisma.financialConfig.deleteMany({ where: { id: legacyDocId } });
  }
}

async function ensureProductExists(productId: string, defaultName: string): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    await prisma.product.create({
      data: {
        id: productId,
        title: defaultName || 'Produit Inconnu (Supprimé)',
        source: 'ponctuel',
      },
    });
  }
}

export async function upsertFinancialConfigRow(
  docId: string,
  data: Record<string, unknown>,
  docPath?: string
): Promise<void> {
  const payload = buildFinancialConfigPayload(docId, data, docPath);
  if (!payload) return;

  await ensureProductExists(payload.productId, `Produit ${payload.productId} (Restauré)`);

  await deleteFinancialConfigDuplicates(payload, docId);

  const { id, productId, dateEffet, ...rest } = payload;
  await prisma.financialConfig.upsert({
    where: { id },
    create: { id, productId, dateEffet, ...rest },
    update: { productId, dateEffet, ...rest },
  });
}

/** Corps API / formulaire Profitability → upsert PG. */
export function buildFinancialConfigFromApiBody(
  body: Record<string, unknown>
): FinancialConfigPayload | null {
  const productId = String(body.productId ?? '');
  if (!productId) return null;

  const dateEffet = parseDateEffet(
    (body.dateEffet as string) || new Date().toISOString().split('T')[0]
  );

  let id = typeof body.id === 'string' ? body.id : '';
  if (!id || id.startsWith('fc_')) {
    id = financialConfigStableId(productId, dateEffet);
  }

  return {
    id,
    productId,
    dateEffet,
    cau: Number(body.cau ?? 0) || 0,
    appro: Number(body.appro ?? 0) || 0,
    dailyBudgetUsd: Number(body.dailyBudgetUsd ?? 0) || 0,
    isCampaignActive: body.isCampaignActive !== false,
    firestoreUpdatedAt: null,
  };
}

export async function upsertFinancialConfigFromApi(
  body: Record<string, unknown>
): Promise<FinancialConfigPayload> {
  const payload = buildFinancialConfigFromApiBody(body);
  if (!payload) throw new Error('productId requis');

  await ensureProductExists(payload.productId, `Produit ${payload.productId}`);

  await deleteFinancialConfigDuplicates(payload);

  const { id, productId, dateEffet, ...rest } = payload;
  await prisma.financialConfig.upsert({
    where: { id },
    create: { id, productId, dateEffet, ...rest },
    update: { productId, dateEffet, ...rest },
  });

  return payload;
}

/** Pour scripts de comparaison. */
export function snapshotFromPayload(p: FinancialConfigPayload) {
  return {
    key: financialConfigKey(p.productId, p.dateEffet),
    cau: p.cau,
    appro: p.appro,
    dailyBudgetUsd: p.dailyBudgetUsd,
    isCampaignActive: p.isCampaignActive,
  };
}

export function snapshotsEqual(
  a: ReturnType<typeof snapshotFromPayload>,
  b: ReturnType<typeof snapshotFromPayload>
): boolean {
  return (
    a.cau === b.cau &&
    a.appro === b.appro &&
    a.dailyBudgetUsd === b.dailyBudgetUsd &&
    a.isCampaignActive === b.isCampaignActive
  );
}
