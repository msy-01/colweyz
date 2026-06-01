/**
 * Compare PG vs Firestore pour le Dashboard (rapide, sans requête par ID).
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

type OrderSlice = {
  status: string;
  driverId: string | null;
  scheduledAt: string | null;
};

function sliceFromFs(data: FirebaseFirestore.DocumentData): OrderSlice {
  return {
    status: String(data.status ?? 'validé'),
    driverId: (data.driverId as string) || null,
    scheduledAt: normalizeScheduledAtIso(data as Record<string, unknown>),
  };
}

function compareBucket(
  label: string,
  pgMap: Map<string, OrderSlice>,
  fsMap: Map<string, OrderSlice>,
  predicate: (s: OrderSlice) => boolean
): number {
  const pgIds = new Set<string>();
  const fsIds = new Set<string>();

  for (const [id, s] of pgMap) {
    if (predicate(s)) pgIds.add(id);
  }
  for (const [id, s] of fsMap) {
    if (predicate(s)) fsIds.add(id);
  }

  console.log(`\n📋 ${label}`);
  console.log(`   PG: ${pgIds.size}  |  Firestore: ${fsIds.size}`);

  const onlyPg = [...pgIds].filter((id) => !fsIds.has(id));
  const onlyFs = [...fsIds].filter((id) => !pgIds.has(id));
  const mismatch = onlyPg.length + onlyFs.length;

  const show = (ids: string[], labelSide: string, getOther: (id: string) => OrderSlice | undefined) => {
    for (const id of ids.slice(0, 20)) {
      const self = labelSide === 'PG' ? pgMap.get(id)! : fsMap.get(id)!;
      const other = getOther(id);
      console.log(
        `   ≠  ${id}  uniquement ${labelSide} | ${labelSide}: ${self.status}/${self.driverId ?? 'null'}/sched=${self.scheduledAt ?? 'null'}`
      );
      if (other) {
        const side = labelSide === 'PG' ? 'FS' : 'PG';
        console.log(
          `        ${side}: ${other.status}/${other.driverId ?? 'null'}/sched=${other.scheduledAt ?? 'null'}`
        );
      }
    }
    if (ids.length > 20) console.log(`   … +${ids.length - 20} autres uniquement ${labelSide}`);
  };

  show(onlyPg, 'PG', (id) => fsMap.get(id));
  show(onlyFs, 'FS', (id) => pgMap.get(id));

  if (mismatch === 0) console.log('   ✓  Listes identiques');
  return mismatch;
}

async function main() {
  const t0 = Date.now();
  console.log('\n🔍 Diagnostic Dashboard ColWeyz (PG ↔ Firestore)\n');

  const pgRows = await prisma.order.findMany({
    select: { id: true, status: true, driverId: true, scheduledAt: true },
  });
  const pgMap = new Map<string, OrderSlice>(
    pgRows.map((r) => [r.id, { status: r.status, driverId: r.driverId, scheduledAt: r.scheduledAt }])
  );

  const snap = await db.collection('orders').get();
  const fsMap = new Map<string, OrderSlice>();
  for (const doc of snap.docs) {
    fsMap.set(doc.id, sliceFromFs(doc.data()));
  }

  const m1 = compareBucket(
    'Commandes à attribuer',
    pgMap,
    fsMap,
    isDashboardUnassigned
  );
  const m2 = compareBucket(
    'Commandes programmées (futur)',
    pgMap,
    fsMap,
    isDashboardScheduled
  );

  const total = m1 + m2;
  if (total > 0) {
    console.log('\n── Correctifs suggérés ──');
    console.log('  npm run sync:normalize-scheduled -- --apply');
    console.log('  npm run sync:resync-doc -- orders <id> --force');
  }
  console.log(`\nDurée: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
