/**
 * Aligne PostgreSQL sur Firestore — daily_entries + daily_finance.
 *
 * Usage:
 *   npm run sync:align-finance           # dry-run
 *   npm run sync:align-finance -- --apply
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import { resolveFinanceDate } from '../src/lib/finance-data.js';
import { processUpsert } from '../src/sync/upsert.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'align-finance');
const dbId = process.env.FIREBASE_DATABASE_ID;
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

async function alignCollection(
  collectionName: 'daily_entries' | 'daily_finance',
  label: string
): Promise<{ before: number; after: number; orphans: number; imported: number }> {
  const before =
    collectionName === 'daily_entries'
      ? await prisma.dailyEntry.count()
      : await prisma.dailyFinance.count();

  const snap = await db.collection(collectionName).get();
  const fsDates = new Set<string>();
  const toImport: { docId: string; data: Record<string, unknown>; docPath: string }[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const date = resolveFinanceDate(doc.id, data);
    if (!date) continue;
    fsDates.add(date);
    toImport.push({ docId: doc.id, data, docPath: doc.ref.path });
  }

  const pgDates =
    collectionName === 'daily_entries'
      ? (await prisma.dailyEntry.findMany({ select: { date: true } })).map((r) => r.date)
      : (await prisma.dailyFinance.findMany({ select: { date: true } })).map((r) => r.date);

  const orphanDates = pgDates.filter((d) => !fsDates.has(d));

  console.log(`\n  ${label}`);
  console.log(`    PG avant: ${before}  |  Firestore: ${snap.size}  |  orphelines PG: ${orphanDates.length}`);

  if (orphanDates.length) {
    for (const d of orphanDates.slice(0, 8)) console.log(`      - ${d}`);
    if (orphanDates.length > 8) console.log(`      … +${orphanDates.length - 8}`);
  }

  if (apply) {
    if (orphanDates.length) {
      if (collectionName === 'daily_entries') {
        await prisma.dailyEntry.deleteMany({ where: { date: { in: orphanDates } } });
      } else {
        await prisma.dailyFinance.deleteMany({ where: { date: { in: orphanDates } } });
      }
      console.log(`    🗑️  ${orphanDates.length} orphelines supprimées`);
    }

    let n = 0;
    for (const { docId, data, docPath } of toImport) {
      n++;
      if (n % 50 === 0) process.stdout.write(`\r    Import ${n}/${toImport.length}…`);
      await processUpsert(
        { collectionName, docId, docPath },
        data,
        'set',
        { force: true }
      );
    }
    if (toImport.length) console.log(`\r    Import ${toImport.length}/${toImport.length} — terminé.   `);
  } else {
    console.log(`    Écriture: ${toImport.length} upserts + suppression orphelines`);
  }

  const after = apply
    ? collectionName === 'daily_entries'
      ? await prisma.dailyEntry.count()
      : await prisma.dailyFinance.count()
    : before;

  return { before, after, orphans: orphanDates.length, imported: toImport.length };
}

async function main() {
  const t0 = Date.now();
  console.log(`\n📊 Alignement Finance — ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

  await alignCollection('daily_entries', 'daily_entries');
  await alignCollection('daily_finance', 'daily_finance');

  if (!apply) console.log('\n  Relancez avec --apply');

  console.log(`\n  Durée: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
