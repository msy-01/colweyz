/**
 * Corrige payment_method en PG à partir de modePaiement dans l'export Firestore.
 * Usage: npx tsx scripts/backfill-order-payment-methods.ts [chemin/dump.json]
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { paymentMethodFromFirestore } from '../src/lib/payment-method.js';

const prisma = new PrismaClient();

const dumpFile = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(process.cwd(), '..', 'colweyz_firebase_dump_2026-05-26.json');

async function main() {
  console.log(`📂 Dump: ${dumpFile}\n`);
  const dump = JSON.parse(readFileSync(dumpFile, 'utf-8')) as {
    orders?: Record<string, unknown>[];
  };
  const orders = dump.orders ?? [];
  let updated = 0;
  let skipped = 0;

  for (const row of orders) {
    const id = String(row.id ?? '');
    if (!id) continue;

    const next = paymentMethodFromFirestore(row);
    if (!next) {
      skipped++;
      continue;
    }

    const existing = await prisma.order.findUnique({
      where: { id },
      select: { paymentMethod: true },
    });
    if (!existing || existing.paymentMethod === next) continue;

    await prisma.order.update({
      where: { id },
      data: { paymentMethod: next },
    });
    updated++;
    console.log(`  ${id}: ${existing.paymentMethod ?? 'null'} → ${next}`);
  }

  console.log(`\nTerminé: ${updated} commande(s) mises à jour, ${skipped} sans mode de paiement déductible.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
