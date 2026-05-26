
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { 
    Phone, 
    Send, 
    CheckCircle, 
    Truck, 
    AlertCircle, 
    Plus, 
    DollarSign,
    Trash2,
    Calendar,
    ArrowUpDown,
    AlertTriangle,
    X,
    Package,
    Clock,
    ChevronDown,
    Filter,
    FileText,
    Check,
    Box,
    CalendarClock,
    Download,
    RefreshCw,
    UserPlus,
    Edit2
} from 'lucide-react';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Order, Zone, SystemUser, OrderLog, OrderStatus, PurchaseOrder, PurchaseOrderItem, Driver, StockLivreurEntry, StockOperation, Product } from '../types';
import { DataService, DEPOT_ID } from '../services/dataService';
import { formatFCFA } from '../utils/formatters';
import { parseProductCommand } from '../utils/productParser';
import { usePersistedDateRange } from '../hooks/usePersistedDateRange';
import { usePersistedState } from '../hooks/usePersistedState';
import { DateRangePicker } from '../components/DateRangePicker';
import { startOfDay, endOfDay, isWithinInterval, format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface RegionalOrdersProps {
  currentUser?: SystemUser;
}

export const RegionalOrders: React.FC<RegionalOrdersProps> = ({ currentUser }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [stockLivreurs, setStockLivreurs] = useState<StockLivreurEntry[]>([]);
  const [stockOperations, setStockOperations] = useState<StockOperation[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [poSuccessMessage, setPoSuccessMessage] = useState<string | null>(null);
  
  // Filters
  const [dateRange, setDateRange] = usePersistedDateRange('regional_orders_date_range', {
      startDate: new Date(),
      endDate: new Date()
  });

  const safeDateRange = useMemo(() => {
    if (!dateRange.startDate || !dateRange.endDate || isNaN(dateRange.startDate.getTime()) || isNaN(dateRange.endDate.getTime())) {
        return { startDate: new Date(), endDate: new Date() };
    }
    return dateRange;
  }, [dateRange]);

  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid' | 'requested'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Interaction State (Double Click Logic)
  // Store format: "ID-ACTION" ex: "123-delete", "123-pay"
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [showExpedierModal, setShowExpedierModal] = useState(false);
  const [isExpediting, setIsExpediting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adjustingSFId, setAdjustingSFId] = useState<string | null>(null);
  const [editSFValue, setEditSFValue] = useState<number>(0);

  // Global Adjustment Modal State
  const [showGlobalAdjustmentModal, setShowGlobalAdjustmentModal] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState({
    productId: '',
    targetId: DEPOT_ID, // Default to Depot Delta here
    newQty: 0,
    reason: ''
  });
  const [isSubmittingAdjustment, setIsSubmittingAdjustment] = useState(false);

  // Modal States
  const [remarkModalOrder, setRemarkModalOrder] = useState<Order | null>(null);
  const [newRemark, setNewRemark] = useState('');
  const [scheduleModalOrder, setScheduleModalOrder] = useState<Order | null>(null);
  const [scheduledDate, setScheduledDate] = useState<string>(new Date().toISOString().slice(0, 16));
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [editingShippingOrderId, setEditingShippingOrderId] = useState<string | null>(null);
  const [editShippingValue, setEditShippingValue] = useState('');

  // Help with logging labels
  const STATUS_LABELS: Record<string, string> = {
    'regional_en_attente': 'En attente',
    'regional_contacte': 'Contacté',
    'regional_relance': 'Relancé',
    'regional_prete': 'Prête',
    'expedition_en_cours': 'Expédié',
    'regional_injoignable': 'Injoignable',
    'regional_injoignable_x2': 'Injoignable X2',
    'regional_injoignable_x3': 'Injoignable X3',
    'regional_reporte': 'Reporté',
    'expedition_livree': 'Livré',
    'regional_annule': 'Annulé'
  };

  const PAYMENT_LABELS: Record<string, string> = {
    'unpaid': 'Non Payé',
    'requested': 'Demandé',
    'paid': 'Payé'
  };

  useEffect(() => {
      if (remarkModalOrder) setShowAllLogs(false);
  }, [remarkModalOrder]);

  const zonesRef = useRef<Zone[]>([]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(false), 5000);
    const unsubscribe = DataService.subscribeToOrders((newOrders) => {
        const regional = newOrders.filter(ord => {
            const isRegionalStatus = [
                'regional_en_attente', 
                'expedition_en_cours', 'expedition_livree', 
                'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
                'regional_injoignable_x2', 'regional_injoignable_x3',
                'regional_reporte', 'regional_annule'
            ].includes(ord.status);
            
            const isRegionalZone = ord.zoneId && zonesRef.current.find(zo => zo.id === ord.zoneId)?.type === 'regional';
            
            return isRegionalStatus || (isRegionalZone && ord.status === 'validé');
        });
        setOrders(regional);
    });

    const unsubscribeStock = DataService.subscribeToStockLivreurs((entries) => {
        setStockLivreurs(entries);
    });

    const unsubscribeOps = DataService.subscribeToStockOperations((ops) => {
        setStockOperations(ops);
    });

    const unsubscribeProducts = DataService.subscribeToProducts((ps) => {
        setProducts(ps);
    });

    const unsubscribeDrivers = DataService.subscribeToDrivers((ds) => {
        setDrivers(ds);
    });

    return () => {
        clearInterval(interval);
        unsubscribe();
        unsubscribeStock();
        unsubscribeOps();
        unsubscribeProducts();
        unsubscribeDrivers();
    };
  }, []);

  const loadData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const [z, pos, d] = await Promise.all([
      DataService.getZones(),
      DataService.getPurchaseOrders(),
      DataService.getDrivers()
    ]);
    
    zonesRef.current = z;
    setZones(z.filter(zo => zo.type === 'regional'));
    setPurchaseOrders(pos);
    if (showLoading) setLoading(false);
  };

  const getPaymentStatus = (order: Order) => {
      if (order.regionalPaymentStatus) return order.regionalPaymentStatus;
      return order.isPrePaid ? 'paid' : 'unpaid';
  };

  const estProgrammee = (o: Order) => {
    const dateProg = o.scheduledAt || (o as any).dateProgrammee || (o as any).scheduledDate || (o as any).scheduled_date;
    if (!dateProg) return false;
    
    const now = new Date();
    const schedDate = new Date(dateProg);
    
    // Scheduled if now < schedDate + 1 minute
    return now.getTime() < (schedDate.getTime() + 60000);
  };

  const baseFilteredOrders = useMemo(() => {
      let filtered = [...orders];

      const start = startOfDay(safeDateRange.startDate);
      const end = endOfDay(safeDateRange.endDate);

      // Filter by Date
      filtered = filtered.filter(o => {
          // Use scheduledAt if available, then assignedAt, fallback to date
          const dateToUseStr = o.scheduledAt || o.assignedAt || o.date;
          const dateToUse = new Date(dateToUseStr.split('T')[0]);
          return isWithinInterval(dateToUse, { start, end });
      });

      // Filter by Status
      if (statusFilter !== 'all') {
          filtered = filtered.filter(o => o.status === statusFilter);
      }

      // EXCLUDE SCHEDULED
      filtered = filtered.filter(o => !estProgrammee(o));

      return filtered;
  }, [orders, safeDateRange, statusFilter]);

  const counts = useMemo(() => {
      const counts = { all: 0, unpaid: 0, requested: 0, paid: 0 };
      baseFilteredOrders.forEach(o => {
          counts.all++;
          const status = getPaymentStatus(o);
          if (status === 'unpaid') counts.unpaid++;
          else if (status === 'requested') counts.requested++;
          else if (status === 'paid') counts.paid++;
      });
      return counts;
  }, [baseFilteredOrders]);

  const sortedOrders = useMemo(() => {
      let filtered = baseFilteredOrders;

      // Filter by Payment Status
      if (paymentFilter !== 'all') {
          filtered = filtered.filter(o => {
              const status = getPaymentStatus(o);
              return status === paymentFilter;
          });
      }

      return filtered.sort((a, b) => {
          const dateA = new Date(a.importedAt || a.date).getTime();
          const dateB = new Date(b.importedAt || b.date).getTime();
          return dateB - dateA;
      });
  }, [baseFilteredOrders, paymentFilter]);

  // Calcul en temps réel du stock Dépôt Delta
  const stockDepot = useMemo(() => {
    const parseDate = (dateStr: string) => {
      if (dateStr.includes('T')) return new Date(dateStr);
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    const start = startOfDay(safeDateRange.startDate);
    const end = endOfDay(safeDateRange.endDate);

    const getImpact = (op: StockOperation, targetDriverId: string): number => {
      const qty = op.quantity || 0;
      const type = op.type;
      const sourceId = op.livreurId;
      const destId = op.entiteId;

      let impact = 0;
      // Case 1: Target is the destination
      if (destId === targetDriverId) {
        if (['entree', 'transfert_global_to_driver', 'transfert_global_to_depot', 'transfert_driver_to_depot', 'transfert_depot_to_driver', 'si_ajustement', 'retour'].includes(type)) impact += qty;
      }
      // Case 2: Target is the source
      if (sourceId === targetDriverId) {
        if (['sortie', 'vente', 'transfert_driver_to_global', 'transfert_depot_to_global', 'transfert_driver_to_depot', 'transfert_depot_to_driver'].includes(type)) impact -= qty;
        if (['entree', 'retour'].includes(type)) impact += qty;
      }
      
      // Special case: if only one of them is set but it's not a transfer type, treat it as the target
      if (!sourceId && destId === targetDriverId && !['transfert_global_to_driver', 'transfert_global_to_depot', 'transfert_driver_to_depot', 'transfert_depot_to_driver'].includes(type)) {
         if (['entree', 'si_ajustement', 'retour'].includes(type)) return qty;
         if (['sortie', 'vente'].includes(type)) return -qty;
      }
      if (!destId && sourceId === targetDriverId && !['transfert_driver_to_global', 'transfert_depot_to_global', 'transfert_driver_to_depot', 'transfert_depot_to_driver'].includes(type)) {
         if (['entree', 'si_ajustement', 'retour'].includes(type)) return qty;
         if (['sortie', 'vente'].includes(type)) return -qty;
      }

      return impact;
    };

    const depotEntries = stockLivreurs.filter(e => e.livreurId === 'depot_delta');
    return depotEntries.map(e => {
      const ajustementManuel = e.ajustementManuel || 0;
      const currentSF = (e.SI || 0) + (e.entrees || 0) - (e.sorties || 0) + ajustementManuel;
      const opsForProduct = stockOperations.filter(op => 
        op.productId === e.produitId && 
        (op.livreurId === e.livreurId || op.entiteId === e.livreurId)
      );
      
      const opsAfterEnd = opsForProduct.filter(op => parseDate(op.date) > end);
      const sfAtEnd = currentSF - opsAfterEnd.reduce((sum, op) => sum + getImpact(op, e.livreurId), 0);
      
      const opsInRange = opsForProduct.filter(op => {
        const d = parseDate(op.date);
        return d >= start && d <= end;
      });
      
      const entrees = opsInRange.reduce((sum, op) => {
        const impact = getImpact(op, e.livreurId);
        return impact > 0 ? sum + impact : sum;
      }, 0);
      
      const sorties = opsInRange.reduce((sum, op) => {
        const impact = getImpact(op, e.livreurId);
        return impact < 0 ? sum + Math.abs(impact) : sum;
      }, 0);
      
      const siAtStart = sfAtEnd - entrees + sorties;
      
      return {
        nom: e.produitNom,
        si: siAtStart,
        entrees,
        sorties,
        sf: sfAtEnd,
        produitId: e.produitId,
        ajustementManuel
      };
    }).filter(s => s.sf >= 0 && (s.sf > 0 || s.entrees > 0 || s.sorties > 0));
  }, [stockLivreurs, stockOperations, safeDateRange]);

  const handleFinalizeExpedier = async () => {
    setIsExpediting(true);
    setErrorMessage(null);
    try {
      // 1. Récupérer les commandes à expédier (statut "Prête")
      const commandesAExpedier = baseFilteredOrders.filter(o => 
        (o.status as string) === 'regional_prete' || (o.status as string) === 'Prête' || (o.status as string) === 'prete' || (o.status as string) === 'ready'
      );

      if (commandesAExpedier.length === 0) {
        setIsExpediting(false);
        setShowExpedierModal(false);
        return;
      }

      // 2. Consolider les produits
      const produitsConsolides: { nom: string, quantite: number }[] = [];

      for (const commande of commandesAExpedier) {
        // Tester les différents noms de champ possibles
        const lignes: any[] = 
          commande.products ?? 
          (commande.productDetails ? [commande.productDetails] : []) ??
          [];

        for (const ligne of lignes) {
          let nom = "";
          let quantite = 1;

          if (typeof ligne === "object" && ligne !== null) {
              nom = (ligne.name || ligne.nom || String(ligne)).trim();
              quantite = ligne.quantity || ligne.quantite || 1;
          } else {
              const ligneStr = String(ligne);
              const match = ligneStr.match(/^(\d+)\s*[xX]\s*(.+)$/);
              quantite = match ? parseInt(match[1]) : 1;
              nom = match ? match[2].trim() : ligneStr.trim();
          }

          const existant = produitsConsolides.find(p => p.nom === nom);
          if (existant) existant.quantite += quantite;
          else produitsConsolides.push({ nom, quantite });
        }
      }

      // 3. Écrire les sorties stock — une par produit
      const allProducts = await DataService.getProducts();
      for (const produit of produitsConsolides) {
        // Find productId by name
        let productId = "unknown";
        const cleanProduitNom = produit.nom?.trim().toLowerCase();
        
        const foundProduct = allProducts.find(p => {
          const title = p.title?.trim().toLowerCase();
          const pId = p.id?.trim().toLowerCase();
          const cleanNom = cleanProduitNom;
          
          // Match by exact title or exact ID
          if (title === cleanNom || pId === cleanNom) return true;
          
          // Match by SKU
          if (p.variants && p.variants.some(v => v.sku?.trim().toLowerCase() === cleanNom)) return true;
          
          // Fuzzy match
          if (cleanNom.length > 2 && title && title.includes(cleanNom)) return true;
          if (title && title.length > 2 && cleanNom.includes(title)) return true;
          
          return false;
        });
        
        if (foundProduct) {
          productId = foundProduct.id;
        }

        // 1. Log operation
        await DataService.logStockOperation({
          entiteType: "depot",
          entiteId: "depot_delta",
          livreurId: "depot_delta", // Added for consistency
          productName: produit.nom,
          productId: productId,
          type: "sortie",
          quantity: produit.quantite,
          source: "expedition_delta",
          date: new Date().toISOString()
        });

        // 2. Update physical stock (SF) in the database
        if (productId !== "unknown") {
          await DataService.updateDepotStock(productId, produit.quantite, 'deduct', 'expedition_delta');
        }
      }

      // 4. Passer chaque commande en "Expédié"
      for (const commande of commandesAExpedier) {
        const newLog: OrderLog = {
          id: Date.now().toString() + Math.random().toString(36).substring(7),
          text: "Statut changé : Expédié (Livré Delta)",
          author: currentUser?.username || 'Admin',
          createdAt: new Date().toISOString()
        };
        // Use DataService.saveOrder to ensure correct collection names and error handling
        await DataService.saveOrder({
          ...commande,
          status: "expedition_livree",
          logs: [...(commande.logs || []), newLog],
          sortieDepotLogged: true
        });
      }

      // 5. Fermer le modal et afficher succès
      setShowExpedierModal(false);
      setSuccessMessage(`${commandesAExpedier.length} commande(s) expédiée(s) avec succès.`);
      setTimeout(() => setSuccessMessage(null), 5000);

    } catch (error) {
      // Afficher l'erreur exacte dans la console ET dans l'UI
      console.error("ERREUR handleFinalizeExpedier :", error);
      setErrorMessage("Erreur lors de l'expédition : " + String(error));
    } finally {
      setIsExpediting(false);
    }
  };

  const handleUpdateZone = async (order: Order, zoneId: string) => {
      const zone = zones.find(z => z.id === zoneId);
      if (!zone) return;

      const newLog: OrderLog = {
          id: Date.now().toString() + Math.random().toString(36).substring(7),
          text: `Zone changée : ${zone.name}`,
          author: currentUser?.username || 'Admin',
          createdAt: new Date().toISOString()
      };

      const updated: Order = {
          ...order,
          zoneId: zone.id,
          shippingFee: zone.rate,
          logs: [...(order.logs || []), newLog]
      };
      await DataService.saveOrder(updated);
      setOrders(prev => prev?.map(o => o.id === order.id ? updated : o));
  };

  const handleSaveShippingRemark = async (order: Order) => {
      if (!editShippingValue.trim()) {
          setEditingShippingOrderId(null);
          return;
      }

      const newLog: OrderLog = {
          id: Date.now().toString() + Math.random().toString(36).substring(7),
          text: `Note d'expédition modifiée : ${editShippingValue.trim()}`,
          author: currentUser?.username || 'Admin',
          createdAt: new Date().toISOString()
      };

      const updated: Order = {
          ...order,
          shippingRemarks: editShippingValue.trim(),
          logs: [...(order.logs || []), newLog]
      };

      await DataService.saveOrder(updated);
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
      setEditingShippingOrderId(null);
  };

  const productsToShip = useMemo(() => {
      const preteOrders = baseFilteredOrders.filter(o => 
          ['regional_prete', 'Prête', 'prete', 'ready'].includes(o.status as string)
      );
      const grouped: Record<string, { quantity: number, orderIds: string[], sku?: string | null }> = {};
      
      preteOrders.forEach(order => {
          // Handle multi-product or single product
          if (order.products && order.products.length > 0) {
              order.products.forEach(p => {
                  const name = p.name || 'Produit inconnu';
                  if (!grouped[name]) grouped[name] = { quantity: 0, orderIds: [], sku: p.sku };
                  grouped[name].quantity += p.quantity;
                  if (!grouped[name].orderIds.includes(order.id)) {
                      grouped[name].orderIds.push(order.id);
                  }
              });
          } else {
              const { quantity, productName } = parseProductCommand(order.productDetails || 'Produit inconnu');
              const name = productName;
              if (!grouped[name]) grouped[name] = { quantity: 0, orderIds: [] };
              grouped[name].quantity += quantity > 0 ? quantity : 1;
              if (!grouped[name].orderIds.includes(order.id)) {
                  grouped[name].orderIds.push(order.id);
              }
          }
      });
      
      return Object.entries(grouped)?.map(([name, data]) => ({
          name,
          quantity: data.quantity,
          orderIds: data.orderIds,
          sku: data.sku
      })).sort((a, b) => b.quantity - a.quantity);
  }, [baseFilteredOrders]);

  const totalProductsToShip = productsToShip.reduce((acc, p) => acc + p.quantity, 0);

  const isPOCreated = useMemo(() => {
      if (productsToShip.length === 0) return false;
      const currentOrderIds = productsToShip.flatMap(p => p.orderIds);
      return purchaseOrders.some(po => 
          po.source === 'Expéditions Delta Transport - Auto' && 
          po.linkedOrderIds?.some(id => currentOrderIds.includes(id))
      );
  }, [productsToShip, purchaseOrders]);

  const handleCreatePO = async () => {
      if (productsToShip.length === 0 || isPOCreated) return;

      setLoading(true);
      try {
          const [products, configs] = await Promise.all([
              DataService.getProducts(),
              DataService.getFinancialConfigs()
          ]);
          
          const items: PurchaseOrderItem[] = productsToShip?.map(p => {
              const cleanName = p.name.replace(/^\d+\s*[xX]\s*/, '').trim().toLowerCase();
              const stockProduct = products.find(sp => {
                  const spTitle = sp.title.toLowerCase();
                  return spTitle === cleanName || cleanName.includes(spTitle) || spTitle.includes(cleanName);
              });
              
              let unitPrice = 0;
              if (stockProduct) {
                  // Get the latest config for this product
                  const productConfigs = configs
                      .filter(c => c.productId === stockProduct.id)
                      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                  
                  if (productConfigs.length > 0) {
                      unitPrice = productConfigs[0].appro;
                  } else {
                      unitPrice = stockProduct.purchasePrice || 0;
                  }
              }

              return {
                  productId: stockProduct?.id || `adhoc-${Date.now()}-${Math.random()}`,
                  productName: p.name,
                  quantity: p.quantity,
                  unitPrice: unitPrice,
                  total: unitPrice * p.quantity,
                  source: stockProduct ? 'stock' : 'adhoc'
              };
          });

          const totalAmount = items.reduce((sum, item) => sum + item.total, 0);
          
          const date = new Date();
          const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
          const count = purchaseOrders.filter(po => po.date.startsWith(date.toISOString().slice(0, 10))).length + 1;
          const poNumber = `PO-${dateStr}-${count.toString().padStart(3, '0')}`;

          const newPO: PurchaseOrder = {
              id: crypto.randomUUID(),
              number: poNumber,
              date: date.toISOString(),
              items,
              totalAmount,
              transportFees: 0,
              status: 'draft',
              createdAt: date.toISOString(),
              source: 'Expéditions Delta Transport - Auto',
              fournisseur: {
                  societe: 'Delta Transport',
                  telephone: '770000000' // Placeholder
              },
              linkedOrderIds: productsToShip.flatMap(p => p.orderIds),
              documents: []
          };

          await DataService.savePurchaseOrder(newPO);
          setPurchaseOrders(prev => [...prev, newPO]);
          setPoSuccessMessage('Bon de commande créé dans Approvisionnement ✅');
          setTimeout(() => setPoSuccessMessage(null), 5000);
      } catch (error) {
          console.error("Error creating PO:", error);
      } finally {
          setLoading(false);
      }
  };

  const handleStatusChange = async (order: Order, newStatus: string) => {
      const label = STATUS_LABELS[newStatus] || newStatus;
      const newLog: OrderLog = {
          id: Date.now().toString() + Math.random().toString(36).substring(7),
          text: `Statut changé : ${label}`,
          author: currentUser?.username || 'Admin',
          createdAt: new Date().toISOString()
      };

      const updated: Order = {
          ...order,
          status: newStatus as OrderStatus,
          logs: [...(order.logs || []), newLog]
      };
      
      // If setting to delivered or shipped, mark timestamp and deduct stock if not done
      if (newStatus === 'expedition_livree' || newStatus === 'expedition_en_cours') {
          if (newStatus === 'expedition_livree') {
              updated.deliveredAt = new Date().toISOString();
          }
          
          if (!order.sortieDepotLogged) {
              console.log(`[RegionalOrders] Auto-deducting stock for order ${order.id} (Status: ${newStatus})`);
              const allProds = await DataService.getProducts();
              const lines = order.products || (order.productDetails ? [{ name: order.productDetails, quantity: order.quantity || 1 }] : []);
              
              for (const line of lines) {
                  let nom = "";
                  let quantite = 1;
                  if (typeof line === "object" && line !== null) {
                      const l = line as any;
                      nom = (l.name || l.nom || String(l)).trim();
                      quantite = l.quantity || l.quantite || 1;
                  } else {
                      const lineStr = String(line);
                      const match = lineStr.match(/^(\d+)\s*[xX]\s*(.+)$/);
                      quantite = match ? parseInt(match[1]) : 1;
                      nom = match ? match[2].trim() : lineStr.trim();
                  }

                  const cleanNom = nom.toLowerCase();
                  const foundP = allProds.find(p => {
                      const title = p.title?.trim().toLowerCase();
                      const pId = p.id?.trim().toLowerCase();
                      return title === cleanNom || pId === cleanNom || 
                             (p.variants && p.variants.some(v => v.sku?.trim().toLowerCase() === cleanNom));
                  });

                  if (foundP) {
                      await DataService.logStockOperation({
                          entiteType: "depot",
                          entiteId: "depot_delta",
                          livreurId: "depot_delta",
                          productName: nom,
                          productId: foundP.id,
                          type: "sortie",
                          quantity: quantite,
                          source: `change_status_to_${newStatus}`,
                          date: new Date().toISOString()
                      });
                      await DataService.updateDepotStock(foundP.id, quantite, 'deduct', `status_${newStatus}`);
                  }
              }
              updated.sortieDepotLogged = true;
          }
      }

      await DataService.saveOrder(updated);
      setOrders(prev => prev?.map(o => o.id === order.id ? updated : o));
  };

  const cyclePaymentStatus = async (order: Order) => {
      const currentStatus = getPaymentStatus(order);
      let nextStatus: 'unpaid' | 'requested' | 'paid' = 'unpaid';

      // Logic: Unpaid -> Requested -> Paid -> Unpaid
      if (currentStatus === 'unpaid') {
          nextStatus = 'requested';
      } else if (currentStatus === 'requested') {
          nextStatus = 'paid';
      } else if (currentStatus === 'paid') {
          nextStatus = 'unpaid';
      }

      const actionKey = `${order.id}-pay`;

      // Require confirmation only when moving TO 'paid' (money involved)
      if (nextStatus === 'paid') {
          if (confirmAction === actionKey) {
             // Confirmed
             setConfirmAction(null);
          } else {
             // First click
             setConfirmAction(actionKey);
             return;
          }
      }

      const label = PAYMENT_LABELS[nextStatus] || nextStatus;
      const newLog: OrderLog = {
          id: Date.now().toString() + Math.random().toString(36).substring(7),
          text: `Paiement changé : ${label}`,
          author: currentUser?.username || 'Admin',
          createdAt: new Date().toISOString()
      };

      const updated: Order = {
        ...order,
        regionalPaymentStatus: nextStatus,
        isPrePaid: nextStatus === 'paid', // Keep legacy sync
        updatedAt: new Date().toISOString(), // Update timestamp for Profitability tracking
        logs: [...(order.logs || []), newLog]
      };
      
      await DataService.saveOrder(updated);
      setOrders(prev => prev?.map(o => o.id === order.id ? updated : o));
  };

  const handleDelete = async (orderId: string) => {
      const actionKey = `${orderId}-delete`;
      
      if (confirmAction === actionKey) {
          // Second click: Execute
          await DataService.deleteOrder(orderId);
          setOrders(prev => prev.filter(o => o.id !== orderId));
          setConfirmAction(null);
      } else {
          setConfirmAction(actionKey);
          setTimeout(() => setConfirmAction(null), 3000);
      }
  };

  const sendDeltaWhatsApp = (order: Order) => {
      if (!order.clientPhone) return;
      const shippingFee = order.shippingFee || 0;
      
      let productText = '';
      if (order.products && order.products.length > 0) {
          productText = order.products?.map(p => p.quantity > 1 ? `${p.quantity}x ${p.name}` : p.name).join(', ');
      } else {
          const { quantity, productName } = parseProductCommand(order.productDetails || 'Colis');
          productText = quantity > 1 ? `${quantity}x ${productName}` : productName;
      }
      
      const msg = `Bonjour ${order.clientName},\n\nVotre commande Colweyz #${order.id} est prête pour expédition via Delta Transport.\n\nProduit: ${productText}\nPrix Produit: ${order.amount} F CFA (A payer avant départ)\n\nMerci de confirmer le paiement du produit par Wave/OM.`;
      
      const url = `https://wa.me/${order.clientPhone}?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
  };

  const handleAddRemark = async () => {
      if (!remarkModalOrder || !newRemark.trim() || !currentUser) return;

      const newLog: OrderLog = {
          id: Date.now().toString(),
          text: newRemark,
          author: currentUser.username,
          createdAt: new Date().toISOString()
      };

      const existingLogs = remarkModalOrder.logs || [];
      const updatedOrder: Order = {
          ...remarkModalOrder,
          logs: [...existingLogs, newLog]
      };

      await DataService.saveOrder(updatedOrder);
      setOrders(prev => prev?.map(o => o.id === updatedOrder.id ? updatedOrder : o));
      
      setNewRemark('');
      setRemarkModalOrder(null);
  };

  const handleExportOrdersPDF = () => {
    const doc = new jsPDF();
    const dateStr = safeDateFormat(safeDateRange.startDate.toISOString()) + (safeDateRange.startDate.getTime() !== safeDateRange.endDate.getTime() ? ' au ' + safeDateFormat(safeDateRange.endDate.toISOString()) : '');
    const title = `Commandes Delta - ${dateStr}`;
    doc.setFontSize(18);
    doc.text(title, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Filtres: Statut=${statusFilter}, Paiement=${paymentFilter}`, 14, 30);

    const tableData = sortedOrders.map(o => {
        let details = 'Non spécifié';
        if (o.products && o.products.length > 0) {
            details = o.products.map(p => `${p.quantity} X ${p.name}`).join('\n');
        } else if (o.productDetails) {
            details = o.productDetails.split('\n').map(line => {
                const { quantity, productName } = parseProductCommand(line);
                return `${quantity} X ${productName}`;
            }).join('\n');
        }

        const shippingNote = o.shippingRemarks || '';

        return [
            o.clientName,
            o.clientPhone || '',
            o.address || '',
            details,
            shippingNote
        ];
    });

    autoTable(doc, {
        startY: 35,
        head: [['Client', 'Téléphone', 'Adresse', 'Détail', 'Note Expédition']],
        body: tableData,
        styles: { cellPadding: 3, fontSize: 8 },
        columnStyles: {
            3: { cellWidth: 40 }, // Detail
            4: { cellWidth: 40 }  // Shipping Note
        }
    });

    doc.save(`commandes_delta_${format(safeDateRange.startDate, 'yyyy-MM-dd')}.pdf`);
  };

  const handleExportExpeditionPDF = () => {
    const doc = new jsPDF();
    const dateStr = safeDateFormat(safeDateRange.startDate.toISOString()) + (safeDateRange.startDate.getTime() !== safeDateRange.endDate.getTime() ? ' au ' + safeDateFormat(safeDateRange.endDate.toISOString()) : '');
    const title = `Produits à Expédier - ${dateStr}`;
    doc.setFontSize(18);
    doc.text(title, 14, 22);

    const tableData = productsToShip.map(p => {
        return [
            p.name,
            p.quantity,
            p.orderIds.join(', ')
        ];
    });

    autoTable(doc, {
        startY: 30,
        head: [['Produit', 'Quantité', 'Commandes']],
        body: tableData,
        styles: { cellPadding: 3, fontSize: 8 }
    });

    doc.save(`expedition_delta_${format(safeDateRange.startDate, 'yyyy-MM-dd')}.pdf`);
  };

  const handleExportStockPDF = () => {
    const doc = new jsPDF();
    const dateStr = safeDateFormat(safeDateRange.startDate.toISOString()) + (safeDateRange.startDate.getTime() !== safeDateRange.endDate.getTime() ? ' au ' + safeDateFormat(safeDateRange.endDate.toISOString()) : '');
    const title = `État Stock Dépôt Delta - ${dateStr}`;
    doc.setFontSize(18);
    doc.text(title, 14, 22);

    const tableData = stockDepot.map(s => [
        s.nom,
        s.si,
        s.entrees,
        s.sorties,
        s.sf
    ]);

    autoTable(doc, {
        startY: 30,
        head: [['Produit', 'Stock Début', 'Entrées', 'Sorties', 'Stock Fin']],
        body: tableData,
    });

    doc.save(`stock_depot_delta_${format(safeDateRange.startDate, 'yyyy-MM-dd')}.pdf`);
  };

  const startAdjustingSF = (id: string, currentSF: number) => {
    setAdjustingSFId(id);
    setEditSFValue(currentSF);
  };

  const handleAdjustDepotSF = async (produitId: string, produitNom: string, currentSFBrut: number, ajustementManuel: number) => {
    const currentSF = currentSFBrut + ajustementManuel;
    const diff = editSFValue - currentSF;
    if (diff === 0) {
      setAdjustingSFId(null);
      return;
    }

    const DEPOT_ID = 'depot_delta';
    
    try {
      // 1. Log adjustment operation
      await DataService.logStockOperation({
        date: new Date().toISOString(),
        productId: produitId,
        productName: produitNom,
        type: 'si_ajustement',
        quantity: diff,
        livreurId: DEPOT_ID,
        entiteType: 'depot',
        entiteId: DEPOT_ID,
        source: 'ajustement_manuel_quick',
        notes: `Ajustement rapide Delta: ${currentSF} -> ${editSFValue}`
      });

      // 2. Update via DataService
      await DataService.updateLivreurStockSF(DEPOT_ID, produitId, editSFValue, 'Ajustement rapide table', currentUser?.id || 'unknown');
      
      setAdjustingSFId(null);
      alert('Stock dépôt ajusté avec succès !');
    } catch (error) {
      console.error('Error adjusting depot stock:', error);
      alert('Erreur lors de l\'ajustement.');
    }
  };

  const handleGlobalAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[RegionalOrders] handleGlobalAdjustmentSubmit started', adjustmentForm);
    if (!adjustmentForm.productId || !adjustmentForm.reason) {
      alert('Veuillez remplir tous les champs obligatoires.');
      return;
    }

    setIsSubmittingAdjustment(true);
    try {
      const product = products.find(p => p.id === adjustmentForm.productId);
      if (!product) {
        console.error('[RegionalOrders] Product not found in state:', adjustmentForm.productId);
        throw new Error('Produit non trouvé');
      }

      let oldQty = 0;
      let targetName = 'Stock Global';

      console.log('[RegionalOrders] Target:', adjustmentForm.targetId);
      if (adjustmentForm.targetId === 'global') {
        oldQty = (product.stockGlobal?.si || 0) + (product.stockGlobal?.entrees || 0) - (product.stockGlobal?.sorties || 0) + (product.stockGlobal?.ajustementManuel || 0);
        console.log('[RegionalOrders] Adjusting Global Stock. Old Qty (Adjusted):', oldQty);
        await DataService.updateGlobalStockSF(product.id, adjustmentForm.newQty, adjustmentForm.reason, currentUser?.id || 'unknown');
      } else {
        const driver = drivers.find(d => d.id === adjustmentForm.targetId);
        const isDepot = adjustmentForm.targetId === DEPOT_ID;
        targetName = isDepot ? 'Dépôt Delta' : (driver?.name || 'Inconnu');
        
        const entry = stockLivreurs.find(e => e.livreurId === adjustmentForm.targetId && e.produitId === product.id);
        oldQty = (entry?.SI || 0) + (entry?.entrees || 0) - (entry?.sorties || 0) + (entry?.ajustementManuel || 0);
        console.log(`[RegionalOrders] Adjusting ${targetName} Stock. Old Qty (Adjusted):`, oldQty);
        await DataService.updateLivreurStockSF(adjustmentForm.targetId, product.id, adjustmentForm.newQty, adjustmentForm.reason, currentUser?.id || 'unknown');
      }

      console.log('[RegionalOrders] Logging adjustment...');
      // Log in logs_ajustements
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

      console.log('[RegionalOrders] Logging stock operation...');
      // Also log as a stock operation for SI/SF consistency
      await DataService.logStockOperation({
        date: new Date().toISOString(),
        productId: product.id,
        productName: product.title,
        type: 'si_ajustement',
        quantity: adjustmentForm.newQty - oldQty,
        livreurId: adjustmentForm.targetId === 'global' ? undefined : adjustmentForm.targetId,
        entiteType: adjustmentForm.targetId === 'global' ? 'global' : (adjustmentForm.targetId === DEPOT_ID ? 'depot' : 'livreur'),
        entiteId: adjustmentForm.targetId === 'global' ? undefined : adjustmentForm.targetId,
        source: 'ajustement_superadmin',
        referenceId: adjustmentForm.reason,
        notes: `Ajustement SuperAdmin (${targetName}): ${oldQty} -> ${adjustmentForm.newQty}. Motif: ${adjustmentForm.reason}`
      });

      console.log('[RegionalOrders] Adjustment successful');
      alert('Stock ajusté avec succès !');
      setShowGlobalAdjustmentModal(false);
      setAdjustmentForm({ productId: '', targetId: DEPOT_ID, newQty: 0, reason: '' });
    } catch (error) {
      console.error('[RegionalOrders] Error adjusting stock:', error);
      alert('Erreur lors de l\'ajustement du stock.');
    } finally {
      setIsSubmittingAdjustment(false);
    }
  };

  const handleScheduleOrder = async () => {
    if (!scheduleModalOrder || !currentUser) return;
    
    const updatedOrder: Order = {
        ...scheduleModalOrder,
        scheduledAt: scheduledDate,
        logs: [
            ...(scheduleModalOrder.logs || []),
            {
                id: Date.now().toString(),
                text: `Commande programmée pour le ${new Date(scheduledDate).toLocaleString()}`,
                author: currentUser.username,
                createdAt: new Date().toISOString()
            }
        ]
    };

    try {
        await DataService.saveOrder(updatedOrder);
        setOrders(prev => prev.map(o => o.id === scheduleModalOrder.id ? updatedOrder : o));
        setScheduleModalOrder(null);
    } catch (e) {
        console.error("Error scheduling order:", e);
        alert("Erreur lors de la programmation.");
    }
  };

  const safeDateFormat = (dateStr: string) => {
      if (!dateStr) return "-";
      // Handle simple YYYY-MM-DD
      if (dateStr.length === 10 && dateStr.includes('-')) return dateStr;
      // Handle ISO
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
      switch(status) {
          case 'expedition_livree': return 'bg-green-100 text-green-800 border-green-200';
          case 'expedition_en_cours': return 'bg-blue-100 text-blue-800 border-blue-200';
          case 'regional_contacte': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
          case 'regional_relance': return 'bg-cyan-100 text-cyan-800 border-cyan-200';
          case 'regional_prete': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
          case 'regional_injoignable': return 'bg-orange-100 text-orange-800 border-orange-200';
          case 'regional_injoignable_x2': return 'bg-orange-200 text-orange-900 border-orange-300';
          case 'regional_injoignable_x3': return 'bg-orange-300 text-orange-950 border-orange-400 font-bold';
          case 'regional_annule': return 'bg-red-100 text-red-800 border-red-200';
          case 'regional_reporte': return 'bg-purple-100 text-purple-800 border-purple-200';
          case 'regional_en_attente': return 'bg-gray-100 text-gray-800 border-gray-200';
          default: return 'bg-gray-100 text-gray-800';
      }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Chargement Delta Transport...</div>;

  return (
    <div className="space-y-6 pb-20">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-2">
            <div className="flex items-center space-x-3">
                <div className="bg-blue-100 p-2 sm:p-3 rounded-full text-blue-600 flex-shrink-0">
                    <Truck size={24} className="sm:w-7 sm:h-7" />
                </div>
                <div className="min-w-0">
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-800 truncate">Expéditions (Delta Transport)</h2>
                    <p className="text-gray-500 text-xs sm:text-sm truncate">Gestion des commandes en régions.</p>
                </div>
            </div>
            
            <div className="flex items-center flex-wrap gap-2">
                <button 
                    onClick={handleExportOrdersPDF}
                    className="bg-white border border-gray-200 text-gray-700 px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-50 transition-colors shadow-sm text-xs sm:text-sm"
                    title="Exporter les commandes filtrées en PDF"
                >
                    <Download size={16} />
                    <span>PDF</span>
                </button>

                {/* Date Filter */}
                <div className="min-w-[140px] sm:min-w-[180px]">
                    <DateRangePicker 
                        dateRange={safeDateRange}
                        onUpdate={setDateRange}
                        align="right"
                        className="w-full"
                    />
                </div>

                {/* Status Filter */}
                <div className="min-w-[140px]">
                    <select 
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs sm:text-sm focus:ring-blue-500 focus:border-blue-500 bg-white"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">Tous les statuts</option>
                        <option value="regional_en_attente">En attente</option>
                        <option value="regional_contacte">Contacté</option>
                        <option value="regional_prete">Prête</option>
                        <option value="expedition_en_cours">Expédié</option>
                        <option value="regional_injoignable">Injoignable</option>
                        <option value="regional_reporte">Reporté</option>
                        <option value="expedition_livree">Livré</option>
                        <option value="regional_annule">Annulé</option>
                    </select>
                </div>
            </div>
        </div>

        {/* État du Stock Dépôt Delta */}
        <div className="bg-white rounded-xl shadow-sm border border-indigo-100 overflow-hidden mb-6">
            <div className="bg-indigo-50 px-6 py-3 border-b border-indigo-100 flex justify-between items-center">
                <h3 className="text-sm font-bold text-indigo-900 flex items-center">
                    <Box className="mr-2" size={16} />
                    📦 État du Stock Dépôt Delta
                </h3>
                <div className="flex items-center gap-3">
                    {(currentUser?.role === 'super_admin' || currentUser?.role === 'responsable') && (
                        <button 
                            onClick={() => setShowGlobalAdjustmentModal(true)}
                            className="bg-orange-600 text-white px-3 py-1 rounded-lg flex items-center gap-1.5 hover:bg-orange-700 transition-colors shadow-sm text-[10px] font-bold"
                        >
                            <RefreshCw size={12} />
                            Ajuster le stock
                        </button>
                    )}
                    <button 
                        onClick={handleExportStockPDF}
                        className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-xs font-bold"
                    >
                        <Download size={14} />
                        PDF
                    </button>
                </div>
            </div>
            <div className="p-0 overflow-x-auto">
                <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 text-gray-600 uppercase font-semibold">
                        <tr>
                            <th className="px-6 py-2">PRODUIT</th>
                            <th className="px-6 py-2 text-center text-blue-600">Stock Début</th>
                            <th className="px-6 py-2 text-center">ENTRÉES</th>
                            <th className="px-6 py-2 text-center">SORTIES</th>
                            <th className="px-6 py-2 text-center text-blue-600">Stock Fin</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {stockDepot.length > 0 ? (
                            stockDepot.map((s, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                    <td className="px-6 py-2 font-medium text-gray-900">{s.nom}</td>
                                    <td className="px-6 py-2 text-center text-gray-600">{s.si}</td>
                                    <td className="px-6 py-2 text-center text-green-600 font-medium">+{s.entrees}</td>
                                    <td className="px-6 py-2 text-center text-red-600 font-medium">-{s.sorties}</td>
                                    <td className="px-6 py-2 text-center">
                                        {adjustingSFId === s.produitId ? (
                                            <div className="flex items-center justify-center gap-2">
                                                <input 
                                                    type="number" 
                                                    className="w-16 border rounded px-1 py-0.5 text-xs text-center focus:ring-1 focus:ring-indigo-500 outline-none"
                                                    value={editSFValue}
                                                    onChange={e => setEditSFValue(parseInt(e.target.value) || 0)}
                                                    autoFocus
                                                />
                                                <button onClick={() => handleAdjustDepotSF(s.produitId, s.nom, s.sf, s.ajustementManuel || 0)} className="text-green-600 hover:text-green-800 text-[10px] font-bold">OK</button>
                                                <button onClick={() => setAdjustingSFId(null)} className="text-gray-400 hover:text-gray-600 text-[10px] font-bold">X</button>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center">
                                                <span className={`font-bold ${s.sf < 0 ? 'text-red-600' : (s.ajustementManuel !== 0 ? 'text-blue-600' : 'text-indigo-700')}`}>
                                                    {s.sf}
                                                </span>
                                                {(currentUser?.role === 'super_admin' || currentUser?.role === 'responsable') && (
                                                    <button 
                                                        onClick={() => startAdjustingSF(s.produitId, s.sf)}
                                                        className="text-[9px] text-gray-400 hover:text-indigo-600 underline"
                                                    >
                                                        Ajuster
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={5} className="px-6 py-4 text-center text-gray-500 italic">
                                    Aucun produit dans le dépôt pour cette date.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Produits à Expédier Section */}
        {productsToShip.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-indigo-100 overflow-hidden mb-6">
                <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <h3 className="text-lg font-bold text-indigo-900 flex items-center">
                        <Package className="mr-2" size={20} />
                        Produits à Expédier
                    </h3>
                    <div className="flex flex-col sm:flex-row items-center gap-2">
                        {poSuccessMessage && (
                            <div className="text-sm font-medium text-green-700 bg-green-100 px-3 py-1.5 rounded-lg flex items-center">
                                {poSuccessMessage}
                                <Link to="/procurement" className="ml-2 underline hover:text-green-800">Voir le bon →</Link>
                            </div>
                        )}
                        {successMessage && (
                            <div className="text-sm font-medium text-green-700 bg-green-100 px-3 py-1.5 rounded-lg flex items-center">
                                {successMessage}
                            </div>
                        )}
                        {errorMessage && (
                            <div className="text-sm font-medium text-red-700 bg-red-100 px-3 py-1.5 rounded-lg flex items-center">
                                <AlertCircle className="mr-2" size={16} />
                                {errorMessage}
                            </div>
                        )}
                        <button
                            onClick={handleExportExpeditionPDF}
                            className="flex items-center px-4 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 transition-colors shadow-sm font-bold text-sm"
                        >
                            <Download className="mr-2" size={16} />
                            PDF
                        </button>
                        <button
                            onClick={() => setShowExpedierModal(true)}
                            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-bold text-sm"
                        >
                            <Send className="mr-2" size={16} />
                            Confirmer l'Expédition
                        </button>
                    </div>
                </div>
                <div className="p-0">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs font-semibold">
                            <tr>
                                <th className="px-6 py-3">Produit</th>
                                <th className="px-6 py-3 text-center">Quantité Totale</th>
                                <th className="px-6 py-3">Commandes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {productsToShip?.map((p, i) => (
                                <tr key={i} className="hover:bg-gray-50">
                                    <td className="px-6 py-3 font-medium text-gray-900">{p.name}</td>
                                    <td className="px-6 py-3 text-center font-bold text-indigo-600 text-lg">{p.quantity}</td>
                                    <td className="px-6 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {p.orderIds?.map(id => (
                                                <span key={id} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 cursor-pointer hover:bg-gray-200 transition-colors" title="Voir la commande">
                                                    #{id}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            <tr className="bg-indigo-50/30 font-bold border-t-2 border-indigo-100">
                                <td className="px-6 py-4 text-indigo-900 text-right">TOTAL</td>
                                <td className="px-6 py-4 text-center text-indigo-700 text-xl">{totalProductsToShip}</td>
                                <td className="px-6 py-4"></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {/* Payment Tabs */}
        <div className="flex flex-wrap gap-3 mb-6">
            <button
                onClick={() => setPaymentFilter('all')}
                className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                    paymentFilter === 'all' 
                    ? 'bg-gray-800 text-white shadow-md' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
            >
                <span>Tous</span>
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${paymentFilter === 'all' ? 'bg-white text-gray-800' : 'bg-gray-200 text-gray-700'}`}>
                    {counts.all}
                </span>
            </button>
            <button
                onClick={() => setPaymentFilter('unpaid')}
                className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                    paymentFilter === 'unpaid' 
                    ? 'bg-red-600 text-white shadow-md' 
                    : 'bg-red-50 text-red-600 hover:bg-red-100'
                }`}
            >
                <span>Non payé</span>
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${paymentFilter === 'unpaid' ? 'bg-white text-red-600' : 'bg-red-100 text-red-700'}`}>
                    {counts.unpaid}
                </span>
            </button>
            <button
                onClick={() => setPaymentFilter('requested')}
                className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                    paymentFilter === 'requested' 
                    ? 'bg-orange-500 text-white shadow-md' 
                    : 'bg-orange-50 text-orange-600 hover:bg-orange-100'
                }`}
            >
                <span>Demandé</span>
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${paymentFilter === 'requested' ? 'bg-white text-orange-600' : 'bg-orange-100 text-orange-700'}`}>
                    {counts.requested}
                </span>
            </button>
            <button
                onClick={() => setPaymentFilter('paid')}
                className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                    paymentFilter === 'paid' 
                    ? 'bg-green-600 text-white shadow-md' 
                    : 'bg-green-50 text-green-600 hover:bg-green-100'
                }`}
            >
                <span>Payé</span>
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${paymentFilter === 'paid' ? 'bg-white text-green-600' : 'bg-green-100 text-green-700'}`}>
                    {counts.paid}
                </span>
            </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-blue-50 text-blue-800 uppercase text-xs font-semibold">
                        <tr>
                            <th className="px-6 py-4">ID</th>
                            <th className="px-6 py-4">Date</th>
                            <th className="px-6 py-4">Client</th>
                            <th className="px-6 py-4">Commande</th>
                            <th className="px-6 py-4">Transport</th>
                            <th className="px-6 py-4 text-center">Paiement Produit</th>
                            <th className="px-6 py-4">Statut & Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {sortedOrders.length === 0 ? (
                            <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">Aucune expédition en cours.</td></tr>
                        ) : (
                            sortedOrders?.map(order => {
                                const paymentStatus = getPaymentStatus(order);
                                return (
                                <tr key={order.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-gray-900">#{order.id}</div>
                                    </td>
                                    
                                    <td className="px-6 py-4">
                                        <div className="flex items-center text-gray-600">
                                            <Calendar size={14} className="mr-1.5 opacity-50" />
                                            {safeDateFormat(order.assignedAt || order.date)}
                                        </div>
                                    </td>
                                    
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-gray-900">{order.clientName}</div>
                                        <div className="text-xs text-gray-500 mb-1">{order.address}</div>
                                        {order.clientPhone && <div className="text-xs font-bold text-gray-700 mb-1">{order.clientPhone}</div>}
                                        
                                        <div className="flex flex-col gap-1 mt-1">
                                            {order.logs && order.logs.length > 0 && (
                                                <div className="text-[10px] bg-yellow-50 text-yellow-800 p-1.5 rounded border border-yellow-100 group relative">
                                                    <span className="font-bold">
                                                        {new Date(order.logs[order.logs.length - 1].createdAt).toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'}).replace(':', 'H')}, {order.logs[order.logs.length - 1].author},
                                                    </span> {order.logs[order.logs.length - 1].text}
                                                </div>
                                            )}
                                            
                                            <div className="flex flex-col gap-1">
                                                {editingShippingOrderId === order.id ? (
                                                    <div className="flex items-center gap-1 mt-1">
                                                        <input 
                                                            type="text"
                                                            className="text-[10px] border rounded px-1 py-0.5 w-full focus:ring-1 focus:ring-blue-500 outline-none"
                                                            value={editShippingValue}
                                                            onChange={e => setEditShippingValue(e.target.value)}
                                                            autoFocus
                                                            onKeyDown={e => e.key === 'Enter' && handleSaveShippingRemark(order)}
                                                        />
                                                        <button 
                                                            onClick={() => handleSaveShippingRemark(order)}
                                                            className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-bold"
                                                        >
                                                            OK
                                                        </button>
                                                        <button 
                                                            onClick={() => setEditingShippingOrderId(null)}
                                                            className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-bold"
                                                        >
                                                            X
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <button 
                                                            onClick={() => setRemarkModalOrder(order)}
                                                            className="text-[10px] text-blue-600 hover:underline flex items-center"
                                                        >
                                                            <Plus size={10} className="mr-1" /> Remarque
                                                        </button>

                                                        <button 
                                                            onClick={() => {
                                                                setEditingShippingOrderId(order.id);
                                                                setEditShippingValue(order.shippingRemarks || '');
                                                            }}
                                                            className="text-[10px] text-indigo-600 hover:underline flex items-center"
                                                            title="Modifier la note d'expédition"
                                                        >
                                                            <Edit2 size={10} className="mr-1" /> Expédition
                                                        </button>

                                                        {order.logs && order.logs.length > 1 && (
                                                            <button 
                                                                onClick={() => setRemarkModalOrder(order)}
                                                                className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200"
                                                                title="Voir tout l'historique"
                                                            >
                                                                <ChevronDown size={10} className="mr-1" /> 
                                                                Voir tout ({order.logs.length})
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>

                                    <td className="px-6 py-4 bg-blue-50/30">
                                        <div className="flex items-start">
                                            <Package size={16} className="text-blue-400 mr-2 mt-0.5" />
                                            <div>
                                                <div className="text-sm font-medium text-gray-900 max-w-[200px] whitespace-pre-wrap">
                                                    {order.products && order.products.length > 0 ? order.products?.map((p, i) => (
                                                        <div key={i}><span className="font-bold text-green-700">({p.quantity} X)</span> {p.name}</div>
                                                    )) : order.productDetails ? order.productDetails.split('\n')?.map((line, i) => {
                                                        const { quantity, productName } = parseProductCommand(line);
                                                        return <div key={i}><span className="font-bold text-green-700">({quantity} X)</span> {productName}</div>;
                                                    }) : 'Non spécifié'}
                                                </div>
                                                <div className="mt-1 text-xs font-bold text-green-700 bg-green-50 inline-block px-1.5 py-0.5 rounded border border-green-100">
                                                    {formatFCFA(order.amount)}
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    <td className="px-6 py-4">
                                        <select 
                                            className="border rounded px-2 py-1 text-xs w-full mb-1"
                                            value={order.zoneId || ''}
                                            onChange={(e) => handleUpdateZone(order, e.target.value)}
                                        >
                                            <option value="">-- Zone --</option>
                                            {zones?.map(z => (
                                                <option key={z.id} value={z.id}>{z.name} ({formatFCFA(z.rate)})</option>
                                            ))}
                                        </select>
                                        {!order.shippingFee && (
                                            <div className="text-xs text-red-400 mt-1 flex items-center">
                                                <AlertCircle size={10} className="mr-1" /> À définir
                                            </div>
                                        )}
                                    </td>

                                    <td className="px-6 py-4 text-center">
                                        <button 
                                            onClick={() => cyclePaymentStatus(order)}
                                            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-sm ${
                                                paymentStatus === 'paid'
                                                ? 'bg-green-100 text-green-700 border-green-200'
                                                : paymentStatus === 'requested'
                                                    ? confirmAction === `${order.id}-pay` 
                                                        ? 'bg-orange-100 text-orange-700 border-orange-300 ring-2 ring-orange-200' // Confirming transition to paid
                                                        : 'bg-orange-50 text-orange-600 border-orange-200' 
                                                    : 'bg-white text-gray-400 border-gray-200 hover:border-blue-300'
                                            }`}
                                        >
                                            {paymentStatus === 'paid' ? (
                                                <><CheckCircle size={14} className="mr-1.5" /> Payé</>
                                            ) : paymentStatus === 'requested' ? (
                                                confirmAction === `${order.id}-pay` ? (
                                                    <><AlertTriangle size={14} className="mr-1.5" /> Confirmer ?</>
                                                ) : (
                                                    <><Clock size={14} className="mr-1.5" /> Demandé</>
                                                )
                                            ) : (
                                                <><DollarSign size={14} className="mr-1.5" /> Non Payé</>
                                            )}
                                        </button>
                                    </td>

                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-2">
                                            <select 
                                                className={`border rounded px-2 py-1.5 text-xs font-bold w-full ${getStatusColor(order.status)}`}
                                                value={order.status}
                                                onChange={(e) => handleStatusChange(order, e.target.value)}
                                            >
                                                <option value="regional_en_attente">En attente</option>
                                                <option value="regional_contacte">Contacté</option>
                                                <option value="regional_relance">Relancé</option>
                                                <option value="regional_prete">Prête</option>
                                                <option value="expedition_en_cours">Expédié</option>
                                                <option value="regional_injoignable">Injoignable</option>
                                                <option value="regional_injoignable_x2">Injoignable X2</option>
                                                <option value="regional_injoignable_x3">Injoignable X3</option>
                                                <option value="regional_reporte">Reporté</option>
                                                <option value="expedition_livree">Livré</option>
                                                <option value="regional_annule">Annulé</option>
                                            </select>

                                            <div className="flex justify-end gap-2 mt-1">
                                                {order.clientPhone && (
                                                    <>
                                                        <a 
                                                            href={`tel:${order.clientPhone}`}
                                                            className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                                                            title="Appeler"
                                                        >
                                                            <Phone size={16} />
                                                        </a>
                                                        <button 
                                                            onClick={() => sendDeltaWhatsApp(order)}
                                                            className="p-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 border border-green-100"
                                                            title="WhatsApp Paiement"
                                                        >
                                                            <Send size={16} />
                                                        </button>
                                                        <button 
                                                            onClick={() => {
                                                                setScheduleModalOrder(order);
                                                                setScheduledDate(new Date().toISOString().slice(0, 16));
                                                            }}
                                                            className="p-2 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 border border-purple-100"
                                                            title="Programmer pour plus tard"
                                                        >
                                                            <CalendarClock size={16} />
                                                        </button>
                                                    </>
                                                )}
                                                
                                                {currentUser?.role === 'super_admin' || currentUser?.role === 'responsable' ? (
                                                    <button 
                                                        onClick={() => handleDelete(order.id)}
                                                        className={`p-2 rounded-lg transition-colors ${
                                                            confirmAction === `${order.id}-delete`
                                                            ? 'bg-red-600 text-white'
                                                            : 'bg-white text-gray-300 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100'
                                                        }`}
                                                        title="Supprimer"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            );
                        }))}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Remark Modal */}

        {remarkModalOrder && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">Ajouter une remarque</h3>
                    <p className="text-sm text-gray-500 mb-2">Commande #{remarkModalOrder.id} - {remarkModalOrder.clientName}</p>
                    
                    <textarea 
                        className="w-full border rounded-lg p-3 text-sm h-32 mb-4"
                        placeholder="Ex: Client injoignable à 14h, rappelé à 16h..."
                        value={newRemark}
                        onChange={e => setNewRemark(e.target.value)}
                    ></textarea>

                    <div className="flex gap-2">
                        <button 
                            onClick={() => setRemarkModalOrder(null)}
                            className="flex-1 py-2 text-gray-500 font-medium hover:bg-gray-100 rounded-lg"
                        >
                            Annuler
                        </button>
                        <button 
                            onClick={handleAddRemark}
                            className="flex-1 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
                        >
                            Enregistrer
                        </button>
                    </div>

                    {/* History */}
                    <div className="mt-4 pt-4 border-t border-gray-100 max-h-60 overflow-y-auto">
                        <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Historique</h4>
                        {(() => {
                            const sortedLogs = [...(remarkModalOrder.logs || [])].reverse();
                            const displayLogs = showAllLogs ? sortedLogs : sortedLogs.slice(0, 3);
                            return displayLogs?.map(log => (
                                <div key={log.id} className="text-xs mb-2 pb-2 border-b border-gray-50 last:border-0">
                                    <div className="text-gray-700">
                                        <span className="font-bold text-gray-500">
                                            {new Date(log.createdAt).toLocaleTimeString('fr-FR', {hour: '2-digit', minute:'2-digit'}).replace(':', 'H')}, {log.author},
                                        </span> {log.text}
                                    </div>
                                </div>
                            ));
                        })()}
                        
                        {!showAllLogs && (remarkModalOrder.logs?.length || 0) > 3 && (
                            <button 
                                onClick={() => setShowAllLogs(true)}
                                className="w-full text-center text-xs text-blue-600 font-medium py-1 hover:bg-blue-50 rounded"
                            >
                                Afficher la suite ({remarkModalOrder.logs!.length - 3} de plus)
                            </button>
                        )}
                    </div>
                </div>
            </div>
        )}
        {/* Global Adjustment Modal */}
        {showGlobalAdjustmentModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
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

        {/* Modal Expédier */}
        {showExpedierModal && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                    <div className="bg-indigo-600 px-6 py-4 flex items-center justify-between">
                        <h3 className="text-xl font-bold text-white flex items-center">
                            <Send className="mr-2" size={24} />
                            Confirmer l'Expédition
                        </h3>
                        <button onClick={() => setShowExpedierModal(false)} className="text-indigo-100 hover:text-white transition-colors">
                            <X size={24} />
                        </button>
                    </div>
                    <div className="p-6">
                        {errorMessage && (
                            <div className="bg-red-50 border border-red-100 text-red-700 p-4 rounded-xl mb-6 flex items-start">
                                <AlertCircle className="mr-2 mt-0.5 shrink-0" size={18} />
                                <div className="text-sm font-medium">{errorMessage}</div>
                            </div>
                        )}
                        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100 mb-6">
                            <p className="text-indigo-900 font-medium mb-2">
                                Vous allez expédier <span className="font-bold">{totalProductsToShip} produits</span> pour <span className="font-bold">{baseFilteredOrders.filter(o => ['regional_prete', 'Prête', 'prete', 'ready'].includes(o.status as string)).length} commandes</span>.
                            </p>
                            <p className="text-indigo-700 text-sm">
                                Cette action va :
                            </p>
                            <ul className="text-indigo-700 text-sm list-disc list-inside mt-2 space-y-1">
                                <li>Enregistrer les sorties de stock du Dépôt Delta</li>
                                <li>Passer les commandes au statut "Expédié"</li>
                            </ul>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowExpedierModal(false)}
                                className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                                disabled={isExpediting}
                            >
                                Annuler
                            </button>
                            <button
                                onClick={handleFinalizeExpedier}
                                className="flex-2 px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center disabled:opacity-50"
                                disabled={isExpediting}
                            >
                                {isExpediting ? (
                                    <>
                                        <Clock className="animate-spin mr-2" size={20} />
                                        Traitement...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="mr-2" size={20} />
                                        Confirmer & Expédier
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        {/* Schedule Modal */}
        {scheduleModalOrder && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                    <div className="flex items-center gap-2 mb-4 text-purple-600">
                        <CalendarClock size={24} />
                        <h3 className="text-lg font-bold text-gray-800">Programmer la commande</h3>
                    </div>
                    
                    <p className="text-sm text-gray-500 mb-4">
                        Commande #{scheduleModalOrder.id} - {scheduleModalOrder.clientName}
                    </p>

                    <div className="mb-6">
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Date et heure de livraison</label>
                        <input 
                            type="datetime-local" 
                            className="w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-purple-200 outline-none"
                            value={scheduledDate}
                            onChange={e => setScheduledDate(e.target.value)}
                        />
                    </div>

                    <div className="flex gap-2">
                        <button 
                            onClick={() => setScheduleModalOrder(null)}
                            className="flex-1 py-2 text-gray-500 font-medium hover:bg-gray-100 rounded-lg"
                        >
                            Annuler
                        </button>
                        <button 
                            onClick={handleScheduleOrder}
                            className="flex-1 py-2 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 shadow-md"
                        >
                            Programmer
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};
