# Ancienne app (`source_code`) — Firestore + PostgreSQL

## Architecture sync (cible)

```
┌─────────────────────────────────────────────────────────────┐
│  source_code (Netlify / Cloud Run / local)                  │
│  • Mode normal : lecture/écriture Firestore (temps réel)    │
│  • Mode secours : API REST → PostgreSQL (polling)           │
└───────────────┬─────────────────────────────┬───────────────┘
                │ writes (normal)             │ writes (quota)
                ▼                             ▼
         ┌──────────────┐              ┌──────────────┐
         │  Firestore   │              │  PostgreSQL  │
         │  (source     │   forward    │  (VPS)       │
         │   vérité)    │ ──────────►  │              │
         └──────────────┘   worker     └──────────────┘
                ▲              colweyz-sync
                │              (onSnapshot)
                │ reverse OFF  SYNC_REVERSE_ENABLED=false
                └──────────────  (ne pas réécrire Firestore depuis PG)
```

**Principe** : une seule écriture à la fois côté app (Firestore **ou** API). La **copie** vers l’autre base est faite par le **worker forward** (Firestore → PG), pas par l’app.

| Composant | Rôle |
|-----------|------|
| `dataService.ts` | Proxy : Firestore par défaut, bascule API si quota/erreur |
| `dataService.firestore.ts` | Comportement historique (onSnapshot, setDoc) |
| `dataService.api.ts` | Même interface, appels REST + polling |
| `colweyz-api` (VPS) | API + auth JWT |
| `colweyz-sync` (VPS) | `npm run sync` — écoute Firestore → upsert PG |

Collections synchronisées (forward) : `orders`, `drivers`, `zones`, `users`, `products`, `stock_operations`, `stockLivreurs`, `fund_requests`, `financial_configs`, `purchase_orders`, `daily_entries`, `daily_finance`, `accounting_entries`, `settings`, `config`, `claude_analysis`.

---

## Règles d’or

1. **`SYNC_REVERSE_ENABLED=false`** sur le VPS — évite que PG (parfois en retard) écrase Firestore.
2. **Forward toujours actif** quand Firebase répond : `SYNC_ENABLED=true`, service `colweyz-sync`.
3. **Login** : après connexion Firestore, un **JWT API** est aussi enregistré (`primeApiJwt`) pour le secours PG.
4. **Netlify** : `VITE_API_URL` **vide** → proxy `/api` → VPS (pas d’URL `http://IP` en prod).
5. Les écritures en **mode secours** vont **uniquement en PG** jusqu’au retour de Firebase ; elles ne remontent pas seules dans Firestore (reverse coupé).

---

## Checklist « prêt pour la sync »

### VPS (`180.149.197.31`)

```bash
# Services
systemctl status colweyz-api colweyz-sync

# API
curl -s http://127.0.0.1:3001/api/health

# Worker (logs)
journalctl -u colweyz-sync -f --no-pager
```

Dans `server/.env` sur le VPS :

```env
SYNC_ENABLED=true
SYNC_REVERSE_ENABLED=false
GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/firebase-service-account.json
FIREBASE_DATABASE_ID=...
DATABASE_URL=postgresql://...
```

### Netlify

| Variable | Valeur |
|----------|--------|
| `VITE_API_URL` | *(vide)* → proxy `netlify.toml` |
| `VITE_POLL_CRITICAL_MS` | `3000` |
| `VITE_DISABLE_SHOPIFY_AUTO_SYNC` | `true` |
| `VITE_FORCE_API_MODE` | `false` (sauf test) |

Firebase Console → **Authorized domains** → `xxx.netlify.app`.

### Local

```bash
cd source_code && cp .env.example .env && npm install && npm run dev

cd server && npm install && npm run dev    # terminal 1 — API
cd server && npm run sync                  # terminal 2 — forward sync
```

### Vérification rapide

```bash
cd server && npm run sync:diagnose
```

Attendu : `SYNC_REVERSE_ENABLED=false`, orders PG > 0, pas de curseurs `reverse_*`.

Test manuel : modifier une commande dans l’ancienne app (Firestore) → après quelques secondes, même `driverId` / `status` dans PG (`audit-order-changes.ts` ou requête SQL).

---

## Comportement UI

1. **Normal** : bannière verte **Données : Firestore**.
2. **Quota / panne** : bascule auto → bannière ambre **PostgreSQL (secours)**.
3. **Retour Firebase** : bouton **Réessayer Firestore** (recharge la page si besoin).

---

## Déploiement Netlify (résumé)

