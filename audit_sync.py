#!/usr/bin/env python3
"""
Deep audit: compare Firestore JSON dump against PostgreSQL data (via API).
Run from the local machine.
"""
import json, subprocess, sys

DUMP = "/home/chiffer/Musique/colweyz/colweyz_firebase_dump_2026-05-30.json"
SSH  = "ssh -o ConnectTimeout=5 root@180.149.197.31"
PSQL = 'docker exec colweyz_postgres psql -U colweyz -d colweyz -t -A -F"|" -c'

print("Loading Firestore dump…")
with open(DUMP) as f:
    fb = json.load(f)

def pg(sql):
    cmd = f'{SSH} "{PSQL} \\"{sql}\\""'
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
    return r.stdout.strip()

# ──────────────────────────────────────────────
# 1. COUNTS
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("1. DOCUMENT / ROW COUNTS")
print("="*70)

mappings = [
    ("orders",            "orders"),
    ("drivers",           "drivers"),
    ("zones",             "zones"),
    ("products",          "products"),
    ("fund_requests",     "fund_requests"),
    ("users",             "users"),
    ("stockLivreurs",     "stock_livreurs"),
    ("stock_operations",  "stock_operations"),
    ("purchase_orders",   "purchase_orders"),
    ("daily_entries",     "daily_entries"),
    ("financial_configs", "financial_configs"),
    ("daily_finance",     "daily_finance"),
    ("settings",          "app_settings"),
    ("config",            "app_config"),
    ("claude_analysis",   "claude_analysis"),
    ("accounting_entries","accounting_entries"),
]

issues = []
for fb_col, pg_tbl in mappings:
    fb_count = len(fb.get(fb_col, {}))
    try:
        pg_count = int(pg(f"SELECT COUNT(*) FROM {pg_tbl}"))
    except:
        pg_count = "TABLE MISSING"
    match = "✅" if fb_count == pg_count else "❌"
    if fb_count != pg_count:
        issues.append((fb_col, pg_tbl, fb_count, pg_count))
    print(f"  {match} {fb_col:25s} Firestore={fb_count:5}  PG={str(pg_count):>5}")

# Collections in Firestore not handled by sync
fb_all = set(fb.keys())
synced = set(m[0] for m in mappings)
not_synced = fb_all - synced
if not_synced:
    print(f"\n  ⚠️  Firestore collections NOT synced: {not_synced}")

# ──────────────────────────────────────────────
# 2. ORDERS — field-by-field comparison
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("2. ORDERS — Spot-check (first 20 mismatches)")
print("="*70)

# Get all PG orders as JSON
pg_orders_raw = pg("SELECT json_agg(o) FROM (SELECT id, date, client_name, client_phone, address, product_details, amount, status, remuneration, payment_method, cancel_reason, assigned_at, delivered_at, postponed_at, scheduled_at, imported_at, refused_by, remarks, shipping_remarks, assignment_remarks, driver_id, zone_id, shipping_fee, is_pre_paid, regional_payment_status, delivery_cost, purchase_cost, products, logs, linked_order_ids FROM orders ORDER BY id) o")

try:
    pg_orders = json.loads(pg_orders_raw)
    pg_orders_map = {o['id']: o for o in pg_orders}
except:
    pg_orders_map = {}
    print("  ⚠️ Could not parse PG orders JSON")

# Payment method mapping for comparison
def normalize_pm(fb_pm, fb_mp):
    """Convert Firestore paymentMethod/modePaiement to PG payment_method"""
    if fb_pm:
        pm = str(fb_pm).lower()
        if pm in ('wave', 'om', 'cash'): return pm
        if pm in ('espèces', 'especes'): return 'cash'
        return str(fb_pm)
    if fb_mp:
        mp = str(fb_mp)
        if mp == 'Wave': return 'wave'
        if mp == 'OM': return 'om'
        if mp == 'Espèces': return 'cash'
        if mp == 'Dépôt Expédition': return 'depot'
    return None

