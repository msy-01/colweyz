/**
 * Compare les champs métier des enregistrements communs (dump ∩ PG).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const DUMP = path.join(process.cwd(), '..', 'colweyz_firebase_dump_2026-05-23.json');
const prisma = new PrismaClient();

const ORDER_FIELDS = [
  'status',
  'amount',
  'clientName',
  'zoneId',
  'driverId',
  'regionalPaymentStatus',
  'shippingFee',
] as const;

async function compareOrders() {
  const data = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
  const dumpOrders = data.orders as Record<string, unknown>[];
  const pgOrders = await prisma.order.findMany();
  const pgById = new Map(pgOrders.map((o) => [o.id, o]));

  let common = 0;
  let mismatches = 0;
  const mismatchSamples: string[] = [];

  for (const d of dumpOrders) {
    const id = String(d.id);
    const p = pgById.get(id);
    if (!p) continue;
    common++;
    for (const f of ORDER_FIELDS) {
      const dv = d[f];
      const pv = (p as Record<string, unknown>)[f];
      const ds = dv === null || dv === undefined ? '' : String(dv);
      const ps = pv === null || pv === undefined ? '' : String(pv);
      if (ds !== ps) {
        mismatches++;
        if (mismatchSamples.length < 15) {
          mismatchSamples.push(`${id}.${f}: dump=${ds} pg=${ps}`);
        }
      }
    }
  }

  console.log(`Orders communs: ${common}`);
  console.log(`Différences de champs (total): ${mismatches}`);
  if (mismatchSamples.length) {
    console.log('Exemples:');
    mismatchSamples.forEach((s) => console.log(' ', s));
  }
}

async function compareFundRequests() {
  const data = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
  const dumpFr = data.fund_requests as Record<string, unknown>[];
  const pgFr = await prisma.fundRequest.findMany();
  const pgById = new Map(pgFr.map((x) => [x.id, x]));
  let statusDiff = 0;
  for (const d of dumpFr) {
    const p = pgById.get(String(d.id));
    if (p && String(d.status) !== p.status) statusDiff++;
  }
  console.log(`\nFund requests: ${dumpFr.length} dump, status diff: ${statusDiff}`);
}

main()
  .then(() => compareOrders())
  .then(() => compareFundRequests())
  .finally(() => prisma.$disconnect());
