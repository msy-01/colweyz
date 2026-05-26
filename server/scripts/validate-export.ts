/**
 * Valide un export JSON Firestore (backup) : comptages par collection.
 * Usage: npm run validate [chemin/vers/export.json]
 */
import * as fs from 'fs';
import * as path from 'path';

const EXPORT_PATH =
  process.argv[2] ||
  path.join(process.env.HOME || '/home/chiffer', 'Téléchargements', 'colweyz_full_backup_2026-05-18.json');

const EXPECTED_KEYS = [
  'drivers',
  'zones',
  'orders',
  'users',
  'fund_requests',
  'products',
  'adhoc_products',
  'financial_configs',
  'daily_entries',
  'daily_finance',
  'purchase_orders',
  'accounting_entries',
  'stockLivreurs',
  'stock_operations',
  'settings',
  'config',
  'claude_analysis',
] as const;

function countValue(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  if (value !== undefined && value !== null) return 1;
  return 0;
}

function main() {
  console.log(`\n📂 Validation export: ${EXPORT_PATH}\n`);

  if (!fs.existsSync(EXPORT_PATH)) {
    console.error(`❌ Fichier introuvable: ${EXPORT_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(EXPORT_PATH, 'utf8');
  let data: Record<string, unknown>;

  try {
    data = JSON.parse(raw);
  } catch {
    console.error('❌ JSON invalide');
    process.exit(1);
  }

  const sizeMb = (Buffer.byteLength(raw) / 1024 / 1024).toFixed(2);
  console.log(`Taille: ${sizeMb} Mo\n`);
  console.log('Collection'.padEnd(28), 'Count');
  console.log('─'.repeat(40));

  let total = 0;
  for (const key of EXPECTED_KEYS) {
    const count = countValue(data[key]);
    total += count;
    const marker = count === 0 ? ' (vide)' : '';
    console.log(key.padEnd(28), String(count) + marker);
  }

  const extraKeys = Object.keys(data).filter((k) => !EXPECTED_KEYS.includes(k as (typeof EXPECTED_KEYS)[number]));
  if (extraKeys.length) {
    console.log('\nClés supplémentaires dans le fichier:');
    for (const k of extraKeys) {
      console.log(`  ${k}: ${countValue(data[k])}`);
    }
  }

  console.log('─'.repeat(40));
  console.log('Total documents'.padEnd(28), total);
  console.log('\n✅ Validation terminée\n');
}

main();
