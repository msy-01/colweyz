/**
 * Aligne scheduledAt entre Firestore et PostgreSQL (champs legacy → scheduledAt).
 *
 * Usage:
 *   cd server && npm run sync:normalize-scheduled          # simulation
 *   cd server && npm run sync:normalize-scheduled -- --apply
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import {
  hasLegacyScheduleFieldsOnly,
  isDashboardScheduled,
  isDashboardUnassigned,
  normalizeScheduledAtIso,
} from '../src/lib/scheduled-at.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant ou fichier introuvable');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'normalize-scheduled');
const dbId = process.env.FIREBASE_DATABASE_ID;
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

function sliceFromFs(data: FirebaseFirestore.DocumentData) {
  const scheduledAt = normalizeScheduledAtIso(data as Record<string, unknown>);
  return {
    status: String(data.status ?? 'validé'),
    driverId: (data.driverId as string) || null,
    scheduledAt,
  };
}

async function main() {
  console.log(`\n📅 Normalisation scheduledAt — mode ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

  let fsLegacyPatched = 0;
  let pgPatched = 0;
  let alreadyOk = 0;
  let fsOnly = 0;

  const snap = await db.collection('orders').get();
  console.log(`Firestore orders: ${snap.size}`);

  for (const doc of snap.docs) {
    const data = doc.data();
    const canonical = normalizeScheduledAtIso(data as Record<string, unknown>);
    const legacyOnly = hasLegacyScheduleFieldsOnly(data as Record<string, unknown>);

    if (legacyOnly && canonical) {
      fsOnly++;
      console.log(`  legacy→scheduledAt  ${doc.id}  (${String(data.dateProgrammee ?? data.scheduledDate ?? data.scheduled_date).slice(0, 24)})`);
      if (apply) {
        await doc.ref.set({ scheduledAt: canonical }, { merge: true });
        fsLegacyPatched++;
      }
    }

    const pg = await prisma.order.findUnique({
      where: { id: doc.id },
      select: { scheduledAt: true, status: true, driverId: true },
    });
    if (!pg) continue;

    const pgCanonical = pg.scheduledAt;
    if (canonical !== pgCanonical) {
      console.log(
        `  PG align ${doc.id}  ${pgCanonical ?? 'null'} → ${canonical ?? 'null'}`
      );
      if (apply && canonical !== pgCanonical) {
        await prisma.order.update({
          where: { id: doc.id },
          data: { scheduledAt: canonical },
        });
        pgPatched++;
      }
    } else {
      alreadyOk++;
    }
  }

  // PG sans scheduledAt : relecture Firestore (au cas où doc manquant dans la boucle)
  const pgNullScheduled = await prisma.order.findMany({
    where: { scheduledAt: null },
    select: { id: true, status: true, driverId: true },
  });

  let pgOrphanFixed = 0;
  for (const row of pgNullScheduled) {
    const fsDoc = await db.collection('orders').doc(row.id).get();
    if (!fsDoc.exists) continue;
    const canonical = normalizeScheduledAtIso(fsDoc.data() as Record<string, unknown>);
    if (!canonical) continue;
    console.log(`  PG null fix ${row.id}  → ${canonical}`);
    if (apply) {
      await prisma.order.update({
        where: { id: row.id },
        data: { scheduledAt: canonical },
      });
      pgOrphanFixed++;
    }
  }

  // Résumé dashboard (même règles que l'UI)
  const pgOrders = await prisma.order.findMany({
    select: { id: true, status: true, driverId: true, scheduledAt: true },
  });
  const pgUnassigned = pgOrders.filter((o) => isDashboardUnassigned(o));
  const pgScheduled = pgOrders.filter((o) => isDashboardScheduled(o));

  let fsUnassigned = 0;
  let fsScheduled = 0;
  for (const doc of snap.docs) {
    const s = sliceFromFs(doc.data());
    if (isDashboardUnassigned(s)) fsUnassigned++;
    if (isDashboardScheduled(s)) fsScheduled++;
  }

  console.log('\n── Résumé ──');
  console.log(`  Firestore legacy sans scheduledAt : ${fsOnly}`);
  if (apply) {
    console.log(`  Firestore patchés (scheduledAt)     : ${fsLegacyPatched}`);
    console.log(`  PostgreSQL patchés                : ${pgPatched + pgOrphanFixed}`);
  } else {
    console.log('  Relancez avec --apply pour écrire.');
  }
  console.log(`  Déjà alignés (échantillon FS)      : ${alreadyOk}`);
  console.log('\n── Compteurs Dashboard (règles UI) ──');
  console.log(`  À attribuer   PG: ${pgUnassigned.length}  |  FS: ${fsUnassigned}`);
  console.log(`  Programmées   PG: ${pgScheduled.length}  |  FS: ${fsScheduled}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
