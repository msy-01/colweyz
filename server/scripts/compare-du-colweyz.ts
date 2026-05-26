/**
 * Compare « Dû à Colweyz » (logique Deliveries / Balances) : PG vs dump Firestore.
 * Usage: npx tsx scripts/compare-du-colweyz.ts [dump.json]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  paymentMethodFromFirestore,
  modePaiementFromPaymentMethod,
} from '../src/lib/payment-method.js';

const DUMP =
  process.argv[2] ||
  path.join(process.cwd(), '..', 'colweyz_firebase_dump_2026-05-26.json');

const prisma = new PrismaClient();

function isCash(o: {
  modePaiement?: string;
  paymentMethod?: string | null;
}): boolean {
  const mp = o.modePaiement ?? modePaiementFromPaymentMethod(o.paymentMethod);
  return (
    mp === 'Espèces' ||
    (!mp && (o.paymentMethod === 'cash' || !o.paymentMethod))
  );
}

function debtDeliveriesSourceCode(
  orders: {
    status: string;
    amount: number | null;
    remuneration: number | null;
    modePaiement?: string;
    paymentMethod?: string | null;
  }[],
  initialBalance: number
) {
  const rel = orders.filter(
    (o) => o.status === 'livré' || o.status === 'terminé'
  );
  const totalCash = rel.filter(isCash).reduce((s, o) => s + (o.amount ?? 0), 0);
  const totalRemun = rel.reduce((s, o) => s + (o.remuneration ?? 0), 0);
  const balance = (initialBalance + totalRemun) - totalCash;
  return {
    relN: rel.length,
    cashOrders: rel.filter(isCash).length,
    totalCash,
    totalRemun,
    initialBalance,
    due: balance < 0 ? Math.abs(balance) : 0,
  };
}

function debtDeliveriesPages(
  orders: {
    status: string;
    amount: number | null;
    remuneration: number | null;
    modePaiement?: string;
    paymentMethod?: string | null;
  }[]
) {
  const rel = orders.filter((o) =>
    ['livré', 'terminé', 'expedition_livree'].includes(o.status)
  );
  const totalCash = rel.filter(isCash).reduce((s, o) => s + (o.amount ?? 0), 0);
  const totalRemun = rel.reduce((s, o) => s + (o.remuneration ?? 0), 0);
  return {
    relN: rel.length,
    due: Math.max(0, totalCash - totalRemun),
    totalCash,
    totalRemun,
  };
}

function parseOrderDate(o: Record<string, unknown>): Date | null {
  const s = String(o.deliveredAt || o.assignedAt || o.date || '');
  if (!s) return null;
  const d = new Date(s.split('T')[0]);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8')) as {
    orders?: Record<string, unknown>[];
  };
  const drivers = await prisma.driver.findMany();
  const initial = drivers.reduce((s, d) => s + (d.initialBalance || 0), 0);
  const pgOrders = await prisma.order.findMany();

  const pgApi = pgOrders.map((o) => ({
    status: o.status,
    amount: o.amount,
    remuneration: o.remuneration,
    paymentMethod: o.paymentMethod,
    modePaiement: modePaiementFromPaymentMethod(o.paymentMethod),
  }));

  const pgFixed = pgOrders.map((o) => {
    const row = dump.orders?.find((x) => x.id === o.id);
    const pm = row ? paymentMethodFromFirestore(row) : o.paymentMethod;
    return {
      status: o.status,
      amount: o.amount,
      remuneration: o.remuneration,
      paymentMethod: pm,
      modePaiement:
        (row?.modePaiement as string) || modePaiementFromPaymentMethod(pm),
    };
  });

  const fsFromDump = (dump.orders || []).map((o) => ({
    status: String(o.status ?? ''),
    amount: Number(o.amount ?? 0),
    remuneration: Number(o.remuneration ?? 0),
    paymentMethod: paymentMethodFromFirestore(o),
    modePaiement:
      (o.modePaiement as string) ||
      modePaiementFromPaymentMethod(paymentMethodFromFirestore(o)),
  }));

  console.log('\n=== Dû à Colweyz — diagnostic ===\n');
  console.log('initialBalance (tous livreurs):', initial);
  console.log('\n1) PG actuel (API: paymentMethod seul, null → compté espèces)');
  console.log(debtDeliveriesSourceCode(pgApi, initial));
  console.log('\n2) PG corrigé (modePaiement depuis dump)');
  console.log(debtDeliveriesSourceCode(pgFixed, initial));
  console.log('\n3) Firestore (dump live)');
  console.log(debtDeliveriesSourceCode(fsFromDump, initial));
  console.log('\n4) Variante pages/Deliveries (sans initial, +expedition_livree)');
  console.log({ pgApi: debtDeliveriesPages(pgApi), firestore: debtDeliveriesPages(fsFromDump) });

  const nullPm = pgOrders.filter(
    (o) => !o.paymentMethod && ['livré', 'terminé'].includes(o.status)
  );
  let waveN = 0;
  let waveAmt = 0;
  for (const o of nullPm) {
    const row = dump.orders?.find((x) => x.id === o.id);
    if (row?.modePaiement === 'Wave' || row?.modePaiement === 'OM') {
      waveN++;
      waveAmt += o.amount ?? 0;
    }
  }
  console.log('\n5) Cause probable: livré/terminé avec paymentMethod=null en PG mais Wave/OM dans FS:');
  console.log({ count: waveN, amountMisclassifiedAsCash: waveAmt });

  // Période du jour (comme filtre Livraisons par défaut)
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const inRange = (o: Record<string, unknown>) => {
    const d = parseOrderDate(o);
    return d && d >= start && d <= end;
  };
  const pgApiToday = pgOrders.filter((o) => inRange(o as unknown as Record<string, unknown>)).map((o) => ({
    status: o.status,
    amount: o.amount,
    remuneration: o.remuneration,
    paymentMethod: o.paymentMethod,
    modePaiement: modePaiementFromPaymentMethod(o.paymentMethod),
  }));
  const fsToday = (dump.orders || [])
    .filter((o) => inRange(o))
    .map((o) => ({
      status: String(o.status ?? ''),
      amount: Number(o.amount ?? 0),
      remuneration: Number(o.remuneration ?? 0),
      paymentMethod: paymentMethodFromFirestore(o),
      modePaiement:
        (o.modePaiement as string) ||
        modePaiementFromPaymentMethod(paymentMethodFromFirestore(o)),
    }));

  console.log(`\n6) Aujourd'hui seulement (${start.toISOString().slice(0, 10)}) — pages/Deliveries (période, sans initial):`);
  console.log({
    pgApi: debtDeliveriesPages(pgApiToday),
    firestore: debtDeliveriesPages(fsToday),
  });
  console.log("\n7) Aujourd'hui — source_code/Deliveries (global debt, avec initial):");
  console.log({
    pgApi: debtDeliveriesSourceCode(pgApiToday, initial),
    firestore: debtDeliveriesSourceCode(fsToday, initial),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
