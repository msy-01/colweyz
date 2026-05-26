/**
 * Vérifie OBJECTIF TOTAL, SCORE, et totaux période vs dump/PG.
 * Usage: npx tsx scripts/verify-profitability-range.ts [start] [end]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import {
  eachDayOfInterval,
  format,
  parseISO,
  isWithinInterval,
  startOfDay,
  endOfDay,
  isBefore,
} from 'date-fns';

const FINANCE_START = new Date('2026-03-05');
const RANGE_START = process.argv[2] || '2026-05-01';
const RANGE_END = process.argv[3] || '2026-05-22';

function parseDateEffet(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(raw).slice(0, 10);
}

function configEffectDate(c: { dateEffet?: string | null; updatedAt: Date | string }): string {
  const from = parseDateEffet(c.dateEffet);
  if (from) return from;
  const s = typeof c.updatedAt === 'string' ? c.updatedAt : c.updatedAt.toISOString();
  return s.slice(0, 10);
}

function getConfigForDate(
  configs: { productId: string; dateEffet: string | null; updatedAt: Date | string; cau: number; appro: number; dailyBudgetUsd: number }[],
  productId: string,
  date: string,
  broken: boolean
) {
  const valid = configs.filter((c) => {
    if (c.productId !== productId) return false;
    const effect = broken
      ? c.dateEffet || String(c.updatedAt).slice(0, 10)
      : configEffectDate(c);
    return effect && effect <= date;
  });
  valid.sort((a, b) => {
    const dA = broken ? a.dateEffet || String(a.updatedAt).slice(0, 10) : configEffectDate(a);
    const dB = broken ? b.dateEffet || String(b.updatedAt).slice(0, 10) : configEffectDate(b);
    if (dA !== dB) return dB.localeCompare(dA);
    const tA = typeof a.updatedAt === 'string' ? new Date(a.updatedAt).getTime() : a.updatedAt.getTime();
    const tB = typeof b.updatedAt === 'string' ? new Date(b.updatedAt).getTime() : b.updatedAt.getTime();
    return tB - tA;
  });
  return valid[0] ?? null;
}

function normaliser(str: string): string {
  return (str ?? '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isDeltaPaid(o: Record<string, unknown>): boolean {
  const pStatus = String(o.paymentStatus || o.statusPaiement || '').toLowerCase();
  if (pStatus === 'payé' || pStatus === 'paid') return true;
  const reg = String(
    o.paiementProduit ?? o.regionalPaymentStatus ?? o.payment_product ?? ''
  ).toLowerCase();
  return reg === 'payé' || reg === 'paid' || reg === 'paye';
}

function getOrderDate(o: Record<string, unknown>, isDelta: boolean): string {
  if (isDelta) {
    return String(o.datePaiement || o.paiementAt || o.dateAttribution || o.assignedAt || '').split('T')[0];
  }
  return String(o.dateAttribution || o.assignedAt || '').split('T')[0];
}

async function main() {
  const prisma = new PrismaClient();
  const dump = JSON.parse(
    readFileSync(resolve(process.cwd(), '..', 'colweyz_firebase_dump_2026-05-23.json'), 'utf-8')
  ) as { orders: Record<string, unknown>[] };

  const products = await prisma.product.findMany();
  const configs = await prisma.financialConfig.findMany();
  const dailyEntries = await prisma.dailyEntry.findMany();
  const zones = await prisma.zone.findMany();
  const orders = await prisma.order.findMany();

  const activeAtEnd = products.filter((p) => {
    const cfg = getConfigForDate(configs, p.id, RANGE_END, false);
    return cfg?.isCampaignActive === true;
  });

  const rangeStart = parseISO(RANGE_START);
  const rangeEnd = parseISO(RANGE_END);
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

  let pointMort = 0;
  let realSales = 0;
  let viewCA = 0;

  for (const product of activeAtEnd) {
    for (const day of days) {
      if (isBefore(day, FINANCE_START)) continue;
      const dateStr = format(day, 'yyyy-MM-dd');
      const config = getConfigForDate(configs, product.id, dateStr, false);
      if (!config) continue;
      const rate = dailyEntries.find((e) => e.date === dateStr)?.exchangeRate ?? 600;
      const entry = dailyEntries.find((e) => e.date === dateStr);
      const sold = (entry?.entries as Record<string, { soldQty?: number; spendUsd?: number }>)?.[product.id]
        ?.soldQty ?? 0;
      const spend = (entry?.entries as Record<string, { soldQty?: number; spendUsd?: number }>)?.[product.id]
        ?.spendUsd ?? 0;
      const marginUnit = config.cau - config.appro;
      const pubCfa = (config.dailyBudgetUsd || 0) * 1.18 * rate;
      pointMort += marginUnit > 0 ? Math.ceil(pubCfa / marginUnit) : 0;
      viewCA += sold * config.cau;
    }
  }

  const activeIds = new Set(activeAtEnd.map((p) => p.id));
  const regionalStatuses = new Set([
    'regional_en_attente',
    'regional_contacte',
    'regional_relance',
    'regional_injoignable',
    'regional_injoignable_x2',
    'regional_injoignable_x3',
    'expedition_en_cours',
    'expedition_livree',
    'regional_annule',
    'regional_reporte',
  ]);

  for (const o of orders) {
    const zone = zones.find((z) => z.id === o.zoneId);
    const isDelta =
      regionalStatuses.has(o.status) ||
      isDeltaPaid(o) ||
      (zone?.type === 'regional');
    const d = getOrderDate(o as Record<string, unknown>, isDelta);
    if (!d) continue;
    const dateObj = parseISO(d);
    if (isBefore(dateObj, FINANCE_START)) continue;
    if (!isWithinInterval(dateObj, { start: startOfDay(rangeStart), end: endOfDay(rangeEnd) })) continue;

    const status = o.status.toLowerCase();
    let qty = 0;
    if (o.productId && activeIds.has(o.productId) && (status === 'livré' || status === 'terminé')) {
      qty = 1;
    }
    if (qty > 0) realSales += qty;
  }

  // Diff mensuel jour par jour (configs cassées vs corrigées) sur jours avec ventes
  let caBroken = 0;
  let caFixed = 0;
  const monthDays = eachDayOfInterval({
    start: parseISO(`${RANGE_START.slice(0, 7)}-01`),
    end: parseISO(`${RANGE_END.slice(0, 7)}-28`),
  });
  const month = RANGE_START.slice(0, 7);
  const pwd = products.filter((p) =>
    dailyEntries.some((e) => e.date.startsWith(month) && (e.entries as Record<string, unknown>)?.[p.id])
  );
  for (const product of pwd) {
    for (const day of monthDays) {
      if (isBefore(day, FINANCE_START)) continue;
      const ds = format(day, 'yyyy-MM-dd');
      const entry = dailyEntries.find((e) => e.date === ds);
      const sold = (entry?.entries as Record<string, { soldQty?: number }>)?.[product.id]?.soldQty || 0;
      if (!sold) continue;
      const cb = getConfigForDate(configs, product.id, ds, true);
      const cf = getConfigForDate(configs, product.id, ds, false);
      caBroken += sold * (cb?.cau || 0);
      caFixed += sold * (cf?.cau || 0);
    }
  }

  console.log(`\n=== Période ${RANGE_START} → ${RANGE_END} ===\n`);
  console.log('Campagnes actives (fin période):', activeAtEnd.length);
  console.log('OBJECTIF TOTAL (point mort cumulé):', pointMort);
  console.log('RÉALISÉ campagnes (livré/terminé, simplifié):', realSales);
  console.log('SCORE (réalisé - objectif):', realSales - pointMort);
  console.log('CA saisie période (soldQty × CAU):', viewCA);
  console.log('\n=== Écart CA mensuel (jours avec ventes > 0) ===');
  console.log('CA configs cassées:', caBroken);
  console.log('CA configs corrigées:', caFixed);
  console.log('Δ:', caFixed - caBroken);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
