/**
 * Vérifie Total CA/Marge/ROI (Mois), objectifs et score vs dump Firestore.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { eachDayOfInterval, format, startOfMonth, endOfMonth, isBefore } from 'date-fns';
import { configEffectDate } from '../../utils/financialConfig.js';

const FINANCE_START = new Date('2026-03-05');
const MONTH = '2026-05';

function getConfigForDate(
  configs: { productId: string; dateEffet: string | null; updatedAt: Date | string; cau: number; appro: number }[],
  productId: string,
  date: string,
  useBroken: boolean
) {
  const valid = configs.filter((c) => {
    if (c.productId !== productId) return false;
    const effect = useBroken
      ? c.dateEffet || String(c.updatedAt).slice(0, 10)
      : configEffectDate(c);
    return effect && effect <= date;
  });
  valid.sort((a, b) => {
    const dA = useBroken ? a.dateEffet || String(a.updatedAt).slice(0, 10) : configEffectDate(a);
    const dB = useBroken ? b.dateEffet || String(b.updatedAt).slice(0, 10) : configEffectDate(b);
    return dB.localeCompare(dA);
  });
  return valid[0] ?? null;
}

function monthlyStats(
  products: { id: string }[],
  configs: Parameters<typeof getConfigForDate>[0],
  dailyEntries: { date: string; exchangeRate: number; entries: Record<string, { soldQty?: number; spendUsd?: number }> }[],
  useBroken: boolean
) {
  const days = eachDayOfInterval({
    start: startOfMonth(new Date(`${MONTH}-01`)),
    end: endOfMonth(new Date(`${MONTH}-01`)),
  });
  const productsWithData = products.filter((p) =>
    dailyEntries.some((e) => e.date.startsWith(MONTH) && e.entries[p.id])
  );
  let totalCA = 0;
  let totalAPPRO = 0;
  let totalPUB_CFA = 0;
  for (const product of productsWithData) {
    for (const day of days) {
      if (isBefore(day, FINANCE_START)) continue;
      const dateStr = format(day, 'yyyy-MM-dd');
      const config = getConfigForDate(configs, product.id, dateStr, useBroken);
      const entry = dailyEntries.find((e) => e.date === dateStr);
      const soldQty = entry?.entries[product.id]?.soldQty || 0;
      const spendUsd = entry?.entries[product.id]?.spendUsd || 0;
      const rate = entry?.exchangeRate || 600;
      totalCA += soldQty * (config?.cau || 0);
      totalAPPRO += soldQty * (config?.appro || 0);
      totalPUB_CFA += spendUsd * 1.18 * rate;
    }
  }
  const MARGE = totalCA - totalAPPRO - totalPUB_CFA;
  return { CA: totalCA, MARGE, ROI: totalPUB_CFA > 0 ? MARGE / totalPUB_CFA : 0, productsWithData: productsWithData.length };
}

async function main() {
  const dumpPath = resolve(process.cwd(), '..', 'colweyz_firebase_dump_2026-05-23.json');
  const dump = JSON.parse(readFileSync(dumpPath, 'utf-8')) as {
    products: { id: string }[];
    financial_configs: { productId: string; dateEffet?: string; updatedAt: string; id: string; cau: number; appro: number }[];
    daily_entries: { date: string; exchangeRate: number; entries: Record<string, { soldQty?: number; spendUsd?: number }> }[];
  };

  const dumpConfigs = dump.financial_configs.map((fc) => ({
    productId: fc.productId,
    dateEffet: fc.dateEffet || (fc.updatedAt ? `${fc.updatedAt.slice(0, 10)}#${fc.id}` : fc.id),
    updatedAt: fc.updatedAt,
    cau: fc.cau,
    appro: fc.appro,
  }));

  const prisma = new PrismaClient();
  const pgProducts = await prisma.product.findMany({ select: { id: true } });
  const pgConfigs = await prisma.financialConfig.findMany();
  const pgDaily = await prisma.dailyEntry.findMany();

  const dumpDaily = dump.daily_entries.map((e) => ({
    date: e.date,
    exchangeRate: e.exchangeRate,
    entries: e.entries as Record<string, { soldQty?: number; spendUsd?: number }>,
  }));
  const pgDailyNorm = pgDaily.map((e) => ({
    date: e.date,
    exchangeRate: e.exchangeRate,
    entries: e.entries as Record<string, { soldQty?: number; spendUsd?: number }>,
  }));

  console.log('\n=== Total CA / Marge / ROI (Mois) — mai 2026 ===\n');
  console.log('Dump + configs cassées (ancien bug dateEffet):', monthlyStats(dump.products, dumpConfigs, dumpDaily, true));
  console.log('Dump + configs corrigées:', monthlyStats(dump.products, dumpConfigs, dumpDaily, false));
  console.log('PG + configs cassées:', monthlyStats(pgProducts, pgConfigs, pgDailyNorm, true));
  console.log('PG + configs corrigées (app actuelle):', monthlyStats(pgProducts, pgConfigs, pgDailyNorm, false));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
