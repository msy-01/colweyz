/**
 * Re-synchronise un document (ou toute une collection) Firestore → PostgreSQL
 * sans export JSON. Utile pour corriger une incohérence ponctuelle.
 *
 * Usage:
 *   npx tsx scripts/resync-firestore-doc.ts orders '#CW85099'
 *   npx tsx scripts/resync-firestore-doc.ts orders --all
 *   npx tsx scripts/resync-firestore-doc.ts orders '#CW85123' --force
 *   npx tsx scripts/resync-firestore-doc.ts daily_entries '2026-05-25'
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { processUpsert } from '../src/sync/upsert.js';
import { collectionsContext } from '../src/sync/collections.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--force');
const force = process.argv.includes('--force');
const collection = args[0];
const docIdOrFlag = args[1];
const syncAll = docIdOrFlag === '--all';

if (!collection) {
  console.error('Usage: resync-firestore-doc.ts <collection> <docId|--all> [--force]');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'resync-doc');
const databaseId = process.env.FIREBASE_DATABASE_ID;
const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

function fsCollectionName(name: string): string {
  return collectionsContext.firestoreCollectionName(name);
}

async function resyncDoc(
  logicalCollection: string,
  docId: string,
  data: Record<string, unknown>,
  path: string,
  firestoreUpdateTime: string | null
) {
  await processUpsert(
    { collectionName: logicalCollection, docId, docPath: path, firestoreUpdateTime },
    data,
    'set',
    { force }
  );
  const st = data.status ?? '—';
  const drv = data.driverId ?? 'null';
  console.log(`✅ ${logicalCollection}/${docId} (status=${st}, driverId=${drv})${force ? ' [force]' : ''}`);
  if (data._syncSource === 'postgres' && logicalCollection === 'orders') {
    console.log(`   ℹ️  doc marqué _syncSource=postgres — importé quand même (fix dashboard)`);
  }
}

async function main() {
  const fsName = fsCollectionName(collection);

  if (collection === 'financial_configs' && syncAll) {
    const snap = await db.collectionGroup('configs').get();
    console.log(`financial_configs (collectionGroup): ${snap.size} docs`);
    for (const doc of snap.docs) {
      const ut = doc.updateTime ? doc.updateTime.toDate().toISOString() : null;
      await resyncDoc('financial_configs', doc.id, doc.data() as Record<string, unknown>, doc.ref.path, ut);
    }
    return;
  }

  if (syncAll) {
    const snap = await db.collection(fsName).get();
    console.log(`${collection}: ${snap.size} docs depuis Firestore`);
    for (const doc of snap.docs) {
      const ut = doc.updateTime ? doc.updateTime.toDate().toISOString() : null;
      await resyncDoc(collection, doc.id, doc.data() as Record<string, unknown>, doc.ref.path, ut);
    }
    return;
  }

  if (!docIdOrFlag) {
    console.error('Indiquez un docId ou --all');
    process.exit(1);
  }

  if (collection === 'settings') {
    const ref = db.collection('settings').doc('global');
    const snap = await ref.get();
    if (!snap.exists) {
      console.error('settings/global introuvable');
      process.exit(1);
    }
    await resyncDoc(
      'settings',
      'global',
      snap.data() as Record<string, unknown>,
      snap.ref.path,
      snap.updateTime ? snap.updateTime.toDate().toISOString() : null
    );
    return;
  }

  if (collection === 'config') {
    const snap = await db.collection('config').doc(docIdOrFlag).get();
    if (!snap.exists) {
      console.error(`config/${docIdOrFlag} introuvable`);
      process.exit(1);
    }
    await resyncDoc(
      'config',
      docIdOrFlag,
      snap.data() as Record<string, unknown>,
      snap.ref.path,
      snap.updateTime ? snap.updateTime.toDate().toISOString() : null
    );
    return;
  }

  const ref = db.collection(fsName).doc(docIdOrFlag);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`${fsName}/${docIdOrFlag} introuvable dans Firestore`);
    process.exit(1);
  }
  await resyncDoc(
    collection,
    docIdOrFlag,
    snap.data() as Record<string, unknown>,
    snap.ref.path,
    snap.updateTime ? snap.updateTime.toDate().toISOString() : null
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