order_diffs = 0
missing_in_pg = []
for fb_id, fb_o in fb.get('orders', {}).items():
    if fb_id not in pg_orders_map:
        missing_in_pg.append(fb_id)
        continue
    pg_o = pg_orders_map[fb_id]
    
    # Compare key fields
    field_map = [
        ('date', 'date'),
        ('clientName', 'client_name'),
        ('clientPhone', 'client_phone'),
        ('address', 'address'),
        ('amount', 'amount'),
        ('status', 'status'),
        ('remuneration', 'remuneration'),
        ('driverId', 'driver_id'),
        ('zoneId', 'zone_id'),
        ('cancelReason', 'cancel_reason'),
        ('assignedAt', 'assigned_at'),
        ('deliveredAt', 'delivered_at'),
        ('remarks', 'remarks'),
        ('shippingFee', 'shipping_fee'),
        ('isPrePaid', 'is_pre_paid'),
        ('regionalPaymentStatus', 'regional_payment_status'),
    ]
    
    diffs = []
    for fb_f, pg_f in field_map:
        fb_v = fb_o.get(fb_f)
        pg_v = pg_o.get(pg_f)
        # Normalize
        if fb_v is None or fb_v == '': fb_v = None
        if pg_v is None or pg_v == '': pg_v = None
        # Numbers
        if isinstance(fb_v, (int, float)) and isinstance(pg_v, (int, float)):
            if int(fb_v) != int(pg_v):
                diffs.append(f"  {fb_f}: FB={fb_v} vs PG={pg_v}")
        elif str(fb_v or '') != str(pg_v or ''):
            diffs.append(f"  {fb_f}: FB={repr(fb_v)} vs PG={repr(pg_v)}")
    
    # Payment method
    fb_pm_normalized = normalize_pm(fb_o.get('paymentMethod'), fb_o.get('modePaiement'))
    pg_pm = pg_o.get('payment_method')
    if str(fb_pm_normalized or '') != str(pg_pm or ''):
        diffs.append(f"  paymentMethod: FB={repr(fb_pm_normalized)} vs PG={repr(pg_pm)}")
    
    if diffs:
        order_diffs += 1
        if order_diffs <= 20:
            print(f"\n  ❌ Order {fb_id}:")
            for d in diffs:
                print(f"    {d}")

if missing_in_pg:
    print(f"\n  ❌ Orders in Firestore but MISSING in PG: {missing_in_pg[:10]}...")
    
extra_in_pg = set(pg_orders_map.keys()) - set(fb.get('orders', {}).keys())
if extra_in_pg:
    print(f"\n  ⚠️ Orders in PG but NOT in Firestore: {list(extra_in_pg)[:10]}...")

print(f"\n  Summary: {order_diffs} orders with field differences, {len(missing_in_pg)} missing in PG")

# ──────────────────────────────────────────────
# 3. DRIVERS — field comparison
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("3. DRIVERS")
print("="*70)

pg_drivers_raw = pg("SELECT json_agg(d) FROM (SELECT id, name, phone, username, initial_balance, status, color FROM drivers ORDER BY name) d")
try:
    pg_drivers = {d['id']: d for d in json.loads(pg_drivers_raw)}
except:
    pg_drivers = {}

for fb_id, fb_d in fb.get('drivers', {}).items():
    if fb_id not in pg_drivers:
        print(f"  ❌ Driver {fb_id} ({fb_d.get('name')}) MISSING in PG")
        continue
    pg_d = pg_drivers[fb_id]
    diffs = []
    for fb_f, pg_f in [('name','name'),('phone','phone'),('username','username'),('initialBalance','initial_balance'),('status','status'),('color','color')]:
        fb_v = fb_d.get(fb_f)
        pg_v = pg_d.get(pg_f)
        if fb_v is None: fb_v = None
        if pg_v is None: pg_v = None
        if isinstance(fb_v, (int,float)) and isinstance(pg_v, (int,float)):
            if int(fb_v) != int(pg_v):
                diffs.append(f"{fb_f}: FB={fb_v} PG={pg_v}")
        elif str(fb_v or '') != str(pg_v or ''):
            diffs.append(f"{fb_f}: FB={repr(fb_v)} PG={repr(pg_v)}")
    if diffs:
        print(f"  ❌ Driver {fb_d.get('name')}: {'; '.join(diffs)}")
    else:
        print(f"  ✅ Driver {fb_d.get('name')} — OK")

# Extra drivers in PG
extra = set(pg_drivers.keys()) - set(fb.get('drivers',{}).keys())
if extra:
    for eid in extra:
        print(f"  ⚠️ Driver {pg_drivers[eid].get('name')} exists in PG but NOT in Firestore")

