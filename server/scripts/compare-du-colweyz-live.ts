/**
 * Compare « Dû à Colweyz » live : Firestore vs PG/API (sans dump JSON).
 * Usage: cd server && npx tsx scripts/compare-du-colweyz-live.ts
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import {
  modePaiementFromPaymentMethod,
  paymentMethodFromFirestore,
} from '../src/lib/payment-method.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'du-live');
const db = getFirestore(app, process.env.FIREBASE_DATABASE_ID);

function isRegionalOrder(
  o: { status: string; zoneId?: string | null },
  zoneType: Map<string, string>
): boolean {
  const regionalStatuses = [
    'regional_en_attente',
    'expedition_en_cours',
    'expedition_livree',
    'regional_contacte',
    'regional_relance',
    'regional_prete',
    'regional_injoignable',
    'regional_injoignable_x2',
    'regional_injoignable_x3',
    'regional_reporte',
    'regional_annule',
  ];
  return (
    regionalStatuses.includes(o.status) ||
    (o.zoneId != null && zoneType.get(o.zoneId) === 'regional')
  );
}

function isCashFs(o: { modePaiement?: string; paymentMethod?: string | null }): boolean {
  return (
    o.modePaiement === 'Espèces' ||
    (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod))
  );
}

function isCashApi(o: { paymentMethod: string | null }): boolean {
  const mp = modePaiementFromPaymentMethod(o.paymentMethod);
  return mp === 'Espèces' || (!mp && (o.paymentMethod === 'cash' || !o.paymentMethod));
}

function debtDeliveries(
  orders: {
    status: string;
    amount: number;
    remuneration: number | null;
    zoneId?: string | null;
  }[],
  initial: number,
  zoneType: Map<string, string>,
  cashFn: (o: { modePaiement?: string; paymentMethod?: string | null }) => boolean,
  shapeCash: (o: (typeof orders)[0]) => { modePaiement?: string; paymentMethod?: string | null }
) {
  const rel = orders.filter(
    (o) =>
      o.status === 'livré' ||
      o.status === 'terminé' ||
      o.status === 'expedition_livree'
  );
  const totalCash = rel
    .filter((o) => cashFn(shapeCash(o)))
    .reduce((s, o) => s + (o.amount ?? 0), 0);
  const totalRemun = rel.reduce(
    (s, o) => (isRegionalOrder(o, zoneType) ? s : s + (o.remuneration ?? 0)),
    0
  );
  const balance = initial + totalRemun - totalCash;
  return {
    due: balance < 0 ? Math.abs(balance) : 0,
    totalCash,
    totalRemun,
    initial,
    relN: rel.length,
  };
}

async function main() {
  const [drivers, zones, pgOrders] = await Promise.all([
    prisma.driver.findMany({ select: { id: true, initialBalance: true } }),
    prisma.zone.findMany({ select: { id: true, type: true } }),
    prisma.order.findMany({
      where: { status: { in: ['livré', 'terminé', 'expedition_livree'] } },
      select: {
        status: true,
        amount: true,
        remuneration: true,
        paymentMethod: true,
        zoneId: true,
      },
    }),
  ]);

  const zoneType = new Map(zones.map((z) => [z.id, z.type ?? '']));
  const initial = drivers.reduce((s, d) => s + (d.initialBalance ?? 0), 0);

  const snap = await db.collection('orders').get();
  const fsOrders = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        status: String(data.status ?? ''),
        amount: Number(data.amount ?? 0),
        remuneration: Number(data.remuneration ?? 0) || null,
        zoneId: (data.zoneId as string) || null,
        modePaiement:
          (data.modePaiement as string) ||
          modePaiementFromPaymentMethod(paymentMethodFromFirestore(data)),
        paymentMethod: paymentMethodFromFirestore(data),
      };
    })
    .filter(
      (o) =>
        o.status === 'livré' ||
        o.status === 'terminé' ||
        o.status === 'expedition_livree'
    );

  const pgApi = debtDeliveries(
    pgOrders,
    initial,
    zoneType,
    isCashApi,
    (o) => ({ paymentMethod: o.paymentMethod })
  );

  const fsUi = debtDeliveries(
    fsOrders,
    initial,
    zoneType,
    isCashFs,
    (o) => ({ modePaiement: o.modePaiement, paymentMethod: o.paymentMethod })
  );

  // Ancienne version Deliveries : rémunération sans exclusion régional
  const relFs = fsOrders.filter(
    (o) =>
      o.status === 'livré' ||
      o.status === 'terminé' ||
      o.status === 'expedition_livree'
  );
  const cashFsTotal = relFs
    .filter((o) => isCashFs({ modePaiement: o.modePaiement, paymentMethod: o.paymentMethod }))
    .reduce((s, o) => s + o.amount, 0);
  const remFsAll = relFs.reduce((s, o) => s + (o.remuneration ?? 0), 0);
  const balOld = initial + remFsAll - cashFsTotal;
  const fsUiOldRemun = { due: balOld < 0 ? Math.abs(balOld) : 0, totalRemun: remFsAll };

  const pgRel = pgOrders;
  const cashPg = pgRel.filter((o) => isCashApi(o)).reduce((s, o) => s + o.amount, 0);
  const remPgAll = pgRel.reduce((s, o) => s + (o.remuneration ?? 0), 0);
  const balPgOld = initial + remPgAll - cashPg;
  const pgOldRemun = { due: balPgOld < 0 ? Math.abs(balPgOld) : 0, totalRemun: remPgAll };

  let paymentMismatch = 0;
  let paymentMismatchAmt = 0;
  const pgMap = new Map(
    (
      await prisma.order.findMany({
        where: { status: { in: ['livré', 'terminé', 'expedition_livree'] } },
        select: { id: true, paymentMethod: true, amount: true },
      })
    ).map((o) => [o.id, o])
  );

  for (const doc of snap.docs) {
    const data = doc.data();
    if (
      data.status !== 'livré' &&
      data.status !== 'terminé' &&
      data.status !== 'expedition_livree'
    )
      continue;
    const pg = pgMap.get(doc.id);
    if (!pg) continue;
    const pmFs = paymentMethodFromFirestore(data);
    if (pmFs && pg.paymentMethod !== pmFs) {
      paymentMismatch++;
      paymentMismatchAmt += Number(data.amount ?? 0);
    }
  }

  console.log('\n=== Dû à Colweyz (live) ===\n');
  console.log('Firestore (formule actuelle, skip régional):', fsUi);
  console.log('Firestore (ancienne: remun sans skip régional):', fsUiOldRemun);
  console.log('PostgreSQL / API (formule actuelle):', pgApi);
  console.log('PostgreSQL (ancienne: remun sans skip régional):', pgOldRemun);
  console.log('Écart due FS vs PG (formule actuelle):', pgApi.due - fsUi.due, 'FCFA');
  console.log('Commandes paymentMethod PG ≠ Firestore:', paymentMismatch, 'montant cash:', paymentMismatchAmt);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
