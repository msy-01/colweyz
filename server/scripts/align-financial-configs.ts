/**
 * Aligne PostgreSQL sur Firestore collectionGroup('configs') — rentabilité.
 *
 * Usage:
 *   npm run sync:align-financial-configs           # dry-run
 *   npm run sync:align-financial-configs -- --apply
 */
import 'dotenv/config';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { prisma } from '../src/lib/prisma.js';
import {
  buildFinancialConfigPayload,
  financialConfigKey,
  upsertFinancialConfigRow,
} from '../src/lib/financial-config.js';

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH || !fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS manquant');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = admin.initializeApp({ credential: admin.credential.cert(sa) }, 'align-fin');
const dbId = process.env.FIREBASE_DATABASE_ID;
const db = dbId ? getFirestore(app, dbId) : getFirestore(app);

async function main() {
  const t0 = Date.now();
  console.log(`\n📊 Alignement configs rentabilité — ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

  const before = await prisma.financialConfig.count();
  const snap = await db.collectionGroup('configs').get();
  console.log(`  PG avant: ${before}  |  Firestore configs: ${snap.size}\n`);

  const fsKeys = new Set<string>();
  const toImport: { docId: string; data: Record<string, unknown>; docPath: string }[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const p = buildFinancialConfigPayload(doc.id, data, doc.ref.path);
    if (!p) continue;
    fsKeys.add(financialConfigKey(p.productId, p.dateEffet));
    toImport.push({ docId: doc.id, data, docPath: doc.ref.path });
  }

  const pgRows = await prisma.financialConfig.findMany({
    select: { id: true, productId: true, dateEffet: true },
  });

  const orphanPg = pgRows.filter((r) => {
    if (!r.productId || !r.dateEffet) return true;
    return !fsKeys.has(financialConfigKey(r.productId, r.dateEffet));
  });

  if (orphanPg.length) {
    console.log(`  Configs PG orphelines (absentes de Firestore): ${orphanPg.length}`);
    for (const r of orphanPg.slice(0, 10)) {
      console.log(`    - ${r.id} (${r.productId} / ${r.dateEffet})`);
    }
    if (orphanPg.length > 10) console.log(`    … +${orphanPg.length - 10}`);
  }

  if (apply) {
    if (orphanPg.length) {
      await prisma.financialConfig.deleteMany({
        where: { id: { in: orphanPg.map((r) => r.id) } },
      });
      console.log(`  🗑️  ${orphanPg.length} orphelines supprimées`);
    }

    let n = 0;
    for (const { docId, data, docPath } of toImport) {
      n++;
      if (n % 20 === 0) process.stdout.write(`\r  Import ${n}/${toImport.length}…`);
      await upsertFinancialConfigRow(docId, data, docPath);
    }
    if (toImport.length) console.log(`\r  Import ${toImport.length}/${toImport.length} — terminé.   `);
  } else {
    console.log(`  Écriture: ${toImport.length} upserts + suppression orphelines`);
    console.log('  Relancez avec --apply');
  }

  const after = apply ? await prisma.financialConfig.count() : before;
  console.log(`\n  PG après: ${after}`);
  console.log(`  Durée: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