# ──────────────────────────────────────────────
# 4. ZONES
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("4. ZONES")
print("="*70)

pg_zones_raw = pg("SELECT json_agg(z) FROM (SELECT id, name, type, delivery_fee, remuneration FROM zones ORDER BY name) z")
try:
    pg_zones = {z['id']: z for z in json.loads(pg_zones_raw)}
except:
    pg_zones = {}

for fb_id, fb_z in fb.get('zones', {}).items():
    if fb_id not in pg_zones:
        print(f"  ❌ Zone {fb_id} MISSING in PG")
        continue
    pg_z = pg_zones[fb_id]
    diffs = []
    for fb_f, pg_f in [('name','name'),('type','type'),('deliveryFee','delivery_fee'),('remuneration','remuneration')]:
        fb_v = fb_z.get(fb_f)
        pg_v = pg_z.get(pg_f)
        if isinstance(fb_v,(int,float)) and isinstance(pg_v,(int,float)):
            if int(fb_v) != int(pg_v): diffs.append(f"{fb_f}: FB={fb_v} PG={pg_v}")
        elif str(fb_v or '') != str(pg_v or ''):
            diffs.append(f"{fb_f}: FB={repr(fb_v)} PG={repr(pg_v)}")
    if diffs:
        print(f"  ❌ Zone {fb_z.get('name')}: {'; '.join(diffs)}")
    else:
        print(f"  ✅ Zone {fb_z.get('name')} — OK")

# ──────────────────────────────────────────────
# 5. FUND REQUESTS
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("5. FUND REQUESTS — Summary")
print("="*70)

pg_fr_raw = pg("SELECT json_agg(f) FROM (SELECT id, driver_id, amount, type, status, notes, created_at FROM fund_requests ORDER BY id) f")
try:
    pg_fr = {f['id']: f for f in json.loads(pg_fr_raw)}
except:
    pg_fr = {}

fr_ok = 0
fr_diff = 0
fr_missing = 0
for fb_id, fb_f in fb.get('fund_requests', {}).items():
    if fb_id not in pg_fr:
        fr_missing += 1
        continue
    pg_f = pg_fr[fb_id]
    has_diff = False
    for fb_field, pg_field in [('amount','amount'),('type','type'),('status','status'),('driverId','driver_id')]:
        fb_v = fb_f.get(fb_field)
        pg_v = pg_f.get(pg_field)
        if isinstance(fb_v,(int,float)) and isinstance(pg_v,(int,float)):
            if int(fb_v) != int(pg_v): has_diff = True
        elif str(fb_v or '') != str(pg_v or ''):
            has_diff = True
    if has_diff: fr_diff += 1
    else: fr_ok += 1

print(f"  ✅ Matching: {fr_ok}  ❌ Diffs: {fr_diff}  🚫 Missing in PG: {fr_missing}")

# ──────────────────────────────────────────────
# 6. PRODUCTS
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("6. PRODUCTS — Summary")
print("="*70)

pg_prod_raw = pg("SELECT json_agg(p) FROM (SELECT id, title, source, purchase_price, main_stock FROM products ORDER BY id) p")
try:
    pg_prods = {p['id']: p for p in json.loads(pg_prod_raw)}
except:
    pg_prods = {}

prod_ok = 0
prod_diff = 0
prod_missing = []
for fb_id, fb_p in fb.get('products', {}).items():
    if fb_id not in pg_prods:
        prod_missing.append(fb_id)
        continue
    pg_p = pg_prods[fb_id]
    has_diff = False
    for fb_f, pg_f in [('title','title'),('source','source'),('purchasePrice','purchase_price'),('mainStock','main_stock')]:
        fb_v = fb_p.get(fb_f)
        pg_v = pg_p.get(pg_f)
        if isinstance(fb_v,(int,float)) and isinstance(pg_v,(int,float)):
            if int(fb_v) != int(pg_v): has_diff = True
        elif str(fb_v or '') != str(pg_v or ''):
            has_diff = True
    if has_diff: prod_diff += 1
    else: prod_ok += 1

print(f"  ✅ Matching: {prod_ok}  ❌ Diff: {prod_diff}  🚫 Missing in PG: {len(prod_missing)}")
if prod_missing:
    for pid in prod_missing[:5]:
        print(f"    Missing: {pid} ({fb['products'][pid].get('title','')})")

