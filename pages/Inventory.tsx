import React, { useState, useEffect, useMemo } from 'react';
import { DataService, DEPOT_ID } from '../services/dataService';
import { formatNumber, formatFCFA } from '../utils/formatters';
import { Product, Driver, StockLivreurEntry, StockOperation, Order, PurchaseOrder, SystemUser } from '../types';
import { parseProductCommand } from '../utils/productParser';
import { trouverProduitShopify } from '../utils/productMatcher';
import { Package, RefreshCw, Search, Settings, ArrowRightLeft, X, AlertCircle, Download, Calendar, FileText, Truck, Trash2 } from 'lucide-react';
import { usePersistedDateRange } from '../hooks/usePersistedDateRange';
import { DateRangePicker } from '../components/DateRangePicker';
import { format, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const Inventory: React.FC<{ currentUser?: SystemUser }> = ({ currentUser }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [stockEntries, setStockEntries] = useState<StockLivreurEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [promptModal, setPromptModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    type: 'confirm' | 'prompt' | 'alert';
    onConfirm: (value?: string) => void;
    placeholder?: string;
    defaultValue?: string;
  }>({
    show: false,
    title: '',
    message: '',
    type: 'confirm',
    onConfirm: () => {}
  });
  const [promptValue, setPromptValue] = useState('');

  const showPrompt = (config: Omit<typeof promptModal, 'show'>) => {
    setPromptModal({ ...config, show: true });
    setPromptValue(config.defaultValue || '');
  };

  const handlePromptConfirm = () => {
    setPromptModal(prev => ({ ...prev, show: false }));
    promptModal.onConfirm(promptValue);
  };
  const [searchTerm, setSearchTerm] = useState('');
  
  const [activeTab, setActiveTab] = useState<'global' | 'livreurs' | 'depot' | 'mouvements'>('global');
  const [selectedDriverId, setSelectedDriverId] = useState<string>('all');
  const [movementFilter, setMovementFilter] = useState<string>('all');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  
  // Manual Stock Edit State
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editSI, setEditSI] = useState<number>(0);
  const [editSellingPrice, setEditSellingPrice] = useState<number>(0);
  const [editPurchasePrice, setEditPurchasePrice] = useState<number>(0);

  // Ad-Hoc Product Modal State
  const [showAdHocModal, setShowAdHocModal] = useState(false);
  const [newAdHocName, setNewAdHocName] = useState('');
  const [newAdHocPurchasePrice, setNewAdHocPurchasePrice] = useState<number>(0);
  const [newAdHocSellingPrice, setNewAdHocSellingPrice] = useState<number>(0);
  const [creatingAdHoc, setCreatingAdHoc] = useState(false);

  // Transfer Modal State
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showTransferConfirmModal, setShowTransferConfirmModal] = useState(false);
  const [transferProduct, setTransferProduct] = useState<Product | null>(null);
  const [transferSourceId, setTransferSourceId] = useState<string>('global');
  const [transferDestinationId, setTransferDestinationId] = useState<string>('');
  const [transferQuantity, setTransferQuantity] = useState<number>(1);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [shopifyAccessToken, setShopifyAccessToken] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [resetType, setResetType] = useState<'global' | 'livreurs' | 'all' | null>(null);
  const [resetConfirmationInput, setResetConfirmationInput] = useState('');

  // Date Range State
  const [dateRange, setDateRange] = usePersistedDateRange('inventory_date_range', {
      startDate: new Date(),
      endDate: new Date()
  });

  const [orders, setOrders] = useState<Order[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [stockOperations, setStockOperations] = useState<StockOperation[]>([]);

  const safeDateRange = useMemo(() => {
      if (!dateRange.startDate || !dateRange.endDate || isNaN(dateRange.startDate.getTime()) || isNaN(dateRange.endDate.getTime())) {
          return { startDate: new Date(), endDate: new Date() };
      }
      return dateRange;
  }, [dateRange]);

  // Driver Stock Edit State
  const [editingDriverStockId, setEditingDriverStockId] = useState<string | null>(null);
  const [editDriverSI, setEditDriverSI] = useState<number>(0);

  // SF Adjustment State
  const [adjustingSFId, setAdjustingSFId] = useState<string | null>(null);
  const [editSFValue, setEditSFValue] = useState<number>(0);

  // Global Adjustment Modal State
  const [showGlobalAdjustmentModal, setShowGlobalAdjustmentModal] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({
    productId: '',
    targetId: 'global', // 'global' or driverId
    newQty: 0,
    reason: ''
  });
  const [isSubmittingAdjustment, setIsSubmittingAdjustment] = useState(false);

  const startAdjustingSF = (id: string, currentSF: number) => {
    setAdjustingSFId(id);
    setEditSFValue(currentSF);
  };

  const handleAdjustSF = async (product: Product) => {
    const currentSF = (product.stockGlobal?.si || 0) + (product.stockGlobal?.entrees || 0) - (product.stockGlobal?.sorties || 0) + (product.stockGlobal?.ajustementManuel || 0);
    const diff = editSFValue - currentSF;
    
    if (diff === 0) {
      setAdjustingSFId(null);
      return;
    }

    showPrompt({
        title: "Confirmer l'ajustement",
        message: `Voulez-vous ajuster le stock global de "${product.title}" à ${editSFValue} ? Veuillez indiquer le motif :`,
        type: 'prompt',
        placeholder: "Correction inventaire physique",
        defaultValue: "Correction inventaire physique",
        onConfirm: async (reason) => {
            if (!reason) return;
            try {
                setAdjustingSFId(null);
                await DataService.updateGlobalStockSF(product.id, editSFValue, reason, currentUser?.id || 'unknown');
                await loadData();
                showPrompt({ title: "Succès", message: "Stock final ajusté avec succès !", type: 'alert', onConfirm: () => {} });
            } catch (error: any) {
                console.error('Error adjusting SF:', error);
                showPrompt({ title: "Erreur", message: "Erreur lors de l'ajustement: " + error.message, type: 'alert', onConfirm: () => {} });
            }
        }
    });
  };

  const handleGlobalAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[Inventory] handleGlobalAdjustmentSubmit started', adjustmentForm);
    if (!adjustmentForm.productId || !adjustmentForm.reason) {
      showPrompt({ title: "Champ manquant", message: 'Veuillez remplir tous les champs obligatoires.', type: 'alert', onConfirm: () => {} });
      return;
    }

    setIsSubmittingAdjustment(true);
    try {
      const product = products.find(p => p.id === adjustmentForm.productId);
      if (!product) {
        console.error('[Inventory] Product not found in state:', adjustmentForm.productId);
        throw new Error('Produit non trouvé');
      }

      console.log('[Inventory] Target:', adjustmentForm.targetId);
      if (adjustmentForm.targetId === 'global') {
        await DataService.updateGlobalStockSF(product.id, adjustmentForm.newQty, adjustmentForm.reason, currentUser?.id || 'unknown');
      } else {
        await DataService.updateLivreurStockSF(adjustmentForm.targetId, product.id, adjustmentForm.newQty, adjustmentForm.reason, currentUser?.id || 'unknown');
      }

      console.log('[Inventory] Logging adjustment...');
      // Log in logs_ajustements (for specific reporting, independent of stock ops)
      let targetName = 'Stock Global';
      let oldQty = 0;
      if (adjustmentForm.targetId === 'global') {
        const si = (product.stockGlobal?.si || product.mainStock || 0);
        oldQty = si + (product.stockGlobal?.entrees || 0) - (product.stockGlobal?.sorties || 0) + (product.stockGlobal?.ajustementManuel || 0);
      } else {
          const entry = stockEntries.find(e => e.livreurId === adjustmentForm.targetId && e.produitId === product.id);
          oldQty = (entry?.SI || 0) + (entry?.entrees || 0) - (entry?.sorties || 0) + (entry?.ajustementManuel || 0);
          const driver = drivers.find(d => d.id === adjustmentForm.targetId);
          targetName = adjustmentForm.targetId === DEPOT_ID ? 'Dépôt Delta' : (driver?.name || 'Inconnu');
      }

      await DataService.logAdjustment({
        adminId: currentUser?.id || 'unknown',
        productId: product.id,
        productName: product.title,
        targetStock: targetName,
        oldQty,
        newQty: adjustmentForm.newQty,
        reason: adjustmentForm.reason,
        livreurId: adjustmentForm.targetId === 'global' ? 'global' : adjustmentForm.targetId,
        produitSku: product.variants?.[0]?.sku || '-',
        ajustementManuel: adjustmentForm.newQty - oldQty
      });

      console.log('[Inventory] Adjustment successful');
      showPrompt({ title: "Succès", message: 'Stock ajusté avec succès !', type: 'alert', onConfirm: () => {} });
      setShowGlobalAdjustmentModal(false);
      setAdjustmentForm({ productId: '', targetId: 'global', newQty: 0, reason: '' });
    } catch (error) {
      console.error('[Inventory] Error adjusting stock:', error);
      showPrompt({ title: "Erreur", message: 'Erreur lors de l\'ajustement du stock.', type: 'alert', onConfirm: () => {} });
    } finally {
      setIsSubmittingAdjustment(false);
    }
  };

  const handleAdjustDriverSF = async (entry: StockLivreurEntry) => {
    const currentSF = (entry.SI || 0) + (entry.entrees || 0) - (entry.sorties || 0) + (entry.ajustementManuel || 0);
    const diff = editSFValue - currentSF;
    
    if (diff === 0) {
      setAdjustingSFId(null);
      return;
    }

    showPrompt({
        title: "Confirmer l'ajustement",
        message: `Voulez-vous ajuster le stock de "${entry.produitNom}" pour ce livreur à ${editSFValue} ? Motif :`,
        type: 'prompt',
        placeholder: "Correction inventaire physique",
        defaultValue: "Correction inventaire physique",
        onConfirm: async (reason) => {
            if (!reason) return;
            try {
                setAdjustingSFId(null);
                await DataService.updateLivreurStockSF(entry.livreurId, entry.produitId, editSFValue, reason, currentUser?.id || 'unknown');
                await loadData();
                showPrompt({ title: "Succès", message: "Stock livreur ajusté avec succès !", type: 'alert', onConfirm: () => {} });
            } catch (error: any) {
                console.error('Error adjusting driver SF:', error);
                showPrompt({ title: "Erreur", message: "Erreur lors de l'ajustement: " + error.message, type: 'alert', onConfirm: () => {} });
            }
        }
    });
  };

  const startEditingDriverSI = (entry: StockLivreurEntry) => {
    setEditingDriverStockId(`${entry.produitId}-${entry.livreurId}`);
    setEditDriverSI(entry.SI || 0);
  };

  const saveDriverSI = async (entry: StockLivreurEntry) => {
    const previousSI = entry.SI || 0;
    const updatedEntry: StockLivreurEntry = { 
      ...entry, 
      SI: editDriverSI, 
      SF: editDriverSI + entry.entrees - entry.sorties 
    };
    await DataService.saveStockLivreurEntry(updatedEntry);

    // Log manual adjustment
    if (previousSI !== editDriverSI) {
      const diff = editDriverSI - previousSI;
      await DataService.logStockOperation({
        productId: entry.produitId,
        productName: entry.produitNom,
        quantity: diff,
        type: 'si_ajustement',
        date: new Date().toISOString(),
        livreurId: entry.livreurId,
        entiteType: entry.livreurId === DEPOT_ID ? 'depot' : 'livreur',
        entiteId: entry.livreurId,
        source: 'manual_edit',
        notes: `Modif. manuelle du SI: ${previousSI} -> ${editDriverSI}`
      });
    }

    setStockEntries(prev => prev.map(e => (e.livreurId === entry.livreurId && e.produitId === entry.produitId) ? updatedEntry : e));
    setEditingDriverStockId(null);
  };

  useEffect(() => {
    // Initial sync of settings (static inputs in UI)
    loadSettings();
    
    const unsubscribeProducts = DataService.subscribeToProducts((prods) => setProducts(prods));
    const unsubscribeStock = DataService.subscribeToStockLivreurs((entries) => setStockEntries(entries));
    const unsubscribeOps = DataService.subscribeToStockOperations((ops) => setStockOperations(ops));
    const unsubscribeDrivers = DataService.subscribeToDrivers((drvs) => setDrivers(drvs));
    const unsubscribeOrders = DataService.subscribeToOrders((ords) => setOrders(ords));
    const unsubscribePurchaseOrders = DataService.subscribeToPurchaseOrders((pos) => setPurchaseOrders(pos));
    const unsubscribeSettings = DataService.subscribeToSettings((settings) => {
        setShopifyDomain(settings.shopifyDomain || '');
        setShopifyAccessToken(settings.shopifyAccessToken || '');
        setLoading(false);
    });

    // Auto-import every 2 hours
    const interval = setInterval(() => {
        handleAutoImport();
    }, 7200000);

    return () => {
        unsubscribeProducts();
        unsubscribeStock();
        unsubscribeOps();
        unsubscribeDrivers();
        unsubscribeOrders();
        unsubscribePurchaseOrders();
        unsubscribeSettings();
        clearInterval(interval);
    };
  }, [currentUser]);

  const loadSettings = async () => {
      const settings = await DataService.getSettings();
      setShopifyDomain(settings.shopifyDomain || '');
      setShopifyAccessToken(settings.shopifyAccessToken || '');
  };

  const handleSaveSettings = async () => {
      const currentSettings = await DataService.getSettings();
      await DataService.saveSettings({
          ...currentSettings,
          shopifyDomain,
          shopifyAccessToken
      });
      setShowSettings(false);
      setResetType(null);
      setResetConfirmationInput('');
      showPrompt({ title: "Succès", message: 'Configuration enregistrée !', type: 'alert', onConfirm: () => {} });
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [drvs, ords, pos] = await Promise.all([
        DataService.getDrivers(),
        DataService.getOrders(),
        DataService.getPurchaseOrders()
      ]);
      setDrivers(drvs);
      setOrders(ords);
      setPurchaseOrders(pos);
    } catch (err) {
      console.error("Failed to load data", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoImport = async () => {
      console.log("Starting auto-import...");
      try {
          const fetchedProducts = await DataService.fetchShopifyProducts();
          await DataService.importProducts(fetchedProducts);
          setImportError(null);
          loadData(); // Refresh UI
      } catch (e: any) {
          console.error("Auto-import failed", e);
          setImportError(e.message);
      }
  };

  const handleManualImport = async () => {
    showPrompt({
      title: "Synchronisation Shopify",
      message: "Voulez-vous forcer la synchronisation avec Shopify ?",
      type: 'confirm',
      onConfirm: async () => {
        setImporting(true);
        setImportError(null);
        try {
          const fetchedProducts = await DataService.fetchShopifyProducts();
          await DataService.importProducts(fetchedProducts);
          await loadData();
          showPrompt({ 
            title: "Succès", 
            message: `${fetchedProducts.length} produits importés/mis à jour.`, 
            type: 'alert', 
            onConfirm: () => {} 
          });
        } catch (err: any) {
          console.error(err);
          setImportError(err.message);
          showPrompt({ 
            title: "Erreur", 
            message: "Erreur lors de l'importation: " + err.message, 
            type: 'alert', 
            onConfirm: () => {} 
          });
        } finally {
          setImporting(false);
        }
      }
    });
  };

  const handleRecalculateStocks = async () => {
    showPrompt({
      title: "Recalculer les stocks",
      message: "Êtes-vous sûr de vouloir recalculer tous les stocks à partir de l'historique complet ? Cette opération peut prendre quelques instants.",
      type: 'confirm',
      onConfirm: async () => {
        setLoading(true);
        try {
          const result = await DataService.recalculateAllStocks();
          showPrompt({
            title: "Résultat",
            message: result.message,
            type: 'alert',
            onConfirm: () => {}
          });
        } catch (e: any) {
          showPrompt({
            title: "Erreur",
            message: "Erreur lors du recalcul : " + e.message,
            type: 'alert',
            onConfirm: () => {}
          });
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleCreateAdHoc = async () => {
    if (!newAdHocName.trim()) return;
    setCreatingAdHoc(true);
    try {
      await DataService.ajouterProduitPonctuelDansStock(newAdHocName, newAdHocPurchasePrice, newAdHocSellingPrice);
      await loadData();
      setShowAdHocModal(false);
      setNewAdHocName('');
      setNewAdHocPurchasePrice(0);
      setNewAdHocSellingPrice(0);
      showPrompt({ title: "Succès", message: 'Produit ponctuel créé avec succès !', type: 'alert', onConfirm: () => {} });
    } catch (e) {
      console.error(e);
      showPrompt({ title: "Erreur", message: 'Erreur lors de la création du produit.', type: 'alert', onConfirm: () => {} });
    } finally {
      setCreatingAdHoc(false);
    }
  };

  const handleResetStockEntries = async () => {
    if (resetConfirmationInput !== 'CONFIRMER') {
      showPrompt({ title: "Attention", message: "Voulez-vous taper 'CONFIRMER' pour valider.", type: 'alert', onConfirm: () => {} });
      return;
    }

    setLoading(true);
    try {
      let result;
      if (resetType === 'global') {
        result = await DataService.resetGlobalStock();
      } else if (resetType === 'livreurs') {
        result = await DataService.resetDriverStocks();
      } else {
        result = await DataService.resetAllStockEntries();
      }

      if (result.success) {
        showPrompt({ title: "Succès", message: result.message, type: 'alert', onConfirm: () => {} });
        await loadData();
        setShowSettings(false);
        setResetType(null);
        setResetConfirmationInput('');
      } else {
        showPrompt({ title: "Résultat", message: result.message, type: 'alert', onConfirm: () => {} });
      }
    } catch (err) {
      console.error("Failed to reset stock", err);
      showPrompt({ title: "Erreur", message: "Erreur lors de la réinitialisation.", type: 'alert', onConfirm: () => {} });
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupCharge5 = async () => {
    showPrompt({
      title: "Nettoyer Doublon Charge 5",
      message: "Cette opération va identifier le produit 'Charge 5' légitime, et lui réassigner toutes les opérations et entrées de stock qui appartenaient au doublon supprimé. Confirmer ?",
      type: 'confirm',
      onConfirm: async () => {
        setLoading(true);
        try {
          // 1. Find legit product
          const legit = products.find(p => p.title.toLowerCase().trim() === 'charge 5');
          if (!legit) {
            throw new Error("Produit 'Charge 5' non trouvé dans la liste actuelle.");
          }

          console.log("[Cleanup] Legit ID:", legit.id);

          // 2. Find orphaned operations
          const orphanedOps = stockOperations.filter(op => 
            (op.productName || '').toLowerCase().trim() === 'charge 5' && 
            op.productId !== legit.id
          );

          console.log(`[Cleanup] Found ${orphanedOps.length} orphaned operations.`);

          // 3. Update operations and delete orphaned stock entries
          const updatePromises = orphanedOps.map(op => 
            DataService.logStockOperation({ ...op, productId: legit.id }) 
          );
          
          // Actually we need an update method in DataService for operations.
          // Since we don't have one explicitly named 'updateStockOperation', 
          // we might need to do it via Firestore directly or add it.
          // Let's check DataService.ts again for updateStockOperation.
          
          await DataService.cleanupDuplicateProduct('charge 5', legit.id);

          showPrompt({
            title: "Succès",
            message: "Nettoyage terminé. Les stocks ont été recalculés.",
            type: 'alert',
            onConfirm: () => {}
          });
          await loadData();
        } catch (e: any) {
          showPrompt({
            title: "Erreur",
            message: e.message,
            type: 'alert',
            onConfirm: () => {}
          });
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const calculatedStock = useMemo(() => {
    const parseDate = (dateStr: string) => {
      if (!dateStr) return new Date();
      if (dateStr.includes('T')) return new Date(dateStr);
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    const start = startOfDay(safeDateRange.startDate);
    const end = endOfDay(safeDateRange.endDate);

    const getImpact = (op: StockOperation, targetDriverId: string | null): number => {
      if (op.annule) return 0;
      const qty = op.quantity || 0;
      const type = op.type;
      const sourceId = op.livreurId;
      const destId = op.entiteId;

      if (targetDriverId === null) {
        // Global Stock Impact
        if (type === 'transfert_global_to_driver' || type === 'transfert_global_to_depot') return -qty;
        if (type === 'transfert_driver_to_global' || type === 'transfert_depot_to_global') return qty;
        
        // Use the same logic as recalculateAllStocks: global is when src/dst are null or 'global'
        if ((!sourceId && !destId) || (sourceId === 'global' || destId === 'global')) {
          if (['entree', 'si_ajustement', 'retour'].includes(type)) return qty;
          if (['sortie', 'vente'].includes(type)) return -qty;
        }
        return 0;
      } else {
        // Driver/Depot Stock Impact
        // Use the same logic as recalculateAllStocks: check ids in a set to avoid double counting if src==dst
        const ids = new Set<string>();
        if (sourceId && sourceId !== 'global') ids.add(sourceId);
        if (destId && destId !== 'global') ids.add(destId);

        if (!ids.has(targetDriverId)) return 0;

        let impact = 0;
        if (destId === targetDriverId) {
          if (['entree', 'transfert_global_to_driver', 'transfert_global_to_depot', 'transfert_driver_to_depot', 'transfert_depot_to_driver', 'si_ajustement', 'retour'].includes(type)) {
            impact += qty;
          }
        } else if (sourceId === targetDriverId) {
          // Use else if to avoid double counting if srcId === destId
          if (['sortie', 'vente', 'transfert_driver_to_global', 'transfert_depot_to_global', 'transfert_driver_to_depot', 'transfert_depot_to_driver'].includes(type)) {
            impact -= qty;
          }
        }
        
        // Fallback for simple operations on entities if type is not a specific transfer but entity is set
        if (impact === 0) {
          const isTransfer = ['transfert_global_to_driver', 'transfert_global_to_depot', 'transfert_driver_to_global', 'transfert_depot_to_global', 'transfert_driver_to_depot', 'transfert_depot_to_driver'].includes(type);
          if (!isTransfer) {
            if (destId === targetDriverId && ['entree', 'si_ajustement', 'retour'].includes(type)) impact += qty;
            else if (sourceId === targetDriverId && ['sortie', 'vente'].includes(type)) impact -= qty;
          }
        }

        return impact;
      }
    };

    // Index operations by product to avoid nested loops
    const opsByProduct: Record<string, StockOperation[]> = {};
    stockOperations.forEach(op => {
      if (!opsByProduct[op.productId]) opsByProduct[op.productId] = [];
      opsByProduct[op.productId].push(op);
    });

    // Global Stock
    const globalStock = products.map(p => {
      const baseSI = p.stockGlobal?.si ?? p.mainStock ?? p.totalInventory ?? 0;
      const currentSF = baseSI + (p.stockGlobal?.entrees || 0) - (p.stockGlobal?.sorties || 0) + (p.stockGlobal?.ajustementManuel || 0);
      const ajustementManuel = p.stockGlobal?.ajustementManuel || 0;
      
      const opsForProduct = opsByProduct[p.id] || [];
      
      const opsAfterEnd = opsForProduct.filter(op => parseDate(op.date) > end);
      const sfAtEnd = currentSF - opsAfterEnd.reduce((sum, op) => sum + getImpact(op, null), 0);
      
      const opsInRange = opsForProduct.filter(op => {
        const d = parseDate(op.date);
        return d >= start && d <= end;
      });
      
      let entrees = 0;
      let sorties = 0;
      opsInRange.forEach(op => {
        const impact = getImpact(op, null);
        if (impact > 0) entrees += impact;
        else if (impact < 0) sorties += Math.abs(impact);
      });
      
      const siAtStart = sfAtEnd - entrees + sorties;
      
      return {
        ...p,
        calculated: { si: siAtStart, entrees, sorties, sf: sfAtEnd, ajustementManuel }
      };
    });

    // Driver Stock
    const allLivreurStockRaw = stockEntries.map(e => {
      const currentSF = (e.SI || 0) + (e.entrees || 0) - (e.sorties || 0) + (e.ajustementManuel || 0);
      const ajustementManuel = e.ajustementManuel || 0;
      const opsForProduct = opsByProduct[e.produitId] || [];
      const opsForDriver = opsForProduct.filter(op => op.livreurId === e.livreurId || op.entiteId === e.livreurId);
      
      const opsAfterEnd = opsForDriver.filter(op => parseDate(op.date) > end);
      const sfAtEnd = currentSF - opsAfterEnd.reduce((sum, op) => sum + getImpact(op, e.livreurId), 0);
      
      const opsInRange = opsForDriver.filter(op => {
        const d = parseDate(op.date);
        return d >= start && d <= end;
      });
      
      let entrees = 0;
      let sorties = 0;
      opsInRange.forEach(op => {
        const impact = getImpact(op, e.livreurId);
        if (impact > 0) entrees += impact;
        else if (impact < 0) sorties += Math.abs(impact);
      });
      
      const siAtStart = sfAtEnd - entrees + sorties;
      
      return {
        ...e,
        calculated: { si: siAtStart, entrees, sorties, sf: sfAtEnd, ajustementManuel }
      };
    });

    // Consolidate duplicates by title for each driver/depot
    const consolidatedLivreurStock: any[] = [];
    const seenLivreurProds = new Map<string, any>();
    
    allLivreurStockRaw.forEach(e => {
        const key = `${e.livreurId}_${(e.produitNom || '').trim().toLowerCase()}`;
        if (!seenLivreurProds.has(key)) {
            seenLivreurProds.set(key, { ...e });
            consolidatedLivreurStock.push(seenLivreurProds.get(key));
        } else {
            const existing = seenLivreurProds.get(key);
            existing.calculated.si += e.calculated.si;
            existing.calculated.entrees += e.calculated.entrees;
            existing.calculated.sorties += e.calculated.sorties;
            existing.calculated.sf += e.calculated.sf;
            existing.calculated.ajustementManuel += e.calculated.ajustementManuel;
            // Also merge the base fields just in case they are used in sub-components
            existing.SI = (existing.SI || 0) + (e.SI || 0);
            existing.entrees = (existing.entrees || 0) + (e.entrees || 0);
            existing.sorties = (existing.sorties || 0) + (e.sorties || 0);
            existing.SF = (existing.SF || 0) + (e.SF || 0);
            existing.ajustementManuel = (existing.ajustementManuel || 0) + (e.ajustementManuel || 0);
        }
    });

    const driverStock = consolidatedLivreurStock.filter(e => e.livreurId !== DEPOT_ID);
    const depotStock = consolidatedLivreurStock.filter(e => e.livreurId === DEPOT_ID);

    return { globalStock, driverStock, depotStock };
  }, [products, stockEntries, stockOperations, safeDateRange]);

  const exportGlobalStockPDF = async () => {
    const doc = new jsPDF();
    const settings = await DataService.getSettings();
    
    if (settings.logoUrl) {
      try {
        doc.addImage(settings.logoUrl, 'PNG', 14, 10, 30, 10);
      } catch (e) {}
    }

    const title = `Inventaire Stock Global - ${format(safeDateRange.startDate, 'dd/MM/yyyy')} au ${format(safeDateRange.endDate, 'dd/MM/yyyy')}`;
    doc.setFontSize(16);
    doc.text(title, 14, 30);

    const tableData = calculatedStock.globalStock
      .filter(p => p.calculated.sf !== 0)
      .map(p => [
        p.title,
        p.variants?.[0]?.sku || '-',
        (p.stockGlobal?.si ?? p.mainStock ?? 0).toString(),
        p.calculated.si.toString(),
        p.calculated.entrees.toString(),
        p.calculated.sorties.toString(),
        p.calculated.sf.toString()
      ]);

    autoTable(doc, {
      startY: 40,
      head: [['Produit', 'SKU', 'SI (Initial)', 'Stock Début', 'Entrées', 'Sorties', 'Stock Fin']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] }
    });

    // Operations Inventory
    const opsInRange = getOperationsInRange();
    if (opsInRange.length > 0) {
      doc.addPage();
      doc.setFontSize(14);
      doc.text("Historique des Opérations", 14, 20);
      
      const opsData = opsInRange.map(op => [
        format(new Date(op.date), 'dd/MM/yyyy HH:mm'),
        op.productName,
        op.type.replace(/_/g, ' ').toUpperCase(),
        op.quantity.toString(),
        op.livreurId ? (drivers.find(d => d.id === op.livreurId)?.name || op.livreurId) : 'Global',
        op.source
      ]);

      autoTable(doc, {
        startY: 30,
        head: [['Date', 'Produit', 'Type', 'Qté', 'Livreur/Source', 'Origine']],
        body: opsData,
        theme: 'striped',
        styles: { fontSize: 8 }
      });
    }

    doc.save(`stock_global_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const exportDriverStockPDF = async (driverId: string) => {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return;

    const doc = new jsPDF();
    const settings = await DataService.getSettings();
    
    if (settings.logoUrl) {
      try {
        doc.addImage(settings.logoUrl, 'PNG', 14, 10, 30, 10);
      } catch (e) {}
    }

    const title = `Stock Livreur: ${driver.name} - ${format(safeDateRange.startDate, 'dd/MM/yyyy')} au ${format(safeDateRange.endDate, 'dd/MM/yyyy')}`;
    doc.setFontSize(16);
    doc.text(title, 14, 30);

    const tableData = calculatedStock.driverStock
      .filter(e => e.livreurId === driverId && e.calculated.sf !== 0)
      .map(e => [
        e.produitNom,
        (e.SI || 0).toString(),
        e.calculated.si.toString(),
        e.calculated.entrees.toString(),
        e.calculated.sorties.toString(),
        e.calculated.sf.toString()
      ]);

    autoTable(doc, {
      startY: 40,
      head: [['Produit', 'SI (Initial)', 'Stock Début', 'Entrées', 'Sorties', 'Stock Fin']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] }
    });

    // Driver Operations
    const opsInRange = getOperationsInRange().filter(op => op.livreurId === driverId || op.entiteId === driverId);
    if (opsInRange.length > 0) {
      doc.addPage();
      doc.setFontSize(14);
      doc.text(`Historique des Opérations - ${driver.name}`, 14, 20);
      
      const opsData = opsInRange.map(op => [
        format(new Date(op.date), 'dd/MM/yyyy HH:mm'),
        op.productName,
        op.type.replace(/_/g, ' ').toUpperCase(),
        op.quantity.toString(),
        op.source
      ]);

      autoTable(doc, {
        startY: 30,
        head: [['Date', 'Produit', 'Type', 'Qté', 'Origine']],
        body: opsData,
        theme: 'striped',
        styles: { fontSize: 8 }
      });
    }

    doc.save(`stock_${driver.name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const exportDepotStockPDF = async () => {
    const doc = new jsPDF();
    const settings = await DataService.getSettings();
    
    if (settings.logoUrl) {
      try {
        doc.addImage(settings.logoUrl, 'PNG', 14, 10, 30, 10);
      } catch (e) {}
    }

    const title = `Stock Dépôt Delta - ${format(safeDateRange.startDate, 'dd/MM/yyyy')} au ${format(safeDateRange.endDate, 'dd/MM/yyyy')}`;
    doc.setFontSize(16);
    doc.text(title, 14, 30);

    const tableData = calculatedStock.depotStock
      .filter(e => e.calculated.sf !== 0)
      .map(e => [
        e.produitNom,
        (e.SI || 0).toString(),
        e.calculated.si.toString(),
        e.calculated.entrees.toString(),
        e.calculated.sorties.toString(),
        e.calculated.sf.toString()
      ]);

    autoTable(doc, {
      startY: 40,
      head: [['Produit', 'SI (Initial)', 'Stock Début', 'Entrées', 'Sorties', 'Stock Fin']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] }
    });

    // Depot Operations
    const opsInRange = getOperationsInRange().filter(op => op.livreurId === DEPOT_ID || op.entiteId === DEPOT_ID);
    if (opsInRange.length > 0) {
      doc.addPage();
      doc.setFontSize(14);
      doc.text("Historique des Opérations - Dépôt Delta", 14, 20);
      
      const opsData = opsInRange.map(op => [
        format(new Date(op.date), 'dd/MM/yyyy HH:mm'),
        op.productName,
        op.type.replace(/_/g, ' ').toUpperCase(),
        op.quantity.toString(),
        op.source
      ]);

      autoTable(doc, {
        startY: 30,
        head: [['Date', 'Produit', 'Type', 'Qté', 'Origine']],
        body: opsData,
        theme: 'striped',
        styles: { fontSize: 8 }
      });
    }

    doc.save(`stock_depot_delta_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const exportMovementsPDF = async () => {
    const doc = new jsPDF();
    const settings = await DataService.getSettings();
    
    if (settings.logoUrl) {
      try {
        doc.addImage(settings.logoUrl, 'PNG', 14, 10, 30, 10);
      } catch (e) {}
    }

    const filterLabel = movementFilter === 'all' ? 'Tous' : (movementFilter === 'global' ? 'Global' : (movementFilter === DEPOT_ID ? 'Dépôt' : (drivers.find(d => d.id === movementFilter)?.name || movementFilter)));
    const title = `Inventaire Mouvements de Stock (${filterLabel})`;
    const subtitle = `${format(safeDateRange.startDate, 'dd/MM/yyyy')} au ${format(safeDateRange.endDate, 'dd/MM/yyyy')}`;
    
    doc.setFontSize(16);
    doc.text(title, 14, 30);
    doc.setFontSize(12);
    doc.text(subtitle, 14, 38);

    const tableData = filteredOperations.map(op => [
      format(new Date(op.date), 'dd/MM/yyyy HH:mm'),
      op.productName,
      op.annule ? 'ANNULÉ' : op.type.replace(/_/g, ' ').toUpperCase(),
      op.quantity.toString(),
      op.livreurId ? (drivers.find(d => d.id === op.livreurId)?.name || (op.livreurId === DEPOT_ID ? 'Dépôt' : op.livreurId)) : 'Global',
      op.source || '-'
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Date', 'Produit', 'Type', 'Qté', 'Entité', 'Source']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] },
      styles: { fontSize: 8 }
    });

    doc.save(`mouvements_stock_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const handleExportPDF = () => {
    if (activeTab === 'global') {
      exportGlobalStockPDF();
    } else if (activeTab === 'livreurs') {
      if (selectedDriverId === 'all') {
        showPrompt({ title: "Entité non sélectionnée", message: "Veuillez sélectionner un livreur spécifique pour exporter son stock.", type: 'alert', onConfirm: () => {} });
      } else {
        exportDriverStockPDF(selectedDriverId);
      }
    } else if (activeTab === 'depot') {
      exportDepotStockPDF();
    } else if (activeTab === 'mouvements') {
      exportMovementsPDF();
    }
  };

  const getOperationsInRange = (): StockOperation[] => {
    const parseDate = (dateStr: string) => {
      if (dateStr.includes('T')) return new Date(dateStr);
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    const start = startOfDay(safeDateRange.startDate);
    const end = endOfDay(safeDateRange.endDate);

    const filteredOps = stockOperations.filter(op => {
      const d = parseDate(op.date);
      return isWithinInterval(d, { start, end });
    });

    return filteredOps;
  };

  const startEditingProduct = (product: Product) => {
      setEditingProductId(product.id);
      setEditSI(product.stockGlobal?.si ?? product.mainStock ?? 0);
      setEditSellingPrice(product.sellingPrice || 0);
      setEditPurchasePrice(product.purchasePrice || 0);
  };

  const saveProduct = async (product: Product) => {
      const currentGlobal = product.stockGlobal || { si: 0, entrees: 0, sorties: 0, sf: 0 };
      const si = currentGlobal.si ?? product.mainStock ?? 0;
      const entrees = currentGlobal.entrees ?? 0;
      const sorties = currentGlobal.sorties ?? 0;
      
      const newSI = editSI;
      const newSF = newSI + entrees - sorties;

      const updatedProduct: Product = { 
          ...product, 
          mainStock: newSI, // Keep for backward compatibility
          sellingPrice: editSellingPrice,
          purchasePrice: editPurchasePrice,
          stockGlobal: {
            si: newSI,
            entrees: entrees,
            sorties: sorties,
            sf: newSF
          }
      };
      await DataService.saveProduct(updatedProduct);

      // Log manual adjustment
      if (si !== newSI) {
        const diff = newSI - si;
        await DataService.logStockOperation({
          productId: product.id,
          productName: product.title,
          quantity: diff,
          type: 'si_ajustement',
          date: new Date().toISOString(),
          source: 'manual_edit',
          notes: `Modif. manuelle du stock global: ${si} -> ${newSI}`
        });
      }

      setProducts(prev => prev?.map(p => p.id === product.id ? updatedProduct : p));
      setEditingProductId(null);
  };

  const handleDeleteProduct = async (product: any) => {
    if (currentUser?.role !== 'super_admin') {
      showPrompt({ title: "Accès refusé", message: "Seul un super admin peut supprimer un produit.", type: 'alert', onConfirm: () => {} });
      return;
    }

    const { sf } = product.calculated || { sf: 0 };
    
    // Check if there is stock elsewhere (drivers/depot)
    const driverStockImpact = stockEntries.filter(e => e.produitId === product.id).some(e => e.SI !== 0 || e.entrees !== 0 || e.sorties !== 0);

    const firstMessage = sf !== 0 || driverStockImpact 
      ? `ATTENTION: Le produit "${product.title}" semble avoir du stock ou des mouvements en cours (Stock global: ${sf}). Êtes-vous sûr de vouloir le supprimer ?`
      : `Voulez-vous supprimer le produit "${product.title}" ?`;

    showPrompt({
      title: "Supprimer le produit (1/2)",
      message: firstMessage,
      type: 'confirm',
      onConfirm: () => {
        // Second confirmation
        showPrompt({
          title: "CONFIRMATION FINALE (2/2)",
          message: `Dernière étape: Confirmez-vous la suppression DÉFINITIVE de "${product.title}" ? Cette action est irréversible et sera enregistrée dans l'historique des mouvements.`,
          type: 'confirm',
          onConfirm: async () => {
            try {
              setLoading(true);
              const productIdToDelete = product.id;
              await DataService.deleteProduct(
                productIdToDelete, 
                product.title, 
                sf, 
                currentUser.id
              );
              
              // Optimistic update
              setProducts(prev => prev.filter(p => p.id !== productIdToDelete));
              
              await loadData();
              showPrompt({ title: "Succès", message: "Produit supprimé et mouvement enregistré.", type: 'alert', onConfirm: () => {} });
            } catch (e: any) {
              console.error("Error deleting product", e);
              showPrompt({ title: "Erreur", message: "Erreur lors de la suppression: " + e.message, type: 'alert', onConfirm: () => {} });
            } finally {
              setLoading(false);
            }
          }
        });
      }
    });
  };

  const handleTransfer = async () => {
    if (!transferProduct || !transferSourceId || !transferDestinationId || transferQuantity <= 0) return;
    if (transferSourceId === transferDestinationId) {
      showPrompt({ title: "Erreur de destination", message: "La source et la destination doivent être différentes.", type: 'alert', onConfirm: () => {} });
      return;
    }

    setLoading(true);
    try {
      await DataService.transferStock({
        productId: transferProduct.id,
        productName: transferProduct.title,
        sourceId: transferSourceId,
        destinationId: transferDestinationId,
        quantity: transferQuantity,
        adminId: currentUser?.id || 'unknown'
      });

      setShowTransferConfirmModal(false);
      setShowTransferModal(false);
      setTransferProduct(null);
      setTransferQuantity(1);
      showPrompt({ title: "Succès", message: 'Transfert effectué avec succès !', type: 'alert', onConfirm: () => {} });
    } catch (error: any) {
      console.error('Error during transfer:', error);
      showPrompt({ title: "Erreur", message: 'Erreur lors du transfert: ' + error.message, type: 'alert', onConfirm: () => {} });
    } finally {
      setLoading(false);
    }
  };

  const handleCancelOperation = async (opId: string) => {
    showPrompt({
      title: "Annuler le mouvement",
      message: "Êtes-vous sûr de vouloir annuler ce mouvement ? Cette action est irréversible.",
      type: 'confirm',
      onConfirm: async () => {
        setLoading(true);
        try {
          await DataService.cancelStockOperation(opId, currentUser?.id || 'unknown');
          showPrompt({ title: "Succès", message: 'Mouvement annulé avec succès !', type: 'alert', onConfirm: () => {} });
          await loadData();
        } catch (error: any) {
          console.error('Error cancelling operation:', error);
          showPrompt({ title: "Erreur", message: 'Erreur lors de l\'annulation: ' + error.message, type: 'alert', onConfirm: () => {} });
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredGlobalStock = useMemo(() => {
    let result = calculatedStock.globalStock.filter(p => 
      p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.variants || []).some(v => v.sku?.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (sortConfig) {
      result.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortConfig.key) {
          case 'title': aValue = a.title; bValue = b.title; break;
          case 'si': aValue = a.calculated.si; bValue = b.calculated.si; break;
          case 'entrees': aValue = a.calculated.entrees; bValue = b.calculated.entrees; break;
          case 'sorties': aValue = a.calculated.sorties; bValue = b.calculated.sorties; break;
          case 'sf': aValue = a.calculated.sf; bValue = b.calculated.sf; break;
          default: aValue = 0; bValue = 0;
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return [...result];
  }, [calculatedStock.globalStock, searchTerm, sortConfig]);

  const filteredDriverStock = useMemo(() => {
    let result = calculatedStock.driverStock.filter(entry => {
      const matchesDriver = selectedDriverId === 'all' || entry.livreurId === selectedDriverId;
      const matchesSearch = !searchTerm || (
        entry.produitNom.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (products.find(p => p.id === entry.produitId)?.variants || []).some(v => v.sku?.toLowerCase().includes(searchTerm.toLowerCase()))
      );
      return matchesDriver && matchesSearch;
    });

    if (sortConfig) {
      result.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortConfig.key) {
          case 'produitNom': aValue = a.produitNom; bValue = b.produitNom; break;
          case 'si': aValue = a.calculated.si; bValue = b.calculated.si; break;
          case 'entrees': aValue = a.calculated.entrees; bValue = b.calculated.entrees; break;
          case 'sorties': aValue = a.calculated.sorties; bValue = b.calculated.sorties; break;
          case 'sf': aValue = a.calculated.sf; bValue = b.calculated.sf; break;
          default: aValue = 0; bValue = 0;
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return [...result];
  }, [calculatedStock.driverStock, searchTerm, selectedDriverId, sortConfig, products]);

  const filteredDepotStock = useMemo(() => {
    let result = calculatedStock.depotStock.filter(entry => {
      const matchesSearch = !searchTerm || (
        entry.produitNom.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (products.find(p => p.id === entry.produitId)?.variants || []).some(v => v.sku?.toLowerCase().includes(searchTerm.toLowerCase()))
      );
      return matchesSearch;
    });

    if (sortConfig) {
      result.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortConfig.key) {
          case 'produitNom': aValue = a.produitNom; bValue = b.produitNom; break;
          case 'si': aValue = a.calculated.si; bValue = b.calculated.si; break;
          case 'entrees': aValue = a.calculated.entrees; bValue = b.calculated.entrees; break;
          case 'sorties': aValue = a.calculated.sorties; bValue = b.calculated.sorties; break;
          case 'sf': aValue = a.calculated.sf; bValue = b.calculated.sf; break;
          default: aValue = 0; bValue = 0;
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return [...result];
  }, [calculatedStock.depotStock, searchTerm, sortConfig, products]);

  const filteredOperations = useMemo(() => {
    const opsInRange = getOperationsInRange();
    let result = opsInRange.filter(op => {
      const matchesSearch = !searchTerm || (
        op.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        op.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (op.source || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (op.annule ? 'annulé' : '').includes(searchTerm.toLowerCase())
      );
      
      let matchesEntity = true;
      if (movementFilter !== 'all') {
        if (movementFilter === 'global') {
          matchesEntity = !op.livreurId && !op.entiteId;
        } else {
          matchesEntity = op.livreurId === movementFilter || op.entiteId === movementFilter;
        }
      }
      
      return matchesSearch && matchesEntity;
    });

    // Sort by date desc by default if no sort config
    if (!sortConfig) {
      result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } else {
      result.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortConfig.key) {
          case 'date': aValue = new Date(a.date).getTime(); bValue = new Date(b.date).getTime(); break;
          case 'productName': aValue = a.productName; bValue = b.productName; break;
          case 'type': aValue = a.type; bValue = b.type; break;
          case 'quantity': aValue = a.quantity; bValue = b.quantity; break;
          default: aValue = 0; bValue = 0;
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return result;
  }, [stockOperations, searchTerm, movementFilter, sortConfig, safeDateRange]);

  const currentTableData = activeTab === 'global' ? filteredGlobalStock : (activeTab === 'livreurs' ? filteredDriverStock : (activeTab === 'depot' ? filteredDepotStock : []));

  return (
    <div className="space-y-6">
      {importError && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl shadow-sm animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-start gap-3">
            <div className="bg-red-100 p-1.5 rounded-full">
              <X className="text-red-600" size={16} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-red-800">Problème de synchronisation Shopify</h3>
              <p className="text-xs text-red-700 mt-1 leading-relaxed">
                {importError}
              </p>
              <div className="mt-2 flex gap-3">
                <button 
                  onClick={handleManualImport}
                  className="text-xs font-bold text-red-800 underline hover:no-underline"
                >
                  Réessayer maintenant
                </button>
                <button 
                  onClick={() => setShowSettings(true)}
                  className="text-xs font-bold text-red-800 underline hover:no-underline"
                >
                  Vérifier la configuration
                </button>
              </div>
            </div>
            <button onClick={() => setImportError(null)} className="text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="w-full lg:w-auto">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Package className="text-blue-600" />
            Gestion de Stock
          </h1>
          <p className="text-gray-500 text-sm">Stock Global & Stock Livreurs</p>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full lg:w-auto">
            <div className="w-full sm:w-auto">
              <DateRangePicker 
                dateRange={dateRange} 
                onUpdate={setDateRange} 
                align="right"
                className="w-full"
              />
            </div>
            <div className="grid grid-cols-2 sm:flex sm:flex-row gap-2 w-full sm:w-auto">
              <button 
                  onClick={handleExportPDF}
                  className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors shadow-sm text-sm"
              >
                  <Download size={16} />
                  <span className="hidden xs:inline">Exporter</span>
              </button>
              <button 
                  onClick={() => setShowAdHocModal(true)}
                  className="bg-purple-600 text-white px-3 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-purple-700 transition-colors shadow-sm text-sm"
              >
                  <Package size={16} />
                  <span>Nouveau</span>
              </button>
            </div>
            
            {currentUser?.role === 'super_admin' && (
              <div className="grid grid-cols-1 sm:flex sm:flex-row gap-2 w-full sm:w-auto">
                <button 
                    onClick={() => setShowGlobalAdjustmentModal(true)}
                    className="bg-orange-600 text-white px-3 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-orange-700 transition-colors shadow-sm text-sm"
                >
                    <RefreshCw size={16} />
                    Ajuster Stock
                </button>
                <button 
                    onClick={handleRecalculateStocks}
                    disabled={loading}
                    className="bg-indigo-600 text-white px-3 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 text-sm"
                >
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    Recalculer
                </button>
              </div>
            )}
            
            <div className="grid grid-cols-2 sm:flex sm:flex-row gap-2 w-full sm:w-auto">
              <button 
                  onClick={() => setShowSettings(true)}
                  className="bg-gray-100 text-gray-700 px-3 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors text-sm"
              >
                  <Settings size={16} />
                  Config
              </button>
              <button 
                  onClick={handleManualImport}
                  disabled={importing}
                  className="bg-blue-600 text-white px-3 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 text-sm text-center"
              >
                  <RefreshCw size={16} className={importing ? 'animate-spin' : ''} />
                  {importing ? '...' : 'Sync Shopify'}
              </button>
            </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 overflow-x-auto scrollbar-hide no-wrap">
        <button
          onClick={() => setActiveTab('global')}
          className={`px-4 sm:px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'global' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          📦 Stock Global
        </button>
        <button
          onClick={() => setActiveTab('livreurs')}
          className={`px-4 sm:px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'livreurs' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          🚴 Livreurs
        </button>
        <button
          onClick={() => setActiveTab('depot')}
          className={`px-4 sm:px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'depot' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          🏢 Dépôt
        </button>
        <button
          onClick={() => setActiveTab('mouvements')}
          className={`px-4 sm:px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'mouvements' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          📋 Mouvements
        </button>
      </div>

      {/* Search Bar & Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input 
            type="text" 
            placeholder="Rechercher par nom ou SKU..." 
            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {activeTab === 'livreurs' && (
          <select
            value={selectedDriverId}
            onChange={(e) => setSelectedDriverId(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="all">Tous les livreurs</option>
            {drivers.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
        {activeTab === 'mouvements' && (
          <select
            value={movementFilter}
            onChange={(e) => setMovementFilter(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-3 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="all">Toutes les entités</option>
            <option value="global">Stock Global</option>
            <option value={DEPOT_ID}>Dépôt Delta</option>
            <optgroup label="Livreurs">
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </optgroup>
          </select>
        )}
      </div>

      {/* Products List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Chargement...</div>
        ) : activeTab === 'mouvements' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => requestSort('date')}>
                    Date {sortConfig?.key === 'date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => requestSort('productName')}>
                    Produit {sortConfig?.key === 'productName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => requestSort('type')}>
                    Type {sortConfig?.key === 'type' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right cursor-pointer hover:bg-gray-100" onClick={() => requestSort('quantity')}>
                    Qté {sortConfig?.key === 'quantity' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="hidden md:table-cell px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Provenance / Destination</th>
                  <th className="hidden lg:table-cell px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Réf / Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOperations.map((op) => {
                  const getEntityName = (id: string | undefined) => {
                    if (!id || id === 'global') return '📦 Global';
                    if (id === DEPOT_ID) return '🏢 Dépôt Delta';
                    return drivers.find(d => d.id === id)?.name || id;
                  };

                  const isTransfer = op.type.startsWith('transfert');
                  
                  return (
                    <tr key={op.id} className="hover:bg-gray-50 transition-colors text-sm">
                      <td className="hidden sm:table-cell px-6 py-4 text-gray-600">
                        {format(new Date(op.date), 'dd/MM/yyyy HH:mm')}
                      </td>
                      <td className="px-4 sm:px-6 py-4 font-medium text-gray-900 break-words max-w-[120px] sm:max-w-none">
                        {op.productName}
                      </td>
                      <td className="px-4 sm:px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                            op.annule ? 'bg-red-100 text-red-700' :
                            op.type === 'entree' ? 'bg-green-100 text-green-700' :
                            op.type === 'sortie' ? 'bg-red-100 text-red-700' :
                            op.type === 'vente' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {op.annule ? 'Annulé' : op.type.substring(0, 3)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-right font-bold">
                        {op.quantity}
                      </td>
                      <td className="hidden md:table-cell px-6 py-4 text-gray-600 font-medium">
                        {isTransfer ? (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500">{getEntityName(op.livreurId || 'global')}</span>
                            <ArrowRightLeft size={12} className="text-blue-400" />
                            <span className="text-blue-700 font-bold">{getEntityName(op.entiteId || 'global')}</span>
                          </div>
                        ) : (
                          getEntityName(op.livreurId || op.entiteId || 'global')
                        )}
                      </td>
                      <td className="hidden lg:table-cell px-6 py-4 text-gray-500 italic max-w-[150px] truncate">
                        {op.source || op.referenceId || op.notes || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : currentTableData.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center">
            <div className="bg-gray-100 p-4 rounded-full mb-4">
              <Package size={32} className="text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">Aucun produit trouvé</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th 
                    className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" 
                    onClick={() => requestSort(activeTab === 'global' ? 'title' : 'produitNom')}
                  >
                    <div className="flex items-center gap-1">
                      Produit
                      {sortConfig?.key === (activeTab === 'global' ? 'title' : 'produitNom') && (
                        <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th className="hidden md:table-cell px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
                  {activeTab === 'global' && (
                    <>
                      <th className="hidden lg:table-cell px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Prix Achat</th>
                      <th className="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Prix Vente</th>
                    </>
                  )}
                  {activeTab === 'livreurs' && selectedDriverId === 'all' && (
                    <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Livreur</th>
                  )}
                  <th 
                    className="hidden xs:table-cell px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right cursor-pointer hover:bg-gray-100" 
                    onClick={() => requestSort('si')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      S.Début
                      {sortConfig?.key === 'si' && (
                        <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right cursor-pointer hover:bg-gray-100" 
                    onClick={() => requestSort('entrees')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Entrées
                      {sortConfig?.key === 'entrees' && (
                        <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="hidden sm:table-cell px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right cursor-pointer hover:bg-gray-100" 
                    onClick={() => requestSort('sorties')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Sorties
                      {sortConfig?.key === 'sorties' && (
                        <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right cursor-pointer hover:bg-gray-100" 
                    onClick={() => requestSort('sf')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Stock Fin
                      {sortConfig?.key === 'sf' && (
                        <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeTab === 'global' ? (
                  filteredGlobalStock.map((product) => {
                    const isEditing = editingProductId === product.id;
                    const { si, entrees, sorties, sf, ajustementManuel } = product.calculated;
                    const sfAffiche = sf;

                    return (
                      <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-gray-100 flex-shrink-0 overflow-hidden border border-gray-200 flex items-center justify-center">
                                <Package size={20} className="text-gray-400" />
                            </div>
                            <div>
                              <div className="font-medium text-gray-900 flex items-center gap-2">
                                {product.title}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="hidden md:table-cell px-6 py-4 text-sm text-gray-600 font-mono">
                          {(product.variants || []).map(v => v.sku).join(', ') || '-'}
                        </td>
                        <td className="hidden lg:table-cell px-6 py-4 text-right">
                            {isEditing ? (
                                <input 
                                    type="number" 
                                    className="w-24 border rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={editPurchasePrice || ''}
                                    onChange={e => setEditPurchasePrice(parseInt(e.target.value) || 0)}
                                    placeholder="0"
                                />
                            ) : (
                                <span className="text-sm font-medium text-gray-500">
                                    {product.purchasePrice ? formatNumber(product.purchasePrice) : '-'}
                                </span>
                            )}
                        </td>
                        <td className="hidden sm:table-cell px-6 py-4 text-right">
                            {isEditing ? (
                                <input 
                                    type="number" 
                                    className="w-24 border rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={editSellingPrice || ''}
                                    onChange={e => setEditSellingPrice(parseInt(e.target.value) || 0)}
                                    placeholder="0"
                                />
                            ) : (
                                <span className="text-sm font-medium text-gray-900">
                                    {product.sellingPrice ? formatNumber(product.sellingPrice) : '-'}
                                </span>
                            )}
                        </td>
                        <td className="hidden xs:table-cell px-6 py-4 text-right">
                            {isEditing ? (
                                <input 
                                    type="number" 
                                    className="w-20 border rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={editSI || ''}
                                    onChange={e => setEditSI(parseInt(e.target.value) || 0)}
                                    placeholder="0"
                                />
                            ) : (
                                <span className="font-medium text-gray-900">{si}</span>
                            )}
                        </td>
                        <td className="hidden sm:table-cell px-6 py-4 text-right text-green-600 font-medium">+{entrees}</td>
                        <td className="hidden sm:table-cell px-6 py-4 text-right text-orange-600 font-medium">-{sorties}</td>
                        <td className={`px-6 py-4 text-right ${sfAffiche < 0 ? 'bg-red-50' : ''}`}>
                          {adjustingSFId === product.id ? (
                            <div className="flex items-center justify-end gap-2">
                              <input 
                                type="number" 
                                className="w-20 border rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                                value={editSFValue === 0 ? '0' : (editSFValue || '')}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === '') setEditSFValue(0);
                                  else setEditSFValue(parseInt(val) || 0);
                                }}
                                autoFocus
                              />
                              <button onClick={() => handleAdjustSF(product)} className="text-green-600 hover:text-green-800 text-xs font-bold">OK</button>
                              <button onClick={() => setAdjustingSFId(null)} className="text-gray-400 hover:text-gray-600 text-xs font-bold">X</button>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end">
                              <span className={`font-bold flex items-center justify-end gap-1 ${sfAffiche < 0 ? 'text-red-600' : (ajustementManuel !== 0 ? 'text-blue-600' : 'text-gray-900')}`}>
                                {sfAffiche < 0 && <AlertCircle size={14} />}
                                {sfAffiche}
                              </span>
                              {currentUser?.role === 'super_admin' && (
                                <button 
                                  onClick={() => startAdjustingSF(product.id, sfAffiche)}
                                  className="text-[10px] text-gray-400 hover:text-blue-600 underline"
                                >
                                  Ajuster
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {isEditing ? (
                            <div className="flex justify-center gap-2">
                              <button onClick={() => saveProduct(product)} className="text-green-600 hover:text-green-800 text-sm font-medium">Enregistrer</button>
                              <button onClick={() => setEditingProductId(null)} className="text-gray-400 hover:text-gray-600 text-sm font-medium">Annuler</button>
                            </div>
                          ) : (
                            <div className="flex justify-center gap-3">
                              <button 
                                onClick={() => startEditingProduct(product)}
                                className="text-gray-400 hover:text-blue-600 transition-colors text-sm font-medium"
                              >
                                Modifier
                              </button>
                              <button 
                                onClick={() => {
                                  setTransferProduct(product);
                                  setTransferSourceId('global');
                                  setTransferDestinationId(DEPOT_ID);
                                  setShowTransferModal(true);
                                }}
                                className="text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1 text-sm font-medium"
                              >
                                <ArrowRightLeft size={14} /> Transférer
                              </button>
                              {currentUser?.role === 'super_admin' && (
                                <button 
                                  onClick={() => handleDeleteProduct(product)}
                                  className="text-red-400 hover:text-red-600 transition-colors flex items-center gap-1 text-sm font-medium"
                                  title="Supprimer le produit"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  // Livreurs & Depot Tab
                  currentTableData.map(entry => {
                    const driverName = entry.livreurId === DEPOT_ID ? '🏢 Dépôt Delta Transport' : (drivers.find(d => d.id === entry.livreurId)?.name || 'Inconnu');
                    const { si, entrees, sorties, sf, ajustementManuel } = entry.calculated;
                    const sfAffiche = sf;

                    return (
                      <tr key={`${entry.produitId}-${entry.livreurId}`} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{entry.produitNom}</div>
                        </td>
                        <td className="hidden md:table-cell px-6 py-4 text-sm text-gray-600 font-mono">
                          {products.find(p => p.id === entry.produitId)?.variants?.[0]?.sku || '-'}
                        </td>
                        {(activeTab === 'livreurs' && selectedDriverId === 'all') && (
                          <td className="px-6 py-4 text-sm font-medium text-gray-700">
                            {driverName}
                          </td>
                        )}
                        <td className="hidden xs:table-cell px-6 py-4 text-right font-medium text-gray-900">
                          {editingDriverStockId === `${entry.produitId}-${entry.livreurId}` ? (
                            <input 
                              type="number" 
                              className="w-20 border rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                              value={editDriverSI || ''}
                              onChange={e => setEditDriverSI(parseInt(e.target.value) || 0)}
                              autoFocus
                            />
                          ) : (
                            si
                          )}
                        </td>
                        <td className="hidden sm:table-cell px-6 py-4 text-right text-green-600 font-medium">+{entrees}</td>
                        <td className="hidden sm:table-cell px-6 py-4 text-right text-orange-600 font-medium">-{sorties}</td>
                        <td className={`px-6 py-4 text-right ${sfAffiche < 0 ? 'bg-red-50' : ''}`}>
                          {adjustingSFId === `${entry.produitId}-${entry.livreurId}` ? (
                            <div className="flex items-center justify-end gap-2">
                              <input 
                                type="number" 
                                className="w-20 border rounded px-2 py-1 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                                value={editSFValue === 0 ? '0' : (editSFValue || '')}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === '') setEditSFValue(0);
                                  else setEditSFValue(parseInt(val) || 0);
                                }}
                                autoFocus
                              />
                              <button onClick={() => handleAdjustDriverSF(entry)} className="text-green-600 hover:text-green-800 text-xs font-bold">OK</button>
                              <button onClick={() => setAdjustingSFId(null)} className="text-gray-400 hover:text-gray-600 text-xs font-bold">X</button>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end">
                              <span className={`font-bold flex items-center justify-end gap-1 ${sfAffiche < 0 ? 'text-red-600' : (ajustementManuel !== 0 ? 'text-blue-600' : 'text-gray-900')}`}>
                                {sfAffiche < 0 && <AlertCircle size={14} />}
                                {sfAffiche}
                              </span>
                              {currentUser?.role === 'super_admin' && (
                                <button 
                                  onClick={() => startAdjustingSF(`${entry.produitId}-${entry.livreurId}`, sfAffiche)}
                                  className="text-[10px] text-gray-400 hover:text-blue-600 underline"
                                >
                                  Ajuster
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {editingDriverStockId === `${entry.produitId}-${entry.livreurId}` ? (
                              <div className="flex justify-center gap-2">
                                <button onClick={() => saveDriverSI(entry)} className="text-green-600 hover:text-green-800 text-sm font-medium">OK</button>
                                <button onClick={() => setEditingDriverStockId(null)} className="text-gray-400 hover:text-gray-600 text-sm font-medium">X</button>
                              </div>
                            ) : (
                              <>
                                <button 
                                  onClick={() => startEditingDriverSI(entry)}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-bold"
                                >
                                  Modifier SI
                                </button>
                                <button
                                  onClick={() => {
                                      const p = products.find(prod => prod.id === entry.produitId);
                                      if (p) {
                                          setTransferProduct(p);
                                          setTransferSourceId(entry.livreurId);
                                          setTransferDestinationId('global');
                                          setShowTransferModal(true);
                                      }
                                  }}
                                  className="text-gray-400 hover:text-blue-600 transition-colors"
                                  title="Transférer"
                                >
                                  <ArrowRightLeft size={16} />
                                </button>
                                {entry.livreurId !== DEPOT_ID && (
                                  <button
                                    onClick={() => {
                                        const p = products.find(prod => prod.id === entry.produitId);
                                        if (p) {
                                            setTransferProduct(p);
                                            setTransferSourceId(entry.livreurId);
                                            setTransferDestinationId(DEPOT_ID);
                                            setShowTransferModal(true);
                                        }
                                    }}
                                    className="text-indigo-400 hover:text-indigo-600 transition-colors"
                                    title="Vers Dépôt"
                                  >
                                    <Truck size={16} />
                                  </button>
                                )}
                                {entry.livreurId === DEPOT_ID && (
                                  <button
                                    onClick={() => {
                                        const p = products.find(prod => prod.id === entry.produitId);
                                        if (p) {
                                            setTransferProduct(p);
                                            setTransferSourceId('global');
                                            setTransferDestinationId(DEPOT_ID);
                                            setShowTransferModal(true);
                                        }
                                    }}
                                    className="text-green-600 hover:text-green-800 transition-colors"
                                    title="Alimenter depuis Global"
                                  >
                                    <RefreshCw size={16} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* TRANSFER MODAL */}
      {showTransferModal && transferProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                      <ArrowRightLeft className="text-blue-600" /> Transférer Stock
                  </h3>
                  <button onClick={() => setShowTransferModal(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={20} />
                  </button>
                </div>
                
                <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-sm font-medium text-blue-900">{transferProduct.title}</p>
                  <p className="text-xs text-blue-700 mt-1">
                    Stock Global Disponible (SF) : 
                    <span className="font-bold ml-1">
                      {transferProduct.stockGlobal?.sf ?? transferProduct.mainStock ?? 0}
                    </span>
                  </p>
                </div>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Source</label>
                            <select 
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50"
                                value={transferSourceId}
                                onChange={e => setTransferSourceId(e.target.value)}
                            >
                                <option value="global">📦 Stock Global</option>
                                <option value={DEPOT_ID}>🏢 Dépôt Delta</option>
                                {drivers.map(d => (
                                    <option key={d.id} value={d.id}>👤 {d.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center justify-center pt-5">
                            <ArrowRightLeft className="text-gray-300" size={20} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Destination</label>
                            <select 
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50"
                                value={transferDestinationId}
                                onChange={e => setTransferDestinationId(e.target.value)}
                            >
                                <option value="global">📦 Stock Global</option>
                                <option value={DEPOT_ID}>🏢 Dépôt Delta</option>
                                {drivers.map(d => (
                                    <option key={d.id} value={d.id}>👤 {d.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Quantité à transférer</label>
                        <input 
                            type="number" 
                            min="1"
                            className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                            value={transferQuantity}
                            onChange={e => setTransferQuantity(parseInt(e.target.value) || 1)}
                        />
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                        <button onClick={() => setShowTransferModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Annuler</button>
                        <button 
                          onClick={() => setShowTransferConfirmModal(true)} 
                          disabled={!transferSourceId || !transferDestinationId || transferSourceId === transferDestinationId || transferQuantity <= 0}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-bold"
                        >
                          Suivant
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* TRANSFER CONFIRMATION MODAL */}
      {showTransferConfirmModal && transferProduct && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-blue-600 px-6 py-4 text-white">
              <h3 className="font-bold flex items-center gap-2 uppercase tracking-wider">
                📦 Récapitulatif du transfert
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-sm text-gray-500">Produit</span>
                  <span className="text-sm font-bold text-gray-900">{transferProduct.title}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-sm text-gray-500">Quantité</span>
                  <span className="text-sm font-bold text-blue-600">{transferQuantity} unité(s)</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-sm text-gray-500">Source</span>
                  <span className="text-sm font-medium text-gray-900">
                    {transferSourceId === 'global' ? '📦 Stock Global' : (drivers.find(d => d.id === transferSourceId)?.name || (transferSourceId === DEPOT_ID ? '🏢 Dépôt Delta' : transferSourceId))}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-sm text-gray-500">Destination</span>
                  <span className="text-sm font-medium text-gray-900">
                    {transferDestinationId === 'global' ? '📦 Stock Global' : (drivers.find(d => d.id === transferDestinationId)?.name || (transferDestinationId === DEPOT_ID ? '🏢 Dépôt Delta' : transferDestinationId))}
                  </span>
                </div>
              </div>

              <div className="bg-orange-50 p-4 rounded-lg border border-orange-100 flex gap-3">
                <AlertCircle className="text-orange-600 shrink-0" size={20} />
                <p className="text-xs text-orange-800 leading-relaxed">
                  Cette opération va déduire <span className="font-bold">{transferQuantity}</span> du stock source et créditer <span className="font-bold">{transferQuantity}</span> au stock destination.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setShowTransferConfirmModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleTransfer}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <RefreshCw className="animate-spin" size={18} /> : '✅ Confirmer le transfert'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Adjustment Modal */}
      {showGlobalAdjustmentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="bg-orange-600 px-6 py-4 text-white flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2">
                <RefreshCw size={20} />
                Ajuster le stock (SuperAdmin)
              </h3>
              <button onClick={() => setShowGlobalAdjustmentModal(false)} className="hover:bg-orange-700 p-1 rounded">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleGlobalAdjustmentSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Produit</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-orange-500 outline-none"
                  value={adjustmentForm.productId}
                  onChange={(e) => setAdjustmentForm({...adjustmentForm, productId: e.target.value})}
                  required
                >
                  <option value="">Sélectionner un produit</option>
                  {products.filter(p => p.status === 'active' || p.status === 'actif').map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stock Cible</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-orange-500 outline-none"
                  value={adjustmentForm.targetId}
                  onChange={(e) => setAdjustmentForm({...adjustmentForm, targetId: e.target.value})}
                  required
                >
                  <option value="global">Stock Global (Entrepôt)</option>
                  <option value={DEPOT_ID}>Dépôt Delta Transport</option>
                  <optgroup label="Livreurs">
                    {drivers.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nouvelle Quantité (Absolue)</label>
                <input 
                  type="number"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-orange-500 outline-none"
                  value={adjustmentForm.newQty}
                  onChange={(e) => setAdjustmentForm({...adjustmentForm, newQty: parseInt(e.target.value) || 0})}
                  min="0"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motif de l'ajustement (Obligatoire)</label>
                <textarea 
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-orange-500 outline-none"
                  value={adjustmentForm.reason}
                  onChange={(e) => setAdjustmentForm({...adjustmentForm, reason: e.target.value})}
                  placeholder="Ex: Inventaire physique, Erreur de saisie..."
                  rows={3}
                  required
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setShowGlobalAdjustmentModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button 
                  type="submit"
                  disabled={isSubmittingAdjustment}
                  className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmittingAdjustment ? <RefreshCw className="animate-spin" size={18} /> : 'Confirmer l\'ajustement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Configuration Stock</h3>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Shopify API</h4>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Domaine Shopify (.myshopify.com)</label>
                  <input 
                    type="text" 
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={shopifyDomain}
                    onChange={e => setShopifyDomain(e.target.value)}
                    placeholder="ma-boutique.myshopify.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Access Token</label>
                  <input 
                    type="password" 
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={shopifyAccessToken}
                    onChange={e => setShopifyAccessToken(e.target.value)}
                    placeholder="shpat_..."
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <h4 className="text-sm font-bold text-red-600 uppercase tracking-wider mb-3">Zone de Danger</h4>
                <div className="space-y-3">
                  <button 
                    onClick={() => setResetType('global')}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-100"
                  >
                    Réinitialiser Stock Global
                  </button>
                  <button 
                    onClick={() => setResetType('livreurs')}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-100"
                  >
                    Réinitialiser Stocks Livreurs
                  </button>
                  <button 
                    onClick={() => setResetType('all')}
                    className="w-full text-left px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                  >
                    Réinitialiser TOUS les stocks
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <h4 className="text-sm font-bold text-blue-600 uppercase tracking-wider mb-3">Maintenance</h4>
                <div className="space-y-3">
                  <button 
                    onClick={handleCleanupCharge5}
                    className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-blue-100 flex items-center gap-2"
                  >
                    <RefreshCw size={14} />
                    Nettoyer & Fusionner Doublon "Charge 5"
                  </button>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg font-medium">Annuler</button>
              <button onClick={handleSaveSettings} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm">Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* RESET MODAL */}
      {resetType && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertCircle size={24} />
              <h3 className="text-lg font-bold">Action Irréversible</h3>
            </div>
            <p className="text-gray-600 mb-6 leading-relaxed">
              Vous êtes sur le point de réinitialiser {resetType === 'global' ? 'le stock global' : resetType === 'livreurs' ? 'les stocks des livreurs' : 'tous les stocks'}. 
              Cette action remettra SI, Entrées et Sorties à zéro.
            </p>
            <div className="mb-6">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Tapez "CONFIRMER" pour valider</label>
              <input 
                type="text" 
                className="w-full border-2 border-red-100 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors font-bold text-center uppercase"
                value={resetConfirmationInput}
                onChange={e => setResetConfirmationInput(e.target.value.toUpperCase())}
                placeholder="CONFIRMER"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => {
                  setResetType(null);
                  setResetConfirmationInput('');
                }} 
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
              >
                Annuler
              </button>
              <button 
                onClick={handleResetStockEntries}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-bold shadow-lg shadow-red-200 disabled:opacity-50"
                disabled={resetConfirmationInput !== 'CONFIRMER'}
              >
                Réinitialiser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AD-HOC MODAL */}
      {showAdHocModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold">Nouveau Produit Ponctuel</h3>
              <button onClick={() => setShowAdHocModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom du produit</label>
                <input 
                  type="text" 
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  value={newAdHocName}
                  onChange={e => setNewAdHocName(e.target.value)}
                  placeholder="Ex: JBL Tour One M2"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prix d'achat</label>
                  <input 
                    type="number" 
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={newAdHocPurchasePrice}
                    onChange={e => setNewAdHocPurchasePrice(parseInt(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prix de vente</label>
                  <input 
                    type="number" 
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={newAdHocSellingPrice}
                    onChange={e => setNewAdHocSellingPrice(parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => setShowAdHocModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Annuler</button>
              <button 
                onClick={handleCreateAdHoc} 
                disabled={creatingAdHoc || !newAdHocName.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {creatingAdHoc ? <RefreshCw size={18} className="animate-spin" /> : 'Créer le produit'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Prompt / Confirm / Alert Modal */}
      {promptModal.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 text-left">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-2">{promptModal.title}</h3>
              <p className="text-gray-600 text-sm mb-4">{promptModal.message}</p>
              
              {promptModal.type === 'prompt' && (
                <input 
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none mb-4"
                  value={promptValue}
                  onChange={e => setPromptValue(e.target.value)}
                  placeholder={promptModal.placeholder}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handlePromptConfirm()}
                />
              )}

              <div className="flex justify-end gap-3">
                {promptModal.type !== 'alert' && (
                  <button 
                    onClick={() => setPromptModal(prev => ({ ...prev, show: false }))}
                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors"
                  >
                    Annuler
                  </button>
                )}
                <button 
                  onClick={handlePromptConfirm}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors shadow-sm"
                >
                  {promptModal.type === 'alert' ? 'OK' : 'Confirmer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
