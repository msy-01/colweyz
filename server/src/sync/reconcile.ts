/**
 * Compare les comptages PostgreSQL avec sync_state (post-seed).
 * Usage: npm run reconcile
 */
import 'dotenv/config';
import { prisma } from '../lib/prisma.js';

const TABLE_COUNTS: { label: string; count: () => Promise<number> }[] = [
  { label: 'zones', count: () => prisma.zone.count() },
  { label: 'drivers', count: () => prisma.driver.count() },
  { label: 'users', count: () => prisma.systemUser.count() },
  { label: 'orders', count: () => prisma.order.count() },
  { label: 'products', count: () => prisma.product.count() },
  { label: 'fund_requests', count: () => prisma.fundRequest.count() },
  { label: 'stockLivreurs', count: () => prisma.stockLivreur.count() },
  { label: 'stock_operations', count: () => prisma.stockOperation.count() },
  { label: 'financial_configs', count: () => prisma.financialConfig.count() },
  { label: 'daily_entries', count: () => prisma.dailyEntry.count() },
  { label: 'daily_finance', count: () => prisma.dailyFinance.count() },
  { label: 'purchase_orders', count: () => prisma.purchaseOrder.count() },
  { label: 'accounting_entries', count: () => prisma.accountingEntry.count() },
  { label: 'settings', count: () => prisma.appSettings.count() },
  { label: 'config', count: () => prisma.appConfig.count() },
  { label: 'claude_analysis', count: () => prisma.claudeAnalysis.count() },
];

async function main() {
  console.log('\n📊 Réconciliation PostgreSQL ↔ sync_state\n');
  console.log('Collection'.padEnd(24), 'PG'.padStart(8), 'sync_state'.padStart(12), 'Écart');
  console.log('─'.repeat(52));

  let hasGap = false;

  for (const { label, count } of TABLE_COUNTS) {
    const pgCount = await count();
    const state = await prisma.syncState.findUnique({ where: { collectionName: label } });
    const stateCount = state?.documentsCount ?? null;
    const gap = stateCount !== null ? pgCount - stateCount : null;
    const gapStr = gap === null ? '—' : gap === 0 ? '✓' : String(gap);

    if (gap !== null && gap !== 0) hasGap = true;

    console.log(
      label.padEnd(24),
      String(pgCount).padStart(8),
      (stateCount !== null ? String(stateCount) : '—').padStart(12),
      gapStr.padStart(8)
    );
  }

  console.log('─'.repeat(52));

  if (hasGap) {
    console.log('\n⚠️  Écarts détectés — relancez le seed ou vérifiez les imports partiels.\n');
    process.exit(1);
  }

  console.log('\n✅ Comptages cohérents\n');
}

main()
  .catch((e) => {
    console.error('❌ Réconciliation échouée:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
