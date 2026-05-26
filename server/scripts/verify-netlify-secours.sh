#!/usr/bin/env bash
# Vérification bout-en-bout : Netlify proxy → VPS API → PostgreSQL
# Usage: ./scripts/verify-netlify-secours.sh [BASE_URL]
#   BASE_URL défaut: https://colweyz.netlify.app

set -euo pipefail
BASE="${1:-https://colweyz.netlify.app}"
API="$BASE/api"

echo "=== ColWeyz — vérification mode secours PG ==="
echo "Base: $API"
echo

fail=0
check() {
  local name="$1" code="$2" expect="$3"
  if [[ "$code" == "$expect" ]]; then
    echo "  OK  $name ($code)"
  else
    echo "  FAIL $name (got $code, want $expect)"
    fail=1
  fi
}

code=$(curl -sS -o /tmp/health.json -w "%{http_code}" "$API/health" --connect-timeout 15)
check "health" "$code" "200"
grep -q '"status":"ok"' /tmp/health.json && echo "       DB: $(python3 -c "import json;print(json.load(open('/tmp/health.json')).get('database'))" 2>/dev/null || echo ok)"

code=$(curl -sS -o /tmp/login.json -w "%{http_code}" -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin","role":"admin"}')
check "auth/login" "$code" "200"
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/login.json'))['token'])" 2>/dev/null || TOKEN="")
if [[ -z "$TOKEN" ]]; then echo "  FAIL pas de JWT"; exit 1; fi
echo "       JWT obtenu (${#TOKEN} chars)"

for path in orders zones drivers products; do
  query=""
  [[ "$path" == "orders" ]] && query="?lite=1"
  code=$(curl -sS -o /tmp/data.json -w "%{http_code}" "$API/$path$query" \
    -H "Authorization: Bearer $TOKEN" --connect-timeout 30)
  n=$(python3 -c "import json;d=json.load(open('/tmp/data.json')); print(len(d) if isinstance(d,list) else 'ERR')" 2>/dev/null || echo ERR)
  check "GET /$path (count=$n)" "$code" "200"
  if [[ "$path" == "orders" && "$n" != ERR && "$n" -lt 100 ]]; then
    echo "  WARN orders < 100 — PG peut être vide ou filtre incorrect"
  fi
done

echo
if [[ $fail -eq 0 ]]; then
  echo "Résultat: infrastructure API OK pour le mode secours."
  echo "App: après deploy, tester bannière ambre + reconnecter (JWT)."
else
  echo "Résultat: échecs détectés — corriger VPS / Netlify redirects."
  exit 1
fi
