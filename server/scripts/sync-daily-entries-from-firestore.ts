/**
 * Re-synchronise daily_entries depuis Firestore (saisies pub / ventes).
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import { processUpsert } from '../src/sync/upsert.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const databaseId = process.env.FIREBASE_DATABASE_ID;
const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

async function main() {
  const snap = await db.collection('daily_entries').get();
  console.log(`Firestore daily_entries: ${snap.size}`);

  for (const doc of snap.docs) {
    await processUpsert(
      { collectionName: 'daily_entries', docId: doc.id, docPath: doc.ref.path },
      doc.data() as Record<string, unknown>,
      'set'
    );
  }

  const may23 = await prisma.dailyEntry.findUnique({ where: { date: '2026-05-23' } });
  console.log('PG 2026-05-23:', may23 ? `rate=${may23.exchangeRate}, keys=${Object.keys(may23.entries as object).length}` : 'MISSING');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
