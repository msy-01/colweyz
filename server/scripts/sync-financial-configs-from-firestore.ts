/**
 * Alias : aligne PG sur Firestore (avec --apply).
 * Préférer: npm run sync:align-financial-configs -- --apply
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes('--apply');
const args = ['tsx', path.join(__dirname, 'align-financial-configs.ts')];
if (apply) args.push('--apply');

const r = spawnSync('npx', args, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
process.exit(r.status ?? 1);
