/**
 * Lance les deux workers (Firestore→PG et PG→Firestore) dans le même terminal.
 * Usage: cd server && npm run sync:all
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(__dirname, '..');

const children: { name: string; script: string }[] = [
  { name: 'forward', script: 'src/sync/worker.ts' },
];

if (process.env.SYNC_REVERSE_ENABLED === 'true') {
  children.push({ name: 'reverse', script: 'src/sync/reverse-worker.ts' });
} else {
  console.log('ℹ️  Reverse sync désactivé (SYNC_REVERSE_ENABLED≠true) — Firestore non modifié par PG\n');
}

console.log('🔄 Démarrage sync (Ctrl+C pour arrêter)\n');

for (const { name, script } of children) {
  const child = spawn('npx', ['tsx', script], {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    console.log(`[${name}] arrêté (code ${code ?? '?'})`);
  });
}

process.on('SIGINT', () => process.exit(0));
