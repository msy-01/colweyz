/**
 * daily_entries / daily_finance — clé métier = date YYYY-MM-DD
 */
export function parseFinanceDate(raw: unknown): string | null {
  if (raw == null) return null;
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Date canonique : body.date prioritaire, sinon docId. */
export function resolveFinanceDate(docId: string, data: Record<string, unknown>): string | null {
  const fromData = parseFinanceDate(data.date);
  const fromDocId = parseFinanceDate(docId);
  return fromData || fromDocId;
}

export function stripSyncMeta(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  delete out._syncSource;
  delete out.updatedAt;
  delete out.createdAt;
  return out;
}

export type DailyEntrySnapshot = {
  exchangeRate: number;
  entries: Record<string, { soldQty: number; spendUsd: number }>;
  productOrder: string[];
};

export function normalizeDailyEntrySnapshot(data: Record<string, unknown>): DailyEntrySnapshot {
  const entriesRaw = (data.entries ?? {}) as Record<string, unknown>;
  const entries: Record<string, { soldQty: number; spendUsd: number }> = {};

  for (const [pid, val] of Object.entries(entriesRaw)) {
    if (val == null || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    entries[pid] = {
      soldQty: Number(v.soldQty ?? v.sold_qty ?? 0) || 0,
      spendUsd: Number(v.spendUsd ?? v.spend_usd ?? 0) || 0,
    };
  }

  const productOrder = Array.isArray(data.productOrder)
    ? data.productOrder.map(String)
    : Array.isArray(data.product_order)
      ? (data.product_order as unknown[]).map(String)
      : [];

  return {
    exchangeRate: Number(data.exchangeRate ?? data.exchange_rate ?? 600) || 600,
    entries,
    productOrder,
  };
}

export type DailyFinanceSnapshot = {
  otherRevenues: { id: string; label: string; amount: number }[];
  otherExpenses: { id: string; label: string; amount: number }[];
};

function normalizeFinanceLines(items: unknown): { id: string; label: string; amount: number }[] {
  const arr = Array.isArray(items) ? items : [];
  return arr
    .map((item) => {
      const i = item as Record<string, unknown>;
      return {
        id: String(i.id ?? ''),
        label: String(i.label ?? ''),
        amount: Number(i.amount ?? 0) || 0,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id) || a.label.localeCompare(b.label));
}

export function normalizeDailyFinanceSnapshot(data: Record<string, unknown>): DailyFinanceSnapshot {
  return {
    otherRevenues: normalizeFinanceLines(data.otherRevenues ?? data.other_revenues),
    otherExpenses: normalizeFinanceLines(data.otherExpenses ?? data.other_expenses),
  };
}

export function dailyEntrySnapshotsEqual(a: DailyEntrySnapshot, b: DailyEntrySnapshot): boolean {
  if (a.exchangeRate !== b.exchangeRate) return false;
  if (JSON.stringify(a.productOrder) !== JSON.stringify(b.productOrder)) return false;
  const keysA = Object.keys(a.entries).sort();
  const keysB = Object.keys(b.entries).sort();
  if (keysA.join('|') !== keysB.join('|')) return false;
  for (const k of keysA) {
    if (a.entries[k].soldQty !== b.entries[k].soldQty) return false;
    if (a.entries[k].spendUsd !== b.entries[k].spendUsd) return false;
  }
  return true;
}

export function dailyFinanceSnapshotsEqual(a: DailyFinanceSnapshot, b: DailyFinanceSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Frais pub (CFA) — même formule que Finance.tsx : spendUsd × 1.18 × taux. */
export function computeFraisPub(snapshot: DailyEntrySnapshot): number {
  let total = 0;
  for (const data of Object.values(snapshot.entries)) {
    total += (data.spendUsd || 0) * 1.18 * snapshot.exchangeRate;
  }
  return Math.round(total);
}

export function sumOtherRevenues(s: DailyFinanceSnapshot): number {
  return s.otherRevenues.reduce((sum, i) => sum + i.amount, 0);
}

export function sumOtherExpenses(s: DailyFinanceSnapshot): number {
  return s.otherExpenses.reduce((sum, i) => sum + i.amount, 0);
}
