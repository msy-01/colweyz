/**
 * Compare PG vs Firestore pour le Dashboard :
 * - commandes « à attribuer »
 * - commandes « programmées » (futur)
 *
 * Usage: cd server && npm run sync:dashboard-gap
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import {
  isDashboardScheduled,
  isDashboardUnassigned,
  normalizeScheduledAtIso,
} from '../src/lib/scheduled-at.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'dash-gap');
const dbId = process.env.FIREBASE_DATABASE_ID;
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

function sliceFromFs(data: FirebaseFirestore.DocumentData) {
  return {
    status: String(data.status ?? 'validé'),
    driverId: (data.driverId as string) || null,
    scheduledAt: normalizeScheduledAtIso(data as Record<string, unknown>),
  };
}

async function compareBucket(
  label: string,
  pgIds: Set<string>,
  fsIds: Set<string>
): Promise<number> {
  console.log(`\n📋 ${label}`);
  console.log(`   PG: ${pgIds.size}  |  Firestore: ${fsIds.size}`);

  let mismatch = 0;
  const onlyPg = [...pgIds].filter((id) => !fsIds.has(id));
  const onlyFs = [...fsIds].filter((id) => !pgIds.has(id));

  for (const id of onlyPg.slice(0, 30)) {
    mismatch++;
    const pg = await prisma.order.findUnique({
      where: { id },
      select: { status: true, driverId: true, scheduledAt: true },
    });
    const snap = await db.collection('orders').doc(id).get();
    const fs = snap.exists ? sliceFromFs(snap.data()!) : null;
    console.log(
      `   ≠  ${id}  uniquement PG | PG: ${pg?.status}/${pg?.driverId ?? 'null'}/sched=${pg?.scheduledAt ?? 'null'}`
    );
    if (fs) {
      console.log(
        `        FS: ${fs.status}/${fs.driverId ?? 'null'}/sched=${fs.scheduledAt ?? 'null'}`
      );
    } else {
      console.log('        FS: (absent)');
    }
  }
  if (onlyPg.length > 30) console.log(`   … +${onlyPg.length - 30} autres uniquement PG`);

  for (const id of onlyFs.slice(0, 30)) {
    mismatch++;
    const snap = await db.collection('orders').doc(id).get();
    const fs = sliceFromFs(snap.data()!);
    const pg = await prisma.order.findUnique({
      where: { id },
      select: { status: true, driverId: true, scheduledAt: true },
    });
    console.log(
      `   ≠  ${id}  uniquement FS | FS: ${fs.status}/${fs.driverId ?? 'null'}/sched=${fs.scheduledAt ?? 'null'}`
    );
    if (pg) {
      console.log(
        `        PG: ${pg.status}/${pg.driverId ?? 'null'}/sched=${pg.scheduledAt ?? 'null'}`
      );
    } else {
      console.log('        PG: (absent)');
    }
  }
  if (onlyFs.length > 30) console.log(`   … +${onlyFs.length - 30} autres uniquement FS`);

  if (mismatch === 0) console.log('   ✓  Listes identiques');
  return mismatch;
}

async function main() {
  const pgOrders = await prisma.order.findMany({
    select: { id: true, status: true, driverId: true, scheduledAt: true },
  });

  const pgUnassigned = new Set(
    pgOrders.filter((o) => isDashboardUnassigned(o)).map((o) => o.id)
  );
  const pgScheduled = new Set(
    pgOrders.filter((o) => isDashboardScheduled(o)).map((o) => o.id)
  );

  const fsUnassigned = new Set<string>();
  const fsScheduled = new Set<string>();

  const snap = await db.collection('orders').get();
  for (const doc of snap.docs) {
    const s = sliceFromFs(doc.data());
    if (isDashboardUnassigned(s)) fsUnassigned.add(doc.id);
    if (isDashboardScheduled(s)) fsScheduled.add(doc.id);
  }

  console.log('\n🔍 Diagnostic Dashboard ColWeyz (PG ↔ Firestore)\n');

  const m1 = await compareBucket('Commandes à attribuer', pgUnassigned, fsUnassigned);
  const m2 = await compareBucket('Commandes programmées (futur)', pgScheduled, fsScheduled);

  const total = m1 + m2;
  if (total > 0) {
    console.log('\n── Correctifs suggérés ──');
    console.log('  npm run sync:normalize-scheduled -- --apply');
    console.log('  npm run sync:resync-doc -- orders <id> --force');
    console.log('  npm run sync:resync-doc -- orders --all --force');
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
