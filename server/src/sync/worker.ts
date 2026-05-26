import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { collectionsContext } from './collections.js';
import { processUpsert, reconcileDeletions, type SyncContext } from './upsert.js';
import { shouldSkipInitialReplay } from './helpers.js';
import { prisma } from '../lib/prisma.js';
import fs from 'fs';
import { EventEmitter } from 'events';

const SYNC_ENABLED = process.env.SYNC_ENABLED === 'true';

if (!SYNC_ENABLED) {
  console.log('⚠️ Sync worker désactivé. Mettez SYNC_ENABLED=true dans server/.env');
  process.exit(0);
}

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`❌ Clé Firebase Admin introuvable: ${SERVICE_ACCOUNT_PATH}`);
  console.error('Placez firebase-service-account.json dans server/ et configurez .env');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));

const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const databaseId = process.env.FIREBASE_DATABASE_ID;
const firestoreDb = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

EventEmitter.defaultMaxListeners = 30;

const unsubscribers: Array<() => void> = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log('🚀 Sync Worker Firestore → PostgreSQL');

function buildSyncContext(
  collectionName: string,
  doc: FirebaseFirestore.QueryDocumentSnapshot
): SyncContext {
  const firestoreUpdateTime = doc.updateTime ? doc.updateTime.toDate().toISOString() : null;
  if (collectionName === 'settings') {
    return { collectionName, docId: 'global', docPath: doc.ref.path, firestoreUpdateTime };
  }
  return {
    collectionName,
    docId: doc.id,
    docPath: doc.ref.path,
    firestoreUpdateTime,
  };
}

async function handleSnapshot(
  collectionName: string,
  snapshot: FirebaseFirestore.QuerySnapshot
): Promise<void> {
  const changes = snapshot.docChanges();

  if (await shouldSkipInitialReplay(collectionName, changes)) {
    console.log(
      `⏭️  ${collectionName}: replay initial ignoré (${changes.length} docs, déjà seedé)`
    );
    return;
  }

  if (changes.length === 0) return;

  let processed = 0;

  const isInitial = changes.length > 0 && changes.every((c) => c.type === 'added');

  if (isInitial) {
    const activeIds = new Set(snapshot.docs.map(d => buildSyncContext(collectionName, d).docId));
    const deletedCount = await reconcileDeletions(collectionName, activeIds);
    if (deletedCount > 0) {
      console.log(`🧹 ${collectionName}: ${deletedCount} docs supprimés (réconciliation initiale)`);
    }
  }

  for (const change of changes) {
    const doc = change.doc;
    const ctx = buildSyncContext(collectionName, doc);
    const data = doc.data() as Record<string, unknown>;

    if (change.type === 'added' || change.type === 'modified') {
      await processUpsert(ctx, data, 'set');
      processed++;
    } else if (change.type === 'removed') {
      await processUpsert(ctx, null, 'delete');
      processed++;
    }
  }

  if (processed > 0) {
    await prisma.syncState.upsert({
      where: { collectionName },
      create: {
        collectionName,
        lastSyncedAt: new Date(),
        documentsCount: snapshot.size,
      },
      update: {
        lastSyncedAt: new Date(),
        documentsCount: snapshot.size,
      },
    });

    const removed = changes.filter((c) => c.type === 'removed').length;
    const upserts = processed - removed;
    const detail =
      removed > 0 && upserts > 0
        ? `${upserts} upsert, ${removed} delete`
        : removed > 0
          ? `${removed} delete`
          : `${upserts} upsert`;
    console.log(`✅ ${collectionName}: ${detail}`);
  }
}

async function startWorker(): Promise<void> {
  const collectionsToSync = Object.keys(collectionsContext.priorities);

  for (const collectionName of collectionsToSync) {
    const queryRef = collectionsContext.usesCollectionGroup(collectionName)
      ? firestoreDb.collectionGroup('configs')
      : firestoreDb.collection(collectionsContext.firestoreCollectionName(collectionName));

    console.log(`🎧 Écoute: ${collectionName}`);

    const unsub = queryRef.onSnapshot(
      (snapshot) => {
        handleSnapshot(collectionName, snapshot).catch((err) => {
          console.error(`❌ Erreur traitement [${collectionName}]:`, err);
        });
      },
      (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('backoff operation is already in progress')) {
          console.warn(`⚠️  Listener [${collectionName}]: reconnexion Firestore en cours (ignoré)`);
          return;
        }
        console.error(`❌ Listener Firebase [${collectionName}]:`, error);
      }
    );
    unsubscribers.push(unsub);

    // Évite de saturer Firestore au démarrage (16 listeners d'un coup)
    await sleep(150);
  }

  console.log(`\n✅ ${collectionsToSync.length} listeners actifs. En attente de changements...\n`);
}

process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du sync worker...');
  for (const unsub of unsubscribers) {
    try {
      unsub();
    } catch {
      /* ignore */
    }
  }
  await prisma.$disconnect();
  process.exit(0);
});

startWorker().catch((err) => {
  console.error('Échec démarrage worker:', err);
  process.exit(1);
});
