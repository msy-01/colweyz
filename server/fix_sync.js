import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { processUpsert } from './dist/sync/upsert.js';
import path from 'path';

const prisma = new PrismaClient();

async function run() {
  console.log("Loading dump...");
  const rawData = fs.readFileSync('/opt/colweyz/dump.json', 'utf-8');
  const fb = JSON.parse(rawData);
  console.log("Dump loaded!");

  console.log("Re-syncing stock_operations...");
  for(const [id, data] of Object.entries(fb.stock_operations || {})) {
      await processUpsert({ collectionName: 'stock_operations', docId: id }, data, 'set', { force: true });
  }

  console.log("Re-syncing stockLivreurs...");
  for(const [id, data] of Object.entries(fb.stockLivreurs || {})) {
      await processUpsert({ collectionName: 'stockLivreurs', docId: id }, data, 'set', { force: true });
  }

  console.log("Re-syncing financial_configs...");
  for(const [id, data] of Object.entries(fb.financial_configs || {})) {
      await processUpsert({ collectionName: 'financial_configs', docId: id }, data, 'set', { force: true });
  }

  console.log("Done syncing missing keys!");
}

run().catch(console.error).finally(()=>prisma.$disconnect());