# ──────────────────────────────────────────────
# 7. STOCK_OPERATIONS
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("7. STOCK OPERATIONS")
print("="*70)

fb_so_count = len(fb.get('stock_operations', {}))
try:
    pg_so_count = int(pg("SELECT COUNT(*) FROM stock_operations"))
except:
    pg_so_count = "?"
print(f"  Firestore: {fb_so_count}  PG: {pg_so_count}")
if fb_so_count != pg_so_count:
    # Find missing
    pg_so_ids_raw = pg("SELECT string_agg(id, ',') FROM stock_operations")
    pg_so_ids = set(pg_so_ids_raw.split(',')) if pg_so_ids_raw else set()
    fb_so_ids = set(fb.get('stock_operations',{}).keys())
    missing = fb_so_ids - pg_so_ids
    extra = pg_so_ids - fb_so_ids
    print(f"  🚫 Missing in PG: {len(missing)} (likely filtered by productId FK)")
    print(f"  ⚠️ Extra in PG: {len(extra)}")

# ──────────────────────────────────────────────
# 8. STOCK LIVREURS
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("8. STOCK LIVREURS")
print("="*70)

fb_sl_count = len(fb.get('stockLivreurs', {}))
try:
    pg_sl_count = int(pg("SELECT COUNT(*) FROM stock_livreurs"))
except:
    pg_sl_count = "?"
print(f"  Firestore: {fb_sl_count}  PG: {pg_sl_count}")

# ──────────────────────────────────────────────
# 9. FINANCIAL CONFIGS
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("9. FINANCIAL CONFIGS")
print("="*70)

fb_fc_count = len(fb.get('financial_configs', {}))
try:
    pg_fc_count = int(pg("SELECT COUNT(*) FROM financial_configs"))
except:
    pg_fc_count = "?"
print(f"  Firestore: {fb_fc_count}  PG: {pg_fc_count}")

# ──────────────────────────────────────────────
# 10. PURCHASE ORDERS
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("10. PURCHASE ORDERS")
print("="*70)

fb_po_count = len(fb.get('purchase_orders', {}))
try:
    pg_po_count = int(pg("SELECT COUNT(*) FROM purchase_orders"))
except:
    pg_po_count = "?"
print(f"  Firestore: {fb_po_count}  PG: {pg_po_count}")

# ──────────────────────────────────────────────
# 11. CONFIG / USER PREFERENCES
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("11. CONFIG & USER PREFERENCES")
print("="*70)

fb_config_count = len(fb.get('config', {}))
fb_userprefs_count = len(fb.get('user_preferences', {}))
try:
    pg_config_count = int(pg("SELECT COUNT(*) FROM app_config"))
except:
    pg_config_count = "?"
print(f"  config:           Firestore={fb_config_count}  PG={pg_config_count}")
print(f"  user_preferences: Firestore={fb_userprefs_count}  (stored in localStorage, not synced)")

# Collections deliberately not synced
print("\n" + "="*70)
print("12. COLLECTIONS NOT SYNCED (by design)")
print("="*70)
not_synced_cols = {
    'adhoc_products': 'Merged with products (source=ponctuel)',
    'campagnes': 'Empty collection',
    'logs_ajustements': 'Historical logs, embedded in stock_operations',
    'user_preferences': 'Stored in browser localStorage',
}
for col, reason in not_synced_cols.items():
    count = len(fb.get(col, {}))
    print(f"  ⚠️ {col} ({count} docs) — {reason}")

# ──────────────────────────────────────────────
# SUMMARY
# ──────────────────────────────────────────────
print("\n" + "="*70)
print("FINAL SUMMARY")
print("="*70)
if issues:
    print("  Count mismatches found:")
    for fb_col, pg_tbl, fb_c, pg_c in issues:
        print(f"    {fb_col}: Firestore={fb_c} vs PG={pg_c}  (delta={fb_c - pg_c if isinstance(pg_c, int) else '?'})")
else:
    print("  ✅ All collection counts match!")

print(f"\n  Orders with field-level differences: {order_diffs}")
print(f"  Orders missing in PG: {len(missing_in_pg)}")
print(f"\nDone.")
