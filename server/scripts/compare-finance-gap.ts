/**
 * Compare PG vs Firestore pour Finance (daily_entries + daily_finance).
 * Usage: cd server && npm run sync:finance-gap
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import {
  computeFraisPub,
  dailyEntrySnapshotsEqual,
  dailyFinanceSnapshotsEqual,
  normalizeDailyEntrySnapshot,
  normalizeDailyFinanceSnapshot,
  resolveFinanceDate,
  stripSyncMeta,
  sumOtherExpenses,
  sumOtherRevenues,
} from '../src/lib/finance-data.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'finance-gap');
const dbId = process.env.FIREBASE_DATABASE_ID;
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

type CollectionReport = {
  pgCount: number;
  fsCount: number;
  keyCountPg: number;
  keyCountFs: number;
  onlyPg: string[];
  onlyFs: string[];
  valueMismatch: string[];
  docIdMismatch: string[];
};

async function compareCollection(
  label: string,
  collectionName: 'daily_entries' | 'daily_finance',
  pgToSnap: (row: Record<string, unknown>) => ReturnType<typeof normalizeDailyEntrySnapshot> | ReturnType<typeof normalizeDailyFinanceSnapshot>,
  fsToSnap: (data: Record<string, unknown>) => ReturnType<typeof normalizeDailyEntrySnapshot> | ReturnType<typeof normalizeDailyFinanceSnapshot>,
  equal: (a: unknown, b: unknown) => boolean,
  formatMismatch: (date: string, pg: unknown, fs: unknown) => string
): Promise<CollectionReport> {
  const report: CollectionReport = {
    pgCount: 0,
    fsCount: 0,
    keyCountPg: 0,
    keyCountFs: 0,
    onlyPg: [],
    onlyFs: [],
    valueMismatch: [],
    docIdMismatch: [],
  };

  const pgByDate = new Map<string, unknown>();

  if (collectionName === 'daily_entries') {
    const rows = await prisma.dailyEntry.findMany();
    report.pgCount = rows.length;
    for (const row of rows) {
      const snap = pgToSnap({
        date: row.date,
        exchangeRate: row.exchangeRate,
        entries: row.entries,
        productOrder: row.productOrder,
      });
      pgByDate.set(row.date, snap);
    }
  } else {
    const rows = await prisma.dailyFinance.findMany();
    report.pgCount = rows.length;
    for (const row of rows) {
      const snap = pgToSnap({
        date: row.date,
        otherRevenues: row.otherRevenues,
        otherExpenses: row.otherExpenses,
      });
      pgByDate.set(row.date, snap);
    }
  }
  report.keyCountPg = pgByDate.size;

  const fsByDate = new Map<string, unknown>();
  const snap = await db.collection(collectionName).get();
  report.fsCount = snap.size;

  for (const doc of snap.docs) {
    const raw = stripSyncMeta(doc.data() as Record<string, unknown>);
    const date = resolveFinanceDate(doc.id, raw);
    if (!date) {
      console.log(`   ⚠ FS ${collectionName} sans date: ${doc.ref.path}`);
      continue;
    }
    if (date !== doc.id) {
      report.docIdMismatch.push(`${doc.id} → ${date}`);
    }
    fsByDate.set(date, fsToSnap(raw));
  }
  report.keyCountFs = fsByDate.size;

  for (const [date, pgSnap] of pgByDate) {
    const fsSnap = fsByDate.get(date);
    if (!fsSnap) {
      report.onlyPg.push(date);
      continue;
    }
    if (!equal(pgSnap, fsSnap)) {
      report.valueMismatch.push(formatMismatch(date, pgSnap, fsSnap));
    }
  }

  for (const date of fsByDate.keys()) {
    if (!pgByDate.has(date)) report.onlyFs.push(date);
  }

  console.log(`\n── ${label} ──`);
  console.log(`  PostgreSQL (lignes) : ${report.pgCount} (${report.keyCountPg} dates)`);
  console.log(`  Firestore           : ${report.fsCount} (${report.keyCountFs} dates)`);

  if (report.docIdMismatch.length) {
    console.log(`  FS docId ≠ date (${report.docIdMismatch.length}):`);
    for (const m of report.docIdMismatch.slice(0, 5)) console.log(`    - ${m}`);
    if (report.docIdMismatch.length > 5) console.log(`    … +${report.docIdMismatch.length - 5}`);
  }

  if (report.onlyPg.length) {
    console.log(`\n  Uniquement PG (${report.onlyPg.length}):`);
    for (const d of report.onlyPg.slice(0, 10)) console.log(`    - ${d}`);
    if (report.onlyPg.length > 10) console.log(`    … +${report.onlyPg.length - 10}`);
  }

  if (report.onlyFs.length) {
    console.log(`\n  Uniquement Firestore (${report.onlyFs.length}):`);
    for (const d of report.onlyFs.slice(0, 10)) console.log(`    - ${d}`);
    if (report.onlyFs.length > 10) console.log(`    … +${report.onlyFs.length - 10}`);
  }

  if (report.valueMismatch.length) {
    console.log(`\n  Écarts de valeurs (${report.valueMismatch.length}):`);
    for (const line of report.valueMismatch.slice(0, 15)) console.log(`    ${line}`);
    if (report.valueMismatch.length > 15) console.log(`    … +${report.valueMismatch.length - 15}`);
  }

  if (
    report.onlyPg.length === 0 &&
    report.onlyFs.length === 0 &&
    report.valueMismatch.length === 0
  ) {
    console.log('\n   ✓  Parité (dates + valeurs)');
  }

  return report;
}

async function main() {
  const t0 = Date.now();
  console.log('\n🔍 Finance — daily_entries & daily_finance PG ↔ Firestore\n');

  const entriesReport = await compareCollection(
    'daily_entries (pub / ventes)',
    'daily_entries',
    (d) => normalizeDailyEntrySnapshot(d),
    (d) => normalizeDailyEntrySnapshot(d),
    (a, b) => dailyEntrySnapshotsEqual(a as never, b as never),
    (date, pg, fs) => {
      const p = pg as ReturnType<typeof normalizeDailyEntrySnapshot>;
      const f = fs as ReturnType<typeof normalizeDailyEntrySnapshot>;
      return `≠ ${date}  taux ${p.exchangeRate}/${f.exchangeRate}  fraisPub ${computeFraisPub(p)}/${computeFraisPub(f)}  produits ${Object.keys(p.entries).length}/${Object.keys(f.entries).length}`;
    }
  );

  const financeReport = await compareCollection(
    'daily_finance (autres revenus / charges)',
    'daily_finance',
    (d) => normalizeDailyFinanceSnapshot(d),
    (d) => normalizeDailyFinanceSnapshot(d),
    (a, b) => dailyFinanceSnapshotsEqual(a as never, b as never),
    (date, pg, fs) => {
      const p = pg as ReturnType<typeof normalizeDailyFinanceSnapshot>;
      const f = fs as ReturnType<typeof normalizeDailyFinanceSnapshot>;
      return `≠ ${date}  rev +${sumOtherRevenues(p)}/${sumOtherRevenues(f)}  dep ${sumOtherExpenses(p)}/${sumOtherExpenses(f)}`;
    }
  );

  const total =
    entriesReport.onlyPg.length +
    entriesReport.onlyFs.length +
    entriesReport.valueMismatch.length +
    financeReport.onlyPg.length +
    financeReport.onlyFs.length +
    financeReport.valueMismatch.length;

  if (total > 0) {
    console.log('\n── Correctif suggéré ──');
    console.log('  npm run sync:align-finance -- --apply');
  }

  console.log(`\nDurée: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
