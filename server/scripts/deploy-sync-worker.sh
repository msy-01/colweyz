#!/usr/bin/env bash
# Recompile le worker sync et redémarre colweyz-sync (obligatoire après git pull).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "=== Build sync worker (dist/) ==="
npm run build
echo "=== Restart colweyz-sync ==="
systemctl restart colweyz-sync
sleep 2
systemctl --no-pager status colweyz-sync | head -15
echo ""
echo "✅ Worker à jour. Vérifiez: journalctl -u colweyz-sync -f"
