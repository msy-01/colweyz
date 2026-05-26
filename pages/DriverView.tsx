
import React, { useState, useEffect, useMemo } from 'react';
import { format, parseISO, isSameDay, isBefore, isValid, parse } from 'date-fns';
import { Driver, Order, FundRequest, Product } from '../types';
import { DataService, DEPOT_ID } from '../services/dataService';
import { formatNumber, formatFCFA } from '../utils/formatters';
import { InvoiceService } from '../services/invoiceService';
import { parseProductCommand } from '../utils/productParser';
import { Truck, MapPin, CheckCircle, Phone, Package, XCircle, PlayCircle, Clock, Loader, LogOut, Power, Wallet, CreditCard, Edit2, Calendar, AlertCircle, UserX, UserMinus, FileText, HandCoins, ExternalLink, Check, PhoneOff, CalendarClock, RotateCcw, ArrowRightLeft, TrendingUp, ArrowDownLeft, ArrowUpRight, Filter, RefreshCw } from 'lucide-react';

interface DriverViewProps {
  driver: Driver;
  onLogout?: () => void;
}

export const DriverView: React.FC<DriverViewProps> = ({ driver: initialDriver, onLogout }) => {
  const [driver, setDriver] = useState<Driver>(initialDriver);
  const [driverId, setDriverId] = useState<string>(initialDriver.id); // The simple ID used for filtering
  const [orders, setOrders] = useState<Order[]>([]);
  const [allFundRequests, setAllFundRequests] = useState<FundRequest[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [driverStock, setDriverStock] = useState<any[]>([]);
  const [stockOperations, setStockOperations] = useState<any[]>([]);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>(new Date().toLocaleTimeString());
  const [activeTab, setActiveTab] = useState<'todo' | 'unreachable' | 'done' | 'balance' | 'stock'>('todo');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [donePaymentFilter, setDonePaymentFilter] = useState<'all' | 'cash' | 'wave' | 'om'>('all');
  const [isSyncingDriver, setIsSyncingDriver] = useState(true); // Loading state for driver sync
  
  // Status State
  const [currentStatus, setCurrentStatus] = useState<'disponible' | 'occupé'>(driver.status);
  
  // Settings State
  const [adminPhone, setAdminPhone] = useState<string>('221770000000'); // Fallback

  // Sync/Link Driver Logic
  useEffect(() => {
    const syncDriver = async () => {
        try {
            const drivers = await DataService.getDrivers();
            
            // Find by phone (most reliable link)
            let current = drivers.find(d => d.phone === driver.phone);
            
            if (!current) {
                current = initialDriver;
            }

            // Normalize ID for Mouhamed/Aliou if needed
            let finalId = current.id;
            const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
            
            if (!finalId || finalId.startsWith('drv-')) {
                if (current.name.toLowerCase().includes('mouhamed') || current.name.toLowerCase().includes('aliou')) {
                    finalId = normalize(current.name);
                }
            }

            let needsUpdate = false;
            const updateData: Partial<Driver> = {};

            if (finalId !== current.id) {
                updateData.id = finalId;
                needsUpdate = true;
            }

            if (needsUpdate) {
                const updatedDriver = { ...current, ...updateData };
                await DataService.saveDriver(updatedDriver);
                setDriver(updatedDriver);
                setDriverId(finalId);
            } else {
                setDriver(current);
                setDriverId(finalId);
            }
        } catch (e) {
            console.error("DriverView: Error syncing driver:", e);
        } finally {
            setIsSyncingDriver(false);
        }
    };

    syncDriver();
  }, [driver.phone, initialDriver]);

  // UI States for interactions
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  // Confirmation states
  const [confirmActionId, setConfirmActionId] = useState<string | null>(null); 
  const [confirmType, setConfirmType] = useState<'deliver' | 'cancel_options' | 'cancel_client' | 'refuse_driver' | 'accept' | 'edit' | 'undo' | null>(null);
  const [commandeEnPaiement, setCommandeEnPaiement] = useState<string | null>(null);
  
  // Fund Request Decline Confirmation
  const [declineConfirmId, setDeclineConfirmId] = useState<string | null>(null);

  // Debug Message
  const [debugMsg, setDebugMsg] = useState<string | null>(null);

  // Postpone Modal State
  const [postponeOrderId, setPostponeOrderId] = useState<string | null>(null);
  const [postponeDate, setPostponeDate] = useState('');
  const [postponeTime, setPostponeTime] = useState('');

  // Sync status if prop changes
  useEffect(() => {
    setCurrentStatus(driver.status);
  }, [driver.status]);

  // Load Admin Phone
  useEffect(() => {
      DataService.getSettings().then(settings => {
          if (settings.adminPhone) setAdminPhone(settings.adminPhone);
      });
  }, []);
  const fetchOrders = async () => {
      if (processingId || isSyncingDriver) return; // Pause polling during actions or sync

      // Refresh Driver Data
      const drivers = await DataService.getDrivers();
      const current = drivers.find(d => d.id === driverId || d.phone === driver.phone);
      if (current) setDriver(current);

      // Fetch Fund Requests
      const allRequests = await DataService.getFundRequests();
      const myRequests = allRequests.filter(r => r.driverId === driverId);
      setAllFundRequests(myRequests);

      // Fetch Products
      const allProducts = await DataService.getProducts();
      setProducts(allProducts);

      // Fetch Driver Stock
      const allStock = await DataService.getStockLivreurs();
      const mergedStockMap = new Map<string, any>();
      
      allStock.filter(s => s.livreurId === driverId).forEach(s => {
          const norm = (s.produitNom || '').trim().toLowerCase();
          if (!mergedStockMap.has(norm)) {
              mergedStockMap.set(norm, { ...s });
          } else {
              const existing = mergedStockMap.get(norm);
              existing.SI = (existing.SI || 0) + (s.SI || 0);
              existing.entrees = (existing.entrees || 0) + (s.entrees || 0);
              existing.sorties = (existing.sorties || 0) + (s.sorties || 0);
              existing.ajustementManuel = (existing.ajustementManuel || 0) + (s.ajustementManuel || 0);
          }
      });

      const myStock = Array.from(mergedStockMap.values()).filter(s => {
          const sf = (s.SI || 0) + (s.entrees || 0) - (s.sorties || 0) + (s.ajustementManuel || 0);
          return sf !== 0;
      });
      setDriverStock(myStock);

      // Fetch Stock Operations for this driver
      const allOps = await DataService.getStockOperations();
      const myOps = allOps.filter(op => 
          op.livreurId === driverId || op.entiteId === driverId
      ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setStockOperations(myOps);
  };

  const handleRefresh = async () => {
      setIsSyncingDriver(true);
      await fetchOrders();
      setLastUpdateTime(new Date().toLocaleTimeString());
      setIsSyncingDriver(false);
  };

  useEffect(() => {
    fetchOrders();
    
    let unsubscribe: (() => void) | undefined;

    
    const setupSubscription = () => {
        if (isSyncingDriver) return;
        
        unsubscribe = DataService.subscribeToOrders((newOrders) => {
            const myOrders = newOrders.filter(o => o.driverId === driverId);
            setOrders(myOrders);
        }, "LIVREUR");
    };

    setupSubscription();

    return () => {
        unsubscribe?.();
    };
  }, [driverId, driver.phone, processingId, isSyncingDriver]);

  const activeFundRequests = useMemo(() => {
      return allFundRequests.filter(r => r.status === 'pending' || r.status === 'paid_by_driver');
  }, [allFundRequests]);

  const toggleStatus = async () => {
      const newStatus = currentStatus === 'disponible' ? 'occupé' : 'disponible';
      setCurrentStatus(newStatus);
      const updatedDriver: Driver = { ...driver, status: newStatus };
      await DataService.saveDriver(updatedDriver);
      setDriver(updatedDriver);
  };

  const sendWhatsAppToAdmin = (order: Order, type: 'payment_request', provider: string = 'Mobile') => {
      let message = "";
      if (type === 'payment_request') {
          message = `Bonjour Admin, j'ai une commande #${order.id} (${order.amount} F CFA) payée par ${provider}. Merci de valider la réception. Livreur: ${driver.name}`;
      }
      const url = `https://wa.me/${adminPhone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
  };

  // FUND REQUEST ACTIONS
  const handlePayFundRequest = async (req: FundRequest, method: 'wave' | 'om') => {
      if (method === 'wave') {
        const waveLink = `https://pay.wave.com/m/M_N1UnVCV3hufj/c/sn/?amount=${req.amount}`;
        window.open(waveLink, '_blank');
      }
      const updatedReq: FundRequest = { 
          ...req, 
          status: 'paid_by_driver',
          paymentMethod: method 
      };
      await DataService.saveFundRequest(updatedReq);
      setAllFundRequests(prev => prev?.map(r => r.id === req.id ? updatedReq : r));
  };

  const handleDeclineClick = async (req: FundRequest) => {
      if (declineConfirmId === req.id) {
          const updatedReq: FundRequest = { ...req, status: 'declined' };
          await DataService.saveFundRequest(updatedReq);
          setAllFundRequests(prev => prev?.map(r => r.id === req.id ? updatedReq : r));
          setDeclineConfirmId(null);
      } else {
          setDeclineConfirmId(req.id);
          setTimeout(() => setDeclineConfirmId(prev => prev === req.id ? null : prev), 3000);
      }
  };

  // SORTING LOGIC
  const estProgrammee = (o: Order) => {
    const dateProg = o.scheduledAt || (o as any).dateProgrammee || (o as any).scheduledDate || (o as any).scheduled_date;
    if (!dateProg) return false;
    
    const now = new Date();
    const schedDate = new Date(dateProg);
    
    // Scheduled if now < schedDate + 1 minute
    return now.getTime() < (schedDate.getTime() + 60000);
  };

  const todoOrders = useMemo(() => {
    const parseDateSafely = (dateStr: string | null | undefined) => {
        if (!dateStr) return new Date(0);
        let d = parseISO(dateStr);
        if (isValid(d)) return d;
        
        // Try common formats if ISO fails
        d = parse(dateStr, 'dd/MM/yyyy', new Date());
        if (isValid(d)) return d;
        
        d = parse(dateStr, 'yyyy-MM-dd', new Date());
        if (isValid(d)) return d;
        
        return new Date(0);
    };

    const selDate = parseISO(selectedDate);

    return orders
        .filter(o => (o.status === 'attribué' || o.status === 'en_cours' || o.status === 'attente_paiement'))
        .filter(o => !estProgrammee(o)) // EXCLUDE SCHEDULED
        .filter(o => {
            // Always show 'en_cours' or 'attente_paiement' (active work)
            if (o.status === 'en_cours' || o.status === 'attente_paiement') return true;
            
            // For 'attribué', filter by selectedDate
            // We show orders for the selected date OR overdue orders (past dates)
            const orderDateStr = o.scheduledAt || o.assignedAt || o.date;
            const orderDate = parseDateSafely(orderDateStr);
            
            return isSameDay(orderDate, selDate) || isBefore(orderDate, selDate);
        })
        .sort((a, b) => {
            // 1. 'en_cours' (In Progress) always at the very top
            if (a.status === 'en_cours' && b.status !== 'en_cours') return -1;
            if (a.status !== 'en_cours' && b.status === 'en_cours') return 1;

            // 2. 'attente_paiement' (Waiting for Admin) next
            if (a.status === 'attente_paiement' && b.status !== 'attente_paiement') return -1;
            if (a.status !== 'attente_paiement' && b.status === 'attente_paiement') return 1;
            
            // 3. Within same status, sort by date ASCENDING (oldest first)
            // Priority: scheduledAt > assignedAt > date
            const timeA = parseDateSafely(a.scheduledAt || a.assignedAt || a.date).getTime();
            const timeB = parseDateSafely(b.scheduledAt || b.assignedAt || b.date).getTime();

            return timeA - timeB;
        });
  }, [orders, selectedDate]);

  const unreachableOrders = useMemo(() => {
      const parseDateSafely = (dateStr: string | null | undefined) => {
          if (!dateStr) return new Date(0);
          let d = parseISO(dateStr);
          if (isValid(d)) return d;
          d = parse(dateStr, 'dd/MM/yyyy', new Date());
          if (isValid(d)) return d;
          d = parse(dateStr, 'yyyy-MM-dd', new Date());
          if (isValid(d)) return d;
          return new Date(0);
      };

      return orders
        .filter(o => o.status === 'injoignable')
        .sort((a, b) => {
            const timeA = parseDateSafely(a.date).getTime();
            const timeB = parseDateSafely(b.date).getTime();
            return timeA - timeB;
        });
  }, [orders]);

  const doneOrders = useMemo(() => {
    return orders
        .filter(o => (o.status === 'livré' || o.status === 'terminé' || o.status === 'annulé' || o.status === 'attente_paiement' || o.status === 'expedition_livree') && o.deliveredAt?.startsWith(selectedDate))
        .filter(o => donePaymentFilter === 'all' || (o.paymentMethod || 'cash') === donePaymentFilter)
        .sort((a, b) => {
            if (a.deliveredAt && b.deliveredAt) {
                return new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime();
            }
            return 0;
        });
  }, [orders, selectedDate, donePaymentFilter]);

  // BALANCE CALCULATIONS
  const balanceStats = useMemo(() => {
      const deliveredOrders = orders.filter(o => o.status === 'livré' || o.status === 'terminé' || o.status === 'expedition_livree');
      
      const totalCA = deliveredOrders.reduce((sum, o) => sum + o.amount, 0);

      const totalCashCollected = deliveredOrders
        .filter(o => o.modePaiement === 'Espèces' || (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod)))
        .reduce((sum, o) => sum + o.amount, 0);

      const totalWaveOM = deliveredOrders
        .filter(o => o.modePaiement === 'Wave' || o.modePaiement === 'OM' || (o.paymentMethod === 'wave' || o.paymentMethod === 'om'))
        .reduce((sum, o) => sum + o.amount, 0);

      const totalRemuneration = deliveredOrders
        .reduce((sum, o) => sum + (o.remuneration || 0), 0);

      // Driver Point of View:
      // Solde = (Ce qu'on me doit) - (Ce que je dois)
      // Solde = (InitialBalance + Remuneration) - (CashCollected)
      // Positive = Colweyz owes Driver. Negative = Driver owes Colweyz.
      const currentBalance = (driver.initialBalance + totalRemuneration) - totalCashCollected;

      return { totalCA, totalCashCollected, totalWaveOM, totalRemuneration, currentBalance };
  }, [orders, driver.initialBalance]);

  const dailyStats = useMemo(() => {
      const dateOrders = orders.filter(o => 
          (o.status === 'livré' || o.status === 'terminé') && 
          o.deliveredAt?.startsWith(selectedDate)
      );

      const dailyCA = dateOrders.reduce((sum, o) => sum + o.amount, 0);

      const dailyCash = dateOrders
        .filter(o => o.modePaiement === 'Espèces' || (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod)))
        .reduce((sum, o) => sum + o.amount, 0);

      const dailyWaveOM = dateOrders
        .filter(o => o.modePaiement === 'Wave' || o.modePaiement === 'OM' || (!o.modePaiement && (o.paymentMethod === 'wave' || o.paymentMethod === 'om')))
        .reduce((sum, o) => sum + o.amount, 0);

      const dailyRemun = dateOrders
        .reduce((sum, o) => sum + (o.remuneration || 0), 0);
      
      return { dailyCA, dailyCash, dailyWaveOM, dailyRemun };
  }, [orders, selectedDate]);

  const balanceHistory = useMemo(() => {
      const history: any[] = [];
      
      // 1. Orders (Cash Collection & Gains)
      orders.forEach(o => {
          if ((o.status === 'livré' || o.status === 'terminé') && o.deliveredAt) {
              const isCash = o.modePaiement === 'Espèces' || (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod));
              const mode = o.modePaiement || (o.paymentMethod === 'wave' ? 'Wave' : o.paymentMethod === 'om' ? 'OM' : 'Espèces');
              const productName = o.products?.[0]?.name || (o.productDetails ? parseProductCommand(o.productDetails.split('\n')[0]).productName : 'Produit');

              // Collection entry (Driver owes this money if cash, or just for record if digital)
              history.push({
                  id: `col-${o.id}`,
                  date: o.deliveredAt,
                  type: 'collection',
                  amount: o.amount,
                  label: `Encaissement #${o.id}`,
                  details: o.clientName,
                  paymentMethod: o.paymentMethod || (isCash ? 'cash' : 'wave'),
                  modePaiement: mode,
                  address: o.address,
                  productName: productName
              });

              // Remuneration (Driver earns this -> Positive impact on balance)
              if (o.remuneration) {
                  history.push({
                      id: `rem-${o.id}`,
                      date: o.deliveredAt,
                      type: 'gain',
                      amount: o.remuneration,
                      label: `Commission #${o.id}`,
                      details: 'Gain sur livraison',
                      paymentMethod: 'n/a',
                      modePaiement: mode,
                      address: o.address,
                      productName: productName
                  });
              }
          }
      });

      // 2. Fund Requests (Payments)
      allFundRequests.forEach(req => {
          if (req.status === 'confirmed' && req.confirmedAt) {
              const isPayout = req.type === 'payout';
              history.push({
                  id: req.id,
                  date: req.confirmedAt,
                  type: isPayout ? 'payout' : 'payment',
                  amount: req.amount,
                  label: isPayout ? 'Versement Reçu' : 'Versement Effectué',
                  details: isPayout ? 'De l\'admin' : 'Vers l\'admin',
                  paymentMethod: req.paymentMethod || 'cash'
              });
          }
      });

      // Sort & Filter by selectedDate
      return history
        .filter(h => h.date.startsWith(selectedDate))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [orders, allFundRequests, selectedDate]);

  let displayOrders = activeTab === 'todo' ? todoOrders : activeTab === 'unreachable' ? unreachableOrders : doneOrders;

  // ACTION HANDLER
  const executeAction = async (orderId: string, action: 'accept' | 'refuse_driver' | 'cancel_client' | 'especes' | 'wave' | 'om' | 'reset' | 'mark_unreachable' | 'retry' | 'undo' | 'confirm_depot') => {
    setProcessingId(orderId);
    setDebugMsg(null); // Clear previous errors
    
    // Clear confirmation states if not a delivery action (delivery state cleared after Firestore write)
    const isDeliveryAction = action === 'especes' || action === 'wave' || action === 'om' || action === 'confirm_depot';
    if (!isDeliveryAction) {
        setConfirmActionId(null);
        setConfirmType(null);
        setCommandeEnPaiement(null);
    }

    try {
        console.log("executeAction appelé:", orderId, action);
        const order = orders.find(o => o.id === orderId);
        if (!order) throw new Error("Commande introuvable");

        const resolveStockProducts = (targetOrder: Order) => {
            return targetOrder.products && targetOrder.products.length > 0
                ? targetOrder.products.map(p => {
                    const matched = products.find(pr => 
                        pr.id === p.sku || 
                        (pr.variants && pr.variants.some(v => v.sku === p.sku)) || 
                        pr.title === p.name ||
                        (p.name && p.name.includes(pr.title))
                    );
                    return { productId: matched?.id || p.sku || p.name || '', quantity: p.quantity };
                })
                : (targetOrder.productDetails || '').split('\n').map(line => {
                    const { quantity, productName } = parseProductCommand(line);
                    const matched = products.find(p => p.title === productName);
                    return { productId: matched?.id || productName, quantity };
                }).filter(p => p.quantity > 0);
        };

        let updated: Order;

        if (action === 'accept') {
            updated = { ...order, status: 'en_cours' };
        } else if (action === 'refuse_driver') {
             updated = { 
                ...order, 
                status: 'validé', 
                driverId: null, 
                assignedAt: null,
                remuneration: null,
                refusedBy: driver.name,
                paymentMethod: undefined,
                cancelReason: "Refus Livreur"
            };
        } else if (action === 'cancel_client') {
            updated = {
                ...order,
                status: 'annulé',
                deliveredAt: new Date().toISOString(),
                cancelReason: "Annulation Client",
                remuneration: 0
            };
        } else if (action === 'confirm_depot') {
            // Special delivery to depot
            let purchaseCost = undefined;
            if (order.productId) {
                const product = await DataService.getProducts().then(ps => ps.find(p => p.id === order.productId));
                if (product) purchaseCost = product.purchasePrice;
            }

            updated = { 
                ...order, 
                status: 'expedition_livree', 
                deliveredAt: new Date().toISOString(),
                paymentMethod: 'cash', // Treat as cash for accounting but amount is 0
                modePaiement: 'Dépôt Expédition',
                purchaseCost // Snapshot
            };

            // 1. Update driver gains and balance
            const updatedDriver: Driver = {
                ...driver,
                gains: (driver.gains || 0) + (order.remuneration || 0),
                balance: (driver.balance || 0) + (order.remuneration || 0)
            };
            await DataService.saveDriver(updatedDriver);

            // 2. If it's a grouped depot delivery, update all linked orders
            if (order.isDepotDelivery && order.linkedOrderIds && order.linkedOrderIds.length > 0) {
                try {
                    const allOrders = await DataService.getOrders();
                    const linkedOrders = allOrders.filter(o => order.linkedOrderIds?.includes(o.id));
                    
                    await Promise.all(linkedOrders.map(lo => {
                        const updatedLO: Order = {
                            ...lo,
                            status: 'expedition_livree',
                            deliveredAt: new Date().toISOString()
                        };
                        return DataService.saveOrder(updatedLO);
                    }));
                } catch (err) {
                    console.error("Error updating linked regional orders:", err);
                }
            }

            // 3. Deduct stock for driver and ADD to depot stock
            if (updated.driverId) {
                const orderProducts = resolveStockProducts(updated);
                for (const p of orderProducts) {
                    await DataService.updateDriverStock(p.productId, updated.driverId, p.quantity, 'deduct');
                    await DataService.updateDepotStock(p.productId, p.quantity, 'add', 'order');
                }
            }
        } else if (action === 'especes') {
            // Snapshot purchase price
            let purchaseCost = undefined;
            if (order.productId) {
                const product = await DataService.getProducts().then(ps => ps.find(p => p.id === order.productId));
                if (product) purchaseCost = product.purchasePrice;
            }

            updated = { 
                ...order, 
                status: 'terminé', 
                deliveredAt: new Date().toISOString(),
                paymentMethod: 'cash',
                modePaiement: 'Espèces',
                purchaseCost // Snapshot
            };

            // Deduct stock for cash delivery
            if (updated.driverId) {
                const orderProducts = resolveStockProducts(updated);
                for (const p of orderProducts) {
                    await DataService.updateDriverStock(p.productId, updated.driverId, p.quantity, 'deduct');
                }
            }
        } else if (action === 'wave' || action === 'om') {
            // Snapshot purchase price
            let purchaseCost = undefined;
            if (order.productId) {
                const product = await DataService.getProducts().then(ps => ps.find(p => p.id === order.productId));
                if (product) purchaseCost = product.purchasePrice;
            }

            updated = { 
                ...order, 
                status: 'attente_paiement', 
                deliveredAt: new Date().toISOString(),
                paymentMethod: action === 'wave' ? 'wave' : 'om',
                modePaiement: action === 'wave' ? 'Wave' : 'OM',
                purchaseCost // Snapshot
            };

            // Save FIRST before opening WhatsApp to avoid losing state on mobile
            await DataService.saveOrder(updated);

            const provider = action === 'wave' ? 'Wave' : 'Orange Money';
            sendWhatsAppToAdmin(order, 'payment_request', provider);
            
            // Deduct stock if delivered
            if (updated.driverId) {
                const orderProducts = resolveStockProducts(updated);
                for (const p of orderProducts) {
                    await DataService.updateDriverStock(p.productId, updated.driverId, p.quantity, 'deduct');
                }
            }
            
            // Update local state before returning
            setOrders(prev => prev?.map(o => o.id === orderId ? updated : o));
            return; // Exit early since we saved and handled stock
        } else if (action === 'mark_unreachable') {
            updated = { ...order, status: 'injoignable' };
        } else if (action === 'retry') {
            updated = { ...order, status: 'en_cours' };
        } else if (action === 'undo') {
            // If it was delivered, restore stock
            if ((order.status === 'terminé' || order.status === 'livré' || order.status === 'attente_paiement' || order.status === 'expedition_livree') && order.driverId) {
                const orderProducts = resolveStockProducts(order);
                for (const p of orderProducts) {
                    await DataService.updateDriverStock(p.productId, order.driverId, p.quantity, 'restore');
                }
            }

            updated = { 
                ...order, 
                status: 'en_cours',
                paymentMethod: undefined,
                deliveredAt: null,
                cancelReason: undefined
                // On garde la rémunération calculée
            };
        } else { // reset
            updated = {
                ...order,
                status: 'en_cours',
                paymentMethod: undefined 
            };
        }

        await DataService.saveOrder(updated);
        
        // Refresh stock data after any action that might affect it
        const allStock = await DataService.getStockLivreurs();
        const myStock = allStock.filter(s => s.livreurId === driverId);
        setDriverStock(myStock);
        
        // Optimistic UI Update
        if (action === 'refuse_driver') {
             setOrders(prev => prev.filter(o => o.id !== orderId));
        } else {
             setOrders(prev => prev?.map(o => o.id === orderId ? updated : o));
        }

    } catch (e: any) {
        console.error("ERREUR executeAction:", e);
        setDebugMsg("ERREUR: " + (e.code || 'N/A') + " — " + e.message);
        alert("Une erreur est survenue.");
    } finally {
        setProcessingId(null);
        setConfirmActionId(null);
        setConfirmType(null);
        setCommandeEnPaiement(null);
    }
  };

  // POSTPONE LOGIC
  const openPostponeModal = (orderId: string) => {
      setPostponeOrderId(orderId);
      setPostponeDate(new Date().toISOString().split('T')[0]); // Default today
      setPostponeTime('');
      setConfirmActionId(null); // Close other menus
  };

  const handlePostponeSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!postponeOrderId || !postponeDate || !postponeTime) return;

      setProcessingId(postponeOrderId);
      try {
          const order = orders.find(o => o.id === postponeOrderId);
          if (!order) return;

          const dateTime = `${postponeDate}T${postponeTime}`;
          
          const updated: Order = {
              ...order,
              status: 'validé', // Retourne au dashboard (pool)
              driverId: null, // Désassignation
              scheduledAt: dateTime, // Utilise scheduledAt pour que ça apparaisse dans "Commandes programmées"
              remuneration: null,
              assignedAt: null
          };

          await DataService.saveOrder(updated);
          setOrders(prev => prev.filter(o => o.id !== postponeOrderId)); // Remove from driver view
          
          setPostponeOrderId(null);
          setPostponeTime('');
      } catch (e) {
          console.error(e);
          alert("Erreur lors du report.");
      } finally {
          setProcessingId(null);
      }
  };

  const requestConfirm = (e: React.MouseEvent, orderId: string, type: 'deliver' | 'cancel_options' | 'cancel_client' | 'refuse_driver' | 'accept' | 'edit' | 'undo') => {
      e.stopPropagation();
      e.preventDefault();
      
      if (type === 'accept') {
          executeAction(orderId, 'accept');
          return;
      }
      
      if (type === 'deliver') {
          setCommandeEnPaiement(orderId);
          setConfirmActionId(null);
          setConfirmType(null);
          return;
      }
      
      if (confirmActionId === orderId && confirmType === type) {
          setConfirmActionId(null);
          setConfirmType(null);
      } else {
          setConfirmActionId(orderId);
          setConfirmType(type);
          setCommandeEnPaiement(null);
      }
  };

  const cancelConfirm = (e: React.MouseEvent) => {
      e.stopPropagation();
      setConfirmActionId(null);
      setConfirmType(null);
      setCommandeEnPaiement(null);
  };

  const handleInvoice = (order: Order) => {
      InvoiceService.sendViaWhatsApp(order, true);
  };

  return (
    <div className="max-w-md mx-auto bg-gray-100 min-h-screen pb-24">
      {/* Header */}
      <div className="bg-green-700 text-white p-6 rounded-b-3xl shadow-lg relative z-10 border-b-4 border-yellow-400">
        <div className="flex justify-between items-start mb-4">
          <div>
             <div className="flex items-baseline gap-2 mb-1 opacity-90">
                <span className="text-[10px] font-black tracking-widest uppercase text-yellow-300">Colweyz</span>
             </div>
            <h1 className="text-xl font-bold">Bonjour, {driver.name}</h1>
            <button 
                onClick={toggleStatus}
                className={`mt-2 flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm ${
                    currentStatus === 'disponible' 
                    ? 'bg-white text-green-700 ring-2 ring-green-200' 
                    : 'bg-red-500 text-white ring-2 ring-red-300'
                }`}
            >
                <Power size={12} strokeWidth={3} />
                <span>{currentStatus === 'disponible' ? 'EN LIGNE' : 'HORS LIGNE'}</span>
            </button>
          </div>
          <div className="flex flex-col items-end gap-2">
             <div className="flex gap-2 items-center">
                {onLogout && (
                    <button 
                       onClick={onLogout}
                       className="bg-white/20 p-2 rounded-full hover:bg-white/30 text-white transition-colors backdrop-blur-sm"
                       title="Se déconnecter"
                    >
                       <LogOut size={20} />
                    </button>
                )}
                <div className="bg-yellow-400 p-2 rounded-full text-green-800 shadow-md">
                   <Truck size={24} strokeWidth={2.5} />
                </div>
             </div>
             <div className="relative mt-1">
                 <input 
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="bg-white text-gray-900 border border-gray-200 shadow-sm rounded-lg px-2 py-1 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-yellow-400 cursor-pointer"
                 />
                 <Calendar className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" size={14} />
             </div>
          </div>
        </div>
      </div>

      {/* --- FUND REQUEST ALERTS --- */}
      {activeFundRequests.length > 0 && (
          <div className="p-4 space-y-4 animate-in fade-in slide-in-from-top-4">
              {activeFundRequests?.map(req => (
                  <div 
                    key={req.id} 
                    className={`rounded-xl p-4 shadow-lg border relative overflow-hidden text-white
                        ${req.status === 'paid_by_driver' 
                            ? 'bg-blue-600 border-blue-500' 
                            : 'bg-orange-600 border-orange-500'
                        }`}
                  >
                      <div className="absolute right-0 top-0 p-4 opacity-10">
                          <HandCoins size={60} />
                      </div>
                      <div className="relative z-10">
                          <h3 className="font-bold text-lg flex items-center mb-1">
                              {req.status === 'paid_by_driver' ? (
                                  <><CheckCircle className="mr-2" size={20} /> Paiement envoyé</>
                              ) : (
                                  <><AlertCircle className="mr-2" size={20} /> Appel de fonds</>
                              )}
                          </h3>
                          <p className={`text-sm mb-3 ${req.status === 'paid_by_driver' ? 'text-blue-100' : 'text-orange-100'}`}>
                              {req.status === 'paid_by_driver' 
                                ? "En attente de confirmation de l'administrateur."
                                : "L'administrateur demande le versement de :"
                              }
                          </p>
                          <div className="text-2xl font-black mb-4">{formatFCFA(req.amount)}</div>
                          
                          {req.status === 'pending' ? (
                              <div className="space-y-2">
                                  <div className="flex gap-2">
                                      <button 
                                        onClick={() => handlePayFundRequest(req, 'wave')}
                                        className="flex-1 bg-[#1da1f2] text-white py-3 rounded-lg font-bold shadow-sm flex items-center justify-center hover:bg-blue-500 active:scale-95 transition-all border-b-4 border-blue-700 active:border-b-0 active:translate-y-1"
                                      >
                                          Wave
                                      </button>
                                      <button 
                                        onClick={() => handlePayFundRequest(req, 'om')}
                                        className="flex-1 bg-[#ff7900] text-white py-3 rounded-lg font-bold shadow-sm flex items-center justify-center hover:bg-orange-600 active:scale-95 transition-all border-b-4 border-orange-800 active:border-b-0 active:translate-y-1"
                                      >
                                          OM
                                      </button>
                                  </div>
                                  <button 
                                    onClick={() => handleDeclineClick(req)}
                                    className={`w-full py-2 rounded-lg font-bold border transition-colors text-sm
                                        ${declineConfirmId === req.id 
                                            ? 'bg-red-600 text-white border-red-700 hover:bg-red-700'
                                            : 'bg-transparent text-white border-white/30 hover:bg-white/10'
                                        }
                                    `}
                                  >
                                      {declineConfirmId === req.id ? "Confirmer le refus ?" : "Refuser / Je ne peux pas payer"}
                                  </button>
                              </div>
                          ) : (
                              <button 
                                onClick={() => {
                                    const waveLink = `https://pay.wave.com/m/M_N1UnVCV3hufj/c/sn/?amount=${req.amount}`;
                                    window.open(waveLink, '_blank');
                                }}
                                className="w-full bg-blue-700 text-blue-200 py-2 rounded-lg font-medium text-xs flex items-center justify-center border border-blue-600 hover:bg-blue-800"
                              >
                                  <ExternalLink size={14} className="mr-1" />
                                  Réouvrir le lien Wave (si besoin)
                              </button>
                          )}
                      </div>
                  </div>
              ))}
          </div>
      )}

      {/* Tabs */}
      <div className="flex p-4 space-x-1 sticky top-0 z-0 bg-gray-100/95 backdrop-blur-sm shadow-sm overflow-x-auto">
        <button 
          onClick={() => setActiveTab('todo')}
          className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all whitespace-nowrap px-2 ${
            activeTab === 'todo' ? 'bg-yellow-400 text-green-900 shadow-md' : 'bg-white text-gray-500 border border-gray-200'
          }`}
        >
          À Faire ({todoOrders.length})
        </button>
        <button 
          onClick={() => setActiveTab('unreachable')}
          className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all whitespace-nowrap px-2 ${
            activeTab === 'unreachable' ? 'bg-orange-500 text-white shadow-md' : 'bg-white text-gray-500 border border-gray-200'
          }`}
        >
          Injoignables ({unreachableOrders.length})
        </button>
        <button 
          onClick={() => setActiveTab('done')}
          className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all whitespace-nowrap px-2 ${
            activeTab === 'done' ? 'bg-green-700 text-white shadow-md' : 'bg-white text-gray-500 border border-gray-200'
          }`}
        >
          Terminées
        </button>
        <button 
          onClick={() => setActiveTab('balance')}
          className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all whitespace-nowrap px-2 ${
            activeTab === 'balance' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-500 border border-gray-200'
          }`}
        >
          Solde
        </button>
        <button 
          onClick={() => setActiveTab('stock')}
          className={`flex-1 py-2 rounded-lg font-bold text-xs transition-all whitespace-nowrap px-2 ${
            activeTab === 'stock' ? 'bg-purple-600 text-white shadow-md' : 'bg-white text-gray-500 border border-gray-200'
          }`}
        >
          Stock
        </button>
      </div>

      {activeTab === 'stock' ? (
          <div className="px-4 pb-10 space-y-4">
              <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm border border-gray-100">
                  <span className="text-xs font-bold text-gray-500 uppercase">Dernière mise à jour : {lastUpdateTime}</span>
                  <button 
                    onClick={handleRefresh}
                    disabled={isSyncingDriver}
                    className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={18} className={isSyncingDriver ? 'animate-spin' : ''} />
                  </button>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-3 border-b border-gray-100 font-bold text-gray-700 bg-gray-50 text-xs flex items-center">
                      <Package size={14} className="mr-2 text-purple-600" />
                      Mon Inventaire Actuel
                  </div>
                  <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-gray-100 text-gray-600 uppercase font-bold border-b border-gray-200">
                              <tr>
                                  <th className="px-3 py-3 border-r border-gray-200">Produit</th>
                                  <th className="px-3 py-3 text-right">Stock</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                              {driverStock.length === 0 ? (
                                  <tr><td colSpan={2} className="p-8 text-center text-gray-400 italic">Aucun stock assigné.</td></tr>
                              ) : (
                                  driverStock.map((item: any) => {
                                      const sfAffiche = (item.SI || 0) + (item.entrees || 0) - (item.sorties || 0) + (item.ajustementManuel || 0);
                                      return (
                                          <tr key={item.id} className="hover:bg-purple-50/30">
                                          <td className="px-3 py-3 border-r border-gray-100 font-medium text-gray-800">
                                              {item.produitNom}
                                          </td>
                                              <td className={`px-3 py-3 text-right font-black text-sm ${sfAffiche < 0 ? 'text-red-600 bg-red-50' : (item.ajustementManuel ? 'text-blue-700' : 'text-gray-800')}`}>
                                                  <div className="flex items-center justify-end gap-1">
                                                      {sfAffiche < 0 && <AlertCircle size={14} />}
                                                      {sfAffiche}
                                                  </div>
                                              </td>
                                          </tr>
                                      );
                                  })
                              )}
                          </tbody>
                      </table>
                  </div>
              </div>

              {/* MOVEMENTS HISTORY FOR DRIVER */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-3 border-b border-gray-100 font-bold text-gray-700 bg-gray-50 text-xs flex items-center justify-between">
                      <div className="flex items-center">
                          <ArrowRightLeft size={14} className="mr-2 text-blue-600" />
                          Historique des Mouvements
                      </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                      {stockOperations.length === 0 ? (
                          <div className="p-8 text-center text-gray-400 text-xs italic">Aucun mouvement récent.</div>
                      ) : (
                          stockOperations.slice(0, 30).map((op) => {
                              const isEntry = op.entiteId === driverId;
                              const isExit = op.livreurId === driverId;
                              const isInternal = isEntry && isExit; // Should not happen but safety
                              
                              return (
                                  <div key={op.id} className="p-3 hover:bg-gray-50 flex items-start justify-between gap-3">
                                      <div className="flex flex-col gap-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                              <span className={`w-2 h-2 rounded-full ${isEntry ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                              <span className="text-xs font-bold text-gray-800 truncate">{op.productName}</span>
                                          </div>
                                          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                              <span>{format(new Date(op.date), 'dd/MM HH:mm')}</span>
                                              <span>•</span>
                                              <span className="uppercase">{op.type.replace(/_/g, ' ')}</span>
                                          </div>
                                      </div>
                                      <div className="flex flex-col items-end shrink-0">
                                          <span className={`text-sm font-black ${isEntry ? 'text-green-600' : 'text-red-600'}`}>
                                              {isEntry ? '+' : '-'}{op.quantity}
                                          </span>
                                          <span className="text-[9px] text-gray-400">
                                              {isEntry ? (op.livreurId === 'global' ? 'Entrepôt' : (op.livreurId === DEPOT_ID ? 'Dépôt' : op.livreurId)) : 
                                               (op.entiteId === 'global' ? 'Entrepôt' : (op.entiteId === DEPOT_ID ? 'Dépôt' : op.entiteId))}
                                          </span>
                                      </div>
                                  </div>
                              );
                          })
                      )}
                  </div>
              </div>
              
              {driverStock.some(s => ((s.SI || 0) + (s.entrees || 0) - (s.sorties || 0) + (s.ajustementManuel || 0)) < 0) && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                      <AlertCircle className="text-red-600 flex-shrink-0" size={20} />
                      <div>
                          <p className="text-sm font-bold text-red-800">Attention : Stock Négatif</p>
                          <p className="text-xs text-red-600">Certains produits ont un stock négatif. Cela signifie que vous avez livré plus que ce qui a été enregistré. Contactez l'admin pour régulariser.</p>
                      </div>
                  </div>
              )}
          </div>
      ) : activeTab === 'balance' ? (
          <div className="px-4 pb-10 space-y-4">
              {/* SUMMARY CARD (GLOBAL) */}
              <div className={`rounded-xl p-6 shadow-sm border ${balanceStats.currentBalance >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                  <p className="text-sm font-medium text-gray-600 mb-1">
                      {balanceStats.currentBalance >= 0 ? "Montant dû au livreur" : "Montant dû à Colweyz"}
                  </p>
                  <div className={`text-3xl font-black ${balanceStats.currentBalance >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {formatFCFA(Math.abs(balanceStats.currentBalance))}
                  </div>
              </div>

              {/* DAILY SUMMARY CARD */}
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
                  <p className="text-xs font-bold uppercase text-gray-500 mb-3 flex items-center">
                      <Calendar size={14} className="mr-1" />
                      Activité du {new Date(selectedDate).toLocaleDateString()}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                          <p className="text-[9px] text-gray-400 font-bold uppercase">Total Courses (CA)</p>
                          <p className="text-sm font-black text-gray-800">{formatFCFA(dailyStats.dailyCA)}</p>
                      </div>
                      <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-100">
                          <p className="text-[9px] text-yellow-700 font-bold uppercase">Espèces Collectées</p>
                          <p className="text-sm font-black text-yellow-800">{formatFCFA(dailyStats.dailyCash)}</p>
                      </div>
                      <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                          <p className="text-[9px] text-blue-600 font-bold uppercase">Wave / OM (Colweyz)</p>
                          <p className="text-sm font-black text-blue-700">{formatFCFA(dailyStats.dailyWaveOM)}</p>
                      </div>
                      <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                          <p className="text-[9px] text-green-600 font-bold uppercase">Gains du Jour</p>
                          <p className="text-sm font-black text-green-700">{formatFCFA(dailyStats.dailyRemun)}</p>
                      </div>
                  </div>
              </div>

              {/* DETAILED ORDER TABLE (SPREADSHEET MODEL) */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-3 border-b border-gray-100 font-bold text-gray-700 bg-gray-50 text-xs flex items-center">
                      <FileText size={14} className="mr-2 text-green-600" />
                      Relevé Journalier - {new Date(selectedDate).toLocaleDateString()}
                  </div>
                  <div className="overflow-x-auto">
                      <table className="w-full text-left text-[10px] border-collapse">
                          <thead className="bg-gray-100 text-gray-600 uppercase font-bold border-b border-gray-200">
                              <tr>
                                  <th className="px-2 py-2 border-r border-gray-200">Client / Adresse</th>
                                  <th className="px-2 py-2 border-r border-gray-200">Produit</th>
                                  <th className="px-2 py-2 border-r border-gray-200 text-right">Prix</th>
                                  <th className="px-2 py-2 border-r border-gray-200 text-center">Mode</th>
                                  <th className="px-2 py-2 border-r border-gray-200 text-right">Frais</th>
                                  <th className="px-2 py-2 text-center">Statut</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                              {balanceHistory.filter(h => h.type === 'collection' || h.type === 'gain').length === 0 ? (
                                  <tr><td colSpan={6} className="p-4 text-center text-gray-400 italic">Aucune course ce jour.</td></tr>
                              ) : (
                                  Object.values(
                                      balanceHistory
                                          .filter(h => h.type === 'collection' || h.type === 'gain')
                                          .reduce((acc: any, curr: any) => {
                                              const orderId = curr.id.split('-')[1];
                                              if (!acc[orderId]) {
                                                  acc[orderId] = { 
                                                      id: orderId, 
                                                      address: curr.address, 
                                                      clientName: curr.details,
                                                      productName: curr.productName,
                                                      price: 0, 
                                                      gain: 0, 
                                                      mode: curr.modePaiement,
                                                      status: 'Livrée' 
                                                  };
                                              }
                                              if (curr.type === 'collection') acc[orderId].price = curr.amount;
                                              if (curr.type === 'gain') acc[orderId].gain = curr.amount;
                                              return acc;
                                          }, {})
                                  ).map((order: any) => (
                                      <tr key={order.id} className="hover:bg-green-50/30">
                                          <td className="px-2 py-2 border-r border-gray-100">
                                              <div className="font-bold text-gray-800 truncate max-w-[80px]">{order.clientName}</div>
                                              <div className="text-[8px] text-gray-400 truncate max-w-[80px]">{order.address}</div>
                                          </td>
                                          <td className="px-2 py-2 border-r border-gray-100 truncate max-w-[80px]">
                                              {order.productName}
                                          </td>
                                          <td className={`px-2 py-2 border-r border-gray-100 text-right font-bold ${order.mode === 'Espèces' ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                                              {formatNumber(order.price)}
                                          </td>
                                          <td className="px-2 py-2 border-r border-gray-100 text-center">
                                              <span className={`text-[8px] px-1 py-0.5 rounded font-bold ${
                                                  order.mode === 'Espèces' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                              }`}>
                                                  {order.mode}
                                              </span>
                                          </td>
                                          <td className="px-2 py-2 border-r border-gray-100 text-right font-bold text-green-700">
                                              {formatNumber(order.gain)}
                                          </td>
                                          <td className="px-2 py-2 text-center">
                                              <span className="bg-green-600 text-white text-[8px] px-1 py-0.5 rounded-full font-bold">
                                                  {order.status}
                                              </span>
                                          </td>
                                      </tr>
                                  ))
                              )}
                          </tbody>
                      </table>
                  </div>
                  
                  {/* SUMMARY BOX AT BOTTOM OF TABLE */}
                  {balanceHistory.filter(h => h.type === 'collection' || h.type === 'gain').length > 0 && (
                      <div className="p-4 bg-gray-900 text-white space-y-2">
                          <div className="flex justify-between items-center text-[10px] border-b border-gray-700 pb-1">
                              <span className="text-gray-400 uppercase">Total Courses (CA)</span>
                              <span className="font-bold">{formatNumber(dailyStats.dailyCA)} F</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px] border-b border-gray-700 pb-1">
                              <span className="text-gray-400 uppercase">Espèces Collectées</span>
                              <span className="font-bold text-yellow-400">{formatNumber(dailyStats.dailyCash)} F</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px] border-b border-gray-700 pb-1">
                              <span className="text-gray-400 uppercase">Wave / OM (Colweyz)</span>
                              <span className="font-bold text-blue-400">{formatNumber(dailyStats.dailyWaveOM)} F</span>
                          </div>
                          <div className="flex justify-between items-center text-xs pt-1">
                              <span className="text-green-400 font-bold uppercase tracking-wider">Gains du Jour</span>
                              <span className="font-black text-green-400 text-lg">{formatNumber(dailyStats.dailyRemun)} F</span>
                          </div>
                      </div>
                  )}
              </div>

              {/* HISTORY LIST (Mouvements de Caisse) */}
              <div className="space-y-3">
                  <h4 className="text-xs font-bold text-gray-400 uppercase ml-1">Mouvements de Caisse ({new Date(selectedDate).toLocaleDateString()})</h4>
                  {balanceHistory.filter(h => h.type === 'payment' || h.type === 'payout').length === 0 ? (
                      <div className="text-center py-4 text-gray-400 text-xs italic bg-white rounded-xl border border-dashed border-gray-200">Aucun mouvement de caisse.</div>
                  ) : (
                      balanceHistory.filter(h => h.type === 'payment' || h.type === 'payout').map((item: any) => (
                          <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
                              <div>
                                  <div className="flex items-center gap-2 mb-1">
                                      <span className="text-xs font-bold text-gray-400">{new Date(item.date).toLocaleDateString()}</span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                          item.type === 'collection' ? 'bg-gray-100 text-gray-600' :
                                          item.type === 'gain' ? 'bg-green-100 text-green-600' :
                                          item.type === 'payment' ? 'bg-blue-100 text-blue-600' :
                                          'bg-purple-100 text-purple-600'
                                      }`}>
                                          {item.type === 'collection' ? 'Espèce' :
                                           item.type === 'gain' ? 'Gain' :
                                           item.type === 'payment' ? 'Versé' : 'Reçu'}
                                      </span>
                                  </div>
                                  <p className="font-bold text-sm text-gray-800">{item.label}</p>
                                  <p className="text-xs text-gray-500">{item.details}</p>
                              </div>
                              <div className={`font-bold ${
                                  item.type === 'gain' || item.type === 'payment' ? 'text-green-600' : 'text-red-500'
                              }`}>
                                  {item.type === 'gain' || item.type === 'payment' ? '+' : '-'}{formatFCFA(item.amount)}
                              </div>
                          </div>
                      ))
                  )}
              </div>
          </div>
      ) : (
      /* List */
      <div className="px-4 space-y-4 pb-10">
        {activeTab === 'done' && (
            <div className="flex justify-end mb-4 mt-2 sticky top-14 z-10">
                <div className="bg-white p-1 rounded-lg shadow-sm border border-gray-200">
                    <select 
                        value={donePaymentFilter}
                        onChange={(e) => setDonePaymentFilter(e.target.value as any)}
                        className="bg-transparent text-gray-700 text-xs font-bold py-1 px-2 rounded focus:outline-none"
                    >
                        <option value="all">Tous paiements</option>
                        <option value="cash">Espèces</option>
                        <option value="wave">Wave</option>
                        <option value="om">Orange Money</option>
                    </select>
                </div>
            </div>
        )}

        {displayOrders.length === 0 ? (
           <div className="text-center py-12 text-gray-400">
             <div className="bg-white rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4 shadow-sm border border-gray-100">
                <CheckCircle size={40} className="text-green-100" />
             </div>
             <p className="font-medium">
                 {activeTab === 'todo' ? 'Aucune course à faire.' : 
                  activeTab === 'unreachable' ? 'Aucun client injoignable.' : 
                  `Aucune course terminée le ${selectedDate}.`}
             </p>
           </div>
        ) : (
          displayOrders?.map(order => {
            const isProcessing = processingId === order.id;
            const isConfirming = confirmActionId === order.id || commandeEnPaiement === order.id;

            return (
            <div key={order.id} className={`bg-white rounded-xl p-5 shadow-sm border relative overflow-hidden transition-all ${order.status === 'attribué' && activeTab === 'todo' ? 'border-l-4 border-l-yellow-400' : 'border-gray-100'}`}>
              
              {/* Processing Overlay */}
              {isProcessing && (
                  <div className="absolute inset-0 bg-white/80 z-20 flex items-center justify-center backdrop-blur-sm">
                      <div className="flex flex-col items-center text-green-600">
                          <Loader size={32} className="animate-spin mb-2" />
                          <span className="text-sm font-semibold">Traitement...</span>
                      </div>
                  </div>
              )}

              {/* Debug Message */}
              {debugMsg && (
                <div style={{
                  background: "#fee2e2",
                  color: "#991b1b", 
                  padding: "8px",
                  borderRadius: "8px",
                  margin: "8px 0",
                  fontSize: "12px"
                }}>
                  {debugMsg}
                </div>
              )}

              {/* Status Header */}
              <div className="flex justify-between items-center mb-3">
                 <div className="flex items-center gap-2">
                     <span className="text-xs font-mono text-gray-400 font-bold">#{order.id}</span>
                     {activeTab === 'todo' && (
                        order.isDepotDelivery ? (
                            <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center border border-indigo-200">
                                <Truck size={10} className="mr-1" /> Expédition Dépôt
                            </span>
                        ) : order.status === 'attribué' ? (
                            <span className="bg-yellow-100 text-yellow-700 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center">
                                <Clock size={10} className="mr-1" /> New
                            </span>
                        ) : order.status === 'attente_paiement' ? (
                            <span className="bg-purple-100 text-purple-700 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center border border-purple-200">
                                <AlertCircle size={10} className="mr-1" /> En attente admin
                            </span>
                        ) : (
                            <span className="bg-blue-100 text-blue-600 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center">
                                <PlayCircle size={10} className="mr-1" /> En cours
                            </span>
                        )
                     )}
                     {activeTab === 'unreachable' && (
                         <span className="bg-orange-100 text-orange-600 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center">
                             <PhoneOff size={10} className="mr-1" /> Injoignable
                         </span>
                     )}
                     <span className="text-[10px] text-gray-400">{order.date}</span>
                 </div>
                 <span className={`text-sm px-2 py-1 rounded font-black border ${order.status === 'annulé' ? 'bg-red-50 text-red-500 border-red-100 line-through' : 'bg-green-50 text-green-700 border-green-100'}`}>
                    {formatFCFA(order.amount)}
                 </span>
              </div>
              
              {/* Scheduled Time Indicator */}
              {order.scheduledAt && (
                  <div className="mb-3 flex items-center text-xs font-bold text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-100">
                      <CalendarClock size={14} className="mr-2" />
                      <span>
                          Prévu le {new Date(order.scheduledAt).toLocaleDateString()} à {new Date(order.scheduledAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </span>
                  </div>
              )}
              
              {/* Order Info */}
              <div className="flex items-start justify-between">
                <div className="w-full">
                   {order.isDepotDelivery ? (
                       <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-3">
                           <div className="flex items-center gap-2 mb-3 text-indigo-700">
                               <Package size={18} className="flex-shrink-0" />
                               <h3 className="font-black text-sm uppercase tracking-tight">Expédition Dépôt Delta Transport</h3>
                           </div>
                           
                           <div className="space-y-2 mb-4 border-y border-indigo-100/50 py-3">
                               {order.products?.map((p, i) => (
                                   <div key={i} className="flex justify-between text-xs font-bold text-gray-700">
                                       <span className="flex-1 pr-2">{p.name}</span>
                                       <span className="text-indigo-600 whitespace-nowrap">× {p.quantity}</span>
                                   </div>
                               ))}
                           </div>

                           <div className="space-y-1.5">
                               <div className="flex justify-between items-center text-[11px]">
                                   <span className="text-gray-500 font-bold uppercase">À encaisser :</span>
                                   <span className="font-black text-gray-900 bg-white px-2 py-0.5 rounded border border-gray-100">0 F CFA</span>
                               </div>
                               <div className="flex justify-between items-center text-[11px]">
                                   <span className="text-gray-500 font-bold uppercase">Commission :</span>
                                   <span className="font-black text-indigo-600 bg-indigo-100/50 px-2 py-0.5 rounded border border-indigo-100">{formatFCFA(order.remuneration || 0)}</span>
                               </div>
                           </div>
                       </div>
                   ) : (
                       <>
                           <h3 className="font-bold text-gray-800 text-lg leading-tight">{order.clientName}</h3>
                           {order.products && order.products.length > 0 ? (
                               <div className="flex items-start text-xs text-gray-500 font-medium mt-1">
                                   <Package size={12} className="mr-1 mt-0.5 flex-shrink-0" />
                                   <div className="whitespace-pre-wrap">
                                       {order.products?.map((p, i) => (
                                           <div key={i}>{p.quantity > 1 ? <span className="font-bold text-green-700">{p.quantity}x</span> : ''} {p.name}</div>
                                       ))}
                                   </div>
                               </div>
                           ) : order.productDetails && (
                               <div className="flex items-start text-xs text-gray-500 font-medium mt-1">
                                   <Package size={12} className="mr-1 mt-0.5 flex-shrink-0" />
                                   <div className="whitespace-pre-wrap">
                                       {order.productDetails.split('\n')?.map((line, i) => {
                                           const { quantity, productName } = parseProductCommand(line);
                                           return <div key={i}>{quantity > 1 ? <span className="font-bold text-green-700">{quantity}x</span> : ''} {productName}</div>;
                                       })}
                                   </div>
                               </div>
                           )}
                       </>
                   )}
                   
                   {/* Display Assignment Note if exists */}
                   {order.logs && order.logs.length > 0 && (() => {
                       const noteLog = [...order.logs].reverse().find(l => l.text.startsWith("Note d'attribution :"));
                       if (noteLog) {
                           return (
                               <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-xs text-yellow-800 flex items-start">
                                   <FileText size={12} className="mr-1.5 mt-0.5 flex-shrink-0" />
                                   <span className="font-medium">{noteLog.text.replace("Note d'attribution :", "").trim()}</span>
                               </div>
                           );
                       }
                       return null;
                   })()}
                </div>
                {order.clientPhone && (
                  <a href={`tel:${order.clientPhone}`} className="bg-green-600 text-white p-2.5 rounded-full hover:bg-green-700 shadow-md active:scale-95 transition-transform">
                     <Phone size={20} />
                  </a>
                )}
              </div>

              <div className="flex items-start text-gray-500 text-sm mb-4 mt-2 bg-gray-50 p-2 rounded-lg">
                 <MapPin size={16} className="mt-0.5 mr-2 flex-shrink-0 text-red-500" />
                 <span className="leading-snug">{order.address}</span>
              </div>

              {/* --- ACTIONS AREA --- */}
              {activeTab === 'unreachable' && (
                  <div className={isConfirming ? "mt-4 w-full" : "mt-4 flex gap-2"}>
                      {!isConfirming && (
                          <>
                              <button 
                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); executeAction(order.id, 'retry'); }}
                                className="flex-1 bg-green-600 text-white py-2 rounded-lg font-bold text-sm shadow-sm flex items-center justify-center hover:bg-green-700"
                              >
                                  <PlayCircle size={16} className="mr-2" /> Réexpédier
                              </button>
                              <button 
                                onClick={(e) => requestConfirm(e, order.id, 'cancel_options')}
                                className="p-2 border border-red-200 text-red-500 rounded-lg hover:bg-red-50"
                              >
                                  <XCircle size={20} />
                              </button>
                          </>
                      )}
                      {/* CANCELLATION OPTIONS IN UNREACHABLE TAB */}
                      {isConfirming && confirmType === 'cancel_options' && (
                          <div className="mt-3 space-y-2 animate-in fade-in slide-in-from-bottom-2">
                               <p className="text-center text-xs font-bold text-red-500 uppercase mb-1">Confirmer annulation ?</p>
                               <button onClick={(e) => requestConfirm(e, order.id, 'cancel_client')} className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-bold text-sm flex items-center justify-center hover:bg-red-50 hover:text-red-600">
                                  <UserX size={16} className="mr-2" /> Le client a annulé / Injoignable
                              </button>
                              <button onClick={(e) => requestConfirm(e, order.id, 'refuse_driver')} className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-bold text-sm flex items-center justify-center hover:bg-red-50 hover:text-red-600">
                                  <UserMinus size={16} className="mr-2" /> Je ne peux pas livrer
                              </button>
                               <button onClick={cancelConfirm} className="w-full py-2 text-sm text-gray-400 font-medium">Annuler</button>
                          </div>
                      )}
                  </div>
              )}

              {activeTab === 'todo' && (
                  <div className="mt-4">
                      {order.status === 'attente_paiement' ? (
                          <div className="flex flex-col items-center justify-center p-3 bg-yellow-50 border border-dashed border-yellow-300 rounded-xl text-center">
                              <Loader size={20} className="text-yellow-600 animate-spin mb-1" />
                              <p className="text-sm font-bold text-yellow-800">Validation Paiement en cours</p>
                          </div>
                      ) : order.status === 'attribué' ? (
                        <div className={isConfirming ? "w-full" : "flex space-x-3"}>
                             {isConfirming && confirmType === 'cancel_options' ? (
                                <div className="space-y-2 w-full animate-in fade-in slide-in-from-bottom-2">
                                     <button onClick={(e) => requestConfirm(e, order.id, 'cancel_client')} className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-bold text-sm flex items-center justify-center hover:bg-red-50 hover:text-red-600">
                                        <UserX size={16} className="mr-2" /> Le client a annulé
                                    </button>
                                    <button onClick={(e) => requestConfirm(e, order.id, 'refuse_driver')} className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-bold text-sm flex items-center justify-center hover:bg-red-50 hover:text-red-600">
                                        <UserMinus size={16} className="mr-2" /> Je ne peux pas livrer
                                    </button>
                                     <button onClick={cancelConfirm} className="w-full py-2 text-sm text-gray-400 font-medium">Retour</button>
                                </div>
                             ) : !isConfirming && (
                                <>
                                    <button onClick={(e) => requestConfirm(e, order.id, 'cancel_options')} className="w-12 bg-white border border-red-200 text-red-500 rounded-xl flex items-center justify-center hover:bg-red-50 transition-colors">
                                        <XCircle size={20} />
                                    </button>
                                    <button 
                                        onClick={(e) => requestConfirm(e, order.id, 'accept')} 
                                        className="flex-1 py-3 rounded-xl font-bold shadow-sm flex items-center justify-center transition-transform bg-yellow-400 text-green-900 hover:bg-yellow-500 active:scale-95"
                                    >
                                        <PlayCircle size={20} className="mr-2" /> 
                                        Accepter
                                    </button>
                                </>
                             )}
                        </div>
                      ) : (
                        /* EN COURS ACTIONS */
                        <div className="space-y-3">
                            {order.isDepotDelivery ? (
                                <div className="space-y-3">
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            executeAction(order.id, 'confirm_depot');
                                        }}
                                        className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold shadow-md hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center"
                                    >
                                        <CheckCircle size={20} className="mr-2" /> Confirmer Livraison au Dépôt
                                    </button>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); executeAction(order.id, 'mark_unreachable'); }}
                                            className="bg-orange-50 text-orange-600 border border-orange-200 py-2 rounded-lg font-bold text-xs flex flex-col items-center justify-center hover:bg-orange-100"
                                        >
                                            <PhoneOff size={16} className="mb-1" /> Injoignable
                                        </button>
                                        <button 
                                            onClick={(e) => requestConfirm(e, order.id, 'cancel_options')}
                                            className="bg-red-50 text-red-600 border border-red-200 py-2 rounded-lg font-bold text-xs flex flex-col items-center justify-center hover:bg-red-100"
                                        >
                                            <XCircle size={16} className="mb-1" /> Annuler
                                        </button>
                                    </div>
                                </div>
                            ) : commandeEnPaiement === order.id ? (
                                <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                    <p className="text-center text-xs font-bold text-gray-500 uppercase mb-1">Mode de paiement ?</p>
                                    <button onClick={(e) => { 
                                        e.stopPropagation(); 
                                        e.preventDefault(); 
                                        executeAction(order.id, 'especes');
                                    }} className="w-full bg-green-700 text-white py-3 rounded-xl font-bold shadow-md flex items-center justify-center border-b-4 border-green-800 active:border-b-0 active:translate-y-1">
                                        <Wallet size={18} className="mr-2" /> Encaissé (Espèce)
                                    </button>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button onClick={(e) => { 
                                            e.stopPropagation(); 
                                            e.preventDefault(); 
                                            executeAction(order.id, 'wave');
                                        }} className="w-full bg-[#1da1f2] text-white py-3 rounded-xl font-bold shadow-md flex flex-col items-center justify-center border-b-4 border-blue-700 active:border-b-0 active:translate-y-1">
                                            <span className="text-sm">Wave</span>
                                        </button>
                                        <button onClick={(e) => { 
                                            e.stopPropagation(); 
                                            e.preventDefault(); 
                                            executeAction(order.id, 'om');
                                        }} className="w-full bg-[#ff7900] text-white py-3 rounded-xl font-bold shadow-md flex flex-col items-center justify-center border-b-4 border-orange-700 active:border-b-0 active:translate-y-1">
                                            <span className="text-sm">Orange Money</span>
                                        </button>
                                    </div>
                                    <button onClick={cancelConfirm} className="w-full py-2 text-sm text-gray-500 font-medium">Annuler</button>
                                </div>
                            ) : (
                                <>
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            setCommandeEnPaiement(order.id);
                                        }}
                                        className={`w-full bg-green-600 text-white py-3.5 rounded-xl font-bold shadow-md hover:bg-green-700 active:scale-95 transition-all flex items-center justify-center ${isConfirming ? 'opacity-50 hidden' : ''}`}
                                    >
                                        <CheckCircle size={20} className="mr-2" /> Confirmer Livraison
                                    </button>
                                    
                                    {!isConfirming && (
                                        <div className="grid grid-cols-3 gap-2">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); e.preventDefault(); executeAction(order.id, 'mark_unreachable'); }}
                                                className="bg-orange-50 text-orange-600 border border-orange-200 py-2 rounded-lg font-bold text-xs flex flex-col items-center justify-center hover:bg-orange-100"
                                            >
                                                <PhoneOff size={16} className="mb-1" /> Injoignable
                                            </button>
                                            <button 
                                                onClick={() => openPostponeModal(order.id)}
                                                className="bg-purple-50 text-purple-600 border border-purple-200 py-2 rounded-lg font-bold text-xs flex flex-col items-center justify-center hover:bg-purple-100"
                                            >
                                                <CalendarClock size={16} className="mb-1" /> Reporter
                                            </button>
                                            <button 
                                                onClick={(e) => requestConfirm(e, order.id, 'cancel_options')}
                                                className="bg-red-50 text-red-600 border border-red-200 py-2 rounded-lg font-bold text-xs flex flex-col items-center justify-center hover:bg-red-100"
                                            >
                                                <XCircle size={16} className="mb-1" /> Annuler
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                            
                            {/* CANCELLATION OPTIONS IN MAIN TAB */}
                            {isConfirming && confirmType === 'cancel_options' && (
                                <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
                                     <p className="text-center text-xs font-bold text-red-500 uppercase mb-1">Quel est le problème ?</p>
                                     <button onClick={(e) => requestConfirm(e, order.id, 'cancel_client')} className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-bold text-sm flex items-center justify-center">
                                        <UserX size={16} className="mr-2" /> Le client a annulé
                                    </button>
                                    <button onClick={(e) => requestConfirm(e, order.id, 'refuse_driver')} className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-bold text-sm flex items-center justify-center">
                                        <UserMinus size={16} className="mr-2" /> Je ne peux pas livrer
                                    </button>
                                     <button onClick={cancelConfirm} className="w-full py-2 text-sm text-gray-400 font-medium">Retour</button>
                                </div>
                            )}
                        </div>
                      )}
                  </div>
              )}
              
              {/* --- DONE TAB ACTIONS --- */}
              {activeTab === 'done' && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center text-gray-600 text-sm font-medium">
                            {order.status === 'annulé' ? (
                                <div className="flex items-center text-red-500"><XCircle size={16} className="mr-1.5" /> Annulé</div>
                            ) : order.status === 'attente_paiement' ? (
                                <div className="flex items-center text-orange-500 animate-pulse"><Clock size={16} className="mr-1.5" /> En attente de validation</div>
                            ) : order.isDepotDelivery || order.status === 'expedition_livree' ? (
                                <div className="flex items-center text-indigo-600"><CheckCircle size={16} className="mr-1.5" /> Livré au Dépôt</div>
                            ) : (
                                <div className="flex items-center text-green-600"><CheckCircle size={16} className="mr-1.5" /> Livré</div>
                            )}
                        </div>
                        {(order.status === 'livré' || order.status === 'terminé' || order.status === 'attente_paiement' || order.status === 'expedition_livree' || order.isDepotDelivery) && (
                            <span className={`text-xs font-bold px-2 py-1 rounded border ${
                                order.paymentMethod === 'wave' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                order.paymentMethod === 'om' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                (order.isDepotDelivery || order.status === 'expedition_livree') ? 'bg-indigo-100 text-indigo-700 border-indigo-200' :
                                'bg-green-100 text-green-700 border-green-200'
                            }`}>
                                {order.paymentMethod === 'wave' ? 'Wave' : order.paymentMethod === 'om' ? 'Orange Money' : (order.isDepotDelivery || order.status === 'expedition_livree') ? 'Dépôt' : 'Espèce'}
                            </span>
                        )}
                    </div>
                    {/* Simplified Edit for brevity */}
                    <div className="flex gap-2">
                        {(order.status === 'livré' || order.status === 'terminé' || order.status === 'attente_paiement' || order.status === 'expedition_livree' || order.isDepotDelivery) && !isConfirming && <button onClick={() => handleInvoice(order)} className="flex-1 bg-green-50 text-green-700 border border-green-200 py-2 rounded-lg text-xs font-bold">Facture</button>}
                        {!isConfirming && (
                            <button 
                                onClick={(e) => requestConfirm(e, order.id, 'undo')}
                                className="flex-1 bg-gray-100 text-gray-600 border border-gray-200 py-2 rounded-lg text-xs font-bold flex items-center justify-center hover:bg-gray-200"
                            >
                                <RotateCcw size={14} className="mr-1" /> Erreur ? Annuler
                            </button>
                        )}
                    </div>

                    {isConfirming && confirmType === 'undo' && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-100 rounded-xl animate-in fade-in zoom-in-95">
                            <p className="text-center text-xs font-bold text-red-600 mb-3">Voulez-vous vraiment annuler cette action ?</p>
                            <div className="flex gap-2">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); executeAction(order.id, 'undo'); }}
                                    className="flex-1 bg-red-600 text-white py-2 rounded-lg text-xs font-bold shadow-sm"
                                >
                                    Oui, Annuler
                                </button>
                                <button 
                                    onClick={cancelConfirm}
                                    className="flex-1 bg-white text-gray-500 border border-gray-200 py-2 rounded-lg text-xs font-bold"
                                >
                                    Fermer
                                </button>
                            </div>
                        </div>
                    )}
                  </div>
              )}

              {/* DOUBLE VALIDATION FOR CANCELLATION (GLOBAL) */}
              {isConfirming && (confirmType === 'cancel_client' || confirmType === 'refuse_driver') && (
                  <div className="mt-3 p-4 bg-red-50 border border-red-200 rounded-xl animate-in fade-in zoom-in-95">
                      <p className="text-center text-sm font-bold text-red-700 mb-4">
                          {confirmType === 'cancel_client' 
                            ? "Confirmer que le client a annulé ?" 
                            : "Confirmer que vous ne pouvez pas livrer ?"}
                      </p>
                      <div className="flex gap-3">
                          <button 
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); executeAction(order.id, confirmType as any); }}
                            className="flex-1 bg-red-600 text-white py-3 rounded-lg font-bold shadow-sm hover:bg-red-700"
                          >
                              Oui, Confirmer
                          </button>
                          <button 
                            onClick={cancelConfirm}
                            className="flex-1 bg-white text-gray-500 border border-gray-200 py-3 rounded-lg font-bold"
                          >
                              Retour
                          </button>
                      </div>
                  </div>
              )}
            </div>
            );
          })
        )}
      </div>
      )}

      {/* POSTPONE MODAL */}
      {postponeOrderId && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
                      <CalendarClock className="mr-2 text-purple-600" /> Reporter la course
                  </h3>
                  <form onSubmit={handlePostponeSubmit} className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                          <input 
                              type="date" 
                              className="w-full border rounded-lg px-3 py-2"
                              value={postponeDate}
                              onChange={e => setPostponeDate(e.target.value)}
                              required
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Heure</label>
                          <input 
                              type="time" 
                              className="w-full border rounded-lg px-3 py-2"
                              value={postponeTime}
                              onChange={e => setPostponeTime(e.target.value)}
                              required
                          />
                      </div>
                      <div className="bg-purple-50 p-3 rounded-lg text-xs text-purple-800">
                          <p>La commande sera renvoyée à l'administrateur avec la note de report.</p>
                      </div>
                      <div className="flex gap-3 pt-2">
                          <button 
                            type="button" 
                            onClick={() => setPostponeOrderId(null)}
                            className="flex-1 py-2 text-gray-500 font-medium hover:bg-gray-100 rounded-lg"
                          >
                              Annuler
                          </button>
                          <button 
                            type="submit"
                            className="flex-1 py-2 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700"
                          >
                              Valider Report
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};
