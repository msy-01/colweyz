/**
 * Vérification forward sync : PG vs Firestore (champs métier + dashboard).
 * Usage: cd server && npx tsx scripts/verify-forward-sync.ts
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import { paymentMethodFromFirestore } from '../src/lib/payment-method.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'verify-forward');
const dbId = process.env.FIREBASE_DATABASE_ID;
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

const ORDER_FIELDS = ['status', 'driverId', 'zoneId', 'amount', 'scheduledAt'] as const;

function estProgrammee(scheduledAt: string | null): boolean {
  if (!scheduledAt) return false;
  return Date.now() < new Date(scheduledAt).getTime() + 60_000;
}

async function compareOrders() {
  const pgOrders = await prisma.order.findMany({
    select: {
      id: true,
      status: true,
      driverId: true,
      zoneId: true,
      amount: true,
      paymentMethod: true,
      scheduledAt: true,
    },
  });
  const pgMap = new Map(pgOrders.map((o) => [o.id, o]));
  const snap = await db.collection('orders').get();

  let fieldDiffs = 0;
  let paymentDiffs = 0;
  let missingPg = 0;
  const examples: string[] = [];

  for (const doc of snap.docs) {
    const fs = doc.data() as Record<string, unknown>;
    const pg = pgMap.get(doc.id);
    if (!pg) {
      missingPg++;
      continue;
    }
    pgMap.delete(doc.id);

    for (const f of ORDER_FIELDS) {
      const fv = fs[f] ?? null;
      const pv = pg[f as keyof typeof pg] ?? null;
      if (JSON.stringify(fv) !== JSON.stringify(pv)) {
        fieldDiffs++;
        if (examples.length < 5) {
          examples.push(`${doc.id}.${f}: FS=${JSON.stringify(fv)} PG=${JSON.stringify(pv)}`);
        }
        break;
      }
    }

    const pmFs = paymentMethodFromFirestore(fs);
    if (pmFs && pg.paymentMethod !== pmFs) paymentDiffs++;
  }

  const pgUnassigned = pgOrders.filter(
    (o) => o.status === 'validé' && !o.driverId && !estProgrammee(o.scheduledAt)
  ).length;

  let fsUnassigned = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (
      d.status === 'validé' &&
      !d.driverId &&
      !estProgrammee((d.scheduledAt as string) || null)
    ) {
      fsUnassigned++;
    }
  }

  return {
    firestore: snap.size,
    pg: pgOrders.length,
    extraInPg: pgMap.size,
    missingInPg: missingPg,
    fieldDiffs,
    paymentDiffs,
    dashboardUnassigned: { pg: pgUnassigned, firestore: fsUnassigned },
    examples,
  };
}

async function compareCollectionIds(
  label: string,
  pgIds: Set<string>,
  fsIds: Set<string>
) {
  const onlyFs = [...fsIds].filter((id) => !pgIds.has(id));
  const onlyPg = [...pgIds].filter((id) => !fsIds.has(id));
  return {
    label,
    pg: pgIds.size,
    firestore: fsIds.size,
    onlyFirestore: onlyFs.length,
    onlyPg: onlyPg.length,
    sampleFs: onlyFs.slice(0, 3),
    samplePg: onlyPg.slice(0, 3),
  };
}

async function main() {
  console.log('\n🔍 Vérification forward sync (Firestore → PostgreSQL)\n');

  const orders = await compareOrders();
  console.log('── Orders (métier) ──');
  console.log(JSON.stringify(orders, null, 2));

  const [pgStockOp, pgStockLiv, pgFc] = await Promise.all([
    prisma.stockOperation.findMany({ select: { id: true } }),
    prisma.stockLivreur.findMany({ select: { id: true } }),
    prisma.financialConfig.findMany({ select: { id: true } }),
  ]);

  const fsStockOp = await db.collection('stock_operations').get();
  const fsStockLiv = await db.collection('stockLivreurs').get();
  const fsFc = await db.collectionGroup('configs').get();

  const stockOp = await compareCollectionIds(
    'stock_operations',
    new Set(pgStockOp.map((x) => x.id)),
    new Set(fsStockOp.docs.map((d) => d.id))
  );
  const stockLiv = await compareCollectionIds(
    'stockLivreurs',
    new Set(pgStockLiv.map((x) => x.id)),
    new Set(fsStockLiv.docs.map((d) => d.id))
  );
  const fc = await compareCollectionIds(
    'financial_configs',
    new Set(pgFc.map((x) => x.id)),
    new Set(fsFc.docs.map((d) => d.id))
  );

  console.log('\n── Collections secondaires ──');
  console.log(JSON.stringify({ stockOp, stockLiv, fc }, null, 2));

  const okOrders =
    orders.firestore === orders.pg &&
    orders.fieldDiffs === 0 &&
    orders.dashboardUnassigned.pg === orders.dashboardUnassigned.firestore;

  console.log('\n── Résumé ──');
  if (okOrders) {
    console.log('✅ Orders + Dashboard : alignés');
  } else {
    console.log('❌ Orders / Dashboard : écart détecté');
  }

  if (stockOp.onlyFirestore === 0 && stockLiv.onlyFirestore === 0 && fc.onlyFirestore === 0) {
    console.log('✅ Stock + financial_configs : rien en retard côté PG');
  } else {
    console.log(
      '⚠️  Stock/configs : PG en retard (forward doit rattraper, ou resync ciblé si persistant)'
    );
    if (stockOp.onlyFirestore > 0) {
      console.log('   npx tsx scripts/resync-firestore-doc.ts stock_operations --all');
    }
    if (stockLiv.onlyFirestore > 0) {
      console.log('   npx tsx scripts/resync-firestore-doc.ts stockLivreurs --all');
    }
    if (fc.onlyFirestore > 0) {
      console.log('   npm run sync:financial-configs');
    }
  }

  console.log('');
  process.exit(okOrders ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
