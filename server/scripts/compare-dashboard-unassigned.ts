/**
 * Compare PG vs Firestore pour les commandes "à attribuer" (dashboard).
 * Usage: cd server && npx tsx scripts/compare-dashboard-unassigned.ts
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'dash-gap');
const dbId = process.env.FIREBASE_DATABASE_ID;
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

function estProgrammee(scheduledAt: string | null): boolean {
  if (!scheduledAt) return false;
  const sched = new Date(scheduledAt).getTime();
  return Date.now() < sched + 60_000;
}

async function main() {
  const pgOrders = await prisma.order.findMany({
    select: { id: true, status: true, driverId: true, scheduledAt: true, date: true, updatedAt: true },
  });

  const pgUnassigned = pgOrders.filter(
    (o) => o.status === 'validé' && !o.driverId && !estProgrammee(o.scheduledAt)
  );

  console.log(`\n📋 Dashboard "à attribuer" — PG: ${pgUnassigned.length} commande(s)\n`);

  let mismatch = 0;
  for (const o of pgUnassigned) {
    const snap = await db.collection('orders').doc(o.id).get();
    if (!snap.exists) {
      console.log(`❌ ${o.id} — absent Firestore, PG validé sans livreur`);
      mismatch++;
      continue;
    }
    const d = snap.data()!;
    const fsStatus = d.status as string;
    const fsDriver = (d.driverId as string) || null;
    const same =
      fsStatus === 'validé' && !fsDriver && !estProgrammee((d.scheduledAt as string) || null);
    if (!same) {
      mismatch++;
      console.log(
        `≠  ${o.id} | PG: validé / ${o.driverId ?? 'null'} | FS: ${fsStatus} / ${fsDriver ?? 'null'}`
      );
    } else {
      console.log(`✓  ${o.id} — les deux: à attribuer`);
    }
  }

  console.log(`\nÉcarts PG≠FS: ${mismatch}`);
  if (mismatch > 0) {
    console.log('\nCorriger (sur le VPS):');
    console.log('  npx tsx scripts/resync-firestore-doc.ts orders <id> --force');
    console.log('  # ou toutes les commandes:');
    console.log('  npx tsx scripts/resync-firestore-doc.ts orders --all --force');
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
