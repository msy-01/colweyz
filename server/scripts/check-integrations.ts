/**
 * Vérifie que Google Sheet + Shopify sont bien configurés en PostgreSQL.
 * Usage: cd server && npm run check-integrations
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { fetchGoogleSheetCsv } from '../src/lib/fetch-google-sheet.js';

const p = new PrismaClient();

function maskToken(t: string | null | undefined): string {
  if (!t) return '(vide)';
  if (t.length < 12) return '***';
  return `${t.slice(0, 8)}...${t.slice(-4)} (${t.length} car.)`;
}

async function testShopifyFetch(domain: string, token: string): Promise<void> {
  try {
    let shop = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!shop.includes('.')) shop = `${shop}.myshopify.com`;
    const res = await fetch(`https://${shop}/admin/api/2024-01/products.json?limit=1`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) {
      console.log('   Test réseau Shopify: ❌ HTTP 401 — token invalide ou expiré (à regénérer dans Shopify Admin)');
      return;
    }
    console.log(`   Test réseau Shopify: ${res.ok ? `OK (${res.status})` : `HTTP ${res.status}`}`);
  } catch (e) {
    console.log(`   Test réseau Shopify: ❌ ${e instanceof Error ? e.message : e}`);
  }
}

async function testGoogleSheet(url: string): Promise<void> {
  try {
    const csv = await fetchGoogleSheetCsv(url);
    const lines = csv.split('\n').filter((l) => l.trim()).length;
    console.log(`   Test réseau Google Sheet: ✅ OK (${lines} lignes CSV)`);
  } catch (e) {
    console.log(`   Test réseau Google Sheet: ❌ ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  console.log('\n📋 ColWeyz — Vérification intégrations (PostgreSQL)\n');

  const settings = await p.appSettings.findUnique({ where: { id: 'global' } });
  const sheetCfg = await p.appConfig.findUnique({ where: { key: 'googleSheetUrl' } });

  const envDomain = process.env.SHOPIFY_DOMAIN?.trim();
  const envToken = process.env.SHOPIFY_ACCESS_TOKEN?.trim();
  const dbDomain = settings?.shopifyDomain?.trim();
  const dbToken = settings?.shopifyAccessToken?.trim();

  const effectiveDomain = envDomain || dbDomain;
  const effectiveToken = envToken || dbToken;
  const sheetUrl = sheetCfg?.value?.trim();

  console.log('── Shopify (produits) ──');
  console.log('   DB shopifyDomain     :', dbDomain || '(vide)');
  console.log('   DB shopifyAccessToken:', maskToken(dbToken));
  console.log('   .env SHOPIFY_DOMAIN  :', envDomain || '(non défini)');
  console.log('   .env SHOPIFY_TOKEN   :', envToken ? maskToken(envToken) : '(vide → utilise la DB ✅)');
  console.log('   → Utilisé par l’API   :', effectiveDomain || '(manquant)', '+', effectiveToken ? 'token OK' : '❌ TOKEN MANQUANT');

  console.log('\n── Google Sheet (commandes) ──');
  if (sheetUrl) {
    console.log('   googleSheetUrl       :', sheetUrl.slice(0, 90) + (sheetUrl.length > 90 ? '...' : ''));
    const matchesExport =
      sheetUrl.includes('1nOU1d9ZWQv8JyIAP6vF5QbPVIndTy2-nftv_iCO8-RQ');
    console.log('   Correspond au dump    :', matchesExport ? '✅ oui' : '⚠️ URL différente du backup 2026-05-19');
  } else {
    console.log('   googleSheetUrl       : ❌ ABSENT — configurez Dashboard ou sync Firestore');
  }

  const syncRows = await p.syncState.findMany({
    where: { collectionName: { in: ['settings', 'config'] } },
  });
  console.log('\n── Sync Firestore → PG ──');
  for (const row of syncRows) {
    console.log(`   ${row.collectionName}: ${row.documentsCount} doc(s), dernier sync ${row.lastSyncedAt.toISOString()}`);
  }

  const orderCount = await p.order.count();
  const productCount = await p.product.count({ where: { source: 'shopify' } });
  console.log('\n── Données ──');
  console.log(`   Commandes en base    : ${orderCount}`);
  console.log(`   Produits Shopify     : ${productCount}`);

  console.log('\n── Tests réseau (optionnel) ──');
  console.log('   (curl -I sur Google = souvent 307 → normal ; le GET suit la redirection)');
  if (effectiveDomain && effectiveToken) {
    await testShopifyFetch(effectiveDomain, effectiveToken);
  }
  if (sheetUrl) {
    await testGoogleSheet(sheetUrl);
  }

  console.log('\n── Recommandation migration parallèle ──');
  console.log('   • Import commandes : laisser l’ANCIENNE app lire le Google Sheet → Firestore');
  console.log('   • Nouvelle app       : npm run sync + affichage via API');
  console.log('   • Produits Shopify   : Inventaire ou auto-sync 30 min (nouvelle app)\n');

  const ok = Boolean(effectiveDomain && effectiveToken && sheetUrl);
  process.exit(ok ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
