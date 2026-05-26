/**
 * Aligne PG sur Firestore collectionGroup('configs') — source unique de l'ancienne app.
 * Supprime les configs plates obsolètes du dump qui faussaient CAU / objectifs.
 *
 *   cd server && npm run sync:financial-configs
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import { processUpsert } from '../src/sync/upsert.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant ou fichier introuvable');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const databaseId = process.env.FIREBASE_DATABASE_ID;
const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

async function main() {
  const before = await prisma.financialConfig.count();
  console.log(`Configs PG avant: ${before}`);

  const snap = await db.collectionGroup('configs').get();
  console.log(`Firestore collectionGroup('configs'): ${snap.size} documents`);

  const removed = await prisma.financialConfig.deleteMany();
  console.log(`🗑️  Configs PG supprimées: ${removed.count} (remplacement intégral)`);

  let ok = 0;
  let err = 0;
  for (const doc of snap.docs) {
    try {
      await processUpsert(
        {
          collectionName: 'financial_configs',
          docId: doc.id,
          docPath: doc.ref.path,
        },
        doc.data() as Record<string, unknown>,
        'set'
      );
      ok++;
    } catch (e) {
      err++;
      console.warn(`  ⚠ ${doc.ref.path}:`, e instanceof Error ? e.message : e);
    }
  }

  const after = await prisma.financialConfig.count();
  console.log(`\nTerminé: ${ok} importés, ${err} erreurs`);
  console.log(`Configs PG après: ${after}`);

  await prisma.$disconnect();
  process.exit(err > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
