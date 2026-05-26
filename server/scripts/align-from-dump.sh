#!/usr/bin/env bash
# Aligne PostgreSQL sur un export Firestore JSON (copie de référence).
#
# Usage (sur le VPS, dans le dossier server/) :
#   ./scripts/align-from-dump.sh /chemin/vers/colweyz_firebase_dump_2026-05-25.json
#
# Ou depuis la racine du repo (dump à la racine) :
#   cd server && ./scripts/align-from-dump.sh ../colweyz_firebase_dump_2026-05-25.json

set -euo pipefail

DUMP="${1:-../colweyz_firebase_dump_2026-05-25.json}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$SERVER_ROOT"

if [[ ! -f "$DUMP" ]]; then
  echo "❌ Dump introuvable: $DUMP"
  exit 1
fi

echo "=== ColWeyz — align PG sur dump Firestore ==="
echo "Fichier: $DUMP"
echo ""
echo "1) Arrêt du worker sync (évite conflits pendant l'import)..."
systemctl stop colweyz-sync 2>/dev/null || echo "   (colweyz-sync non systemd — arrêtez npm run sync à la main)"

echo ""
echo "2) Import + align (--align = supprime en PG ce qui n'est pas dans le dump)..."
npx tsx prisma/seed-from-export.ts "$DUMP" --align

echo ""
echo "3) Comparaison dump ↔ PG..."
npx tsx scripts/compare-dump-pg.ts "$DUMP"

echo ""
echo "4) Redémarrage du worker sync..."
systemctl start colweyz-sync 2>/dev/null || echo "   Relancez: systemctl start colweyz-sync"

echo ""
echo "✅ Terminé. Mode secours Netlify devrait refléter Firestore après refresh."
