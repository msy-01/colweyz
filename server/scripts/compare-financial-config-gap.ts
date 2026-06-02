/**
 * Compare PG vs Firestore (collectionGroup configs) pour la Rentabilité.
 * Usage: cd server && npm run sync:financial-gap
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import {
  buildFinancialConfigPayload,
  financialConfigKey,
  snapshotFromPayload,
  snapshotsEqual,
} from '../src/lib/financial-config.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'fin-gap');
const dbId = process.env.FIREBASE_DATABASE_ID;
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

async function main() {
  const t0 = Date.now();
  console.log('\n🔍 Rentabilité — configs financières PG ↔ Firestore\n');

  const pgRows = await prisma.financialConfig.findMany();
  const pgByKey = new Map<string, ReturnType<typeof snapshotFromPayload>>();
  const pgOrphanIds: string[] = [];

  for (const row of pgRows) {
    const payload = buildFinancialConfigPayload(row.id, {
      productId: row.productId,
      dateEffet: row.dateEffet,
      cau: row.cau,
      appro: row.appro,
      dailyBudgetUsd: row.dailyBudgetUsd,
      isCampaignActive: row.isCampaignActive,
      updatedAt: row.firestoreUpdatedAt ?? row.updatedAt.toISOString(),
    });
    if (!payload) {
      pgOrphanIds.push(row.id);
      continue;
    }
    const snap = snapshotFromPayload(payload);
    const existing = pgByKey.get(snap.key);
    if (existing && !snapshotsEqual(existing, snap)) {
      console.log(`   ⚠ PG doublon clé ${snap.key} (ids ${row.id})`);
    }
    pgByKey.set(snap.key, snap);
  }

  const snap = await db.collectionGroup('configs').get();
  const fsByKey = new Map<string, ReturnType<typeof snapshotFromPayload>>();

  for (const doc of snap.docs) {
    const payload = buildFinancialConfigPayload(
      doc.id,
      doc.data() as Record<string, unknown>,
      doc.ref.path
    );
    if (!payload) {
      console.log(`   ⚠ FS ignoré (pas de productId): ${doc.ref.path}`);
      continue;
    }
    fsByKey.set(snapshotFromPayload(payload).key, snapshotFromPayload(payload));
  }

  console.log(`  PostgreSQL (lignes)     : ${pgRows.length} (${pgByKey.size} clés métier)`);
  console.log(`  Firestore configs       : ${snap.size} (${fsByKey.size} clés métier)`);
  if (pgOrphanIds.length) {
    console.log(`  PG orphelines (invalides): ${pgOrphanIds.length}`);
  }

  let valueMismatch = 0;
  const onlyPg: string[] = [];
  const onlyFs: string[] = [];

  for (const [key, pgSnap] of pgByKey) {
    const fsSnap = fsByKey.get(key);
    if (!fsSnap) {
      onlyPg.push(key);
      continue;
    }
    if (!snapshotsEqual(pgSnap, fsSnap)) {
      valueMismatch++;
      if (valueMismatch <= 15) {
        console.log(
          `   ≠  ${key}  cau ${pgSnap.cau}/${fsSnap.cau}  appro ${pgSnap.appro}/${fsSnap.appro}  budget ${pgSnap.dailyBudgetUsd}/${fsSnap.dailyBudgetUsd}`
        );
      }
    }
  }

  for (const key of fsByKey.keys()) {
    if (!pgByKey.has(key)) onlyFs.push(key);
  }

  if (valueMismatch > 15) {
    console.log(`   … +${valueMismatch - 15} autres écarts de valeurs`);
  }

  if (onlyPg.length) {
    console.log(`\n  Uniquement PG (${onlyPg.length}):`);
    for (const k of onlyPg.slice(0, 15)) console.log(`    - ${k}`);
    if (onlyPg.length > 15) console.log(`    … +${onlyPg.length - 15}`);
  }

  if (onlyFs.length) {
    console.log(`\n  Uniquement Firestore (${onlyFs.length}):`);
    for (const k of onlyFs.slice(0, 15)) console.log(`    - ${k}`);
    if (onlyFs.length > 15) console.log(`    … +${onlyFs.length - 15}`);
  }

  const total = onlyPg.length + onlyFs.length + valueMismatch + pgOrphanIds.length;
  if (total === 0) {
    console.log('\n   ✓  Parité configs (clés + valeurs)');
  } else {
    console.log('\n── Correctif suggéré ──');
    console.log('  npm run sync:align-financial-configs -- --apply');
  }

  console.log(`\nDurée: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
