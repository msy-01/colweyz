/**
 * Aligne scheduledAt entre Firestore et PostgreSQL (champs legacy → scheduledAt).
 *
 * Usage:
 *   cd server && npm run sync:normalize-scheduled          # simulation (~10–20 s)
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
const VERBOSE_LIMIT = 25;
const PG_BATCH = 100;
const FS_BATCH = 400;

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

function sameScheduled(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

async function flushPgUpdates(updates: { id: string; scheduledAt: string | null }[]): Promise<number> {
  if (!updates.length) return 0;
  let done = 0;
  for (let i = 0; i < updates.length; i += PG_BATCH) {
    const chunk = updates.slice(i, i + PG_BATCH);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.order.update({
          where: { id: u.id },
          data: { scheduledAt: u.scheduledAt },
        })
      )
    );
    done += chunk.length;
    process.stdout.write(`\r  PostgreSQL: ${done}/${updates.length} mises à jour…`);
  }
  if (updates.length) console.log('');
  return done;
}

async function flushFsLegacy(
  patches: { ref: FirebaseFirestore.DocumentReference; scheduledAt: string }[]
): Promise<number> {
  if (!patches.length) return 0;
  let done = 0;
  for (let i = 0; i < patches.length; i += FS_BATCH) {
    const chunk = patches.slice(i, i + FS_BATCH);
    const batch = db.batch();
    for (const p of chunk) {
      batch.set(p.ref, { scheduledAt: p.scheduledAt }, { merge: true });
    }
    await batch.commit();
    done += chunk.length;
    process.stdout.write(`\r  Firestore legacy: ${done}/${patches.length} patchés…`);
  }
  if (patches.length) console.log('');
  return done;
}

async function main() {
  const t0 = Date.now();
  console.log(`\n📅 Normalisation scheduledAt — mode ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

  console.log('  Chargement PostgreSQL…');
  const pgRows = await prisma.order.findMany({
    select: { id: true, status: true, driverId: true, scheduledAt: true },
  });
  const pgById = new Map(pgRows.map((r) => [r.id, r]));
  console.log(`  ${pgRows.length} commandes en PG`);

  console.log('  Chargement Firestore…');
  const snap = await db.collection('orders').get();
  console.log(`  ${snap.size} commandes Firestore\n`);

  let fsOnly = 0;
  let pgDiff = 0;
  let alreadyOk = 0;
  let verboseLogged = 0;

  const pgUpdates: { id: string; scheduledAt: string | null }[] = [];
  const fsLegacyPatches: {
    ref: FirebaseFirestore.DocumentReference;
    scheduledAt: string;
  }[] = [];

  let n = 0;
  for (const doc of snap.docs) {
    n++;
    if (n % 500 === 0) {
      process.stdout.write(`\r  Analyse ${n}/${snap.size}…`);
    }

    const data = doc.data();
    const record = data as Record<string, unknown>;
    const canonical = normalizeScheduledAtIso(record);

    if (hasLegacyScheduleFieldsOnly(record) && canonical) {
      fsOnly++;
      if (verboseLogged < VERBOSE_LIMIT) {
        console.log(
          `  legacy→scheduledAt  ${doc.id}  (${String(data.dateProgrammee ?? data.scheduledDate ?? data.scheduled_date).slice(0, 24)})`
        );
        verboseLogged++;
      }
      if (apply) {
        fsLegacyPatches.push({ ref: doc.ref, scheduledAt: canonical });
      }
    }

    const pg = pgById.get(doc.id);
    if (!pg) continue;

    if (sameScheduled(canonical, pg.scheduledAt)) {
      alreadyOk++;
      continue;
    }

    pgDiff++;
    if (verboseLogged < VERBOSE_LIMIT) {
      console.log(
        `  PG align ${doc.id}  ${pg.scheduledAt ?? 'null'} → ${canonical ?? 'null'}`
      );
      verboseLogged++;
    }
    if (apply) {
      pgUpdates.push({ id: doc.id, scheduledAt: canonical });
    }
  }
  console.log(`\r  Analyse ${snap.size}/${snap.size} — terminée.     `);
  if (pgDiff > VERBOSE_LIMIT) {
    console.log(`  … +${pgDiff - Math.min(pgDiff, VERBOSE_LIMIT)} autres écarts PG (non affichés)`);
  }

  if (apply) {
    console.log('\n  Écriture…');
    await flushFsLegacy(fsLegacyPatches);
    const pgPatched = await flushPgUpdates(pgUpdates);
    console.log(`  Firestore legacy patchés : ${fsLegacyPatches.length}`);
    console.log(`  PostgreSQL patchés       : ${pgPatched}`);
  }

  const pgUpdateMap = new Map(pgUpdates.map((u) => [u.id, u.scheduledAt]));
  const pgEffective = pgRows.map((o) => ({
    ...o,
    scheduledAt: apply && pgUpdateMap.has(o.id) ? pgUpdateMap.get(o.id)! : o.scheduledAt,
  }));

  const pgUnassigned = pgEffective.filter((o) => isDashboardUnassigned(o));
  const pgScheduled = pgEffective.filter((o) => isDashboardScheduled(o));

  let fsUnassigned = 0;
  let fsScheduled = 0;
  for (const doc of snap.docs) {
    const s = sliceFromFs(doc.data());
    if (isDashboardUnassigned(s)) fsUnassigned++;
    if (isDashboardScheduled(s)) fsScheduled++;
  }

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n── Résumé ──');
  console.log(`  Durée                          : ${sec}s`);
  console.log(`  Firestore legacy sans scheduledAt : ${fsOnly}`);
  console.log(`  Écarts PG scheduledAt          : ${pgDiff}`);
  console.log(`  Déjà alignés                   : ${alreadyOk}`);
  if (!apply && pgDiff > 0) {
    console.log('\n  Relancez: npm run sync:normalize-scheduled -- --apply');
  }
  console.log('\n── Compteurs Dashboard (règles UI) ──');
  console.log(`  À attribuer   PG: ${pgUnassigned.length}  |  FS: ${fsUnassigned}`);
  console.log(`  Programmées   PG: ${pgScheduled.length}  |  FS: ${fsScheduled}`);
  if (!apply && pgDiff > 0) {
    console.log('  (PG ci-dessus = état actuel ; lancez --apply pour aligner)');
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
