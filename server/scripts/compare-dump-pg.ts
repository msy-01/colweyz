/**
 * Compare un export JSON Firestore avec PostgreSQL (IDs + effectifs).
 * Usage: cd server && npx tsx scripts/compare-dump-pg.ts [dump.json]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const DUMP =
  process.argv[2] ||
  path.join(process.cwd(), '..', 'colweyz_firebase_dump_2026-05-23.json');

const prisma = new PrismaClient();

function toSet(arr: unknown[], fn: (x: Record<string, unknown>) => string): Set<string> {
  return new Set(
    (arr || [])
      .map((x) => fn(x as Record<string, unknown>))
      .filter(Boolean)
  );
}

function onlyIn(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x));
}

async function main() {
  if (!fs.existsSync(DUMP)) {
    console.error('Fichier introuvable:', DUMP);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(DUMP, 'utf8')) as Record<string, unknown>;
  const stockLiv =
    (data.stockLivreurs as unknown[])?.length
      ? (data.stockLivreurs as unknown[])
      : (data.stock_livreurs as unknown[]);

  const [
    pgOrders,
    pgDrivers,
    pgZones,
    pgUsers,
    pgFr,
    pgProducts,
    pgStockLiv,
    pgStockOp,
    pgPo,
    pgDaily,
    pgFc,
    pgConfig,
  ] = await Promise.all([
    prisma.order.findMany({ select: { id: true } }),
    prisma.driver.findMany({ select: { id: true } }),
    prisma.zone.findMany({ select: { id: true } }),
    prisma.systemUser.findMany({ select: { id: true } }),
    prisma.fundRequest.findMany({ select: { id: true } }),
    prisma.product.findMany({ select: { id: true } }),
    prisma.stockLivreur.findMany({ select: { id: true } }),
    prisma.stockOperation.findMany({ select: { id: true } }),
    prisma.purchaseOrder.findMany({ select: { id: true } }),
    prisma.dailyEntry.findMany({ select: { date: true } }),
    prisma.financialConfig.findMany({ select: { productId: true, dateEffet: true } }),
    prisma.appConfig.findMany({ select: { key: true } }),
  ]);

  const fcDump = (data.financial_configs as Record<string, unknown>[]) || [];
  const fcDumpKeys = toSet(fcDump, (x) => {
    const pid = String(x.productId || x.product_id || '');
    const date = String(x.dateEffet || x.date_effet || x.date || '');
    return `${pid}|${date}`;
  });
  const fcPgKeys = new Set(pgFc.map((x) => `${x.productId}|${x.dateEffet ?? ''}`));

  const configRaw = data.config;
  const configDumpArr = Array.isArray(configRaw)
    ? configRaw
    : Object.entries((configRaw as Record<string, unknown>) || {}).map(([key, value]) => ({
        key,
        value,
      }));
  const configDumpKeys = toSet(configDumpArr, (x) => String(x.key || x.id || ''));

  const checks = [
    {
      label: 'orders',
      dumpN: (data.orders as unknown[])?.length || 0,
      dumpIds: toSet((data.orders as unknown[]) || [], (x) => String(x.id)),
      pgIds: new Set(pgOrders.map((x) => x.id)),
    },
    {
      label: 'drivers',
      dumpN: (data.drivers as unknown[])?.length || 0,
      dumpIds: toSet((data.drivers as unknown[]) || [], (x) => String(x.id)),
      pgIds: new Set(pgDrivers.map((x) => x.id)),
    },
    {
      label: 'zones',
      dumpN: (data.zones as unknown[])?.length || 0,
      dumpIds: toSet((data.zones as unknown[]) || [], (x) => String(x.id)),
      pgIds: new Set(pgZones.map((x) => x.id)),
    },
    {
      label: 'users',
      dumpN: (data.users as unknown[])?.length || 0,
      dumpIds: toSet((data.users as unknown[]) || [], (x) => String(x.id)),
      pgIds: new Set(pgUsers.map((x) => x.id)),
    },
    {
      label: 'fund_requests',
      dumpN: (data.fund_requests as unknown[])?.length || 0,
      dumpIds: toSet((data.fund_requests as unknown[]) || [], (x) => String(x.id)),
      pgIds: new Set(pgFr.map((x) => x.id)),
    },
    {
      label: 'products',
      dumpN: (data.products as unknown[])?.length || 0,
      dumpIds: toSet((data.products as unknown[]) || [], (x) => String(x.id)),
      pgIds: new Set(pgProducts.map((x) => x.id)),
    },
    {
      label: 'stockLivreurs',
      dumpN: stockLiv?.length || 0,
      dumpIds: toSet(stockLiv || [], (x) =>
        String(x.id || `${x.livreurId}_${x.produitId}`)
      ),
      pgIds: new Set(pgStockLiv.map((x) => x.id)),
    },
    {
      label: 'stock_operations',
      dumpN: (data.stock_operations as unknown[])?.length || 0,
      dumpIds: toSet((data.stock_operations as unknown[]) || [], (x) => String(x.id)),
      pgIds: new Set(pgStockOp.map((x) => x.id)),
    },
    {
      label: 'purchase_orders',
      dumpN: (data.purchase_orders as unknown[])?.length || 0,
      dumpIds: toSet((data.purchase_orders as unknown[]) || [], (x) => String(x.id)),
      pgIds: new Set(pgPo.map((x) => x.id)),
    },
    {
      label: 'daily_entries',
      dumpN: (data.daily_entries as unknown[])?.length || 0,
      dumpIds: toSet((data.daily_entries as unknown[]) || [], (x) =>
        String(x.date || x.id)
      ),
      pgIds: new Set(pgDaily.map((x) => x.date)),
    },
    {
      label: 'financial_configs',
      dumpN: fcDump.length,
      dumpIds: fcDumpKeys,
      pgIds: fcPgKeys,
    },
    {
      label: 'config',
      dumpN: configDumpKeys.size,
      dumpIds: configDumpKeys,
      pgIds: new Set(pgConfig.map((x) => x.key)),
    },
  ];

  console.log('\n=== COMPARAISON DUMP vs PostgreSQL ===');
  console.log('Fichier:', DUMP);
  console.log('');

  let misaligned = 0;
  for (const c of checks) {
    const onlyDump = onlyIn(c.dumpIds, c.pgIds);
    const onlyPg = onlyIn(c.pgIds, c.dumpIds);
    const ok = onlyDump.length === 0 && onlyPg.length === 0;
    if (!ok) misaligned++;
    const delta = c.pgIds.size - c.dumpN;
    console.log(
      `${c.label.padEnd(22)} dump=${String(c.dumpN).padStart(5)}  pg=${String(c.pgIds.size).padStart(5)}  Δ=${delta >= 0 ? '+' : ''}${delta}  ${ok ? 'OK' : 'ECART'}`
    );
    if (onlyDump.length) {
      console.log(`  uniquement dump (${onlyDump.length}):`, onlyDump.slice(0, 10).join(', '));
      if (onlyDump.length > 10) console.log(`    ... +${onlyDump.length - 10} autres`);
    }
    if (onlyPg.length) {
      console.log(`  uniquement PG (${onlyPg.length}):`, onlyPg.slice(0, 10).join(', '));
      if (onlyPg.length > 10) console.log(`    ... +${onlyPg.length - 10} autres`);
    }
  }

  // _syncSource dans dump
  console.log('\n=== _syncSource=postgres dans le dump (reverse sync a touché Firestore) ===');
  for (const name of ['orders', 'drivers', 'products', 'fund_requests'] as const) {
    const arr = (data[name] as Record<string, unknown>[]) || [];
    const n = arr.filter((x) => x._syncSource === 'postgres').length;
    if (arr.length) console.log(`  ${name}: ${n}/${arr.length}`);
  }

  console.log('\n=== Collections présentes dans le dump mais absentes du schéma PG ===');
  for (const k of ['user_preferences', 'logs_ajustements', 'adhoc_products', 'campagnes']) {
    const v = data[k];
    const n = Array.isArray(v) ? v.length : v ? 1 : 0;
    console.log(`  ${k}: ${n}`);
  }

  // financial_configs detail
  if (fcDump.length) {
    const sample = fcDump[0];
    console.log('\n=== financial_configs (échantillon dump) ===');
    console.log(JSON.stringify(sample, null, 2).slice(0, 400));
    const missingProduct = fcDump.filter((x) => {
      const pid = String(x.productId || x.product_id || '');
      return !pgProducts.some((p) => p.id === pid);
    }).length;
    console.log(`Configs dump sans produit en PG: ${missingProduct}/${fcDump.length}`);
  }

  console.log(`\nRésumé: ${checks.length - misaligned}/${checks.length} collections alignées par ID\n`);
  process.exit(misaligned > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
