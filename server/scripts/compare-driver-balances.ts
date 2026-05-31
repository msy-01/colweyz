/**
 * Compare solde livreur : Firestore vs PostgreSQL (formule DriverView / Balances).
 * Usage: cd server && npx tsx scripts/compare-driver-balances.ts [nom-partiel]
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import fs from 'fs';
import { getFirestore } from 'firebase-admin/firestore';
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

const filterName = process.argv[2]?.toLowerCase();

const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp(
  { credential: admin.credential.cert(sa) },
  'driver-bal-compare'
);
const db = getFirestore(app, process.env.FIREBASE_DATABASE_ID);

const FINISHED = ['livré', 'terminé', 'expedition_livree'] as const;

function isRegional(
  o: { status: string; zoneId: string | null },
  zoneType: Map<string, string>
): boolean {
  const st = [
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
    st.includes(o.status) ||
    (o.zoneId != null && zoneType.get(o.zoneId) === 'regional')
  );
}

function driverBalance(
  initial: number,
  orders: {
    status: string;
    amount: number;
    remuneration: number;
    zoneId: string | null;
    paymentMethod: string | null;
    modePaiement?: string;
  }[],
  zoneType: Map<string, string>,
  cashFn: (o: (typeof orders)[0]) => boolean
) {
  const rel = orders.filter((o) => FINISHED.includes(o.status as (typeof FINISHED)[number]));
  const cash = rel.filter(cashFn).reduce((s, o) => s + o.amount, 0);
  const rem = rel.reduce(
    (s, o) => (isRegional(o, zoneType) ? s : s + o.remuneration),
    0
  );
  const balance = initial + rem - cash;
  return {
    balance,
    dueColweyz: balance < 0 ? Math.abs(balance) : 0,
    dueDriver: balance > 0 ? balance : 0,
    orders: rel.length,
  };
}

async function main() {
  const [drivers, zones] = await Promise.all([
    prisma.driver.findMany({ orderBy: { name: 'asc' } }),
    prisma.zone.findMany({ select: { id: true, type: true } }),
  ]);
  const zoneType = new Map(zones.map((z) => [z.id, z.type ?? '']));

  const snap = await db.collection('orders').get();

  for (const d of drivers) {
    if (filterName && !d.name.toLowerCase().includes(filterName)) continue;

    const fsOrders = snap.docs
      .filter((doc) => doc.data().driverId === d.id)
      .map((doc) => {
        const data = doc.data();
        const pm = paymentMethodFromFirestore(data);
        return {
          status: String(data.status ?? ''),
          amount: Number(data.amount ?? 0),
          remuneration: Number(data.remuneration ?? 0) || 0,
          zoneId: (data.zoneId as string) || null,
          paymentMethod: pm,
          modePaiement:
            (data.modePaiement as string) ||
            modePaiementFromPaymentMethod(pm),
        };
      });

    const pgOrders = await prisma.order.findMany({
      where: { driverId: d.id, status: { in: [...FINISHED] } },
      select: {
        status: true,
        amount: true,
        remuneration: true,
        zoneId: true,
        paymentMethod: true,
      },
    });

    const initial = Number(d.initialBalance) || 0;
    const fs = driverBalance(
      initial,
      fsOrders,
      zoneType,
      (o) =>
        o.modePaiement === 'Espèces' ||
        (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod))
    );
    const pg = driverBalance(
      initial,
      pgOrders.map((o) => ({
        status: o.status,
        amount: o.amount ?? 0,
        remuneration: o.remuneration ?? 0,
        zoneId: o.zoneId,
        paymentMethod: o.paymentMethod,
      })),
      zoneType,
      (o) => {
        const mp = modePaiementFromPaymentMethod(o.paymentMethod);
        return (
          mp === 'Espèces' ||
          (!mp && (o.paymentMethod === 'cash' || !o.paymentMethod))
        );
      }
    );

    const gap = pg.dueColweyz - fs.dueColweyz;
    if (!filterName && gap === 0 && fs.orders === pg.orders) continue;

    console.log(
      `${d.name} (${d.id}): FS dû Colweyz=${fs.dueColweyz} | PG=${pg.dueColweyz} | écart=${gap} | cmd FS=${fs.orders} PG=${pg.orders}`
    );
  }
  console.log('\n✓ ddns (PG) doit être identique à la colonne PG ci-dessus.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
