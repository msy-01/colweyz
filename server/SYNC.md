# Synchronisation dual-app (Firestore ↔ PostgreSQL)

## État actuel (reconstruction backend)

- **Reverse sync désactivé** (`SYNC_REVERSE_ENABLED=false`) : PostgreSQL ne doit pas écrire dans Firestore tant que l’ancienne app est en production.
- **Référence données** : export `colweyz_firebase_dump_2026-05-23.json` → `npm run db:align` dans `server/`.
- **Forward sync** (`npm run sync`) : Firestore → PG uniquement (lecture Firestore, pas d’écriture).

---

## Urgence : l’ancienne app affiche des données anciennes

**Cause la plus fréquente** : le worker **reverse** (`PG → Firestore`) a réécrit Firestore avec un PostgreSQL en retard (seed, backup, ou PG pas encore rattrapé par le forward).

### Arrêt immédiat

1. Dans `server/.env` :

```env
SYNC_REVERSE_ENABLED=false
```

2. Arrêter les processus (Ctrl+C dans le terminal, ou) :

```bash
pkill -f "reverse-worker"
pkill -f "run-sync-all"
```

3. Garder **optionnellement** le forward (`SYNC_ENABLED=true`, `npm run sync`) : il met à jour PostgreSQL depuis Firestore **sans modifier** l’ancienne app.

4. **Ne pas** relancer `sync:reverse` tant que PostgreSQL n’est pas la source de vérité confirmée (`npm run sync:parity` + vérif métier).

### Restaurer Firestore

- Point-in-time restore dans la **console Firebase** (si activé), ou
- Réimporter un export Firestore antérieur à la panne.

Le forward seul **ne remonte pas** un Firestore déjà écrasé : il lit Firestore → PG, pas l’inverse.

### Diagnostic

```bash
cd server && npx tsx scripts/sync-diagnose.ts
```

---

# Synchronisation dual-app (Firestore ↔ PostgreSQL)

Deux interfaces en parallèle : **ancienne app** (Firestore temps réel) et **nouvelle app** (API + PostgreSQL + polling).

## Prérequis

1. PostgreSQL alimenté (`npm run db:seed` ou sync déjà actif).
2. `GOOGLE_APPLICATION_CREDENTIALS` et `FIREBASE_DATABASE_ID` dans `server/.env`.
3. Les deux workers activés :

```env
SYNC_ENABLED=true
SYNC_REVERSE_ENABLED=true
SYNC_REVERSE_POLL_MS=3000
SYNC_REVERSE_DELETE_EVERY=10
```

## Lancer la sync

Terminal 1 — API :

```bash
cd server && npm run dev
```

Terminal 2 — sync bidirectionnelle :

```bash
cd server && npm run sync:all
```

Ou séparément : `npm run sync` (Firestore→PG) et `npm run sync:reverse` (PG→Firestore).

## Vérifier la parité

```bash
cd server && npm run sync:parity
```

Compare les effectifs PG vs Firestore par collection.

## Collections couvertes

| Firestore | PostgreSQL | Reverse (push + delete reconcile) |
|-----------|------------|-----------------------------------|
| orders | orders | oui |
| drivers, zones, users | idem | oui |
| fund_requests | fund_requests | oui (curseur `dbUpdatedAt`) |
| products (+ variants/images) | products | oui |
| stockLivreurs, stock_operations | idem | oui |
| purchase_orders | idem | oui |
| daily_entries, daily_finance | idem | oui |
| accounting_entries | idem | oui |
| settings/global | app_settings | push (pas de reconcile delete) |
| config/* | app_config | oui |
| campagnes/{pid}/configs/{date} | financial_configs | oui (collectionGroup) |
| claude_analysis | claude_analysis | oui |

## Anti-boucle

- Le reverse worker ajoute `_syncSource: 'postgres'` sur chaque doc Firestore.
- Le forward worker **ignore** ces événements (pas de réécriture PG).
- Les timestamps `updatedAt` / `firestoreUpdatedAt` / `dbUpdatedAt` évitent les écrasements obsolètes.

## Nouvelle app — rafraîchissement UI

Polling configurable dans `.env` à la racine :

```env
VITE_POLL_CRITICAL_MS=800
VITE_POLL_STANDARD_MS=1500
VITE_POLL_CALM_MS=4000
VITE_POLL_CONFIG_MS=15000
```

## Sécurité

- `shopifyAccessToken` n’est **pas** poussé vers Firestore par défaut (`SYNC_REVERSE_PUSH_SHOPIFY_TOKEN=false`).
- Les mots de passe utilisateurs ne sont jamais poussés vers Firestore.

## Rollout progressif

Limiter le reverse à quelques collections :

```env
SYNC_REVERSE_COLLECTIONS=orders,drivers,zones,products,stock_operations
```
