import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { processUpsert } from './dist/sync/upsert.js';

const prisma = new PrismaClient();

async function run() {
  console.log("Loading dump...");
  const rawData = fs.readFileSync('/opt/colweyz/dump.json', 'utf-8');
  const fb = JSON.parse(rawData);
  console.log("Dump loaded!");

  console.log("Re-syncing orders to populate driverName & regionalPaidAt...");
  // fb.orders is an array physically in dump.json
  const fbOrders = Array.isArray(fb.orders) ? fb.orders : Object.values(fb.orders || {});
  for(const data of fbOrders) {
      if (data.id) {
         await processUpsert({ collectionName: 'orders', docId: data.id }, data, 'set', { force: true });
      }
  }

  console.log("Re-syncing settings to populate stockMigratedV2...");
  const fbSettings = Array.isArray(fb.settings) ? fb.settings : Object.values(fb.settings || {});
  for(const data of fbSettings) {
      await processUpsert({ collectionName: 'settings', docId: 'global' }, data, 'set', { force: true });
  }

  console.log("Done syncing missing fields!");
}

run().catch(console.error).finally(()=>prisma.$disconnect());
