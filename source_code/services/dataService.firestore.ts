
import { Driver, Order, Zone, SystemUser, AppSettings, FundRequest, Product, ProductFinancialConfig, DailyFinancialEntry, PurchaseOrder, AdHocProduct, AccountingEntry, DailyFinanceData, StockLivreurEntry, StockOperation } from '../types';
import { INITIAL_DRIVERS, INITIAL_ORDERS, INITIAL_ZONES, INITIAL_USERS, INITIAL_FUND_REQUESTS } from './mockData';
import { db, auth } from '../firebase';
import Papa from 'papaparse';
import { parseProductCommand } from '../utils/productParser';
export { auth, db };
import { setConnectionMode, isFirestoreUnavailableError } from './connectionMode';
import { 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  doc, 
  setDoc, 
  deleteDoc,
  query, 
  where,
  getDoc,
  orderBy,
  onSnapshot,
  runTransaction,
  increment,
  collectionGroup,
  limit
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

/** Erreur listener onSnapshot → bascule API (évite listes vides INITIAL_*). */
function handleListenerError(error: unknown, path: string): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[ColWeyz] Listener Firestore (${path}):`, msg);
  if (isFirestoreUnavailableError(error)) {
    setConnectionMode('api', msg);
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error Details:', JSON.stringify(errInfo, null, 2));
  throw new Error(JSON.stringify(errInfo));
}

async function firestoreCall<T>(operationType: OperationType, path: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleFirestoreError(error, operationType, path);
    throw error;
  }
}

function removeUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined)
  );
}

// --- LOCAL STORAGE LOGIC (FALLBACK) ---
const STORAGE_KEYS = {
  DRIVERS: 'app_drivers',
  ZONES: 'app_zones',
  ORDERS: 'app_orders',
  USERS: 'app_users',
  SETTINGS: 'app_settings',
  FUND_REQUESTS: 'app_fund_requests',
  PRODUCTS: 'app_products',
  FINANCIAL_CONFIGS: 'app_financial_configs',
  DAILY_ENTRIES: 'app_daily_entries',
  DAILY_FINANCE: 'app_daily_finance',
  PURCHASE_ORDERS: 'app_purchase_orders',
  ADHOC_PRODUCTS: 'app_adhoc_products',
  CLAUDE_ANALYSIS: 'app_claude_analysis',
  ACCOUNTING_ENTRIES: 'app_accounting_entries',
  STOCK_LIVREURS: 'app_stock_livreurs',
  STOCK_OPERATIONS: 'app_stock_operations',
  GOOGLE_SHEET_URL: 'googleSheetUrl',
  FACEBOOK_EXPORT_DATE: 'lastFacebookExportDate_USD_v2'
};

const formatProductLine = (nameInput: string, qtyInput: string) => {
  if (!nameInput) return '';
  let names: string[] = [];
  let qtys: string[] = [];
  let cleanQty = qtyInput ? String(qtyInput).replace(/[()]/g, '').trim() : '';
  
  if (cleanQty.includes('|')) qtys = cleanQty.split('|');
  else if (cleanQty.includes('\n')) qtys = cleanQty.split('\n');
  else if (cleanQty.includes(' ')) qtys = cleanQty.split(/\s+/);
  else if (cleanQty) qtys = [cleanQty];
  
  let cleanName = nameInput.trim();
  if (qtys.length === 0) {
      const multiQtyMatch = cleanName.match(/\((\d+(?:\s+\d+)+)\)$/);
      if (multiQtyMatch) {
          qtys = multiQtyMatch[1].split(/\s+/);
          cleanName = cleanName.substring(0, multiQtyMatch.index).trim();
      }
  }

  if (cleanName.includes('|')) names = cleanName.split('|');
  else if (cleanName.includes('\n')) names = cleanName.split('\n');
  else names = [cleanName];

  const lines: string[] = [];
  const maxLen = Math.max(names.length, qtys.length);
  for (let i = 0; i < maxLen; i++) {
      let n = names[i] || (names.length === 1 ? names[0] : '');
      let q = qtys[i] || '1';
      n = n.replace(/\(x\d+\)/gi, '').replace(/\s+x\d+$/i, '').trim();
      q = q.replace(/\D/g, '') || '1';
      if (n) lines.push(`${q} X ${n}`);
  }
  return lines.join('\n');
};

const findMatchingProduct = (details: string, products: Product[]) => {
  if (!details) return null;
  const firstLine = details.split('\n')[0];
  const { productName } = parseProductCommand(firstLine);
  if (!productName) return null;
  const search = productName.toLowerCase().trim();
  return products.find(p => p.title.toLowerCase().includes(search) || search.includes(p.title.toLowerCase()));
};

const processParsedData = async (data: any[], products: Product[]) => {
  const ordersRef = collection(db, 'orders');
  
  // Get existing orders to avoid duplicates
  const existingSnap = await getDocs(ordersRef);
  const existingIds = new Set(existingSnap.docs.map(d => d.id));
  
  let importedCount = 0;
  let ignoredCount = 0;
  const ordersToSave: any[] = [];
  let currentOrder: any = null;

  const extractProductsFromDetails = (details: string, productsList: Product[]) => {
      const lines = details.split('\n').filter(l => l.trim() !== '');
      const matched: any[] = [];
      for (const line of lines) {
          const { quantity, productName } = parseProductCommand(line);
          const found = productsList.find(p => 
              p.title.toLowerCase() === productName.toLowerCase() ||
              (p.variants && p.variants.some(v => v.sku && v.sku.toLowerCase() === productName.toLowerCase()))
          );
          if (found) {
              matched.push({
                  name: found.title,
                  quantity,
                  sku: found.id,
                  prixUnitaire: found.sellingPrice || 0,
                  ponctuel: false
              });
          } else {
              matched.push({
                  name: productName,
                  quantity,
                  sku: null,
                  prixUnitaire: 0,
                  ponctuel: true
              });
          }
      }
      return matched;
  };

  for (const row of data) {
    const values = Array.isArray(row) ? row : Object.values(row);
    if (values.length < 2) continue;

    let id = values[1] ? String(values[1]).trim() : '';
    let date = values[2] ? String(values[2]).trim() : '';
    const looksLikeDate = (str: string) => (str.includes('/') || str.includes('-')) && /\d/.test(str);
    if (looksLikeDate(id) && !looksLikeDate(date)) { [id, date] = [date, id]; }
    if (date.includes('T')) date = date.split('T')[0];

    const normalizedId = id.trim();
    const hasValidId = normalizedId && !normalizedId.toLowerCase().includes('comm') && normalizedId.length > 2;

    if (hasValidId) {
      if (currentOrder && currentOrder.id !== normalizedId) {
        if (!existingIds.has(currentOrder.id)) {
            currentOrder.products = extractProductsFromDetails(currentOrder.productDetails, products);
            ordersToSave.push(currentOrder);
        }
        currentOrder = null;
      }

      if (!currentOrder) {
        const statusRaw = values[10] ? String(values[10]).trim().toLowerCase() : '';
        if (!statusRaw.includes('valid')) { ignoredCount++; continue; }

        const rawAmount = values[8] ? String(values[8]) : '0';
        const amount = parseInt(rawAmount.replace(/\D/g, '') || '0');

        currentOrder = {
          id: normalizedId,
          date: date,
          clientName: values[3] ? String(values[3]) : 'Inconnu',
          clientPhone: values[5] ? String(values[5]) : '',
          address: values[4] ? String(values[4]) : 'Non précisée',
          productDetails: formatProductLine(values[6] ? String(values[6]) : '', values[7] ? String(values[7]) : ''),
          amount: amount,
          status: 'validé',
          zoneId: null,
          driverId: null,
          importedAt: new Date().toISOString(),
          remarks: values[9] ? String(values[9]).trim() : '',
          logs: [{ id: Date.now().toString(), text: "Importé via Google Drive", author: "Système", createdAt: new Date().toISOString() }]
        };
      } else {
        const productName = values[6] ? String(values[6]).trim() : '';
        const quantity = values[7] ? String(values[7]).trim() : '';
        if (productName) {
          const extra = formatProductLine(productName, quantity);
          if (extra) currentOrder.productDetails += '\n' + extra;
        }
      }
    } else if (currentOrder) {
      const productName = values[6] ? String(values[6]).trim() : '';
      const quantity = values[7] ? String(values[7]).trim() : '';
      if (productName) {
        const extra = formatProductLine(productName, quantity);
        if (extra) currentOrder.productDetails += '\n' + extra;
      }
    }
  }

  if (currentOrder && !existingIds.has(currentOrder.id)) {
    currentOrder.products = extractProductsFromDetails(currentOrder.productDetails, products);
    ordersToSave.push(currentOrder);
  }

  // Save batches
  for (const o of ordersToSave) {
    await setDoc(doc(ordersRef, o.id), o);
    importedCount++;
  }

  return { count: importedCount, ignored: ignoredCount };
};

export const DEPOT_ID = 'depot_delta';

const localLoad = <T,>(key: string, defaults: T): T => {
  const stored = localStorage.getItem(key);
  if (!stored) {
    if (Array.isArray(defaults)) return [...defaults] as unknown as T;
    return defaults;
  }
  try {
      return JSON.parse(stored);
  } catch (e) {
      console.error(`Error parsing localStorage key "${key}". Resetting to defaults.`, e);
      localStorage.removeItem(key);
      if (Array.isArray(defaults)) return [...defaults] as unknown as T;
      return defaults;
  }
};

const localSave = (key: string, data: any) => {
  localStorage.setItem(key, JSON.stringify(data));
};

/** Enrichit productId / dateEffet depuis le chemin campagnes/{pid}/configs/{date}. */
function mapFinancialConfigDoc(
  docSnap: { id: string; data: () => Record<string, unknown>; ref: { path: string } }
): ProductFinancialConfig {
  const data = docSnap.data();
  const parts = docSnap.ref.path.split('/');
  const campIdx = parts.indexOf('campagnes');
  const productId =
    (data.productId as string) ||
    (campIdx >= 0 && parts[campIdx + 1] ? parts[campIdx + 1] : '');
  const dateEffet = (data.dateEffet as string) || docSnap.id;
  return {
    ...(data as ProductFinancialConfig),
    productId,
    dateEffet,
    updatedAt:
      (data.updatedAt as string) ||
      (typeof data.updatedAt === 'object' && data.updatedAt !== null
        ? new Date(data.updatedAt as Date).toISOString()
        : new Date().toISOString()),
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  adminPhone: '221770000000',
  logoUrl: '',
  shopifyDomain: '6b9bc5.myshopify.com',
  shopifyAccessToken: '',
  ignoredShopifyIds: []
};

// --- HYBRID SERVICE ---

export const FirestoreDataService = {
  migrateLocalStorageToFirebase: async () => {
    if (!db || !auth.currentUser) return;

    const migrations = [
      { key: STORAGE_KEYS.DRIVERS, collectionName: 'drivers' },
      { key: STORAGE_KEYS.ZONES, collectionName: 'zones' },
      { key: STORAGE_KEYS.ORDERS, collectionName: 'orders' },
      { key: STORAGE_KEYS.USERS, collectionName: 'users' },
      { key: STORAGE_KEYS.FUND_REQUESTS, collectionName: 'fund_requests' },
      { key: STORAGE_KEYS.PRODUCTS, collectionName: 'products' },
      { key: STORAGE_KEYS.FINANCIAL_CONFIGS, collectionName: 'financial_configs' },
      { key: STORAGE_KEYS.DAILY_ENTRIES, collectionName: 'daily_entries' },
      { key: STORAGE_KEYS.DAILY_FINANCE, collectionName: 'daily_finance' },
      { key: STORAGE_KEYS.PURCHASE_ORDERS, collectionName: 'purchase_orders' },
      { key: STORAGE_KEYS.ADHOC_PRODUCTS, collectionName: 'adhoc_products' },
      { key: STORAGE_KEYS.ACCOUNTING_ENTRIES, collectionName: 'accounting_entries' },
    ];

    for (const migration of migrations) {
      try {
        const localData = localStorage.getItem(migration.key);
        if (localData) {
          const parsed = JSON.parse(localData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const snapshot = await getDocs(collection(db, migration.collectionName));
            if (snapshot.empty) {
              console.log(`Migrating ${migration.key} to Firebase...`);
              for (const item of parsed) {
                if (item.id) {
                  await setDoc(doc(db, migration.collectionName, item.id), item);
                } else if (item.date && migration.collectionName === 'daily_finance') {
                  await setDoc(doc(db, migration.collectionName, item.date), item);
                } else if (item.date && migration.collectionName === 'daily_entries') {
                  await setDoc(doc(db, migration.collectionName, item.date), item);
                } else {
                  await addDoc(collection(db, migration.collectionName), item);
                }
              }
              console.log(`Migration ${migration.key} -> Firebase terminée`);
            }
          }
        }
      } catch (e) {
        console.error(`Error migrating ${migration.key}`, e);
      }
    }

    // Settings
    try {
      const localSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (localSettings) {
        const parsed = JSON.parse(localSettings);
        const docRef = doc(db, 'settings', 'global');
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
          await setDoc(docRef, parsed);
          console.log(`Migration ${STORAGE_KEYS.SETTINGS} -> Firebase terminée`);
        }
      }
    } catch (e) {
      console.error(`Error migrating settings`, e);
    }
    
    // Claude Analysis
    try {
      const localClaude = localStorage.getItem(STORAGE_KEYS.CLAUDE_ANALYSIS);
      if (localClaude) {
        const parsed = JSON.parse(localClaude);
        const snapshot = await getDocs(collection(db, 'claude_analysis'));
        if (snapshot.empty) {
          for (const [date, analysis] of Object.entries(parsed)) {
            await setDoc(doc(db, 'claude_analysis', date), { analysis, updatedAt: new Date().toISOString() });
          }
          console.log(`Migration ${STORAGE_KEYS.CLAUDE_ANALYSIS} -> Firebase terminée`);
        }
      }
    } catch (e) {
      console.error(`Error migrating claude analysis`, e);
    }

    // Facebook Export Date
    try {
      const localExport = localStorage.getItem(STORAGE_KEYS.FACEBOOK_EXPORT_DATE);
      if (localExport) {
        const docRef = doc(db, 'config', STORAGE_KEYS.FACEBOOK_EXPORT_DATE);
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
          await setDoc(docRef, { value: localExport, updatedAt: new Date().toISOString() });
          console.log(`Migration ${STORAGE_KEYS.FACEBOOK_EXPORT_DATE} -> Firebase terminée`);
          localStorage.removeItem(STORAGE_KEYS.FACEBOOK_EXPORT_DATE);
        }
      }
    } catch (e) {
      console.error(`Error migrating facebook export date`, e);
    }

    // Google Sheet URL
    try {
      const localSheet = localStorage.getItem(STORAGE_KEYS.GOOGLE_SHEET_URL);
      if (localSheet) {
        const docRef = doc(db, 'config', STORAGE_KEYS.GOOGLE_SHEET_URL);
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
          await setDoc(docRef, { value: localSheet, updatedAt: new Date().toISOString() });
          console.log(`Migration ${STORAGE_KEYS.GOOGLE_SHEET_URL} -> Firebase terminée`);
          localStorage.removeItem(STORAGE_KEYS.GOOGLE_SHEET_URL);
        }
      }
    } catch (e) {
      console.error(`Error migrating google sheet url`, e);
    }
  },

  // --- DRIVERS ---
  getDrivers: async (): Promise<Driver[]> => {
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.LIST, 'drivers', async () => {
        const snapshot = await getDocs(collection(db, 'drivers'));
        if (snapshot.empty) {
          return INITIAL_DRIVERS; 
        }
        return snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as Driver)) ?? [];
      });
    }
    return localLoad(STORAGE_KEYS.DRIVERS, INITIAL_DRIVERS);
  },
  
  saveDriver: async (driver: Driver): Promise<void> => {
    if (db && auth.currentUser) {
      const docRef = doc(db, 'drivers', driver.id);
      await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, driver, { merge: true }));
      return;
    }
    const drivers = [...localLoad<Driver[]>(STORAGE_KEYS.DRIVERS, INITIAL_DRIVERS)];
    const index = drivers.findIndex(d => d.id === driver.id);
    if (index >= 0) drivers[index] = driver;
    else drivers.push(driver);
    localSave(STORAGE_KEYS.DRIVERS, drivers);
  },

  deleteDriver: async (id: string): Promise<void> => {
    if (db && auth.currentUser) {
      await firestoreCall(OperationType.DELETE, 'drivers', async () => await deleteDoc(doc(db, 'drivers', id)));
      return;
    }
    const drivers = localLoad<Driver[]>(STORAGE_KEYS.DRIVERS, INITIAL_DRIVERS);
    const newDrivers = drivers.filter(d => d.id !== id);
    localSave(STORAGE_KEYS.DRIVERS, newDrivers);
  },

  subscribeToDrivers: (callback: (drivers: Driver[]) => void) => {
    if (!db || !auth.currentUser) return () => {};
    return onSnapshot(collection(db, 'drivers'), (snapshot) => {
      const drivers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Driver));
      callback(drivers);
    }, (error) => handleListenerError(error, 'drivers'));
  },

  // --- ZONES ---
  getZones: async (): Promise<Zone[]> => {
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.LIST, 'zones', async () => {
        const snapshot = await getDocs(collection(db, 'zones'));
        if (snapshot.empty) return INITIAL_ZONES;
        return snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as Zone)) ?? [];
      });
    }
    return localLoad(STORAGE_KEYS.ZONES, INITIAL_ZONES);
  },

  saveZone: async (zone: Zone): Promise<void> => {
    if (db && auth.currentUser) {
      const docRef = doc(db, 'zones', zone.id);
      await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, zone, { merge: true }));
      return;
    }
    const zones = [...localLoad<Zone[]>(STORAGE_KEYS.ZONES, INITIAL_ZONES)];
    const index = zones.findIndex(z => z.id === zone.id);
    if (index >= 0) zones[index] = zone;
    else zones.push(zone);
    localSave(STORAGE_KEYS.ZONES, zones);
  },

  deleteZone: async (id: string): Promise<void> => {
    console.log("Deleting zone with ID:", id);
    if (db && auth.currentUser) {
      await firestoreCall(OperationType.DELETE, 'zones', async () => await deleteDoc(doc(db, 'zones', id)));
      return;
    }
    const zones = localLoad<Zone[]>(STORAGE_KEYS.ZONES, INITIAL_ZONES);
    const newZones = zones.filter(z => z.id !== id);
    localSave(STORAGE_KEYS.ZONES, newZones);
  },

  subscribeToZones: (callback: (zones: Zone[]) => void): (() => void) => {
    if (!db || !auth.currentUser) return () => {};
    return onSnapshot(collection(db, 'zones'), (snapshot) => {
      const zones = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Zone));
      callback(zones);
    }, (error) => handleListenerError(error, 'zones'));
  },

  // --- ORDERS ---
  syncFromGoogleSheet: async (url: string): Promise<{ count: number; ignored: number }> => {
    if (!url) throw new Error("URL manquante");
    
    // 1. Fetch CSV
    const response = await fetch(url);
    if (response.url.includes('accounts.google.com') || !response.ok) {
       throw new Error("Accès refusé. Vérifiez que le lien est public.");
    }
    
    const csvText = await response.text();
    if (csvText.trim().startsWith('<!DOCTYPE html>') || csvText.includes('<html')) {
      throw new Error("Le lien ne renvoie pas un CSV. Vérifiez le format.");
    }

    // 2. Parse CSV and process
    const productsRef = collection(db, 'products');
    const productsSnap = await getDocs(productsRef);
    const products = productsSnap.docs.map(d => ({ ...d.data(), id: d.id } as Product));

    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: false,
        skipEmptyLines: true,
        complete: async (results) => {
          try {
            const res = await processParsedData(results.data, products);
            resolve(res);
          } catch (err) {
            reject(err);
          }
        },
        error: reject
      });
    });
  },

  importProcessedOrders: async (data: any[], products: Product[]): Promise<{ count: number; ignored: number }> => {
    return await processParsedData(data, products);
  },

  getOrders: async (): Promise<Order[]> => {
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.LIST, 'orders', async () => {
        const snapshot = await getDocs(collection(db, 'orders'));
        if (snapshot.empty) {
          return INITIAL_ORDERS;
        }
        return snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as Order)) ?? [];
      });
    }
    return localLoad(STORAGE_KEYS.ORDERS, INITIAL_ORDERS);
  },

  subscribeToOrders: (callback: (orders: Order[]) => void, label?: string): (() => void) => {
    if (db && auth.currentUser) {
      return onSnapshot(collection(db, 'orders'), (snapshot) => {
        if (label) {
          console.log(`=== LISTENER ${label} ===`);
          console.log("Query filtre statut:", "Aucun (Collection complète)");
          console.log("Nombre commandes reçues:", snapshot.docs.length);
          snapshot.docs.forEach(d => console.log(d.id, d.data().status, d.data().driverId));
        }
        if (snapshot.empty) {
          callback(INITIAL_ORDERS);
        } else {
          callback(snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as Order)) ?? []);
        }
      }, (error) => {
        handleListenerError(error, 'orders');
      });
    } else {
      // For local storage, just return current and a no-op unsubscribe
      callback(localLoad(STORAGE_KEYS.ORDERS, INITIAL_ORDERS));
      return () => {};
    }
  },

  saveOrder: async (order: Order): Promise<void> => {
    if (db && auth.currentUser) {
      const docRef = doc(db, 'orders', order.id);
      await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, removeUndefined(order), { merge: true }));
      return;
    }
    const orders = [...localLoad<Order[]>(STORAGE_KEYS.ORDERS, INITIAL_ORDERS)];
    const index = orders.findIndex(o => o.id === order.id);
    if (index >= 0) orders[index] = order;
    else orders.push(order);
    localSave(STORAGE_KEYS.ORDERS, orders);
  },

  deleteOrder: async (id: string): Promise<void> => {
    if (db && auth.currentUser) {
      await firestoreCall(OperationType.DELETE, 'orders', async () => await deleteDoc(doc(db, 'orders', id)));
      return;
    }
    const orders = localLoad<Order[]>(STORAGE_KEYS.ORDERS, INITIAL_ORDERS);
    const newOrders = orders.filter(o => o.id !== id);
    localSave(STORAGE_KEYS.ORDERS, newOrders);
  },

  importOrders: async (newOrders: Order[]): Promise<void> => {
    if (db && auth.currentUser) {
      // Fetch existing orders to avoid overwriting status/assignments
      const snapshot = await getDocs(collection(db, 'orders'));
      const existingMap = new Map(snapshot.docs.map(doc => [doc.id, doc.data() as Order]));

      const batchPromises = newOrders.map(newOrder => {
        const existing = existingMap.get(newOrder.id);
        let orderToSave = newOrder;
        
        if (existing) {
            // Update details but preserve status and assignments
            orderToSave = {
                ...existing,
                clientName: newOrder.clientName,
                clientPhone: newOrder.clientPhone,
                address: newOrder.address,
                productDetails: newOrder.productDetails,
                amount: newOrder.amount,
                date: newOrder.date
            };
        }
        
        return setDoc(doc(db, 'orders', newOrder.id), removeUndefined(orderToSave), { merge: true });
      });
      await Promise.all(batchPromises);
      return;
    }
    const orders = localLoad<Order[]>(STORAGE_KEYS.ORDERS, INITIAL_ORDERS);
    const orderMap = new Map(orders.map(o => [o.id, o]));

    newOrders.forEach(newOrder => {
        const existing = orderMap.get(newOrder.id);
        if (existing) {
            // Update details but preserve status and assignments
            orderMap.set(newOrder.id, {
                ...existing,
                clientName: newOrder.clientName,
                clientPhone: newOrder.clientPhone,
                address: newOrder.address,
                productDetails: newOrder.productDetails,
                products: newOrder.products,
                amount: newOrder.amount,
                date: newOrder.date
            });
        } else {
            orderMap.set(newOrder.id, newOrder);
        }
    });
    
    localSave(STORAGE_KEYS.ORDERS, Array.from(orderMap.values()));
  },

  // --- FUND REQUESTS (Appels de fonds) ---
  getFundRequests: async (): Promise<FundRequest[]> => {
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.LIST, 'fund_requests', async () => {
        const snapshot = await getDocs(collection(db, 'fund_requests'));
        if (snapshot.empty) return INITIAL_FUND_REQUESTS;
        return snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as FundRequest)) ?? [];
      });
    }
    return localLoad(STORAGE_KEYS.FUND_REQUESTS, INITIAL_FUND_REQUESTS);
  },

  saveFundRequest: async (request: FundRequest): Promise<void> => {
    if (db && auth.currentUser) {
      const docRef = doc(db, 'fund_requests', request.id);
      await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, removeUndefined(request), { merge: true }));
      return;
    }
    const requests = [...localLoad<FundRequest[]>(STORAGE_KEYS.FUND_REQUESTS, INITIAL_FUND_REQUESTS)];
    const index = requests.findIndex(r => r.id === request.id);
    if (index >= 0) requests[index] = request;
    else requests.push(request);
    localSave(STORAGE_KEYS.FUND_REQUESTS, requests);
  },

  deleteFundRequest: async (id: string): Promise<void> => {
     if (db && auth.currentUser) {
      await firestoreCall(OperationType.DELETE, 'fund_requests', async () => await deleteDoc(doc(db, 'fund_requests', id)));
      return;
    }
    const requests = localLoad<FundRequest[]>(STORAGE_KEYS.FUND_REQUESTS, INITIAL_FUND_REQUESTS);
    const newRequests = requests.filter(r => r.id !== id);
    localSave(STORAGE_KEYS.FUND_REQUESTS, newRequests);
  },

  subscribeToFundRequests: (callback: (requests: FundRequest[]) => void): (() => void) => {
    if (!db || !auth.currentUser) return () => {};
    return onSnapshot(collection(db, 'fund_requests'), (snapshot) => {
      const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FundRequest));
      callback(requests);
    }, (error) => handleListenerError(error, 'fund_requests'));
  },

  // --- USERS (ADMIN/STAFF) ---
  getUsers: async (): Promise<SystemUser[]> => {
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.LIST, 'users', async () => {
        const snapshot = await getDocs(collection(db, 'users'));
        if (snapshot.empty) return INITIAL_USERS;
        return snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as SystemUser)) ?? [];
      });
    }
    return localLoad(STORAGE_KEYS.USERS, INITIAL_USERS);
  },

  saveUser: async (user: SystemUser): Promise<void> => {
    if (db && auth.currentUser) {
      const docRef = doc(db, 'users', user.id);
      await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, removeUndefined(user), { merge: true }));
      return;
    }
    const users = [...localLoad<SystemUser[]>(STORAGE_KEYS.USERS, INITIAL_USERS)];
    const index = users.findIndex(u => u.id === user.id);
    if (index >= 0) users[index] = user;
    else users.push(user);
    localSave(STORAGE_KEYS.USERS, users);
  },

  deleteUser: async (id: string): Promise<void> => {
    if (db && auth.currentUser) {
      await firestoreCall(OperationType.DELETE, 'users', async () => await deleteDoc(doc(db, 'users', id)));
      return;
    }
    const users = localLoad<SystemUser[]>(STORAGE_KEYS.USERS, INITIAL_USERS);
    const newUsers = users.filter(u => u.id !== id);
    localSave(STORAGE_KEYS.USERS, newUsers);
  },

  // --- CONFIG (Generic Firestore Config) ---
  getConfig: async (key: string, defaultValue: any = null): Promise<any> => {
    if (db && auth.currentUser) {
      const docRef = doc(db, 'config', key);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data().value;
      }
      // If not in Firebase, check localStorage for migration
      const legacy = localStorage.getItem(key);
      if (legacy) {
          try {
              const parsed = JSON.parse(legacy);
              await setDoc(docRef, { value: parsed, updatedAt: new Date().toISOString() });
              localStorage.removeItem(key);
              return parsed;
          } catch {
              // Fallback if not JSON
              await setDoc(docRef, { value: legacy, updatedAt: new Date().toISOString() });
              localStorage.removeItem(key);
              return legacy;
          }
      }
      return defaultValue;
    }
    const local = localStorage.getItem(key);
    if (!local) return defaultValue;
    try { return JSON.parse(local); } catch { return local; }
  },

  saveConfig: async (key: string, value: any): Promise<void> => {
    if (db && auth.currentUser) {
      const docRef = doc(db, 'config', key);
      await setDoc(docRef, { value, updatedAt: new Date().toISOString() }, { merge: true });
      return;
    }
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  },

  subscribeToConfig: (key: string, callback: (value: any) => void) => {
    if (!db || !auth.currentUser) return () => {};
    const unreadLocal = () => {
        const local = localStorage.getItem(key);
        if (local) {
            try { callback(JSON.parse(local)); } catch { callback(local); }
        }
    };
    unreadLocal();
    return onSnapshot(
      doc(db, 'config', key),
      (snap) => {
        if (snap.exists()) {
          callback(snap.data().value);
          // Sync to local for offline support as a side effect
          localStorage.setItem(
            key,
            typeof snap.data().value === 'string' ? snap.data().value : JSON.stringify(snap.data().value)
          );
        }
      },
      (error) => handleListenerError(error, `config/${key}`)
    );
  },

  // Remove duplicate subscribeToProducts at line 801
  subscribeToFinancialConfigs: (callback: (configs: ProductFinancialConfig[]) => void) => {
    if (!db || !auth.currentUser) return () => {};
    return onSnapshot(
      collectionGroup(db, 'configs'),
      (snap) => {
        const configs = snap.docs.map((d) => mapFinancialConfigDoc(d));
        callback(configs);
      },
      (error) => handleListenerError(error, 'financial_configs')
    );
  },

  subscribeToDailyEntries: (callback: (entries: DailyFinancialEntry[]) => void) => {
    if (!db || !auth.currentUser) return () => {};
    return onSnapshot(
      collection(db, 'daily_entries'),
      (snap) => {
        const entries = snap.docs.map((d) => ({
          ...(d.data() as DailyFinancialEntry),
          date: (d.data().date as string) || d.id,
        }));
        callback(entries);
      },
      (error) => handleListenerError(error, 'daily_entries')
    );
  },

  subscribeToAllDailyFinanceData: (callback: (data: DailyFinanceData[]) => void) => {
    if (!db || !auth.currentUser) return () => {};
    return onSnapshot(
      collection(db, 'daily_finance'),
      (snap) => {
        const data = snap.docs.map((d) => ({
          ...(d.data() as DailyFinanceData),
          date: (d.data().date as string) || d.id,
        }));
        callback(data);
      },
      (error) => handleListenerError(error, 'daily_finance')
    );
  },

  // --- USER PREFERENCES (UI STATES) ---
  saveUserPreference: async (key: string, value: any): Promise<void> => {
    if (db && auth.currentUser) {
      const docRef = doc(db, 'user_preferences', `${auth.currentUser.uid}_${key}`);
      await setDoc(docRef, { value, updatedAt: new Date().toISOString() }, { merge: true });
    }
    // Always sync to local for performance
    localStorage.setItem(`pref_${key}`, JSON.stringify(value));
  },

  subscribeToUserPreference: (key: string, callback: (value: any) => void): (() => void) => {
    // Initial load from local
    const local = localStorage.getItem(`pref_${key}`);
    if (local !== null) {
      try { callback(JSON.parse(local)); } catch { callback(local); }
    }

    if (db && auth.currentUser) {
      const docRef = doc(db, 'user_preferences', `${auth.currentUser.uid}_${key}`);
      return onSnapshot(
        docRef,
        (snap) => {
          if (snap.exists()) {
            const val = snap.data().value;
            callback(val);
            localStorage.setItem(`pref_${key}`, JSON.stringify(val));
          }
        },
        (error) => handleListenerError(error, `user_preferences/${key}`)
      );
    }
    return () => {};
  },

  subscribeToClaudeAnalysis: (date: string, callback: (analysis: string | null) => void) => {
    if (!db || !auth.currentUser) return () => {};
    return onSnapshot(
      doc(db, 'claude_analysis', date),
      (snap) => {
        if (snap.exists()) {
          callback(snap.data().analysis);
        } else {
          callback(null);
        }
      },
      (error) => handleListenerError(error, `claude_analysis/${date}`)
    );
  },

  // --- SETTINGS ---
  getSettings: async (): Promise<AppSettings> => {
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.GET, 'settings/global', async () => {
        const docRef = doc(db, 'settings', 'global');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          return { ...DEFAULT_SETTINGS, ...snap.data() } as AppSettings;
        }
        // Migration fallback
        const local = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (local) {
            const parsed = JSON.parse(local);
            await setDoc(docRef, parsed);
            localStorage.removeItem(STORAGE_KEYS.SETTINGS);
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
        return DEFAULT_SETTINGS;
      });
    }
    return localLoad(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  },

  saveSettings: async (settings: AppSettings): Promise<void> => {
    if (db && auth.currentUser) {
      await firestoreCall(OperationType.WRITE, 'settings/global', async () => await setDoc(doc(db, 'settings', 'global'), removeUndefined(settings), { merge: true }));
      return;
    }
    localSave(STORAGE_KEYS.SETTINGS, settings);
  },

  subscribeToSettings: (callback: (settings: AppSettings) => void) => {
    if (!db || !auth.currentUser) return () => {};
    const unreadLocal = () => {
        const local = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (local) {
            try { 
                const parsed = JSON.parse(local);
                if (typeof parsed === 'object') callback(parsed as AppSettings);
            } catch { 
                // Ignore invalid local data
            }
        }
    };
    unreadLocal();
    return onSnapshot(
      doc(db, 'settings', 'global'),
      (snap) => {
        if (snap.exists()) {
          callback({ ...DEFAULT_SETTINGS, ...snap.data() } as AppSettings);
        } else {
          callback(DEFAULT_SETTINGS);
        }
      },
      (error) => handleListenerError(error, 'settings/global')
    );
  },

  // --- PRODUCTS (INVENTORY) ---
  getProducts: async (): Promise<Product[]> => {
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.LIST, 'products', async () => {
        const snapshot = await getDocs(collection(db, 'products'));
        const products = snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as Product)) ?? [];
        
        const adhocSnapshot = await getDocs(collection(db, 'adhoc_products'));
        const oldAdhocs = adhocSnapshot?.docs?.map(doc => {
            const data = doc.data() as AdHocProduct;
            return {
                id: doc.id,
                title: data.name,
                tags: [],
                variants: [],
                images: [],
                status: 'active',
                source: 'ponctuel',
                purchasePrice: data.purchasePrice,
                sellingPrice: 0,
                createdAt: data.createdAt || new Date().toISOString(),
                updatedAt: data.createdAt || new Date().toISOString()
            } as Product;
        }) ?? [];

        const combinedMap = new Map<string, Product>();
        products.forEach(p => combinedMap.set(p.id, p));

        for (const old of oldAdhocs) {
          if (!combinedMap.has(old.id)) {
            const normalizedTitle = old.title.trim().toLowerCase();
            const exists = Array.from(combinedMap.values()).some(existing => 
              existing.title.trim().toLowerCase() === normalizedTitle
            );
            if (!exists) {
              combinedMap.set(old.id, old);
            }
          }
        }
        return Array.from(combinedMap.values());
      });
    }
    const products = localLoad<Product[]>(STORAGE_KEYS.PRODUCTS, []);
    const oldAdhocs = localLoad<AdHocProduct[]>(STORAGE_KEYS.ADHOC_PRODUCTS, []).map(data => ({
        id: data.id,
        title: data.name,
        tags: [],
        variants: [],
        images: [],
        status: 'active',
        source: 'ponctuel',
        purchasePrice: data.purchasePrice,
        sellingPrice: 0,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.createdAt || new Date().toISOString()
    } as Product));
    
    const combinedMap = new Map<string, Product>();
    products.forEach(p => combinedMap.set(p.id, p));
    for (const old of oldAdhocs) {
      if (!combinedMap.has(old.id)) {
        const normalizedTitle = old.title.trim().toLowerCase();
        const exists = Array.from(combinedMap.values()).some(existing => 
          existing.title.trim().toLowerCase() === normalizedTitle
        );
        if (!exists) {
          combinedMap.set(old.id, old);
        }
      }
    }
    return Array.from(combinedMap.values());
  },

  subscribeToProducts: (callback: (products: Product[]) => void): (() => void) => {
    if (db && auth.currentUser) {
      let productsList: Product[] = [];
      let adhocList: Product[] = [];
      let loadingProducts = true;
      let loadingAdhoc = true;

      const notify = () => {
        // Only callback when both have had at least one snapshot
        if (loadingProducts || loadingAdhoc) return;

        const combinedMap = new Map<string, Product>();

        // 1. Add real products first (they take precedence)
        productsList.forEach(p => {
          // Deduplicate by normalized name if needed, but let's trust IDs first
          // Actually, for UI clarity, if same name exists twice, it's confusing
          // But IDs are different, so they ARE different entities.
          // The user wants to see duplicates to delete them.
          combinedMap.set(p.id, p);
        });

        // 2. Add adhoc products
        adhocList.forEach(p => {
          // If we already have a product with exactly same ID, real one wins
          if (!combinedMap.has(p.id)) {
            // Also deduplicate by name against existing products if they look like the same thing
            const normalizedTitle = (p.title || '').trim().toLowerCase();
            const exists = Array.from(combinedMap.values()).some(existing => 
              (existing.title || '').trim().toLowerCase() === normalizedTitle
            );
            
            if (!exists && normalizedTitle) {
              combinedMap.set(p.id, p);
            }
          }
        });

        // 3. DO NOT deduplicate products collection itself
        // The user needs to see duplicates to be able to delete them.
        // Previously we were hiding duplicates here, which led to "reappearing" items.
        
        callback(Array.from(combinedMap.values()));
      };

      const unsubProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
        productsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
        loadingProducts = false;
        notify();
      }, (error) => {
        handleListenerError(error, 'products');
        loadingProducts = false;
        notify();
      });

      const unsubAdhoc = onSnapshot(collection(db, 'adhoc_products'), (snapshot) => {
        adhocList = snapshot.docs.map(doc => {
          const data = doc.data() as AdHocProduct;
          return {
            id: doc.id,
            title: data.name,
            tags: [],
            variants: [],
            images: [],
            status: 'active',
            source: 'ponctuel',
            purchasePrice: data.purchasePrice,
            sellingPrice: 0,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.createdAt || new Date().toISOString()
          } as Product;
        });
        loadingAdhoc = false;
        notify();
      }, (error) => {
        handleListenerError(error, 'adhoc_products');
        loadingAdhoc = false;
        notify();
      });

      return () => {
        unsubProducts();
        unsubAdhoc();
      };
    }
    return () => {};
  },

  saveProduct: async (product: Product): Promise<void> => {
    if (db && auth.currentUser) {
      const docRef = doc(db, 'products', product.id);
      await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, removeUndefined(product), { merge: true }));
      return;
    }
    const products = [...localLoad<Product[]>(STORAGE_KEYS.PRODUCTS, [])];
    const index = products.findIndex(p => p.id === product.id);
    if (index >= 0) products[index] = product;
    else products.push(product);
    localSave(STORAGE_KEYS.PRODUCTS, products);
  },

  deleteProduct: async (id: string, productTitle: string, currentStock: number, adminId: string): Promise<void> => {
    if (db && auth.currentUser) {
      // 1. Log the deletion in movements
      const now = new Date().toISOString();
      await FirestoreDataService.logStockOperation({
        type: 'sortie',
        date: now,
        productId: id,
        productName: productTitle,
        quantity: currentStock,
        entiteType: 'global',
        source: 'Suppression définitive',
        notes: `Stock au moment de la suppression: ${currentStock}`
      });

      // 2. Fetch product first to check its source
      const prodRef = doc(db, 'products', id);
      const prodSnap = await getDoc(prodRef);
      const productData = prodSnap.exists() ? prodSnap.data() as Product : null;
      
      const normalizedTitle = productTitle.trim().toLowerCase();

      // 3. If it's a shopify product, add to ignored list to prevent re-import
      if (productData && (productData.source === 'shopify' || /^\d+$/.test(id))) {
        const settings = await FirestoreDataService.getSettings();
        const ignoredIds = settings.ignoredShopifyIds || [];
        if (!ignoredIds.includes(id)) {
          await FirestoreDataService.saveSettings({
            ...settings,
            ignoredShopifyIds: [...ignoredIds, id]
          });
        }
      }

      // 4. Delete from products
      await firestoreCall(OperationType.DELETE, 'products', async () => await deleteDoc(prodRef));
      
      // 5. Cleanup related collections (Legacy adhoc_products by ID and by Title)
      await firestoreCall(OperationType.DELETE, 'adhoc_products', async () => await deleteDoc(doc(db, 'adhoc_products', id)));
      
      // Search by title in adhoc_products to be absolutely sure we don't have a hidden duplicate
      const adhocRef = collection(db, 'adhoc_products');
      const qAdhoc = query(adhocRef, where('name', '>=', productTitle), where('name', '<=', productTitle + '\uf8ff'));
      const adhocSnap = await getDocs(qAdhoc);
      for (const d of adhocSnap.docs) {
          const dData = d.data();
          if (dData.name.trim().toLowerCase() === normalizedTitle) {
              await deleteDoc(doc(db, 'adhoc_products', d.id));
          }
      }

      // NEW: Sweep 'products' collection by title for ponctuel products
      const pRef = collection(db, 'products');
      const qP = query(pRef, where('title', '>=', productTitle), where('title', '<=', productTitle + '\uf8ff'));
      const pSnap = await getDocs(qP);
      for (const d of pSnap.docs) {
          const dData = d.data() as Product;
          if ((dData.title || '').trim().toLowerCase() === normalizedTitle) {
              // If it's the same ID, we already deleted it or are deleting it. 
              // If it's a different ID, only delete if it's NOT a shopify product (to avoid collateral damage)
              if (d.id !== id && dData.source !== 'shopify') {
                  await deleteDoc(doc(db, 'products', d.id));
              }
          }
      }

      // 6. Cleanup stockLivreurs entries for this product
      // Before deleting, try to merge this stock into a duplicate if one exists
      const stockRef = collection(db, 'stockLivreurs');
      const q = query(stockRef, where('produitId', '==', id));
      const snap = await getDocs(q);
      
      for (const d of snap.docs) {
          // Simply delete the duplicate's stock entries without merging
          // This addresses the user request to "remove quantities delivered on the remaining one"
          // as they don't want the faulty duplicate's history to pollute the good one.
          await deleteDoc(d.ref);
      }

      // 7. NEW: Invalidate/Cancel all stock operations for this product ID
      // This ensures that when recalculating, these operations are ignored
      // and thus their "sorties" (deliveries) won't pollute the remaining product's history
      const opsRef = collection(db, 'stock_operations');
      const qOps = query(opsRef, where('productId', '==', id));
      const opsSnap = await getDocs(qOps);
      
      for (const d of opsSnap.docs) {
          await updateDoc(doc(db, 'stock_operations', d.id), {
              annule: true,
              notes: (d.data().notes || '') + ' [Annulé auto suite suppression produit]'
          });
      }

      // 8. Auto-recalculate to sync everything
      await FirestoreDataService.recalculateAllStocks();

      return;
    }
    // Local storage fallback
    const products = localLoad<Product[]>(STORAGE_KEYS.PRODUCTS, []);
    localSave(STORAGE_KEYS.PRODUCTS, products.filter(p => p.id !== id));
    
    const adhoc = localLoad<any[]>(STORAGE_KEYS.ADHOC_PRODUCTS, []);
    localSave(STORAGE_KEYS.ADHOC_PRODUCTS, adhoc.filter(p => p.id !== id));
    
    const stock = localLoad<StockLivreurEntry[]>(STORAGE_KEYS.STOCK_LIVREURS, []);
    localSave(STORAGE_KEYS.STOCK_LIVREURS, stock.filter(e => e.produitId !== id));
  },

  getStockLivreurs: async (): Promise<StockLivreurEntry[]> => {
    if (db && auth.currentUser) {
      const colRef = collection(db, 'stockLivreurs');
      const snapshot = await firestoreCall(OperationType.LIST, colRef.path, async () => await getDocs(colRef));
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockLivreurEntry));
    }
    return localLoad<StockLivreurEntry[]>(STORAGE_KEYS.STOCK_LIVREURS, []);
  },

  subscribeToStockLivreurs: (callback: (entries: StockLivreurEntry[]) => void): (() => void) => {
    if (db && auth.currentUser) {
      const colRef = collection(db, 'stockLivreurs');
      return onSnapshot(colRef, (snapshot) => {
        const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockLivreurEntry));
        callback(entries);
      }, (error) => handleListenerError(error, 'stockLivreurs'));
    }
    return () => {};
  },

  saveStockLivreurEntry: async (entry: StockLivreurEntry): Promise<void> => {
    if (db && auth.currentUser) {
      // Use a composite ID to ensure uniqueness per (livreurId, produitId)
      const docId = `${entry.livreurId}_${entry.produitId}`;
      const docRef = doc(db, 'stockLivreurs', docId);
      
      // Sanitize entry: ensure keys like SI, sorties, etc are numbers
      const sanitized = {
          ...entry,
          SI: Number(entry.SI || 0),
          entrees: Number(entry.entrees || 0),
          sorties: Number(entry.sorties || 0),
          SF: Number(entry.SF || 0),
          ajustementManuel: Number(entry.ajustementManuel || 0)
      };
      
      await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, removeUndefined(sanitized), { merge: true }));
      return;
    }
    const entries = [...localLoad<StockLivreurEntry[]>(STORAGE_KEYS.STOCK_LIVREURS, [])];
    const index = entries.findIndex(e => e.livreurId === entry.livreurId && e.produitId === entry.produitId);
    if (index >= 0) entries[index] = entry;
    else entries.push(entry);
    localSave(STORAGE_KEYS.STOCK_LIVREURS, entries);
  },

  getStockOperations: async (): Promise<StockOperation[]> => {
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.LIST, 'stock_operations', async () => {
        const q = query(collection(db, 'stock_operations'), orderBy('date', 'desc'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockOperation));
      });
    }
    return localLoad<StockOperation[]>(STORAGE_KEYS.STOCK_OPERATIONS, []);
  },

  subscribeToStockOperations: (callback: (ops: StockOperation[]) => void) => {
    if (db && auth.currentUser) {
      const q = query(collection(db, 'stock_operations'), orderBy('date', 'desc'));
      return onSnapshot(q, (snapshot) => {
        const ops = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StockOperation));
        callback(ops);
      }, (error) => handleListenerError(error, 'stock_operations'));
    }
    return () => {};
  },

  saveStockOperation: async (op: StockOperation): Promise<void> => {
    if (db && auth.currentUser) {
      const docId = op.id || `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const docRef = doc(db, 'stock_operations', docId);
      await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, { ...removeUndefined(op), id: docId }, { merge: true }));
      return;
    }
    const ops = [...localLoad<StockOperation[]>(STORAGE_KEYS.STOCK_OPERATIONS, [])];
    const index = ops.findIndex(o => o.id === op.id);
    if (index >= 0) ops[index] = op;
    else ops.push(op);
    localSave(STORAGE_KEYS.STOCK_OPERATIONS, ops);
  },

  transferStock: async (params: {
    productId: string;
    productName: string;
    sourceId: string;
    destinationId: string;
    quantity: number;
    adminId: string;
  }): Promise<void> => {
    console.log('[DataService] transferStock starting...', params);
    return firestoreCall(OperationType.WRITE, 'stock_operations (transfer)', async () => {
      if (!db || !auth.currentUser) return;
      const { productId, productName, sourceId, destinationId, quantity, adminId } = params;

      await runTransaction(db, async (transaction) => {
        console.log('[DataService] transferStock inside transaction');
        // 1. ALL READS FIRST
        let productSnap: any = null;
        let sourceEntrySnap: any = null;
        let destEntrySnap: any = null;

        // Product (if global involved)
        if (sourceId === 'global' || destinationId === 'global') {
          const productRef = doc(db, 'products', productId);
          productSnap = await transaction.get(productRef);
          if (!productSnap.exists()) throw new Error("Produit non trouvé");
        }

        // Source Entry (if not global)
        if (sourceId !== 'global') {
          const entryRef = doc(db, 'stockLivreurs', `${sourceId}_${productId}`);
          sourceEntrySnap = await transaction.get(entryRef);
        }

        // Destination Entry (if not global)
        if (destinationId !== 'global') {
          const entryRef = doc(db, 'stockLivreurs', `${destinationId}_${productId}`);
          destEntrySnap = await transaction.get(entryRef);
        }

        console.log('[DataService] transferStock reads completed');

        // 2. ALL WRITES SECOND
        
        // SOURCE UPDATE
        if (sourceId === 'global') {
          const productRef = doc(db, 'products', productId);
          const pData = productSnap?.data();
          if (pData && !pData.stockGlobal) {
            transaction.update(productRef, {
              stockGlobal: { si: pData.mainStock || 0, entrees: 0, sorties: quantity, sf: (pData.mainStock || 0) - quantity, ajustementManuel: 0 }
            });
          } else {
            transaction.update(productRef, {
              'stockGlobal.sorties': increment(quantity),
              'stockGlobal.sf': increment(-quantity)
            });
          }
        } else {
          const entryRef = doc(db, 'stockLivreurs', `${sourceId}_${productId}`);
          if (!sourceEntrySnap?.exists()) {
            transaction.set(entryRef, {
              livreurId: sourceId,
              produitId: productId,
              produitNom: productName,
              SI: 0, entrees: 0, sorties: quantity, SF: -quantity,
              ajustementManuel: 0
            });
          } else {
            transaction.update(entryRef, {
              sorties: increment(quantity),
              SF: increment(-quantity)
            });
          }
        }

        // DESTINATION UPDATE
        if (destinationId === 'global') {
          const productRef = doc(db, 'products', productId);
          const pData = productSnap?.data();
          if (pData && !pData.stockGlobal) {
            transaction.update(productRef, {
              stockGlobal: { si: pData.mainStock || 0, entrees: quantity, sorties: 0, sf: (pData.mainStock || 0) + quantity, ajustementManuel: 0 }
            });
          } else {
            transaction.update(productRef, {
              'stockGlobal.entrees': increment(quantity),
              'stockGlobal.sf': increment(quantity)
            });
          }
        } else {
          const entryRef = doc(db, 'stockLivreurs', `${destinationId}_${productId}`);
          if (!destEntrySnap?.exists()) {
            transaction.set(entryRef, {
              livreurId: destinationId,
              produitId: productId,
              produitNom: productName,
              SI: 0, entrees: quantity, sorties: 0, SF: quantity,
              ajustementManuel: 0
            });
          } else {
            transaction.update(entryRef, {
              entrees: increment(quantity),
              SF: increment(quantity)
            });
          }
        }

        // 3. Log Operation
        const opId = `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const opRef = doc(db, 'stock_operations', opId);
        
        let finalType: any = 'transfert_driver_to_driver';
        if (sourceId === 'global' && destinationId === DEPOT_ID) finalType = 'transfert_global_to_depot';
        else if (sourceId === 'global') finalType = 'transfert_global_to_driver';
        else if (sourceId === DEPOT_ID && destinationId === 'global') finalType = 'transfert_depot_to_global';
        else if (destinationId === 'global') finalType = 'transfert_driver_to_global';
        else if (sourceId === DEPOT_ID) finalType = 'transfert_depot_to_driver';
        else if (destinationId === DEPOT_ID) finalType = 'transfert_driver_to_depot';

        const opData = removeUndefined({
          id: opId,
          date: new Date().toISOString(),
          productId,
          productName,
          type: finalType,
          quantity,
          livreurId: sourceId === 'global' ? undefined : sourceId,
          entiteId: destinationId === 'global' ? undefined : destinationId,
          source: `Transfert par ${adminId}`,
          createdAt: new Date().toISOString()
        });

        transaction.set(opRef, opData);
        console.log('[DataService] transferStock transaction writes set');
      });
      console.log('[DataService] transferStock finished');
    });
  },

  cancelStockOperation: async (opId: string, adminId: string): Promise<void> => {
    if (!db || !auth.currentUser) return;

    await runTransaction(db, async (transaction) => {
      const opRef = doc(db, 'stock_operations', opId);
      const opSnap = await transaction.get(opRef);
      if (!opSnap.exists()) throw new Error("Opération non trouvée");
      
      const op = opSnap.data() as StockOperation;
      if (op.annule) throw new Error("Opération déjà annulée");

      const { productId, quantity, livreurId, entiteId } = op;

      // 1. Reverse Source (livreurId)
      if (livreurId) {
        const entryRef = doc(db, 'stockLivreurs', `${livreurId}_${productId}`);
        transaction.update(entryRef, {
          sorties: increment(-quantity),
          SF: increment(quantity)
        });
      } else {
        const productRef = doc(db, 'products', productId);
        transaction.update(productRef, {
          'stockGlobal.sorties': increment(-quantity),
          'stockGlobal.sf': increment(quantity)
        });
      }

      // 2. Reverse Destination (entiteId)
      if (entiteId) {
        const entryRef = doc(db, 'stockLivreurs', `${entiteId}_${productId}`);
        transaction.update(entryRef, {
          entrees: increment(-quantity),
          SF: increment(-quantity)
        });
      } else {
        const productRef = doc(db, 'products', productId);
        transaction.update(productRef, {
          'stockGlobal.entrees': increment(-quantity),
          'stockGlobal.sf': increment(-quantity)
        });
      }

      // 3. Mark as cancelled
      transaction.update(opRef, {
        annule: true,
        annuleLe: new Date().toISOString(),
        annuleMotif: `Annulation par ${adminId}`
      });
    });
  },

  logStockOperation: async (data: Omit<StockOperation, 'id' | 'createdAt'>): Promise<void> => {
    const op: StockOperation = {
      ...data,
      id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString()
    };
    await FirestoreDataService.saveStockOperation(op);
  },

  logAdjustment: async (data: {
    adminId: string;
    productId: string;
    productName: string;
    targetStock: string; // 'Global' or Driver Name
    oldQty: number;
    newQty: number;
    reason: string;
    livreurId?: string;
    produitSku?: string;
    ajustementManuel?: number;
  }): Promise<void> => {
    if (db && auth.currentUser) {
      await addDoc(collection(db, 'logs_ajustements'), {
        ...data,
        sfAvant: data.oldQty,
        sfApres: data.newQty,
        motif: data.reason,
        superAdminUid: data.adminId,
        date: new Date().toISOString()
      });
    }
  },

  updateGlobalStockSF: async (productId: string, newSF: number, reason: string, adminId: string): Promise<void> => {
    console.log(`[DataService] updateGlobalStockSF: productId=${productId}, newSF=${newSF}`);
    if (db && auth.currentUser) {
      const docRef = doc(db, 'products', productId);
      await firestoreCall(OperationType.WRITE, docRef.path, async () => {
        let snap = await getDoc(docRef);
        let targetRef = docRef;
        
        if (!snap.exists()) {
          const adhocRef = doc(db, 'adhoc_products', productId);
          const adhocSnap = await getDoc(adhocRef);
          if (adhocSnap.exists()) {
            targetRef = adhocRef;
            snap = adhocSnap;
          } else {
            console.error(`[DataService] Product ${productId} not found.`);
            return;
          }
        }

        const data = snap.data() || {};
        const stockGlobal = data.stockGlobal || { si: data.mainStock || 0, entrees: 0, sorties: 0, ajustementManuel: 0 };
        const baseSI = stockGlobal.si ?? data.mainStock ?? 0;
        const currentSF = baseSI + (stockGlobal.entrees || 0) - (stockGlobal.sorties || 0) + (stockGlobal.ajustementManuel || 0);
        const diff = newSF - currentSF;

        if (diff !== 0) {
          // Log adjustment movement
          await FirestoreDataService.logStockOperation({
            date: new Date().toISOString(),
            productId,
            productName: data.title || 'Produit',
            type: 'si_ajustement',
            quantity: diff,
            source: 'ajustement_manuel_service',
            entiteType: 'global',
            notes: reason
          });
        }

        const sfBrut = baseSI + (stockGlobal.entrees || 0) - (stockGlobal.sorties || 0);
        const newDelta = newSF - sfBrut;

        const updatedStockGlobal = {
          ...stockGlobal,
          si: baseSI,
          ajustementManuel: newDelta,
          sf: newSF,
          motifDernierAjustement: reason,
          dateDernierAjustement: new Date().toISOString(),
          ajustePar: adminId,
        };

        await updateDoc(targetRef, {
          stockGlobal: updatedStockGlobal,
          mainStock: newSF, // Keep for backward compatibility
          updatedAt: new Date().toISOString()
        });
      });
    }
  },

  updateLivreurStockSF: async (livreurId: string, productId: string, newSF: number, reason: string, adminId: string): Promise<void> => {
    console.log(`[DataService] updateLivreurStockSF: livreurId=${livreurId}, productId=${productId}, newSF=${newSF}`);
    if (db && auth.currentUser) {
      const docId = `${livreurId}_${productId}`;
      const docRef = doc(db, 'stockLivreurs', docId);
      
      await firestoreCall(OperationType.WRITE, docRef.path, async () => {
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
          const products = await FirestoreDataService.getProducts();
          const product = products.find(p => p.id === productId);
          
          // Log adjustment movement for new entry
          await FirestoreDataService.logStockOperation({
            date: new Date().toISOString(),
            productId,
            productName: product?.title || 'Produit',
            type: 'si_ajustement',
            quantity: newSF,
            livreurId,
            entiteType: livreurId === DEPOT_ID ? 'depot' : 'livreur',
            entiteId: livreurId,
            source: 'init_stock_livreur_adj',
            notes: reason
          });

          await setDoc(docRef, {
            livreurId,
            produitId: productId,
            produitNom: product?.title || 'Inconnu',
            SI: 0,
            entrees: 0,
            sorties: 0,
            SF: newSF,
            ajustementManuel: newSF,
            motifDernierAjustement: reason,
            dateDernierAjustement: new Date().toISOString(),
            ajustePar: adminId,
            updatedAt: new Date().toISOString()
          });
        } else {
          const data = snap.data() || { SI: 0, entrees: 0, sorties: 0, ajustementManuel: 0 };
          const currentSF = (data.SI || 0) + (data.entrees || 0) - (data.sorties || 0) + (data.ajustementManuel || 0);
          const diff = newSF - currentSF;

          if (diff !== 0) {
            // Log adjustment movement
            await FirestoreDataService.logStockOperation({
              date: new Date().toISOString(),
              productId,
              productName: data.produitNom || 'Produit',
              type: 'si_ajustement',
              quantity: diff,
              livreurId,
              entiteType: livreurId === DEPOT_ID ? 'depot' : 'livreur',
              entiteId: livreurId,
              source: 'ajustement_manuel_service',
              notes: reason
            });
          }

          const sfBrut = (data.SI || 0) + (data.entrees || 0) - (data.sorties || 0);
          const newDelta = newSF - sfBrut;

          await updateDoc(docRef, {
            ajustementManuel: newDelta,
            SF: newSF,
            motifDernierAjustement: reason,
            dateDernierAjustement: new Date().toISOString(),
            ajustePar: adminId,
            updatedAt: new Date().toISOString()
          });
        }
      });
    }
  },

  recalculateAllStocks: async (): Promise<{ success: boolean; message: string }> => {
    try {
      if (!db || !auth.currentUser) throw new Error("Non authentifié");

      console.log("[Recalcul] Chargement des données...");
      const [products, adhocProducts, allOps, stLivreursSnap] = await Promise.all([
        FirestoreDataService.getProducts(),
        FirestoreDataService.getAdHocProducts(),
        FirestoreDataService.getStockOperations(),
        getDocs(collection(db, 'stockLivreurs'))
      ]);

      const stLivreurs = stLivreursSnap.docs.map(doc => ({ ...doc.data(), id: doc.id } as StockLivreurEntry));
      const combinedProducts = [...products];
      adhocProducts.forEach(ap => {
          if (!combinedProducts.find(p => p.id === ap.id)) {
              combinedProducts.push({ id: ap.id, title: ap.name, purchasePrice: ap.purchasePrice, stockGlobal: { si: 0, entrees: 0, sorties: 0, sf: 0, ajustementManuel: 0 } } as any);
          }
      });

      console.log(`[Recalcul] ${combinedProducts.length} produits et ${allOps.length} opérations à traiter.`);

      for (const product of combinedProducts) {
        const productId = product.id;
        const productName = product.title;
        
        // Find ALL operations for this product OR for any orphaned entry with same title
        const ops = allOps.filter(op => {
            if (op.annule) return false;
            if (op.productId === productId) return true;
            // Also include ops for different IDs if they have EXACTLY the same title (case-insensitive)
            return (op.productName || '').toLowerCase().trim() === productName.toLowerCase().trim();
        });

        let gEntrees = 0;
        let gSorties = 0;
        let gAjustements = 0;
        const livStats: Record<string, { entrees: number; sorties: number; ajustements: number }> = {};

        ops.forEach(op => {
          const qty = op.quantity || 0;
          const type = op.type;
          const srcId = op.livreurId; 
          const dstId = op.entiteId;    

          // Global impact
          const isGlobalSource = !srcId || srcId === 'global';
          const isGlobalDest = !dstId || dstId === 'global';

          if (isGlobalDest && isGlobalSource) {
            // Internal global operation (no driver/depot involved)
            if (['entree', 'retour'].includes(type)) gEntrees += qty;
            else if (['sortie', 'vente'].includes(type)) gSorties += qty;
            else if (type === 'si_ajustement') gAjustements += qty;
          } else {
            // Cross-entity operation
            if (isGlobalDest) {
              if (['entree', 'retour', 'transfert_driver_to_global', 'transfert_depot_to_global'].includes(type)) gEntrees += qty;
              else if (type === 'si_ajustement') gAjustements += qty;
            }
            if (isGlobalSource) {
              if (['sortie', 'vente', 'transfert_global_to_driver', 'transfert_global_to_depot'].includes(type)) gSorties += qty;
              else if (type === 'si_ajustement') gAjustements -= qty;
            }
          }

          // Driver/Depot impact
          const targetedIds = new Set<string>();
          if (srcId && srcId !== 'global') targetedIds.add(srcId);
          if (dstId && dstId !== 'global') targetedIds.add(dstId);

          targetedIds.forEach(id => {
            if (!livStats[id]) livStats[id] = { entrees: 0, sorties: 0, ajustements: 0 };
            
            if (dstId === id) {
              if (['entree', 'retour', 'transfert_global_to_driver', 'transfert_global_to_depot', 'transfert_driver_to_depot', 'transfert_depot_to_driver'].includes(type)) {
                livStats[id].entrees += qty;
              } else if (type === 'si_ajustement') {
                livStats[id].ajustements += qty;
              }
            } else if (srcId === id) {
              if (['sortie', 'vente', 'transfert_driver_to_global', 'transfert_depot_to_global', 'transfert_driver_to_depot', 'transfert_depot_to_driver'].includes(type)) {
                livStats[id].sorties += qty;
              } else if (type === 'si_ajustement') {
                livStats[id].ajustements -= qty;
              }
            }
          });
        });

        // Update Product (Global)
        const siGlobal = product.stockGlobal?.si ?? product.mainStock ?? 0;
        const sfGlobal = siGlobal + gEntrees - gSorties + gAjustements;
        
        const updateData: any = {
          'stockGlobal.si': siGlobal,
          'stockGlobal.entrees': gEntrees,
          'stockGlobal.sorties': gSorties,
          'stockGlobal.ajustementManuel': gAjustements,
          'stockGlobal.sf': sfGlobal,
          'mainStock': sfGlobal, // Backward compat
          updatedAt: new Date().toISOString()
        };

        const docRef = doc(db, 'products', productId);
        const adhocRef = doc(db, 'adhoc_products', productId);
        
        try {
          await updateDoc(docRef, updateData);
        } catch {
          try { await updateDoc(adhocRef, updateData); } catch {}
        }

        // Update StockLivreurs
        for (const [livId, stats] of Object.entries(livStats)) {
          // Find the entry that matches this product title for this livreur
          // This naturally handles merges if multiple entries with same title existed
          const entriesForThisTitle = stLivreurs.filter(e => e.livreurId === livId && (e.produitNom || '').toLowerCase().trim() === productName.toLowerCase().trim());
          const canonicalEntry = entriesForThisTitle.find(e => e.produitId === productId);
          
          if (canonicalEntry) {
            await updateDoc(doc(db, 'stockLivreurs', canonicalEntry.id), {
              entrees: stats.entrees,
              sorties: stats.sorties,
              ajustementManuel: stats.ajustements,
              SF: (canonicalEntry.SI || 0) + stats.entrees - stats.sorties + stats.ajustements,
              updatedAt: new Date().toISOString()
            });
            
            // Cleanup other entries with same title for this driver
            for (const other of entriesForThisTitle) {
                if (other.id !== canonicalEntry.id) {
                    await deleteDoc(doc(db, 'stockLivreurs', other.id));
                }
            }
          } else if (entriesForThisTitle.length > 0) {
              // No canonical entry but we have orphans with same name.
              // We should probably create the canonical one or move one.
              const bestOrphan = entriesForThisTitle[0];
              const targetDocId = `${livId}_${productId}`;
              const targetRef = doc(db, 'stockLivreurs', targetDocId);
              
              await setDoc(targetRef, {
                  ...bestOrphan,
                  id: targetDocId,
                  produitId: productId,
                  entrees: stats.entrees,
                  sorties: stats.sorties,
                  ajustementManuel: stats.ajustements,
                  SF: (bestOrphan.SI || 0) + stats.entrees - stats.sorties + stats.ajustements,
                  updatedAt: new Date().toISOString()
              });
              
              for (const o of entriesForThisTitle) {
                  await deleteDoc(doc(db, 'stockLivreurs', o.id));
              }
          }
        }
      }

      return { success: true, message: "Le recalcul des stocks est terminé." };
    } catch (e: any) {
      console.error("Recalcul failure:", e);
      return { success: false, message: `Erreur: ${e.message}` };
    }
  },

  updateDriverStock: async (productId: string, driverId: string, quantity: number, action: 'deduct' | 'restore'): Promise<void> => {
    const entries = await FirestoreDataService.getStockLivreurs();
    const products = await FirestoreDataService.getProducts();
    
    // Canonical resolution: try to find the actual product ID if a SKU or title was provided
    const canonicalProduct = products.find(p => 
      p.id === productId || 
      (p.variants && p.variants.some(v => v.sku === productId)) ||
      p.title === productId ||
      (productId && productId.toLowerCase().includes(p.title.toLowerCase()) && p.title.length > 3)
    );

    const resolvedId = canonicalProduct?.id || productId;
    let entry = entries.find(e => e.livreurId === driverId && e.produitId === resolvedId);
    
    if (!entry) {
      if (!canonicalProduct && !productId) return;
      
      entry = {
        livreurId: driverId,
        produitId: resolvedId,
        produitNom: canonicalProduct?.title || productId,
        SI: 0,
        entrees: 0,
        sorties: 0,
        SF: 0
      };
    }

    if (action === 'deduct') {
      entry.sorties += quantity;
    } else {
      entry.sorties = Math.max(0, entry.sorties - quantity);
    }
    entry.SF = (entry.SI || 0) + (entry.entrees || 0) - (entry.sorties || 0) + (entry.ajustementManuel || 0);

    await FirestoreDataService.saveStockLivreurEntry(entry);

    // Log operation
    await FirestoreDataService.logStockOperation({
      date: new Date().toISOString(),
      productId,
      productName: entry.produitNom,
      type: action === 'deduct' ? 'sortie' : 'entree',
      quantity,
      livreurId: driverId,
      source: 'order'
    });
  },

  updateDepotStock: async (productId: string, quantity: number, action: 'add' | 'deduct', source: string = 'order', commandeId?: string): Promise<void> => {
    const entries = await FirestoreDataService.getStockLivreurs();
    const products = await FirestoreDataService.getProducts();

    // Canonical resolution
    const canonicalProduct = products.find(p => 
      p.id === productId || 
      (p.variants && p.variants.some(v => v.sku === productId)) ||
      p.title === productId ||
      (productId && productId.toLowerCase().includes(p.title.toLowerCase()) && p.title.length > 3)
    );

    const resolvedId = canonicalProduct?.id || productId;
    let entry = entries.find(e => e.livreurId === DEPOT_ID && e.produitId === resolvedId);
    
    if (!entry) {
      if (!canonicalProduct && !productId) return;
      
      entry = {
        livreurId: DEPOT_ID,
        produitId: resolvedId,
        produitNom: canonicalProduct?.title || productId,
        SI: 0,
        entrees: 0,
        sorties: 0,
        SF: 0
      };
    }

    if (action === 'add') {
      entry.entrees += quantity;
    } else {
      entry.sorties += quantity;
    }
    entry.SF = (entry.SI || 0) + (entry.entrees || 0) - (entry.sorties || 0) + (entry.ajustementManuel || 0);

    await FirestoreDataService.saveStockLivreurEntry(entry);

    // Log operation
    await FirestoreDataService.logStockOperation({
      date: new Date().toISOString(),
      productId,
      productName: entry.produitNom,
      type: action === 'add' ? 'entree' : 'sortie',
      quantity,
      livreurId: DEPOT_ID,
      entiteType: 'depot',
      entiteId: DEPOT_ID,
      source,
      commandeId
    });
  },

  verifierStockLivreur: async (produitId: string, livreurId: string, quantite: number): Promise<boolean> => {
    const entries = await FirestoreDataService.getStockLivreurs();
    const entry = entries.find(e => e.livreurId === livreurId && e.produitId === produitId);
    if (!entry) return false;
    return entry.SF >= quantite;
  },

  deduireStockLivreur: async (produitId: string, livreurId: string, quantite: number): Promise<void> => {
    await FirestoreDataService.updateDriverStock(produitId, livreurId, quantite, 'deduct');
  },

  restituerStockLivreur: async (produitId: string, livreurId: string, quantite: number): Promise<void> => {
    await FirestoreDataService.updateDriverStock(produitId, livreurId, quantite, 'restore');
  },

  importProducts: async (newProducts: Product[]): Promise<void> => {
    // Filter to only allow 'active' products
    const settings = await FirestoreDataService.getSettings();
    const ignoredIds = new Set(settings.ignoredShopifyIds || []);
    
    const activeProducts = newProducts.filter(p => p.status === 'active' && !ignoredIds.has(p.id));
    const activeIds = new Set(activeProducts.map(p => p.id));
    
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.WRITE, 'products', async () => {
        // 1. Get ALL existing products
        const snapshot = await getDocs(collection(db, 'products'));
        const existingProducts = snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as Product)) ?? [];

        // 2. Identify products to DELETE (Existing in DB but NOT in new Active list)
        // We assume newProducts contains the FULL list of products from Shopify (or at least the full active list)
        // If we are doing a full sync, anything in DB that is NOT in activeProducts should be removed.
        // However, we must be careful if newProducts is partial. 
        // The requirement says "Les produits dont le statut passe à "Archivé" sur Shopify doivent être immédiatement supprimés... lors de la prochaine synchronisation"
        // This implies a full sync.
        
        const productsToDelete = existingProducts.filter(p => p.source !== 'ponctuel' && !activeIds.has(p.id));

        // 3. Batch Delete
        const deletePromises = productsToDelete.map(p => deleteDoc(doc(db, 'products', p.id)));
        await Promise.all(deletePromises);

        // 4. Batch Update/Insert Active
        const batchPromises = activeProducts.map(async (product) => {
            // Check if existing to preserve mainStock, sellingPrice, purchasePrice
            const existing = existingProducts.find(ep => ep.id === product.id);
            const productToSave = { ...product };
            
            if (existing) {
                if (existing.mainStock !== undefined) productToSave.mainStock = existing.mainStock;
                if (existing.sellingPrice !== undefined) productToSave.sellingPrice = existing.sellingPrice;
                if (existing.purchasePrice !== undefined) productToSave.purchasePrice = existing.purchasePrice;
            }
            
            await setDoc(doc(db, 'products', product.id), productToSave, { merge: true });
        });
        await Promise.all(batchPromises);
      });
    }

    // Local Storage Fallback
    const currentProducts = localLoad<Product[]>(STORAGE_KEYS.PRODUCTS, []);
    
    // Filter out products that are NOT in the new active list (Delete logic)
    // But we also need to keep products that might not be in the import if the import is partial?
    // Assuming import is FULL list of active products.
    // So we keep only products that ARE in the new active list, AND we keep ponctuel products.
    
    const productMap = new Map(currentProducts.map(p => [p.id, p]));
    const finalProducts: Product[] = currentProducts.filter(p => p.source === 'ponctuel');

    activeProducts.forEach(newP => {
        const existing = productMap.get(newP.id);
        if (existing) {
            // Preserve mainStock, sellingPrice, purchasePrice
            finalProducts.push({ 
                ...newP, 
                mainStock: existing.mainStock,
                sellingPrice: existing.sellingPrice,
                purchasePrice: existing.purchasePrice
            });
        } else {
            finalProducts.push(newP);
        }
    });

    localSave(STORAGE_KEYS.PRODUCTS, finalProducts);
  },

  // --- SHOPIFY API (REAL) ---
  fetchShopifyProducts: async (): Promise<Product[]> => {
      const settings = await FirestoreDataService.getSettings();
      
      if (!settings.shopifyDomain || !settings.shopifyAccessToken) {
          console.warn("Shopify credentials missing. Skipping import.");
          return [];
      }

      console.log("Fetching Shopify Products from:", settings.shopifyDomain);
      
      try {
          // Call our local proxy server
          const response = await fetch('/api/shopify/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  shopDomain: settings.shopifyDomain,
                  accessToken: settings.shopifyAccessToken
              })
          });

          if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              let errorMessage = errorData.error || "Erreur inconnue";
              
              // Try to parse nested JSON if it exists
              try {
                  const nested = JSON.parse(errorMessage);
                  if (nested.errors) errorMessage = nested.errors;
              } catch (e) {}

              if (response.status === 402) {
                  throw new Error("La boutique Shopify est indisponible (Erreur 402). Cela signifie généralement que la boutique est gelée, inactive ou qu'il y a un problème de paiement sur le compte Shopify.");
              }
              if (response.status === 401) {
                  throw new Error("Token d'accès Shopify invalide ou expiré (Erreur 401).");
              }
              if (response.status === 404) {
                  throw new Error("Domaine Shopify introuvable (Erreur 404). Vérifiez le nom de la boutique.");
              }
              
              throw new Error(`Erreur Shopify (${response.status}): ${errorMessage}`);
          }

          const data = await response.json();
          // Map Shopify format to our Product format
          // Shopify returns { products: [...] }
          
          return (data.products || []).map((sp: any) => ({
              id: sp.id.toString(),
              title: sp.title,
              description: sp.body_html,
              vendor: sp.vendor,
              productType: sp.product_type,
              createdAt: sp.created_at,
              updatedAt: sp.updated_at,
              tags: sp.tags ? sp.tags.split(',').map((t: string) => t.trim()) : [],
              status: sp.status,
              source: 'shopify',
              totalInventory: sp.variants.reduce((acc: number, v: any) => acc + (v.inventory_quantity || 0), 0),
              variants: sp.variants.map((v: any) => ({
                  id: v.id.toString(),
                  productId: v.product_id.toString(),
                  title: v.title,
                  sku: v.sku,
                  price: parseFloat(v.price),
                  inventoryQuantity: v.inventory_quantity || 0,
                  weight: v.weight,
                  weightUnit: v.weight_unit
              })),
              images: sp.images.map((img: any) => ({
                  id: img.id.toString(),
                  src: img.src,
                  alt: img.alt
              }))
          }));

      } catch (error) {
          console.error("Failed to fetch Shopify products:", error);
          throw error;
      }
  },

  // --- FINANCIAL CONFIGS ---

  getFinancialConfigs: async (): Promise<ProductFinancialConfig[]> => {
      if (db && auth.currentUser) {
          return firestoreCall(OperationType.LIST, 'configs (collectionGroup)', async () => {
              const snapshot = await getDocs(collectionGroup(db, 'configs'));
              if (snapshot.empty) {
                  const snapshotLegacy = await getDocs(collection(db, 'financial_configs'));
                  return snapshotLegacy?.docs?.map((d) => mapFinancialConfigDoc(d)) ?? [];
              }
              return snapshot?.docs?.map((d) => mapFinancialConfigDoc(d)) ?? [];
          });
      }
      return localLoad(STORAGE_KEYS.FINANCIAL_CONFIGS, []);
  },

  saveFinancialConfig: async (config: ProductFinancialConfig): Promise<void> => {
      // Structure versionnée : campagnes/{produitId}/configs/{dateEffet}
      const dateEffet = config.dateEffet || new Date().toISOString().split('T')[0];
      const productId = config.productId;
      
      const configToSave = {
          ...config,
          dateEffet
      };

      if (db && auth.currentUser) {
          const docRef = doc(db, 'campagnes', productId, 'configs', dateEffet);
          await firestoreCall(OperationType.WRITE, docRef.path, async () => await setDoc(docRef, removeUndefined(configToSave)));
          return;
      }
      
      const configs = [...localLoad<ProductFinancialConfig[]>(STORAGE_KEYS.FINANCIAL_CONFIGS, [])];
      configs.push(configToSave);
      localSave(STORAGE_KEYS.FINANCIAL_CONFIGS, configs);
  },

  migrateFinancialConfigs: async () => {
    if (!db || !auth.currentUser) return;
    
    try {
        console.log("Checking for financial configuration migration...");
        
        // 1. Check legacy unique document structure at root of products or campaigns
        // Some apps might have them in 'financial_configs' or 'campagnes'
        const legacySnap = await getDocs(collection(db, 'financial_configs'));
        const campagneSnap = await getDocs(collection(db, 'campagnes'));
        
        const dateReference = "2026-03-05";

        // Migrate from 'financial_configs'
        for (const lDoc of legacySnap.docs) {
            const data = lDoc.data() as ProductFinancialConfig;
            const pid = data.productId;
            if (!pid) continue;
            
            const configsSnap = await getDocs(collection(db, 'campagnes', pid, 'configs'));
            if (configsSnap.empty) {
                const dateEffet = data.dateEffet || dateReference;
                await setDoc(doc(db, 'campagnes', pid, 'configs', dateEffet), {
                    ...data,
                    dateEffet
                });
                console.log(`Migrated legacy config for ${pid}`);
            }
        }

        // Migrate from 'campagnes' root
        for (const cDoc of campagneSnap.docs) {
            const configsSnap = await getDocs(collection(db, 'campagnes', cDoc.id, 'configs'));
            if (configsSnap.empty) {
                const data = cDoc.data();
                // Check if it's a root config (has cau/caUnitaire) or just a parent doc
                if (data.cau || data.caUnitaire || data.budgetJournalier) {
                    const dateEffet = dateReference;
                    await setDoc(doc(db, 'campagnes', cDoc.id, 'configs', dateEffet), {
                        productId: cDoc.id,
                        cau: data.cau || data.caUnitaire || 0,
                        appro: data.appro || data.coutAppro || 0,
                        dailyBudgetUsd: data.dailyBudgetUsd || data.budgetJournalier || 0,
                        isCampaignActive: data.isCampaignActive ?? (data.statut === 'Active' || data.statut === true),
                        updatedAt: data.updatedAt || new Date().toISOString(),
                        dateEffet
                    });
                    console.log(`Migrated root campagne for ${cDoc.id}`);
                }
            }
        }
    } catch (e) {
        console.error("Migration failed", e);
    }
  },

  // --- DAILY ENTRIES ---
  getDailyEntries: async (): Promise<DailyFinancialEntry[]> => {
      if (db && auth.currentUser) {
          return firestoreCall(OperationType.LIST, 'daily_entries', async () => {
              const snapshot = await getDocs(collection(db, 'daily_entries'));
              if (snapshot.empty) return [];
              return snapshot?.docs?.map(doc => ({ ...doc.data() } as DailyFinancialEntry)) ?? [];
          });
      }
      return localLoad(STORAGE_KEYS.DAILY_ENTRIES, []);
  },

  saveDailyEntry: async (entry: DailyFinancialEntry): Promise<void> => {
      // ID format: YYYY-MM-DD
      const id = entry.date;
      
      if (db && auth.currentUser) {
          await firestoreCall(OperationType.WRITE, `daily_entries/${id}`, async () => await setDoc(doc(db, 'daily_entries', id), removeUndefined(entry)));
          return;
      }
      
      const entries = [...localLoad<DailyFinancialEntry[]>(STORAGE_KEYS.DAILY_ENTRIES, [])];
      const index = entries.findIndex(e => e.date === entry.date);
      if (index >= 0) entries[index] = entry;
      else entries.push(entry);
      localSave(STORAGE_KEYS.DAILY_ENTRIES, entries);
  },

  // --- DAILY FINANCE (MANUAL ENTRIES) ---
  getDailyFinanceData: async (date: string): Promise<DailyFinanceData | null> => {
      if (db && auth.currentUser) {
          return firestoreCall(OperationType.GET, `daily_finance/${date}`, async () => {
              const docRef = doc(db, 'daily_finance', date);
              const snap = await getDoc(docRef);
              if (snap.exists()) return snap.data() as DailyFinanceData;
              return null;
          });
      }
      const data = localLoad<DailyFinanceData[]>(STORAGE_KEYS.DAILY_FINANCE, []);
      return data.find(d => d.date === date) || null;
  },

  getAllDailyFinanceData: async (): Promise<DailyFinanceData[]> => {
      if (db && auth.currentUser) {
          const snapshot = await getDocs(collection(db, 'daily_finance'));
          if (snapshot.empty) return [];
          return snapshot?.docs?.map(doc => ({ ...doc.data() } as DailyFinanceData)) ?? [];
      }
      return localLoad<DailyFinanceData[]>(STORAGE_KEYS.DAILY_FINANCE, []);
  },

  saveDailyFinanceData: async (data: DailyFinanceData): Promise<void> => {
      if (db && auth.currentUser) {
          await setDoc(doc(db, 'daily_finance', data.date), removeUndefined(data));
          return;
      }
      const allData = [...localLoad<DailyFinanceData[]>(STORAGE_KEYS.DAILY_FINANCE, [])];
      const index = allData.findIndex(d => d.date === data.date);
      if (index >= 0) allData[index] = data;
      else allData.push(data);
      localSave(STORAGE_KEYS.DAILY_FINANCE, allData);
  },

  // --- PURCHASE ORDERS ---
  getPurchaseOrders: async (): Promise<PurchaseOrder[]> => {
    if (db && auth.currentUser) {
      const q = query(collection(db, 'purchase_orders'), orderBy('date', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseOrder)) ?? [];
    }
    return localLoad<PurchaseOrder[]>(STORAGE_KEYS.PURCHASE_ORDERS, []);
  },

  savePurchaseOrder: async (po: PurchaseOrder): Promise<void> => {
    if (db && auth.currentUser) {
      await setDoc(doc(db, 'purchase_orders', po.id), removeUndefined(po), { merge: true });
      return;
    }
    const pos = localLoad<PurchaseOrder[]>(STORAGE_KEYS.PURCHASE_ORDERS, []);
    const index = pos.findIndex(p => p.id === po.id);
    if (index >= 0) pos[index] = po;
    else pos.push(po);
    localSave(STORAGE_KEYS.PURCHASE_ORDERS, pos);
  },

  deletePurchaseOrder: async (id: string): Promise<void> => {
    if (db) {
      await firestoreCall(OperationType.DELETE, 'purchase_orders', async () => await deleteDoc(doc(db, 'purchase_orders', id)));
      return;
    }
    const pos = localLoad<PurchaseOrder[]>(STORAGE_KEYS.PURCHASE_ORDERS, []);
    const newPos = pos.filter(p => p.id !== id);
    localSave(STORAGE_KEYS.PURCHASE_ORDERS, newPos);
  },

  subscribeToPurchaseOrders: (callback: (pos: PurchaseOrder[]) => void): (() => void) => {
    if (!db || !auth.currentUser) return () => {};
    const q = query(collection(db, 'purchase_orders'), orderBy('date', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const pos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseOrder));
      callback(pos);
    }, (error) => handleListenerError(error, 'purchase_orders'));
  },

  // --- AD HOC PRODUCTS ---
  ajouterProduitPonctuelDansStock: async (nom: string, prixAchat: number, prixVente: number = 0): Promise<string> => {
    if (db && auth.currentUser) {
      return firestoreCall(OperationType.WRITE, 'products', async () => {
        const q = query(
          collection(db, "products"),
          where("source", "==", "ponctuel"),
          where("title", "==", nom.trim())
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          return snapshot.docs[0].id;
        }

        const newProduct: Product = {
          id: crypto.randomUUID(),
          title: nom.trim(),
          tags: [],
          variants: [],
          images: [],
          status: 'active',
          source: 'ponctuel',
          purchasePrice: prixAchat ?? 0,
          sellingPrice: prixVente ?? 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          stockGlobal: { si: 0, entrees: 0, sorties: 0, sf: 0 }
        };

        const ref = await addDoc(collection(db, "products"), newProduct);
        return ref.id;
      });
    }
    
    // Fallback for local storage
    const products = localLoad<Product[]>(STORAGE_KEYS.PRODUCTS, []);
    const existing = products.find(p => p.source === 'ponctuel' && p.title === nom.trim());
    if (existing) return existing.id;
    
    const newProduct: Product = {
      id: crypto.randomUUID(),
      title: nom.trim(),
      tags: [],
      variants: [],
      images: [],
      status: 'active',
      source: 'ponctuel',
      purchasePrice: prixAchat ?? 0,
      sellingPrice: prixVente ?? 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stockGlobal: { si: 0, entrees: 0, sorties: 0, sf: 0 }
    };
    products.push(newProduct);
    localSave(STORAGE_KEYS.PRODUCTS, products);
    return newProduct.id;
  },

  resetAllStockEntries: async (): Promise<{ success: boolean; message: string }> => {
    try {
      const allProducts = await FirestoreDataService.getProducts();
      const pos = await FirestoreDataService.getPurchaseOrders();

      // 1. Reset all products
      for (const product of allProducts) {
        const currentGlobal = product.stockGlobal || { si: product.mainStock || 0, entrees: 0, sorties: 0, sf: product.mainStock || 0, ajustementManuel: 0 };
        const oldSf = (currentGlobal.si || 0) + (currentGlobal.entrees || 0) - (currentGlobal.sorties || 0);
        const newSi = oldSf + (currentGlobal.ajustementManuel || 0);
        
        // Reset global
        const updatedGlobal = {
          si: newSi,
          entrees: 0,
          sorties: 0,
          sf: newSi,
          ajustementManuel: 0
        };

        // Reset livreurs
        const updatedLivreurs: Record<string, any> = {};
        if (product.stockLivreurs) {
          for (const [driverId, stock] of Object.entries(product.stockLivreurs)) {
            const oldLSf = (stock.si || 0) + (stock.entrees || 0) - (stock.sorties || 0);
            const newLsi = oldLSf + (stock.ajustementManuel || 0);
            updatedLivreurs[driverId] = {
              ...stock,
              si: newLsi,
              entrees: 0,
              sorties: 0,
              sf: newLsi,
              ajustementManuel: 0
            };
          }
        }

        const updatedProduct: Product = {
          ...product,
          mainStock: newSi,
          stockGlobal: updatedGlobal,
          stockLivreurs: updatedLivreurs
        };
        await FirestoreDataService.saveProduct(updatedProduct);
      }

      // Also reset the separate collection
      const entries = await FirestoreDataService.getStockLivreurs();
      for (const entry of entries) {
          const oldSf = (entry.SI || 0) + (entry.entrees || 0) - (entry.sorties || 0);
          const newSi = oldSf + (entry.ajustementManuel || 0);
          await FirestoreDataService.saveStockLivreurEntry({
              ...entry,
              SI: newSi,
              entrees: 0,
              sorties: 0,
              SF: newSi,
              ajustementManuel: 0
          });
      }

      // 2. Mark all existing delivered POs as updated so they are ignored for future counts
      for (const po of pos) {
        if (po.status === 'delivered' && !po.ponctuelStockUpdated) {
          await FirestoreDataService.savePurchaseOrder({ ...po, ponctuelStockUpdated: true });
        }
      }

      return { success: true, message: "Toutes les entrées et sorties de stock ont été réinitialisées à 0. Les nouveaux calculs commenceront à partir d'aujourd'hui." };
    } catch (error) {
      console.error("Reset stock entries error:", error);
      return { success: false, message: "Erreur lors de la réinitialisation des stocks." };
    }
  },

  resetGlobalStock: async (): Promise<{ success: boolean; message: string }> => {
    try {
      const allProducts = await FirestoreDataService.getProducts();
      for (const product of allProducts) {
        const currentGlobal = product.stockGlobal || { si: product.mainStock || 0, entrees: 0, sorties: 0, sf: product.mainStock || 0, ajustementManuel: 0 };
        const oldSf = (currentGlobal.si || 0) + (currentGlobal.entrees || 0) - (currentGlobal.sorties || 0);
        const newSi = oldSf + (currentGlobal.ajustementManuel || 0);
        const updatedProduct: Product = {
          ...product,
          mainStock: newSi,
          stockGlobal: {
            si: newSi,
            entrees: 0,
            sorties: 0,
            sf: newSi,
            ajustementManuel: 0
          }
        };
        await FirestoreDataService.saveProduct(updatedProduct);
      }
      return { success: true, message: 'Stock global réinitialisé avec succès.' };
    } catch (error) {
      console.error("Reset global stock error:", error);
      return { success: false, message: 'Erreur lors de la réinitialisation du stock global.' };
    }
  },

  resetDriverStocks: async (): Promise<{ success: boolean; message: string }> => {
    try {
      const allProducts = await FirestoreDataService.getProducts();
      for (const product of allProducts) {
        if (product.stockLivreurs) {
          const updatedLivreurs: Record<string, any> = {};
          for (const [driverId, stock] of Object.entries(product.stockLivreurs)) {
            const oldLSf = (stock.si || 0) + (stock.entrees || 0) - (stock.sorties || 0);
            const newLsi = oldLSf + (stock.ajustementManuel || 0);
            updatedLivreurs[driverId] = {
              ...stock,
              si: newLsi,
              entrees: 0,
              sorties: 0,
              sf: newLsi,
              ajustementManuel: 0
            };
          }
          await FirestoreDataService.saveProduct({ ...product, stockLivreurs: updatedLivreurs });
        }
      }
      
      const entries = await FirestoreDataService.getStockLivreurs();
      for (const entry of entries) {
          const oldSf = (entry.SI || 0) + (entry.entrees || 0) - (entry.sorties || 0);
          const newSi = oldSf + (entry.ajustementManuel || 0);
          await FirestoreDataService.saveStockLivreurEntry({
              ...entry,
              SI: newSi,
              entrees: 0,
              sorties: 0,
              SF: newSi,
              ajustementManuel: 0
          });
      }
      return { success: true, message: 'Stock des livreurs réinitialisé avec succès.' };
    } catch (error) {
      console.error("Reset driver stocks error:", error);
      return { success: false, message: 'Erreur lors de la réinitialisation du stock des livreurs.' };
    }
  },

  getAdHocProducts: async (): Promise<AdHocProduct[]> => {
    const products = await FirestoreDataService.getProducts();
    return products.filter(p => p.source === 'ponctuel').map(p => ({
        id: p.id,
        name: p.title,
        purchasePrice: p.purchasePrice || 0,
        createdAt: p.createdAt
    }));
  },

  saveAdHocProduct: async (product: AdHocProduct): Promise<void> => {
    if (db && auth.currentUser) {
      await setDoc(doc(db, 'adhoc_products', product.id), removeUndefined(product), { merge: true });
      return;
    }
    const products = localLoad<AdHocProduct[]>(STORAGE_KEYS.ADHOC_PRODUCTS, []);
    const index = products.findIndex(p => p.id === product.id);
    if (index >= 0) products[index] = product;
    else products.push(product);
    localSave(STORAGE_KEYS.ADHOC_PRODUCTS, products);
  },

  deleteAdHocProduct: async (id: string): Promise<void> => {
    if (db && auth.currentUser) {
      await deleteDoc(doc(db, 'adhoc_products', id));
      return;
    }
    const products = localLoad<AdHocProduct[]>(STORAGE_KEYS.ADHOC_PRODUCTS, []);
    const newProducts = products.filter(p => p.id !== id);
    localSave(STORAGE_KEYS.ADHOC_PRODUCTS, newProducts);
  },

  getClaudeAnalysis: async (date: string): Promise<string | null> => {
    try {
      if (db && auth.currentUser) {
        const docRef = doc(db, 'claude_analysis', date);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          return docSnap.data().analysis;
        }
        return null;
      } else {
        const analyses = localLoad<Record<string, string>>(STORAGE_KEYS.CLAUDE_ANALYSIS, {});
        return analyses[date] || null;
      }
    } catch (e) {
      console.error("Error getting Claude analysis:", e);
      return null;
    }
  },

  saveClaudeAnalysis: async (date: string, analysis: string): Promise<void> => {
    try {
      if (db && auth.currentUser) {
        const docRef = doc(db, 'claude_analysis', date);
        await setDoc(docRef, removeUndefined({ analysis, updatedAt: new Date().toISOString() }));
      } else {
        const analyses = localLoad<Record<string, string>>(STORAGE_KEYS.CLAUDE_ANALYSIS, {});
        analyses[date] = analysis;
        localSave(STORAGE_KEYS.CLAUDE_ANALYSIS, analyses);
      }
    } catch (e) {
      console.error("Error saving Claude analysis:", e);
      throw e;
    }
  },

  // --- ACCOUNTING ENTRIES ---
  getAccountingEntries: async (): Promise<AccountingEntry[]> => {
    let entries: AccountingEntry[] = [];
    if (db && auth.currentUser) {
      const snapshot = await getDocs(collection(db, 'accounting_entries'));
      entries = snapshot?.docs?.map(doc => ({ id: doc.id, ...doc.data() } as AccountingEntry)) ?? [];
    } else {
      entries = localLoad<AccountingEntry[]>(STORAGE_KEYS.ACCOUNTING_ENTRIES, []);
    }
    
    // Migration: add origine and modifiable if missing
    return entries.map(entry => {
        if (!entry.origine) {
            entry.origine = entry.isManual ? 'manuel' : 'finance';
            entry.modifiable = entry.isManual;
        }
        return entry;
    });
  },

  saveAccountingEntry: async (entry: AccountingEntry): Promise<void> => {
    if (db && auth.currentUser) {
      await setDoc(doc(db, 'accounting_entries', entry.id), removeUndefined(entry), { merge: true });
      return;
    }
    const entries = localLoad<AccountingEntry[]>(STORAGE_KEYS.ACCOUNTING_ENTRIES, []);
    const index = entries.findIndex(e => e.id === entry.id);
    if (index >= 0) entries[index] = entry;
    else entries.push(entry);
    localSave(STORAGE_KEYS.ACCOUNTING_ENTRIES, entries);
  },

  deleteAccountingEntry: async (id: string): Promise<void> => {
    if (db && auth.currentUser) {
      await firestoreCall(OperationType.DELETE, 'accounting_entries', async () => await deleteDoc(doc(db, 'accounting_entries', id)));
      return;
    }
    const entries = localLoad<AccountingEntry[]>(STORAGE_KEYS.ACCOUNTING_ENTRIES, []);
    const newEntries = entries.filter(e => e.id !== id);
    localSave(STORAGE_KEYS.ACCOUNTING_ENTRIES, newEntries);
  },

  cleanupDuplicateProduct: async (productName: string, legitimateId: string): Promise<void> => {
    if (!db || !auth.currentUser) return;
    
    console.log(`[DataService] Cleaning up duplicate for ${productName} towards legitimateId ${legitimateId}`);
    const nameLower = productName.toLowerCase().trim();
    
    // 1. Reassign operations
    const opsSnap = await getDocs(query(collection(db, 'stock_operations')));
    const batch = [];
    
    for (const snap of opsSnap.docs) {
       const op = snap.data();
       if ((op.productName || '').toLowerCase().trim() === nameLower && op.productId !== legitimateId) {
          batch.push(updateDoc(snap.ref, { productId: legitimateId }));
       }
    }
    
    await Promise.all(batch);
    console.log(`[DataService] Reassigned ${batch.length} operations.`);
    
    // 2. Delete orphaned stockLivreurs entries
    const stSnap = await getDocs(collection(db, 'stockLivreurs'));
    const delBatch = [];
    for (const snap of stSnap.docs) {
        const entry = snap.data();
        if ((entry.produitNom || '').toLowerCase().trim() === nameLower && entry.produitId !== legitimateId) {
            delBatch.push(deleteDoc(snap.ref));
        }
    }
    
    await Promise.all(delBatch);
    console.log(`[DataService] Deleted ${delBatch.length} orphaned stock entries.`);
    
    // 3. Recalculate
    await FirestoreDataService.recalculateAllStocks();
  },
};