/**
 * Audit : pourquoi une commande a perdu zone/livreur / statut ?
 *
 * Usage:
 *   cd server && npx tsx scripts/audit-order-changes.ts '#CW85042' '#CW84988'
 *   cd server && npx tsx scripts/audit-order-changes.ts --unassigned-validé
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const prisma = new PrismaClient();

function initFirestore() {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path || !fs.existsSync(path)) return null;
  const sa = JSON.parse(fs.readFileSync(path, 'utf8'));
  const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'audit-order');
  const dbId = process.env.FIREBASE_DATABASE_ID;
  return dbId ? getFirestore(app, dbId) : getFirestore(app);
}

async function auditOne(id: string, db: FirebaseFirestore.Firestore | null) {
  console.log(`\n─── ${id} ───`);
  const pg = await prisma.order.findUnique({ where: { id } });
  if (!pg) {
    console.log('  PostgreSQL : absent');
  } else {
    console.log('  PostgreSQL :');
    console.log(`    status=${pg.status} driverId=${pg.driverId ?? 'null'} zoneId=${pg.zoneId ?? 'null'}`);
    console.log(`    updatedAt=${pg.updatedAt.toISOString()}`);
    const logs = (pg.logs as { text?: string; author?: string; createdAt?: string }[]) ?? [];
    if (logs.length) {
      console.log('    derniers logs PG:');
      logs.slice(-5).forEach((l) => console.log(`      - ${l.createdAt} | ${l.author}: ${l.text}`));
    }
  }

  const syncRows = await prisma.syncLog.findMany({
    where: { collectionName: 'orders', documentId: id },
    orderBy: { processedAt: 'desc' },
    take: 10,
  });
  if (syncRows.length) {
    console.log('  sync_log (forward Firestore→PG):');
    syncRows.forEach((r) =>
      console.log(`      ${r.processedAt.toISOString()} | ${r.operation} | source=${r.sourceUpdatedAt}`)
    );
  }

  if (db) {
    const snap = await db.collection('orders').doc(id).get();
    if (!snap.exists) {
      console.log('  Firestore : absent');
    } else {
      const d = snap.data()!;
      console.log('  Firestore (live):');
      console.log(`    status=${d.status} driverId=${d.driverId ?? 'null'} zoneId=${d.zoneId ?? 'null'}`);
      console.log(`    updatedAt=${d.updatedAt ?? '—'}`);
      if (d._syncSource === 'postgres') {
        console.log('    ⚠️  _syncSource=postgres → doc touché par reverse sync PG→Firestore');
      }
      const logs = (d.logs as { text?: string; author?: string; createdAt?: string }[]) ?? [];
      if (logs.length) {
        console.log('    derniers logs Firestore:');
        logs.slice(-8).forEach((l) => console.log(`      - ${l.createdAt} | ${l.author}: ${l.text}`));
      }
    }
  }
}

async function listUnassignedInPg() {
  const rows = await prisma.order.findMany({
    where: {
      status: 'validé',
      OR: [{ driverId: null }, { zoneId: null }],
    },
    select: { id: true, date: true, clientName: true, driverId: true, zoneId: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  });
  console.log(`\nCommandes PG status=validé sans livreur/zone (max 30): ${rows.length}`);
  rows.forEach((r) =>
    console.log(`  ${r.id} | ${r.date} | ${r.clientName} | drv=${r.driverId} zone=${r.zoneId}`)
  );
}

async function main() {
  const args = process.argv.slice(2);
  const db = initFirestore();

  console.log('\n🔎 Audit attributions ColWeyz\n');
  console.log(`Reverse enabled (env): ${process.env.SYNC_REVERSE_ENABLED}`);
  console.log(`Forward enabled (env): ${process.env.SYNC_ENABLED}`);

  const reverse = await prisma.syncState.findMany({
    where: { collectionName: { startsWith: 'reverse_' } },
  });
  if (reverse.length) {
    console.log('\n⚠️  Curseurs reverse présents (PG a déjà poussé vers Firestore):');
    reverse.forEach((c) => console.log(`    ${c.collectionName} @ ${c.lastSyncedAt.toISOString()}`));
  }

  if (args.includes('--unassigned-validé')) {
    await listUnassignedInPg();
    return;
  }

  const ids = args.length ? args : ['#CW85042', '#CW84988'];
  for (const id of ids) {
    const norm = id.startsWith('#') ? id : `#${id}`;
    await auditOne(norm, db);
  }

  console.log('\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
