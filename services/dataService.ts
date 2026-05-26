
import { Driver, Order, Zone, SystemUser, AppSettings, FundRequest, Product, ProductFinancialConfig, DailyFinancialEntry, PurchaseOrder, AdHocProduct, AccountingEntry, DailyFinanceData, StockLivreurEntry, StockOperation } from '../types';
import { INITIAL_DRIVERS, INITIAL_ORDERS, INITIAL_ZONES, INITIAL_USERS, INITIAL_FUND_REQUESTS } from './mockData';
import { api, apiId } from './api';
import { createPollingSubscription } from './polling';
import { POLL_MS } from './poll-intervals';

export const DEPOT_ID = 'depot_delta';

const DEFAULT_SETTINGS: AppSettings = {
  adminPhone: '221770000000',
  logoUrl: '',
  shopifyDomain: '',
  shopifyAccessToken: '',
  ignoredShopifyIds: []
};

// ═══════════════════════════════════════════════════════════════
// DataService — All data access via REST API (PostgreSQL backend)
// ═══════════════════════════════════════════════════════════════

export const DataService = {
  // Migration legacy method -> noop since handled by backend
  migrateLocalStorageToFirebase: async () => {
    console.log('migrateLocalStorageToFirebase deprecated. Doing nothing.');
  },

  // ═══════════════════════════════════════════
  // DRIVERS
  // ═══════════════════════════════════════════

  getDrivers: async (): Promise<Driver[]> => {
    return api.get<Driver[]>('/drivers').catch(() => INITIAL_DRIVERS);
  },

  saveDriver: async (driver: Driver): Promise<void> => {
    if (driver.id) {
      await api.put(`/drivers/${apiId(driver.id)}`, driver);
    } else {
      await api.post('/drivers', driver);
    }
  },

  deleteDriver: async (id: string): Promise<void> => {
    await api.delete(`/drivers/${apiId(id)}`);
  },

  subscribeToDrivers: (callback: (drivers: Driver[]) => void) => {
    return createPollingSubscription(
      () => DataService.getDrivers(),
      callback,
      POLL_MS.calm
    );
  },

  // ═══════════════════════════════════════════
  // ZONES
  // ═══════════════════════════════════════════

  getZones: async (): Promise<Zone[]> => {
    return api.get<Zone[]>('/zones').catch(() => INITIAL_ZONES);
  },

  saveZone: async (zone: Zone): Promise<void> => {
    if (zone.id) {
      await api.put(`/zones/${apiId(zone.id)}`, zone);
    } else {
      await api.post('/zones', zone);
    }
  },

  deleteZone: async (id: string): Promise<void> => {
    await api.delete(`/zones/${apiId(id)}`);
  },

  subscribeToZones: (callback: (zones: Zone[]) => void): (() => void) => {
    return createPollingSubscription(
      () => DataService.getZones(),
      callback,
      POLL_MS.calm
    );
  },

  // ═══════════════════════════════════════════
  // ORDERS
  // ═══════════════════════════════════════════

  syncFromGoogleSheet: async (url: string): Promise<{ count: number; ignored: number }> => {
    if (!url) throw new Error("URL manquante");
    // Delegate CSV parsing + import to backend
    const result = await api.post<{ count: number; ignored: number }>('/orders/import', { url });
    return result;
  },

  importProcessedOrders: async (data: any[], _products: Product[]): Promise<{ count: number; ignored: number }> => {
    // Delegate to backend bulk import
    const result = await api.post<{ count: number; ignored: number }>('/orders/import-batch', { orders: data });
    return { count: result.count, ignored: 0 };
  },

  getOrders: async (): Promise<Order[]> => {
    return api.get<Order[]>('/orders?lite=1').catch(() => INITIAL_ORDERS);
  },

  getRegionalOrders: async (): Promise<Order[]> => {
    return api.get<Order[]>('/orders/regional').catch(() => []);
  },

  saveOrder: async (order: Order): Promise<void> => {
    if (order.id) {
      await api.put(`/orders/${apiId(order.id)}`, order);
    } else {
      await api.post('/orders', order);
    }
  },

  deleteOrder: async (id: string): Promise<void> => {
    await api.delete(`/orders/${apiId(id)}`);
  },

  updateOrderDeliveredLocally: (_orderId: string, _deliveredInfos: any): void => {
    // Obsolete en API REST — les mises à jour passent par saveOrder
  },

  updateOrderStatusLocally: (_orderId: string, _status: string): void => {
    // Obsolete en API REST
  },

  subscribeToOrders: (callback: (orders: Order[]) => void, _label?: string): (() => void) => {
    return createPollingSubscription(
      () => DataService.getOrders(),
      callback,
      POLL_MS.critical
    );
  },

  subscribeToRegionalOrders: (callback: (orders: Order[]) => void): (() => void) => {
    return createPollingSubscription(
      () => DataService.getRegionalOrders(),
      callback,
      POLL_MS.standard
    );
  },

  importOrders: async (newOrders: Order[]): Promise<void> => {
    await api.post('/orders/import-batch', { orders: newOrders });
  },

  // ═══════════════════════════════════════════
  // FUND REQUESTS
  // ═══════════════════════════════════════════

  getFundRequests: async (): Promise<FundRequest[]> => {
    return api.get<FundRequest[]>('/fund-requests').catch(() => INITIAL_FUND_REQUESTS);
  },

  saveFundRequest: async (request: FundRequest): Promise<void> => {
    if (request.id && request.id !== 'new') {
      await api.put(`/fund-requests/${apiId(request.id)}`, request);
    } else {
      await api.post('/fund-requests', request);
    }
  },

  deleteFundRequest: async (id: string): Promise<void> => {
    await api.delete(`/fund-requests/${apiId(id)}`);
  },

  approveFundRequestLocally: (_id: string): void => {
    // Obsolete — utiliser saveFundRequest avec status: 'approved'
  },

  subscribeToFundRequests: (callback: (requests: FundRequest[]) => void) => {
    return createPollingSubscription(
      () => DataService.getFundRequests(),
      callback,
      POLL_MS.standard
    );
  },

  // ═══════════════════════════════════════════
  // USERS (ADMIN/STAFF)
  // ═══════════════════════════════════════════

  getUsers: async (): Promise<SystemUser[]> => {
    return api.get<SystemUser[]>('/users').catch(() => INITIAL_USERS);
  },

  saveUser: async (user: SystemUser): Promise<void> => {
    if (user.id && user.id !== 'new') {
      await api.put(`/users/${apiId(user.id)}`, user);
    } else {
      await api.post('/users', user);
    }
  },

  deleteUser: async (id: string): Promise<void> => {
    await api.delete(`/users/${apiId(id)}`);
  },

  // ═══════════════════════════════════════════
  // CONFIG (Generic key-value config)
  // ═══════════════════════════════════════════

  getConfig: async (key: string, defaultValue: any = null): Promise<any> => {
    try {
      const result = await api.get<{ value: unknown }>(`/settings/config/${key}`);
      if (result.value === undefined || result.value === null) return defaultValue;
      if (typeof result.value === 'string') {
        try {
          return JSON.parse(result.value);
        } catch {
          return result.value;
        }
      }
      return result.value;
    } catch {
      return defaultValue;
    }
  },

  saveConfig: async (key: string, value: any): Promise<void> => {
    await api.put(`/settings/config/${key}`, { value });
  },

  subscribeToConfig: (key: string, callback: (value: any) => void) => {
    return createPollingSubscription(
      () => DataService.getConfig(key),
      callback,
      POLL_MS.config
    );
  },

  // ═══════════════════════════════════════════
  // FINANCIAL CONFIGS (campagnes)
  // ═══════════════════════════════════════════

  subscribeToFinancialConfigs: (callback: (configs: ProductFinancialConfig[]) => void) => {
    return createPollingSubscription(
      () => DataService.getFinancialConfigs(),
      callback,
      POLL_MS.standard
    );
  },

  // ═══════════════════════════════════════════
  // DAILY ENTRIES SUBSCRIPTIONS
  // ═══════════════════════════════════════════

  subscribeToDailyEntries: (callback: (entries: DailyFinancialEntry[]) => void) => {
    return createPollingSubscription(
      () => DataService.getDailyEntries(),
      callback,
      POLL_MS.standard
    );
  },

  subscribeToAllDailyFinanceData: (callback: (data: DailyFinanceData[]) => void) => {
    return createPollingSubscription(
      () => DataService.getAllDailyFinanceData(),
      callback,
      POLL_MS.standard
    );
  },

  // ═══════════════════════════════════════════
  // USER PREFERENCES (UI STATES)
  // ═══════════════════════════════════════════

  saveUserPreference: async (key: string, value: any): Promise<void> => {
    // Store locally for fast access + persist to API config
    localStorage.setItem(`pref_${key}`, JSON.stringify(value));
    try {
      await api.put(`/settings/config/pref_${key}`, { value: JSON.stringify(value) });
    } catch {
      // Silent fail — local storage is the primary for preferences
    }
  },

  subscribeToUserPreference: (key: string, callback: (value: any) => void): (() => void) => {
    // Initial load from local for instant response
    const local = localStorage.getItem(`pref_${key}`);
    if (local !== null) {
      try { callback(JSON.parse(local)); } catch { callback(local); }
    }
    // No remote polling needed for preferences — they stay local
    return () => { };
  },

  // ═══════════════════════════════════════════
  // CLAUDE ANALYSIS
  // ═══════════════════════════════════════════

  subscribeToClaudeAnalysis: (date: string, callback: (analysis: string | null) => void) => {
    return createPollingSubscription(
      () => DataService.getClaudeAnalysis(date),
      callback,
      POLL_MS.config
    );
  },

  // ═══════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════

  getSettings: async (): Promise<AppSettings> => {
    try {
      const hasToken = !!localStorage.getItem('jwt_token');
      if (!hasToken) {
        const pub = await api.get<Partial<AppSettings>>('/settings/public');
        return { ...DEFAULT_SETTINGS, ...pub };
      }
      const settings = await api.get<AppSettings>('/settings');
      return { ...DEFAULT_SETTINGS, ...settings };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings: async (settings: AppSettings): Promise<void> => {
    await api.put('/settings', settings);
  },

  subscribeToSettings: (callback: (settings: AppSettings) => void) => {
    return createPollingSubscription(
      () => DataService.getSettings(),
      callback,
      POLL_MS.calm
    );
  },

  // ═══════════════════════════════════════════
  // PRODUCTS (INVENTORY)
  // ═══════════════════════════════════════════

  getProducts: async (): Promise<Product[]> => {
    return api.get<Product[]>('/products').catch(() => []);
  },

  subscribeToProducts: (callback: (products: Product[]) => void): (() => void) => {
    return createPollingSubscription(
      () => DataService.getProducts(),
      callback,
      POLL_MS.critical
    );
  },

  saveProduct: async (product: Product): Promise<void> => {
    if (product.id) {
      await api.put(`/products/${apiId(product.id)}`, product);
    } else {
      await api.post('/products', product);
    }
  },

  deleteProduct: async (id: string, _productTitle: string, _currentStock: number, _adminId: string): Promise<void> => {
    // Backend handles: ignored list, cascade delete, stock cleanup
    await api.delete(`/products/${apiId(id)}`);
    // Auto-recalculate after product deletion
    await DataService.recalculateAllStocks();
  },

  // ═══════════════════════════════════════════
  // STOCK LIVREURS
  // ═══════════════════════════════════════════

  getStockLivreurs: async (): Promise<StockLivreurEntry[]> => {
    return api.get<StockLivreurEntry[]>('/stock/livreurs').then(entries => 
      entries.map(e => ({
        ...e,
        SI: e.SI ?? (e as any).si ?? 0,
        SF: e.SF ?? (e as any).sf ?? 0,
      }))
    ).catch(() => []);
  },

  subscribeToStockLivreurs: (callback: (entries: StockLivreurEntry[]) => void): (() => void) => {
    return createPollingSubscription(
      () => DataService.getStockLivreurs(),
      callback,
      POLL_MS.critical
    );
  },

  saveStockLivreurEntry: async (entry: StockLivreurEntry): Promise<void> => {
    // The backend stock route handles upserts via the adjust-livreur or operations endpoints
    // For direct saves, POST to stock operations or use adjust-livreur
    const sanitized = {
      ...entry,
      si: Number(entry.SI ?? (entry as { si?: number }).si ?? 0),
      entrees: Number(entry.entrees || 0),
      sorties: Number(entry.sorties || 0),
      sf: Number(entry.SF ?? (entry as { sf?: number }).sf ?? 0),
      ajustementManuel: Number(entry.ajustementManuel || 0)
    };
    // Use adjust-livreur to ensure consistency
    await api.post('/stock/adjust-livreur', {
      livreurId: sanitized.livreurId,
      productId: sanitized.produitId,
      newSF: sanitized.sf,
      reason: 'Mise à jour directe via dataService',
      adminId: 'system'
    });
  },

  // ═══════════════════════════════════════════
  // STOCK OPERATIONS
  // ═══════════════════════════════════════════

  getStockOperations: async (): Promise<StockOperation[]> => {
    return api.get<StockOperation[]>('/stock/operations').catch(() => []);
  },

  subscribeToStockOperations: (callback: (ops: StockOperation[]) => void) => {
    return createPollingSubscription(
      () => DataService.getStockOperations(),
      callback,
      POLL_MS.critical
    );
  },

  saveStockOperation: async (op: StockOperation): Promise<void> => {
    await api.post('/stock/operations', op);
  },

  // ═══════════════════════════════════════════
  // STOCK TRANSFERS (Atomic via backend transaction)
  // ═══════════════════════════════════════════

  transferStock: async (params: {
    productId: string;
    productName: string;
    sourceId: string;
    destinationId: string;
    quantity: number;
    adminId: string;
  }): Promise<void> => {
    console.log('[DataService] transferStock via API...', params);
    await api.post('/stock/transfer', params);
    console.log('[DataService] transferStock finished');
  },

  cancelStockOperation: async (opId: string, adminId: string): Promise<void> => {
    await api.post('/stock/cancel-operation', { opId, adminId });
  },

  logStockOperation: async (data: Omit<StockOperation, 'id' | 'createdAt'>): Promise<void> => {
    const op: StockOperation = {
      ...data,
      id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString()
    };
    await DataService.saveStockOperation(op);
  },

  logAdjustment: async (data: {
    adminId: string;
    productId: string;
    productName: string;
    targetStock: string;
    oldQty: number;
    newQty: number;
    reason: string;
    livreurId?: string;
    produitSku?: string;
    ajustementManuel?: number;
  }): Promise<void> => {
    // Log adjustment via stock operations
    await DataService.logStockOperation({
      date: new Date().toISOString(),
      productId: data.productId,
      productName: data.productName,
      type: 'si_ajustement',
      quantity: data.newQty - data.oldQty,
      livreurId: data.livreurId,
      source: 'ajustement_manuel_service',
      notes: data.reason,
      entiteType: data.livreurId ? (data.livreurId === DEPOT_ID ? 'depot' : 'livreur') : 'global',
      entiteId: data.livreurId
    });
  },

  // ═══════════════════════════════════════════
  // STOCK ADJUSTMENTS (via backend)
  // ═══════════════════════════════════════════

  updateGlobalStockSF: async (productId: string, newSF: number, reason: string, adminId: string): Promise<void> => {
    console.log(`[DataService] updateGlobalStockSF: productId=${productId}, newSF=${newSF}`);
    await api.post('/stock/adjust-global', { productId, newSF, reason, adminId });
  },

  updateLivreurStockSF: async (livreurId: string, productId: string, newSF: number, reason: string, adminId: string): Promise<void> => {
    console.log(`[DataService] updateLivreurStockSF: livreurId=${livreurId}, productId=${productId}, newSF=${newSF}`);
    await api.post('/stock/adjust-livreur', { livreurId, productId, newSF, reason, adminId });
  },

  recalculateAllStocks: async (): Promise<{ success: boolean; message: string }> => {
    try {
      const result = await api.post<{ success: boolean; message: string }>('/stock/recalculate-all', {});
      return result;
    } catch (e: any) {
      console.error("Recalcul failure:", e);
      return { success: false, message: `Erreur: ${e.message}` };
    }
  },

  // ═══════════════════════════════════════════
  // DRIVER/DEPOT STOCK HELPERS
  // ═══════════════════════════════════════════

  updateDriverStock: async (productId: string, driverId: string, quantity: number, action: 'deduct' | 'restore'): Promise<void> => {
    const entries = await DataService.getStockLivreurs();
    const products = await DataService.getProducts();

    // Canonical resolution
    const canonicalProduct = products.find(p =>
      p.id === productId ||
      (p.variants && p.variants.some((v: any) => v.sku === productId)) ||
      p.title === productId ||
      (productId && productId.toLowerCase().includes(p.title.toLowerCase()) && p.title.length > 3)
    );

    const resolvedId = canonicalProduct?.id || productId;
    let entry = entries.find((e: any) => e.livreurId === driverId && e.produitId === resolvedId);

    if (!entry) {
      if (!canonicalProduct && !productId) return;

      entry = {
        livreurId: driverId,
        produitId: resolvedId,
        produitNom: canonicalProduct?.title || productId,
        SI: 0, si: 0,
        entrees: 0,
        sorties: 0,
        SF: 0, sf: 0
      } as any;
    }

    if (action === 'deduct') {
      entry.sorties = (entry.sorties || 0) + quantity;
    } else {
      entry.sorties = Math.max(0, (entry.sorties || 0) - quantity);
    }
    const e = entry as StockLivreurEntry & { si?: number };
    const newSF = (e.SI ?? e.si ?? 0) + (e.entrees || 0) - (e.sorties || 0) + (e.ajustementManuel || 0);

    await api.post('/stock/adjust-livreur', {
      livreurId: driverId,
      productId: resolvedId,
      newSF,
      reason: action === 'deduct' ? 'Déduction commande' : 'Restitution commande',
      adminId: 'system'
    });

    // Log operation
    await DataService.logStockOperation({
      date: new Date().toISOString(),
      productId: resolvedId,
      productName: entry.produitNom || canonicalProduct?.title || productId,
      type: action === 'deduct' ? 'sortie' : 'entree',
      quantity,
      livreurId: driverId,
      source: 'order'
    });
  },

  updateDepotStock: async (productId: string, quantity: number, action: 'add' | 'deduct', source: string = 'order', commandeId?: string): Promise<void> => {
    const entries = await DataService.getStockLivreurs();
    const products = await DataService.getProducts();

    const canonicalProduct = products.find(p =>
      p.id === productId ||
      (p.variants && p.variants.some((v: any) => v.sku === productId)) ||
      p.title === productId ||
      (productId && productId.toLowerCase().includes(p.title.toLowerCase()) && p.title.length > 3)
    );

    const resolvedId = canonicalProduct?.id || productId;
    let entry = entries.find((e: any) => e.livreurId === DEPOT_ID && e.produitId === resolvedId);

    if (!entry) {
      if (!canonicalProduct && !productId) return;
      entry = {
        livreurId: DEPOT_ID,
        produitId: resolvedId,
        produitNom: canonicalProduct?.title || productId,
        SI: 0, si: 0, entrees: 0, sorties: 0, SF: 0, sf: 0
      } as any;
    }

    if (action === 'add') {
      entry.entrees = (entry.entrees || 0) + quantity;
    } else {
      entry.sorties = (entry.sorties || 0) + quantity;
    }
    const e = entry as StockLivreurEntry & { si?: number };
    const newSF = (e.SI ?? e.si ?? 0) + (e.entrees || 0) - (e.sorties || 0) + (e.ajustementManuel || 0);

    await api.post('/stock/adjust-livreur', {
      livreurId: DEPOT_ID,
      productId: resolvedId,
      newSF,
      reason: `${source}${commandeId ? ` (cmd: ${commandeId})` : ''}`,
      adminId: 'system'
    });

    await DataService.logStockOperation({
      date: new Date().toISOString(),
      productId: resolvedId,
      productName: entry.produitNom || canonicalProduct?.title || productId,
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
    const entries = await DataService.getStockLivreurs();
    const entry = entries.find((e: any) => e.livreurId === livreurId && e.produitId === produitId);
    if (!entry) return false;
    const e = entry as StockLivreurEntry & { sf?: number };
    return (e.SF ?? e.sf ?? 0) >= quantite;
  },

  deduireStockLivreur: async (produitId: string, livreurId: string, quantite: number): Promise<void> => {
    await DataService.updateDriverStock(produitId, livreurId, quantite, 'deduct');
  },

  restituerStockLivreur: async (produitId: string, livreurId: string, quantite: number): Promise<void> => {
    await DataService.updateDriverStock(produitId, livreurId, quantite, 'restore');
  },

  // ═══════════════════════════════════════════
  // IMPORT PRODUCTS (Shopify sync)
  // ═══════════════════════════════════════════

  importProducts: async (_newProducts: Product[]): Promise<void> => {
    // Delegate to backend shopify-sync which handles everything
    await api.post('/products/shopify-sync', {});
  },

  fetchShopifyProducts: async (): Promise<Product[]> => {
    // The backend handles Shopify API calls directly
    const result = await api.post<{ synced: number; total: number }>('/products/shopify-sync', {});
    console.log(`Shopify sync: ${result.synced} products synced from ${result.total} total`);
    // Return updated product list
    return DataService.getProducts();
  },

  // ═══════════════════════════════════════════
  // FINANCIAL CONFIGS
  // ═══════════════════════════════════════════

  getFinancialConfigs: async (): Promise<ProductFinancialConfig[]> => {
    return api.get<ProductFinancialConfig[]>('/finance/configs').catch(() => []);
  },

  saveFinancialConfig: async (config: ProductFinancialConfig): Promise<void> => {
    await api.post('/finance/configs', config);
  },

  migrateFinancialConfigs: async () => {
    // Migration is handled by backend/Prisma — noop on frontend
    console.log('migrateFinancialConfigs: handled by backend. Skipping.');
  },

  // ═══════════════════════════════════════════
  // DAILY ENTRIES
  // ═══════════════════════════════════════════

  getDailyEntries: async (): Promise<DailyFinancialEntry[]> => {
    return api.get<DailyFinancialEntry[]>('/finance/daily-entries').catch(() => []);
  },

  saveDailyEntry: async (entry: DailyFinancialEntry): Promise<void> => {
    await api.post('/finance/daily-entries', entry);
  },

  // ═══════════════════════════════════════════
  // DAILY FINANCE (MANUAL ENTRIES)
  // ═══════════════════════════════════════════

  getDailyFinanceData: async (date: string): Promise<DailyFinanceData | null> => {
    try {
      const result = await api.get<DailyFinanceData | null>(`/finance/daily-finance/${date}`);
      return result;
    } catch {
      return null;
    }
  },

  getAllDailyFinanceData: async (): Promise<DailyFinanceData[]> => {
    return api.get<DailyFinanceData[]>('/finance/daily-finance').catch(() => []);
  },

  saveDailyFinanceData: async (data: DailyFinanceData): Promise<void> => {
    await api.post('/finance/daily-finance', data);
  },

  // ═══════════════════════════════════════════
  // PURCHASE ORDERS
  // ═══════════════════════════════════════════

  getPurchaseOrders: async (): Promise<PurchaseOrder[]> => {
    return api.get<PurchaseOrder[]>('/purchase-orders').catch(() => []);
  },

  savePurchaseOrder: async (po: PurchaseOrder): Promise<void> => {
    if (po.id) {
      await api.put(`/purchase-orders/${apiId(po.id)}`, po);
    } else {
      await api.post('/purchase-orders', po);
    }
  },

  deletePurchaseOrder: async (id: string): Promise<void> => {
    await api.delete(`/purchase-orders/${apiId(id)}`);
  },

  subscribeToPurchaseOrders: (callback: (pos: PurchaseOrder[]) => void): (() => void) => {
    return createPollingSubscription(
      () => DataService.getPurchaseOrders(),
      callback,
      POLL_MS.standard
    );
  },

  // ═══════════════════════════════════════════
  // AD HOC PRODUCTS (Ponctuels)
  // ═══════════════════════════════════════════

  ajouterProduitPonctuelDansStock: async (nom: string, prixAchat: number, prixVente: number = 0): Promise<string> => {
    const result = await api.post<Product>('/products/ponctuel', { nom, prixAchat, prixVente });
    return result.id;
  },

  getAdHocProducts: async (): Promise<AdHocProduct[]> => {
    const products = await DataService.getProducts();
    return products.filter(p => p.source === 'ponctuel').map(p => ({
      id: p.id,
      name: p.title,
      purchasePrice: p.purchasePrice || 0,
      createdAt: p.createdAt
    }));
  },

  saveAdHocProduct: async (product: AdHocProduct): Promise<void> => {
    // Save as product with source='ponctuel'
    await api.put(`/products/${apiId(product.id)}`, {
      title: product.name,
      purchasePrice: product.purchasePrice,
      source: 'ponctuel'
    });
  },

  deleteAdHocProduct: async (id: string): Promise<void> => {
    await api.delete(`/products/${apiId(id)}`);
  },

  // ═══════════════════════════════════════════
  // STOCK RESET OPERATIONS
  // ═══════════════════════════════════════════

  resetAllStockEntries: async (): Promise<{ success: boolean; message: string }> => {
    try {
      const allProducts = await DataService.getProducts();
      const pos = await DataService.getPurchaseOrders();

      for (const product of allProducts) {
        const currentGlobal = (product.stockGlobal as any) || { si: product.mainStock || 0, entrees: 0, sorties: 0, sf: product.mainStock || 0, ajustementManuel: 0 };
        const oldSf = (currentGlobal.si || 0) + (currentGlobal.entrees || 0) - (currentGlobal.sorties || 0);
        const newSi = oldSf + (currentGlobal.ajustementManuel || 0);

        await DataService.saveProduct({
          ...product,
          mainStock: newSi,
          stockGlobal: { si: newSi, entrees: 0, sorties: 0, sf: newSi, ajustementManuel: 0 }
        });
      }

      // Mark delivered POs as updated
      for (const po of pos) {
        if (po.status === 'delivered' && !po.ponctuelStockUpdated) {
          await DataService.savePurchaseOrder({ ...po, ponctuelStockUpdated: true });
        }
      }

      return { success: true, message: "Toutes les entrées et sorties de stock ont été réinitialisées à 0." };
    } catch (error) {
      console.error("Reset stock entries error:", error);
      return { success: false, message: "Erreur lors de la réinitialisation des stocks." };
    }
  },

  resetGlobalStock: async (): Promise<{ success: boolean; message: string }> => {
    try {
      const allProducts = await DataService.getProducts();
      for (const product of allProducts) {
        const currentGlobal = (product.stockGlobal as any) || { si: product.mainStock || 0, entrees: 0, sorties: 0, sf: product.mainStock || 0, ajustementManuel: 0 };
        const oldSf = (currentGlobal.si || 0) + (currentGlobal.entrees || 0) - (currentGlobal.sorties || 0);
        const newSi = oldSf + (currentGlobal.ajustementManuel || 0);
        await DataService.saveProduct({
          ...product,
          mainStock: newSi,
          stockGlobal: { si: newSi, entrees: 0, sorties: 0, sf: newSi, ajustementManuel: 0 }
        });
      }
      return { success: true, message: 'Stock global réinitialisé avec succès.' };
    } catch (error) {
      console.error("Reset global stock error:", error);
      return { success: false, message: 'Erreur lors de la réinitialisation du stock global.' };
    }
  },

  resetDriverStocks: async (): Promise<{ success: boolean; message: string }> => {
    try {
      const allProducts = await DataService.getProducts();
      for (const product of allProducts) {
        if (product.stockLivreurs) {
          const updatedLivreurs: Record<string, any> = {};
          for (const [driverId, stock] of Object.entries(product.stockLivreurs as Record<string, any>)) {
            const oldLSf = (stock.si || 0) + (stock.entrees || 0) - (stock.sorties || 0);
            const newLsi = oldLSf + (stock.ajustementManuel || 0);
            updatedLivreurs[driverId] = {
              ...stock,
              si: newLsi, entrees: 0, sorties: 0, sf: newLsi, ajustementManuel: 0
            };
          }
          await DataService.saveProduct({ ...product, stockLivreurs: updatedLivreurs });
        }
      }
      return { success: true, message: 'Stock des livreurs réinitialisé avec succès.' };
    } catch (error) {
      console.error("Reset driver stocks error:", error);
      return { success: false, message: 'Erreur lors de la réinitialisation du stock des livreurs.' };
    }
  },

  // ═══════════════════════════════════════════
  // CLAUDE ANALYSIS
  // ═══════════════════════════════════════════

  getClaudeAnalysis: async (date: string): Promise<string | null> => {
    try {
      const result = await api.get<{ analysis: string | null }>(`/settings/claude-analysis/${date}`);
      return result.analysis;
    } catch {
      return null;
    }
  },

  saveClaudeAnalysis: async (date: string, analysis: string): Promise<void> => {
    await api.post('/settings/claude-analysis', { date, analysis });
  },

  // ═══════════════════════════════════════════
  // ACCOUNTING ENTRIES
  // ═══════════════════════════════════════════

  getAccountingEntries: async (): Promise<AccountingEntry[]> => {
    try {
      let entries = await api.get<AccountingEntry[]>('/accounting/entries');
      // Migration: add origine and modifiable if missing
      return entries.map(entry => {
        if (!entry.origine) {
          entry.origine = entry.isManual ? 'manuel' : 'finance';
          entry.modifiable = entry.isManual;
        }
        return entry;
      });
    } catch {
      return [];
    }
  },

  saveAccountingEntry: async (entry: AccountingEntry): Promise<void> => {
    await api.post('/accounting/entries', entry);
  },

  deleteAccountingEntry: async (id: string): Promise<void> => {
    await api.delete(`/accounting/entries/${apiId(id)}`);
  },

  // ═══════════════════════════════════════════
  // CLEANUP DUPLICATE PRODUCT
  // ═══════════════════════════════════════════

  cleanupDuplicateProduct: async (_productName: string, _legitimateId: string): Promise<void> => {
    // Heavy operation — delegate to recalculate which handles deduplication server-side
    console.log(`[DataService] cleanupDuplicateProduct: delegating to recalculateAllStocks`);
    await DataService.recalculateAllStocks();
  },
};