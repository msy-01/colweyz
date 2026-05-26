import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const DUMP = path.join(process.cwd(), '..', 'colweyz_firebase_dump_2026-05-23.json');
const prisma = new PrismaClient();

async function main() {
  const d = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
  const fc = d.financial_configs || [];
  console.log('financial_configs avec dateEffet:', fc.filter((x: { dateEffet?: string }) => x.dateEffet).length);
  console.log('financial_configs sans dateEffet:', fc.filter((x: { dateEffet?: string }) => !x.dateEffet).length);

  for (const id of ['2026-05-22', '#CW84890']) {
    const o = await prisma.order.findUnique({ where: { id } });
    console.log(`order ${id}:`, o ? { date: o.date, status: o.status, updatedAt: o.updatedAt } : 'absent');
  }

  const dr = await prisma.driver.findUnique({ where: { id: 'depot_delta' } });
  console.log('driver depot_delta:', dr ? { name: dr.name } : null);

  const ss = await prisma.syncState.findMany({ orderBy: { collectionName: 'asc' } });
  console.log('\nSyncState (' + ss.length + '):');
  for (const s of ss) {
    console.log(`  ${s.collectionName}: count=${s.documentsCount} last=${s.lastSyncedAt.toISOString().slice(0, 19)}`);
  }

  const dumpOrder = d.orders.find((x: { id: string }) => x.id === '#CW84873') || d.orders[0];
  const pgOrder = await prisma.order.findUnique({ where: { id: dumpOrder.id } });
  if (pgOrder) {
    const fields = ['status', 'amount', 'clientName', 'zoneId', 'driverId', 'regionalPaymentStatus'] as const;
    let diffs = 0;
    for (const f of fields) {
      if (String(dumpOrder[f] ?? '') !== String((pgOrder as Record<string, unknown>)[f] ?? '')) {
        console.log(`  field diff ${f}: dump=${dumpOrder[f]} pg=${(pgOrder as Record<string, unknown>)[f]}`);
        diffs++;
      }
    }
    console.log(`Sample order ${dumpOrder.id}: ${diffs} field diffs`);
  }

  const missingOps = [
    'op-1779448343375-f1p08hqu7',
    'op-1779464876236-75lv5jfop',
  ];
  for (const id of missingOps) {
    const op = d.stock_operations.find((x: { id: string }) => x.id === id);
    const pg = await prisma.stockOperation.findUnique({ where: { id } });
    const prod = op?.productId
      ? await prisma.product.findUnique({ where: { id: op.productId } })
      : null;
    console.log(`stock_op ${id}: in PG=${!!pg} product=${op?.productId} productExists=${!!prod}`);
  }

  const pgOnlyConfig = await prisma.appConfig.findMany({
    where: { key: { contains: '_deliveries_' } },
    take: 5,
    select: { key: true },
  });
  console.log('\nExemples config PG-only (UI prefs):', pgOnlyConfig.map((x) => x.key));
}

main()
  .finally(() => prisma.$disconnect());
