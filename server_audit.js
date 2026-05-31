const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log("Loading dump...");
  const rawData = fs.readFileSync('/opt/colweyz/dump.json', 'utf-8');
  const fb = JSON.parse(rawData);
  console.log("Dump loaded!");

  const pgModels = {
    orders: prisma.order,
    drivers: prisma.driver,
    zones: prisma.zone,
    products: prisma.product,
    fund_requests: prisma.fundRequest,
    users: prisma.systemUser,
    stockLivreurs: prisma.stockLivreur,
    stock_operations: prisma.stockOperation,
    purchase_orders: prisma.purchaseOrder,
    daily_entries: prisma.dailyEntry,
    financial_configs: prisma.financialConfig,
  };

  console.log("\n=======================================================");
  console.log("1. COUNTS");
  console.log("=======================================================");
  
  for (const fbCollection of Object.keys(pgModels)) {
      const fbCount = fb[fbCollection] ? Object.keys(fb[fbCollection]).length : 0;
      const model = pgModels[fbCollection];
      const pgCount = await model.count();
      
      const match = fbCount === pgCount ? '✅' : '❌';
      console.log(`${match} ${fbCollection.padEnd(20)} FB: ${fbCount.toString().padStart(4)} | PG: ${pgCount.toString().padStart(4)}`);
  }

  console.log("\n=======================================================");
  console.log("2. FIELD DIFFERENCES (ORDERS - Spot check)");
  console.log("=======================================================");

  const allPgOrders = await prisma.order.findMany();
  const pgOrdersMap = new Map();
  for(const o of allPgOrders) {
     pgOrdersMap.set(o.id, o);
  }

  let diffs = 0;
  const fbOrders = Array.isArray(fb.orders) ? fb.orders : Object.values(fb.orders || {});
  for (const fbO of fbOrders) {
     const id = fbO.id;
     if (!pgOrdersMap.has(id)) {
        console.log(`❌ Order ${id} missing in PG!`);
        diffs++;
        continue;
     }
     const pgO = pgOrdersMap.get(id);
     
     const checkField = (fbVal, pgVal, fieldName) => {
        let fv = fbVal;
        let pv = pgVal;
        if (fv === null || fv === '') fv = undefined;
        if (pv === null || pv === '') pv = undefined;
        
        if (typeof fv === 'number' && typeof pv === 'number') {
           if (Math.round(fv) !== Math.round(pv)) return `FB=${fv} != PG=${pv}`;
        } else if (String(fv || '') !== String(pv || '')) {
           return `FB='${fv}' != PG='${pv}'`;
        }
        return null;
     };

     const pmFb = fbO.paymentMethod || fbO.modePaiement; 
     
     const fields = [
       { fb: 'amount', pg: 'amount' },
       { fb: 'remuneration', pg: 'remuneration' },
       { fb: 'deliveryCost', pg: 'deliveryCost' },
       { fb: 'status', pg: 'status' },
       { fb: 'driverId', pg: 'driverId' },
     ];

     const orderDiff = [];
     for(const f of fields) {
        const res = checkField(fbO[f.fb], pgO[f.pg]);
        if(res) orderDiff.push(`${f.fb}: ${res}`);
     }

     if(orderDiff.length > 0) {
        diffs++;
        if(diffs <= 10) {
            console.log(`❌ Order ${id}: ${orderDiff.join(', ')}`);
        }
     }
  }

  console.log(`Total Orders with differences: ${diffs}`);

  console.log("\n=======================================================");
  console.log("3. FIELD DIFFERENCES (DRIVERS)");
  console.log("=======================================================");
  
  const allPgDrivers = await prisma.driver.findMany();
  const pgDriversMap = new Map();
  for(const d of allPgDrivers) {
      pgDriversMap.set(d.id, d);
  }

  const fbDrivers = Array.isArray(fb.drivers) ? fb.drivers : Object.values(fb.drivers || {});
  for (const fbD of fbDrivers) {
      const id = fbD.id;
      if (!pgDriversMap.has(id)) {
          console.log(`❌ Driver ${id} missing in PG!`);
          continue;
      }
      const pgD = pgDriversMap.get(id);
      
      const fields = ['initialBalance', 'name', 'phone'];
      const driverDiff = [];
      for(const f of fields) {
          const fbv = fbD[f];
          const pgv = pgD[f];
          if(String(fbv||'') !== String(pgv||'')) {
              driverDiff.push(`${f} FB=${fbv} PG=${pgv}`);
          }
      }
      if(driverDiff.length) console.log(`❌ Driver ${fbD.name}: ${driverDiff.join(', ')}`);
      else console.log(`✅ Driver ${fbD.name}: OK`);
  }

  console.log("\nDone.");
}

run().catch(console.error).finally(()=>prisma.$disconnect());