1. Push `source_code/` sur GitHub (sans `.env`).
2. [app.netlify.com](https://app.netlify.com) → site → **Base directory** : `source_code`.
3. Variables ci-dessus.
4. VPS : `colweyz-api` + `colweyz-sync` actifs.

Proxy (`netlify.toml`) :

```toml
[[redirects]]
  from = "/api/*"
  to = "http://180.149.197.31/api/:splat"
  status = 200
  force = true
```

Quand HTTPS domaine VPS est prêt : `VITE_API_URL=https://colweyz.ddns.net` (ou domaine final).

---

## Quota Firebase — l’app continue-t-elle vraiment ?

| Composant | Rôle quand Firebase est KO |
|-----------|----------------------------|
| **`colweyz-sync` (worker)** | **Non requis** pour utiliser l’app. Il copie Firestore→PG **quand** Firestore répond. Si quota, le worker est aussi bloqué. |
| **`colweyz-api` + PostgreSQL** | **Oui — c’est le secours.** L’app appelle `/api` (proxy Netlify) avec JWT. |
| **Bannière verte « Firestore »** | Tant que les listeners marchent. Au quota → erreur listener → bannière **ambre** + polling PG. |

**Conditions pour que le secours fonctionne sur Netlify :**

1. `VITE_API_URL` **vide** (proxy `/api` → VPS) — ne pas mettre `http://IP` (Mixed Content).
2. **Reconnecter** après bascule (JWT API via `primeApiJwt` au login).
3. Redéployer après correctifs listener (évite listes vides `INITIAL_ORDERS = []`).

**Vérification infra (sans navigateur) :**

```bash
cd server && ./scripts/verify-netlify-secours.sh
# ou: ./scripts/verify-netlify-secours.sh https://colweyz.netlify.app
```

**Test manuel navigateur :** bannière → **Mode secours PG** → déconnexion → login admin → Dashboard doit afficher des milliers de commandes (pas 0).

- **Worker forward** : peut aussi planter (listeners quota) → PG ne reçoit plus les mises à jour **depuis** Firestore tant que le quota n’est pas rétabli. Les données **déjà** en PG restent utilisables.
- **Ne pas** activer le reverse pour « rattraper » sans audit (`sync:parity`, dump de référence).

### Rattraper PG après gros décalage (export Firestore)

Quand le sync temps réel a pris du retard (quota, etc.), un **export JSON** + **`db:align`** est plus rapide qu’attendre des milliers d’`upsert` un par un.

```bash
# 1. Copier le dump sur le VPS (depuis votre PC)
scp colweyz_firebase_dump_2026-05-25.json root@180.149.197.31:/root/colweyz/

# 2. Sur le VPS
cd /root/colweyz/server   # adapter le chemin du repo
systemctl stop colweyz-sync
npx tsx prisma/seed-from-export.ts /root/colweyz/colweyz_firebase_dump_2026-05-25.json --align
npx tsx scripts/compare-dump-pg.ts /root/colweyz/colweyz_firebase_dump_2026-05-25.json
systemctl start colweyz-sync
```

Ou : `chmod +x scripts/align-from-dump.sh && ./scripts/align-from-dump.sh /root/colweyz/colweyz_firebase_dump_2026-05-25.json`

---

## Éviter les exports manuels au quotidien

### Règle d’or

**Firestore = source de vérité** (Cloud Run / ancienne app).  
**PostgreSQL = copie** mise à jour par le worker, pas l’inverse.

| À faire en permanence | Commande / service |
|----------------------|-------------------|
| Worker toujours actif | `systemctl enable --now colweyz-sync` |
| Reverse **off** | `SYNC_REVERSE_ENABLED=false` |
| API secours | `colweyz-api` + Netlify |

### Corriger une incohérence (sans export)

1. **Vérifier** que le worker tourne : `journalctl -u colweyz-sync -f` (tu dois voir des `✅ orders: 1 upsert` quand tu modifies sur Cloud Run).

2. **Une commande / un doc** désynchronisé — tirer depuis Firestore :

```bash
cd server
npm run sync:resync-doc -- orders '#CW85099'
```

3. **Toute une collection** (après panne courte) :

```bash
npm run sync:resync-doc -- orders --all
npm run sync:resync-doc -- daily_entries --all
```

4. **Contrôle effectifs** (pas besoin d’export JSON) :

```bash
npm run sync:parity
npm run sync:diagnose
```

### Quand faire un export + `db:align`

- Première mise en place ou **gros retard** (quota long, PG très en retard).
- **Pas** chaque jour si `colweyz-sync` tourne et Firebase répond.

### Habitudes qui évitent les écarts

1. **Un seul endroit pour travailler** : Cloud Run **ou** Netlify secours, pas les deux en parallèle pour attribuer / modifier.
2. **Quota Firebase** : facturation / Blaze pour que les listeners ne coupent pas le worker.
3. **Modifs en mode secours (PG)** : elles restent en PG jusqu’au retour Firestore ; ne pas s’attendre à les voir sur Cloud Run sans ressaisie sur Firestore.

### Sur le VPS (systemd)

```bash
systemctl enable colweyz-api colweyz-sync
systemctl status colweyz-sync
```

Optionnel : cron hebdo `npm run sync:parity` (alerte mail si écart).

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `services/dataService.ts` | Proxy hybride |
| `services/connectionMode.ts` | Détection quota |
| `pages/Login.tsx` | JWT secours |
| `components/ConnectionModeBanner.tsx` | Bannière mode |
| `server/src/sync/worker.ts` | Forward sync |
| `server/SYNC.md` | Dépannage reverse / restauration Firestore |

---

## Build / run

```bash
cd source_code
npm install
npm run dev
```

Login secours PG : mêmes identifiants qu’en base (`admin` / mot de passe PG).
