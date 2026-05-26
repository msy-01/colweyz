/**
 * Diagnostic rapide : fraîcheur PG vs curseurs sync.
 * Usage: cd server && npx tsx scripts/sync-diagnose.ts
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const recentOrders = await prisma.order.count({ where: { updatedAt: { gt: twoDaysAgo } } });
  const totalOrders = await prisma.order.count();
  const latest = await prisma.order.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, date: true, status: true, updatedAt: true },
  });

  const reverseCursors = await prisma.syncState.findMany({
    where: { collectionName: { startsWith: 'reverse_' } },
    orderBy: { collectionName: 'asc' },
  });

  console.log('\n🔍 Diagnostic sync ColWeyz\n');
  console.log(`Reverse sync (.env)     : SYNC_REVERSE_ENABLED=${process.env.SYNC_REVERSE_ENABLED}`);
  console.log(`Forward sync (.env)     : SYNC_ENABLED=${process.env.SYNC_ENABLED}`);
  console.log(`\nOrders PostgreSQL:`);
  console.log(`  Total                 : ${totalOrders}`);
  console.log(`  Modifiés < 48h        : ${recentOrders}`);
  if (latest) {
    console.log(`  Dernier updatedAt     : ${latest.updatedAt.toISOString()}`);
    console.log(`  Exemple               : ${latest.id} | ${latest.date} | ${latest.status}`);
  }

  if (reverseCursors.length) {
    console.log('\nCurseurs reverse (PG→Firestore) :');
    for (const c of reverseCursors) {
      console.log(`  ${c.collectionName.padEnd(28)} ${c.lastSyncedAt.toISOString()}`);
    }
  } else {
    console.log('\nCurseurs reverse : aucun (reverse jamais poussé ou reset)');
  }

  if (recentOrders < totalOrders * 0.1 && totalOrders > 100) {
    console.log('\n⚠️  PostgreSQL semble figé (peu de mises à jour récentes).');
    console.log('   Le reverse sync peut avoir écrasé Firestore avec cet état ancien.');
  }

  console.log('\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
