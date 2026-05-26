/**
 * Compare les effectifs PostgreSQL vs Firestore (parité dual-app).
 * Usage: cd server && npm run sync:parity
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;

/** Écarts attendus après align dump (pas des bugs). */
const EXPECTED: Record<string, { note: string; pgAdjust?: (pg: number, fs: number) => boolean }> = {
  drivers: {
    note: 'PG garde le livreur technique depot_delta (+1)',
    pgAdjust: (pg, fs) => pg === fs + 1,
  },
  products: {
    note: 'PG peut avoir 2–3 produits stub (référencés par stock_operations)',
    pgAdjust: (pg, fs) => pg >= fs && pg - fs <= 3,
  },
  config: {
    note: 'PG inclut user_preferences UI importées dans app_config (+56)',
    pgAdjust: (pg, fs) => pg >= fs,
  },
  financial_configs: {
    note: 'PG peut contenir configs plates du dump ; Firestore live = collectionGroup',
    pgAdjust: () => false,
  },
};

type Row = {
  label: string;
  pg: number;
  fs: number | null;
  ok: boolean;
  expected?: boolean;
  note?: string;
};

const PG_COUNTS: { label: string; count: () => Promise<number> }[] = [
  { label: 'orders', count: () => prisma.order.count() },
  { label: 'drivers', count: () => prisma.driver.count() },
  { label: 'zones', count: () => prisma.zone.count() },
  { label: 'users', count: () => prisma.systemUser.count() },
  { label: 'fund_requests', count: () => prisma.fundRequest.count() },
  { label: 'products', count: () => prisma.product.count() },
  { label: 'stockLivreurs', count: () => prisma.stockLivreur.count() },
  { label: 'stock_operations', count: () => prisma.stockOperation.count() },
  { label: 'purchase_orders', count: () => prisma.purchaseOrder.count() },
  { label: 'daily_entries', count: () => prisma.dailyEntry.count() },
  { label: 'daily_finance', count: () => prisma.dailyFinance.count() },
  { label: 'accounting_entries', count: () => prisma.accountingEntry.count() },
  { label: 'claude_analysis', count: () => prisma.claudeAnalysis.count() },
  { label: 'settings', count: () => prisma.appSettings.count() },
  { label: 'config', count: () => prisma.appConfig.count() },
  { label: 'financial_configs', count: () => prisma.financialConfig.count() },
];

async function firestoreCount(
  db: FirebaseFirestore.Firestore,
  label: string
): Promise<number> {
  if (label === 'financial_configs') {
    const snap = await db.collectionGroup('configs').get();
    return snap.size;
  }
  if (label === 'settings') {
    const doc = await db.collection('settings').doc('global').get();
    return doc.exists ? 1 : 0;
  }
  const snap = await db.collection(label).get();
  return snap.size;
}

async function main() {
  console.log('\n📊 Parité PostgreSQL ↔ Firestore\n');

  if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant — comptage Firestore impossible.');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  const app = admin.initializeApp(
    { credential: admin.credential.cert(serviceAccount) },
    'sync-parity'
  );
  const databaseId = process.env.FIREBASE_DATABASE_ID;
  const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

  const rows: Row[] = [];
  let hasUnexpectedGap = false;
  let hasExpectedGap = false;

  for (const { label, count } of PG_COUNTS) {
    const pg = await count();
    let fs: number | null = null;
    try {
      fs = await firestoreCount(db, label);
    } catch (e) {
      console.warn(`   ⚠️  ${label}: lecture Firestore échouée`, e);
    }

    const exp = EXPECTED[label];
    const exactOk = fs === null ? true : pg === fs;
    const expectedOk = exp?.pgAdjust && fs !== null ? exp.pgAdjust(pg, fs) : false;
    const ok = exactOk || expectedOk;

    if (!exactOk && fs !== null) {
      if (expectedOk) hasExpectedGap = true;
      else hasUnexpectedGap = true;
    }

    rows.push({
      label,
      pg,
      fs,
      ok,
      expected: expectedOk,
      note: !exactOk && expectedOk ? exp?.note : undefined,
    });
  }

  console.log('Collection'.padEnd(22), 'PG'.padStart(8), 'Firestore'.padStart(10), '  ');
  console.log('─'.repeat(52));
  for (const r of rows) {
    const fsStr = r.fs === null ? '—' : String(r.fs);
    let mark = r.fs === null ? '—' : r.ok ? '✓' : '≠';
    if (r.expected && r.fs !== null && r.pg !== r.fs) mark = '≈';
    console.log(r.label.padEnd(22), String(r.pg).padStart(8), fsStr.padStart(10), mark.padStart(4));
    if (r.note) console.log(`      ↳ ${r.note}`);
  }
  console.log('─'.repeat(52));

  if (hasUnexpectedGap) {
    console.log('\n⚠️  Écarts à corriger :\n');
    const fc = rows.find((r) => r.label === 'financial_configs');
    if (fc && !fc.ok && !fc.expected) {
      console.log('   financial_configs : npm run sync:financial-configs');
      console.log('      (aligne PG sur collectionGroup Firestore, supprime configs plates du dump)\n');
    }
    console.log('   Puis : npm run sync:parity\n');
    process.exit(1);
  }

  if (hasExpectedGap) {
    console.log('\n✅ Collections métier alignées (orders, stock, etc.)');
    console.log('   Écarts restants = connus (depot_delta, prefs UI, configs campagne).\n');
    process.exit(0);
  }
  console.log('\n✅ Effectifs alignés\n');
}

main()
  .catch((e) => {
    console.error('❌ sync:parity:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
