import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { Upload, UserPlus, Search, Link as LinkIcon, RefreshCw, Settings, Check, AlertTriangle, ExternalLink, Edit2, X, Save, Ban, MapPin, Phone, CreditCard, ThumbsUp, ThumbsDown, CalendarClock, Package, AlertCircle, PlayCircle, MessageSquare } from 'lucide-react';
import { Order, Driver, Zone, OrderStatus, SystemUser, Product, StockLivreurEntry } from '../types';
import { DataService } from '../services/dataService';

import { parseProductCommand } from '../utils/productParser';
import { trouverProduitShopify } from '../utils/productMatcher';
import { OrderModal } from '../components/OrderModal';
import { formatFCFA } from '../utils/formatters';

interface DashboardProps {
  currentUser?: SystemUser;
}

export const Dashboard: React.FC<DashboardProps> = ({ currentUser }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Sync State
  const [showConfig, setShowConfig] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  // Local state for assignments being edited
  const [assignments, setAssignments] = useState<Record<string, { driverId: string; zoneId: string }>>({});

  // EDIT MODAL STATE
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [originalEditId, setOriginalEditId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // PRODUCT RESOLUTION MODAL STATE
  const [resolvingOrder, setResolvingOrder] = useState<Order | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  // DELETE CONFIRMATION STATE
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ASSIGNMENT MODAL STATE
  const [assignmentModal, setAssignmentModal] = useState<{
      orderId: string;
      zoneId: string;
      driverId?: string;
      isRegional: boolean;
  } | null>(null);
  const [stockLivreurs, setStockLivreurs] = useState<StockLivreurEntry[]>([]);
  const [isConfirmingAssignment, setIsConfirmingAssignment] = useState(false);
  const [assignmentType, setAssignmentType] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledDate, setScheduledDate] = useState<string>('');
  const [assignmentComment, setAssignmentComment] = useState(''); // New state for comment
  const [shippingComment, setShippingComment] = useState(''); // New state for shipping remarks

  useEffect(() => {
    loadData();

    let unsubscribe: (() => void) | undefined;
    let unsubscribeConfig: (() => void) | undefined;
    
    const setupSubscriptions = () => {
        unsubscribe = DataService.subscribeToOrders((newOrders) => {
            console.log("Dashboard: Received orders from subscription:", newOrders.length);
            setOrders(newOrders);
        }, "DASHBOARD");

        unsubscribeConfig = DataService.subscribeToConfig('googleSheetUrl', (val) => {
            if (val) setSheetUrl(val);
        });
    };

    const unsubscribeStock = DataService.subscribeToStockLivreurs((entries) => {
        setStockLivreurs(entries);
    });

    // Try immediately
    setupSubscriptions();

    return () => {
        unsubscribe?.();
        unsubscribeConfig?.();
        unsubscribeStock();
    };
  }, []);

  // Auto-sync interval for Google Sheet (separate from DB polling)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (sheetUrl) {
      handleSync(sheetUrl, true);
      interval = setInterval(() => handleSync(sheetUrl, true), 3 * 60 * 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [sheetUrl]);

  const loadData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    const [d, z, p] = await Promise.all([
      DataService.getDrivers(),
      DataService.getZones(),
      DataService.getProducts()
    ]);
    setDrivers(d);
    setZones(z);
    setProducts(p);
    if (showLoading) setLoading(false);
  };

  // --- PRODUCT MATCHING LOGIC ---
  const findMatchingProduct = (productDetails?: string): Product | undefined => {
      if (!productDetails) return undefined;
      const { productName } = parseProductCommand(productDetails);
      const match = trouverProduitShopify(productName, products);
      if (match) return match;
      
      // Fallback to SKU match if not found by name
      const normalizedDetails = productName.toLowerCase();
      const skuMatch = products.find(p => p.variants && p.variants.some(v => v.sku && v.sku.toLowerCase() === normalizedDetails));
      if (skuMatch) return skuMatch;

      return undefined;
  };

  // Pre-select suggestion when resolvingOrder changes
  useEffect(() => {
    if (resolvingOrder && !selectedProductId) {
      const suggestion = findMatchingProduct(resolvingOrder.productDetails);
      if (suggestion) {
        setSelectedProductId(suggestion.id);
      }
    }
  }, [resolvingOrder, products]);

  // State to track if we were trying to assign an order when resolution interrupted
  const [pendingAssignment, setPendingAssignment] = useState<{orderId: string, type: 'assign'} | null>(null);

  const handleResolveProduct = async () => {
      if (!resolvingOrder || !selectedProductId) return;
      
      const updatedOrder = { ...resolvingOrder, productId: selectedProductId };
      await DataService.saveOrder(updatedOrder);
      setOrders(prev => prev?.map(o => o.id === resolvingOrder.id ? updatedOrder : o));
      
      const wasPending = pendingAssignment?.orderId === resolvingOrder.id;
      
      setResolvingOrder(null);
      setSelectedProductId('');
      setPendingAssignment(null);

      // If we were trying to assign, retry automatically
      if (wasPending) {
          // Small delay to allow state to settle
          setTimeout(() => confirmAssignment(updatedOrder.id, updatedOrder), 100);
      }
  };

  // ...

  const confirmAssignment = async (orderId: string, resolvedOrder?: Order) => {
    const assign = assignments[orderId];
    const order = resolvedOrder || orders.find(o => o.id === orderId);
    
    if (!order) return;

    // 1. Check if product is resolved
    if (!order.productId && (!order.products || order.products.length === 0)) {
        setResolvingOrder(order);
        // Pre-select suggestion if found
        const suggestion = findMatchingProduct(order.productDetails);
        if (suggestion) {
            setSelectedProductId(suggestion.id);
        }
        setPendingAssignment({ orderId, type: 'assign' });
        return;
    }

    // 2. Validate Selections
    if (!assign || !assign.zoneId) {
      alert("⚠️ Veuillez d'abord sélectionner une ZONE dans la colonne 'Zone'.");
      return;
    }

    const zone = zones.find(z => z.id === assign.zoneId);
    if (!zone) return;

    const isRegional = zone.type === 'regional';

    if (!isRegional && !assign.driverId) {
        alert("⚠️ Veuillez sélectionner un LIVREUR dans la colonne 'Livreur'.");
        return;
    }

    // 3. Proceed with Assignment (Open Modal)
    setAssignmentModal({
        orderId,
        zoneId: assign.zoneId,
        driverId: assign.driverId,
        isRegional
    });
    setAssignmentType('immediate'); // Force immediate assignment
    setAssignmentComment(order.remarks || order.assignmentRemarks || ''); // Pre-fill with Excel remarks or previous assignment remarks
    setShippingComment(order.shippingRemarks || ''); // Pre-fill with previous shipping remarks
    setIsConfirmingAssignment(false); // Reset confirmation state
    
    // Default to current time for scheduling (though not used for immediate)
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    const localTime = new Date(now.getTime() - offsetMs);
    setScheduledDate(localTime.toISOString().slice(0, 16));
  };

  const handleScheduleClick = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // Use assignments state if touched, otherwise fallback to order's existing data
    const assign = assignments[orderId] || { 
        zoneId: order.zoneId || '', 
        driverId: order.driverId || '' 
    };

    // 1. Check if product is resolved (same as confirmAssignment)
    if (!order.productId && (!order.products || order.products.length === 0)) {
        setResolvingOrder(order);
        const suggestion = findMatchingProduct(order.productDetails);
        if (suggestion) {
            setSelectedProductId(suggestion.id);
        }
        setPendingAssignment({ orderId, type: 'assign' });
        return;
    }

    const zoneId = assign.zoneId || order.zoneId || '';
    const zone = zones.find(z => z.id === zoneId);
    const isRegional = zone?.type === 'regional';

    setAssignmentModal({
        orderId,
        zoneId: zoneId,
        driverId: assign.driverId || order.driverId || undefined,
        isRegional: !!isRegional
    });
    setAssignmentType('scheduled'); // Force scheduled assignment
    setAssignmentComment(order.remarks || order.assignmentRemarks || ''); // Pre-fill with Excel remarks or previous assignment remarks
    setShippingComment(order.shippingRemarks || ''); // Pre-fill with previous shipping remarks
    setIsConfirmingAssignment(false);
    
    // Default to current scheduled date if it exists, otherwise now
    const now = order.scheduledAt ? new Date(order.scheduledAt) : new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    const localTime = new Date(now.getTime() - offsetMs);
    setScheduledDate(localTime.toISOString().slice(0, 16));
  };

  const assignmentAlerts = useMemo(() => {
    if (!assignmentModal || !assignmentModal.driverId) return [];
    
    const order = orders.find(o => o.id === assignmentModal.orderId);
    if (!order) return [];

    const driverId = assignmentModal.driverId;
    const driverStockMap = stockLivreurs
      .filter(s => s.livreurId === driverId)
      .reduce((acc, s) => {
        const currentSF = (s.SI || 0) + (s.entrees || 0) - (s.sorties || 0) + (s.ajustementManuel || 0);
        acc[s.produitNom.trim().toLowerCase()] = currentSF;
        return acc;
      }, {} as Record<string, number>);

    // Get products of the current order
    const currentOrderProducts: { nom: string; quantite: number }[] = [];
    if (order.products && order.products.length > 0) {
      order.products.forEach(p => {
        currentOrderProducts.push({ nom: p.name, quantite: p.quantity });
      });
    } else if (order.productDetails) {
      order.productDetails.split('\n').forEach(line => {
        const { quantity, productName } = parseProductCommand(line);
        if (productName) {
          currentOrderProducts.push({ nom: productName, quantite: quantity });
        }
      });
    }

    const alertes: { niveau: "ERREUR" | "AVERTISSEMENT" | "INFO"; message: string }[] = [];

    currentOrderProducts.forEach(produit => {
      const stockActuel = driverStockMap[produit.nom.trim().toLowerCase()] ?? 0;

      const commandesActives = orders.filter(c =>
        c.driverId === driverId &&
        ["attribué", "en_cours"].includes(c.status) &&
        c.id !== order.id
      );

      const quantiteEngagee = commandesActives.reduce((total, cmd) => {
        let cmdQty = 0;
        if (cmd.products && cmd.products.length > 0) {
          cmd.products.forEach(p => {
            if (p.name.trim().toLowerCase() === produit.nom.trim().toLowerCase()) {
              cmdQty += p.quantity;
            }
          });
        } else if (cmd.productDetails) {
          cmd.productDetails.split('\n').forEach(ligne => {
            const match = ligne.match(/^(\d+)\s*[xX]\s*(.+)$/);
            if (match && match[2].trim().toLowerCase() === produit.nom.trim().toLowerCase()) {
              cmdQty += parseInt(match[1]);
            }
          });
        }
        return total + cmdQty;
      }, 0);

      const stockApresAttribution = stockActuel - produit.quantite;
      const stockApresLivraisons = stockActuel - quantiteEngagee - produit.quantite;

      if (stockActuel < produit.quantite) {
        alertes.push({
          niveau: "ERREUR",
          message: `⛔ ${produit.nom} : le livreur n'a que ${stockActuel} unité(s) en stock pour ${produit.quantite} commandée(s).`
        });
      } else if (stockApresLivraisons < 0) {
        alertes.push({
          niveau: "AVERTISSEMENT",
          message: `⚠️ ${produit.nom} : stock actuel ${stockActuel} unité(s), mais ${quantiteEngagee} livraison(s) active(s) déjà en cours. Risque de rupture si toutes sont livrées.`
        });
      } else if (stockApresAttribution <= 2) {
        alertes.push({
          niveau: "INFO",
          message: `ℹ️ ${produit.nom} : il ne restera que ${stockApresAttribution} unité(s) après cette attribution.`
        });
      }
    });

    return alertes;
  }, [assignmentModal, orders, stockLivreurs]);

  const handleFinalizeAssignment = async () => {
      if (!assignmentModal) return;

      if (assignmentType === 'scheduled' && !scheduledDate) {
          alert("Veuillez choisir une date et une heure.");
          return;
      }

      // Double validation step
      if (!isConfirmingAssignment) {
          // Zone is only required for immediate assignment
          if (assignmentType === 'immediate' && !assignmentModal.zoneId) {
              alert("Veuillez sélectionner une zone de livraison.");
              return;
          }
          setIsConfirmingAssignment(true);
          return;
      }

      const { orderId, zoneId, driverId, isRegional } = assignmentModal;
      const order = orders.find(o => o.id === orderId);
      const zone = zoneId ? zones.find(z => z.id === zoneId) : null;

      if (!order) {
          console.error("Order not found during finalization", { orderId });
          return;
      }
      
      if (assignmentType === 'immediate' && !zone) {
          alert("Zone introuvable.");
          return;
      }
      console.log("Finalizing assignment for order:", orderId, "to driver:", driverId);

      const scheduledAt = assignmentType === 'scheduled' ? new Date(scheduledDate).toISOString() : null;

      // Prepare log if comment exists
      const newLogs = order.logs || [];
      if (assignmentComment.trim()) {
          newLogs.push({
              id: Date.now().toString(),
              text: `Note d'attribution : ${assignmentComment}`,
              author: currentUser?.username || 'Admin',
              createdAt: new Date().toISOString()
          });
      }

      // REGIONAL
      if (isRegional && zone) {
          // Snapshot purchase price
          let purchaseCost = undefined;
          if (order.productId) {
              const product = products.find(p => p.id === order.productId);
              if (product) {
                  purchaseCost = product.purchasePrice;
              }
          }

          const updatedOrder: Order = {
              ...order,
              zoneId: zone.id,
              status: 'regional_en_attente',
              assignedAt: new Date().toISOString(),
              driverId: null,
              remuneration: null,
              shippingFee: zone.rate,
              scheduledAt,
              logs: newLogs,
              purchaseCost, // Snapshot
              assignmentRemarks: assignmentComment.trim(),
              shippingRemarks: shippingComment.trim(),
          };
          try {
              console.log("Saving REGIONAL order to DB:", updatedOrder);
              await DataService.saveOrder(updatedOrder);
              console.log("Regional order saved successfully");
              setOrders(prev => prev?.map(o => o.id === orderId ? updatedOrder : o));
          } catch (e) {
              console.error("Error saving regional order", e);
              alert("Erreur lors de l'enregistrement régional.");
          }
      } else if (driverId && zone) {
          // LOCAL
          const driver = drivers.find(d => d.id === driverId);
          const updatedOrder: Order = {
            ...order,
            driverId: driverId || null,
            driverName: driver?.name || null,
            zoneId: zoneId,
            remuneration: driverId ? zone.rate : null,
            status: driverId ? 'attribué' : 'validé',
            assignedAt: driverId ? new Date().toISOString() : null,
            refusedBy: null,
            postponedAt: null,
            scheduledAt,
            logs: newLogs,
            assignmentRemarks: assignmentComment.trim(),
          };

          try {
              console.log("=== ATTRIBUTION ===");
              console.log("commandeId:", orderId);
              console.log("livreur écrit:", driverId);
              console.log("zone écrite:", zoneId);
              console.log("statut écrit:", "attribué");

              const driver = drivers.find(d => d.id === driverId);
              console.log("Saving LOCAL order to DB:", updatedOrder);
              
              await DataService.saveOrder(updatedOrder);
              console.log("Local order saved successfully");

              // Mettre à jour la liste locale
              setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));
              
              if (driver && driver.phone) {
                  const cleanProductMsg = (qty: number, name: string) => {
                      if (!name) return `${qty} X Produit`;
                      if (/^\d+\s*[xX]/.test(name)) return name;
                      return `${qty} X ${name}`;
                  };

                  let productsMsg = "";
                  if (order.products && order.products.length > 0) {
                      productsMsg = order.products.map(p => cleanProductMsg(p.quantity, p.name)).join('\n');
                  } else {
                      productsMsg = cleanProductMsg(order.quantity || 1, order.productDetails || 'Produit');
                  }

                  // Construction du message avec des sauts de ligne explicites
                  const msg = [
                      order.address,
                      order.clientPhone || '',
                      productsMsg,
                      order.amount
                  ].filter(Boolean).join('\n');
                  
                  let finalMsg = msg;
                  if (scheduledAt) {
                      finalMsg += `\n\n📅 Prévue pour : ${new Date(scheduledAt).toLocaleString()}`;
                  }
                  if (assignmentComment.trim()) {
                      finalMsg += `\n\n📝 Note : ${assignmentComment}`;
                  }
                  
                  const url = `https://wa.me/${driver.phone}?text=${encodeURIComponent(finalMsg)}`;
                  window.open(url, '_blank');
              }
          } catch (e) {
              console.error("Error saving order", e);
              alert("Erreur lors de l'enregistrement.");
          }
      } else {
          // SCHEDULED WITHOUT ASSIGNMENT
          const updatedOrder: Order = {
              ...order,
              status: 'validé' as OrderStatus,
              scheduledAt,
              logs: newLogs
          };
          try {
              await DataService.saveOrder(updatedOrder);
              setOrders(prev => prev?.map(o => o.id === orderId ? updatedOrder : o));
          } catch (e) {
              console.error("Error scheduling order", e);
              alert("Erreur lors de la programmation.");
          }
      }

      // Cleanup
      const newAssigns = { ...assignments };
      delete newAssigns[orderId];
      setAssignments(newAssigns);
      setAssignmentModal(null);
      setIsConfirmingAssignment(false);
  };

  const convertToCsvUrl = (url: string): string => {
    try {
      if (!url.includes('docs.google.com/spreadsheets')) return url;
      
      // Extract ID
      const matches = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!matches || !matches[1]) return url;
      const docId = matches[1];

      // Handle specific sheet GID if present
      const gidMatch = url.match(/[#&]gid=([0-9]+)/);
      const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';

      return `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv${gidParam}`;
    } catch (e) {
      return url;
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsSyncing(true);
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
            const allProducts = await DataService.getProducts();
            const { count, ignored } = await DataService.importProcessedOrders(results.data, allProducts);
            
            let msg = `${count} commandes "validé" importées avec succès !`;
            if (ignored > 0) msg += `\n(${ignored} autres commandes ignorées car statut non-validé)`;
            alert(msg);
            await loadData(false);
        } catch (e) {
            console.error(e);
            alert("Erreur lors de l'importation");
        } finally {
            setIsSyncing(false);
        }
      },
      error: (err) => {
          console.error(err);
          alert("Erreur de lecture du fichier");
          setIsSyncing(false);
      }
    });
  };

  const handleUrlSave = async () => {
    const csvUrl = convertToCsvUrl(sheetUrl);
    await DataService.saveConfig('googleSheetUrl', csvUrl);
    setSheetUrl(csvUrl);
    setShowConfig(false);
    if (csvUrl) handleSync(csvUrl);
  };

  const handleSync = async (url: string, isAuto = false) => {
    if (!url) return;
    setIsSyncing(true);
    setSyncError('');

    try {
      const { count, ignored } = await DataService.syncFromGoogleSheet(url);
      setLastSync(new Date());
      if (!isAuto) {
          let msg = count === 0 ? "Aucune NOUVELLE commande 'validé' trouvée." : `${count} nouvelles commandes importées !`;
          if (ignored > 0) msg += `\n(${ignored} ignorées car statut incorrect)`;
          alert(msg);
      }
      await loadData(false);
    } catch (err: any) {
      console.error(err);
      setSyncError(err.message || "Erreur connexion");
    } finally {
      setIsSyncing(false);
    }
  };

  const getTodayString = () => new Date().toISOString().split('T')[0];

  // Main Filter: Only 'validé' (Unassigned) orders. Postponed orders are also 'validé'.
  const estProgrammee = (o: Order) => {
    const dateProg = o.scheduledAt || (o as any).dateProgrammee || (o as any).scheduledDate || (o as any).scheduled_date;
    if (!dateProg) return false;
    
    const now = new Date();
    const schedDate = new Date(dateProg);
    
    // The user wants it to appear in the normal dashboard 1 minute after the scheduled time.
    // So if now >= schedDate + 1 minute, it's no longer "Scheduled" (it becomes "Unassigned").
    // We return true (is scheduled) if now < schedDate + 1 minute.
    return now.getTime() < (schedDate.getTime() + 60000);
  };

  const unassignedOrders = useMemo(() => {
    return orders.filter(o => o.status === 'validé' && !o.driverId && !estProgrammee(o));
  }, [orders]);

  const handleDeliverImmediately = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const updatedOrder: Order = {
      ...order,
      status: 'validé' as OrderStatus,
      driverId: null,
      driverName: null,
      zoneId: null,
      remuneration: null,
      scheduledAt: null,
      postponedAt: null,
      logs: [
        ...(order.logs || []),
        {
          id: Date.now().toString(),
          text: "Livraison immédiate demandée (déprogrammation et remise en attente)",
          author: currentUser?.username || 'Admin',
          createdAt: new Date().toISOString()
        }
      ]
    };

    try {
      await DataService.saveOrder(updatedOrder);
      setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o));
    } catch (e) {
      console.error("Error delivering immediately:", e);
      alert("Erreur lors de la mise à jour.");
    }
  };
  
  const scheduledOrders = useMemo(() => {
    return orders.filter(o => estProgrammee(o)).sort((a, b) => {
      const dateA = new Date(a.scheduledAt || a.importedAt || a.date).getTime();
      const dateB = new Date(b.scheduledAt || b.importedAt || b.date).getTime();
      return dateA - dateB; // Sort by scheduled date ascending
    });
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return unassignedOrders.filter(o => 
      o.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.clientPhone && o.clientPhone.includes(searchTerm))
    ).sort((a, b) => {
      const dateA = new Date(a.importedAt || a.date).getTime();
      const dateB = new Date(b.importedAt || b.date).getTime();
      return dateB - dateA;
    });
  }, [unassignedOrders, searchTerm]);
  
  // Pending Payment Validation
  const pendingPaymentOrders = orders.filter(o => o.status === 'attente_paiement').sort((a, b) => {
    const dateA = new Date(a.importedAt || a.date).getTime();
    const dateB = new Date(b.importedAt || b.date).getTime();
    return dateB - dateA;
  });

  const handleAssignmentChange = (orderId: string, field: 'driverId' | 'zoneId', value: string) => {
    setAssignments(prev => ({
      ...prev,
      [orderId]: {
        driverId: field === 'driverId' ? value : prev[orderId]?.driverId || '',
        zoneId: field === 'zoneId' ? value : prev[orderId]?.zoneId || '',
      }
    }));
  };



  const validatePayment = async (orderId: string, isValid: boolean) => {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;

      let updated: Order;
      if (isValid) {
          updated = { ...order, status: 'livré' }; // Confirmed delivered (Paid via mobile)
          // Open WhatsApp to notify driver
          if (order.driverId) {
              const driver = drivers.find(d => d.id === order.driverId);
              if (driver && driver.phone) {
                  const message = `Paiement Wave/OM pour la commande #${order.id} confirmé. Bon travail!`;
                  const url = `https://wa.me/${driver.phone}?text=${encodeURIComponent(message)}`;
                  window.open(url, '_blank');
              }
          }
      } else {
          updated = { 
              ...order, 
              status: 'en_cours', // Revert to driver
              paymentMethod: undefined // Clear payment method so they can try again
          };
          // Restore stock since it was deducted when driver marked as attente_paiement
          if (order.driverId) {
              const orderProducts = order.products && order.products.length > 0 
                  ? order.products.map(p => ({ productId: p.sku || '', quantity: p.quantity }))
                  : (order.productDetails || '').split('\n').map(line => {
                      const { quantity, productName } = parseProductCommand(line);
                      const product = products.find(p => p.title === productName);
                      return { productId: product?.id || productName, quantity };
                  }).filter(p => p.quantity > 0);

              for (const p of orderProducts) {
                  await DataService.updateDriverStock(p.productId, order.driverId, p.quantity, 'restore');
              }
          }
      }

      await DataService.saveOrder(updated);
      setOrders(prev => prev?.map(o => o.id === orderId ? updated : o));
  };

  const openEditModal = (order: Order) => {
      setEditingOrder({ ...order }); // Clone
      setOriginalEditId(order.id);
      setIsModalOpen(true);
  };



  const handleCancelClick = async (orderId: string) => {
      if (deleteConfirmId === orderId) {
          // Second click: Cancel
          try {
              const orderToCancel = orders.find(o => o.id === orderId);
              if (orderToCancel) {
                  setOrders(prev => prev.filter(o => o.id !== orderId)); // Optimistic UI
                  
                  // Restore stock if it was delivered
                  const isDelivered = (s: string) => s === 'livré' || s === 'terminé' || s === 'attente_paiement';
                  if (isDelivered(orderToCancel.status) && orderToCancel.driverId) {
                      const orderProducts = orderToCancel.products && orderToCancel.products.length > 0 
                          ? orderToCancel.products.map(p => ({ productId: p.sku || '', quantity: p.quantity }))
                          : (orderToCancel.productDetails || '').split('\n').map(line => {
                              const { quantity, productName } = parseProductCommand(line);
                              const product = products.find(p => p.title === productName);
                              return { productId: product?.id || productName, quantity };
                          }).filter(p => p.quantity > 0);

                      for (const p of orderProducts) {
                          await DataService.updateDriverStock(p.productId, orderToCancel.driverId, p.quantity, 'restore');
                      }
                  }

                  await DataService.saveOrder({
                      ...orderToCancel,
                      status: 'annulé',
                      cancelReason: 'Annulation depuis Dashboard'
                  });
              }
              setDeleteConfirmId(null);
          } catch (e) {
              console.error(e);
              loadData(); // Revert
          }
      } else {
          // First click: Confirm
          setDeleteConfirmId(orderId);
          setTimeout(() => setDeleteConfirmId(prev => prev === orderId ? null : prev), 3000);
      }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Chargement...</div>;

  return (
    <div className="space-y-6 pb-40">
      
      {/* --- PENDING PAYMENT VALIDATION SECTION --- */}
      {pendingPaymentOrders.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 shadow-sm animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center mb-4">
                  <div className="bg-yellow-100 p-2 rounded-full mr-3">
                    <CreditCard className="text-yellow-700" size={24} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">Validation Paiements Mobile</h3>
                    <p className="text-sm text-yellow-800">Les livreurs déclarent avoir reçu ces paiements par Wave/OM. Confirmez la réception.</p>
                  </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pendingPaymentOrders?.map(order => {
                      const drv = drivers.find(d => d.id === order.driverId);
                      const isWave = order.paymentMethod === 'wave';
                      const methodText = isWave ? 'Paiement Wave' : order.paymentMethod === 'om' ? 'Paiement OM' : 'Paiement Mobile';
                      const methodColor = isWave 
                        ? 'text-blue-700 bg-blue-100 border-blue-200' 
                        : order.paymentMethod === 'om'
                            ? 'text-orange-700 bg-orange-100 border-orange-200'
                            : 'text-gray-700 bg-gray-100 border-gray-200';

                      return (
                          <div key={order.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col justify-between">
                              <div>
                                  <div className="flex justify-between items-start mb-2">
                                      <span className="font-bold text-gray-800">#{order.id}</span>
                                      <span className="font-bold text-green-700">{formatFCFA(order.amount)}</span>
                                  </div>
                                  <p className="text-sm text-gray-600 mb-2">{order.clientName}</p>
                                  
                                  <div className={`mb-3 inline-flex items-center px-2 py-1 rounded border text-xs font-bold ${methodColor}`}>
                                      {methodText}
                                  </div>

                                  <p className="text-xs text-gray-400 mb-3">Livreur : <span className="font-semibold text-gray-600">{drv?.name || 'Inconnu'}</span></p>
                              </div>
                              <div className="flex gap-2 pt-2 border-t border-gray-50">
                                  <button 
                                    onClick={() => validatePayment(order.id, true)}
                                    className="flex-1 bg-green-600 text-white py-2 rounded text-xs font-bold hover:bg-green-700 flex items-center justify-center"
                                  >
                                      <ThumbsUp size={14} className="mr-1" /> Bien reçu
                                  </button>
                                  <button 
                                    onClick={() => validatePayment(order.id, false)}
                                    className="flex-1 bg-white border border-red-200 text-red-600 py-2 rounded text-xs font-bold hover:bg-red-50 flex items-center justify-center"
                                  >
                                      <ThumbsDown size={14} className="mr-1" /> Pas reçu
                                  </button>
                              </div>
                          </div>
                      )
                  })}
              </div>
          </div>
      )}

      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Card 1: Data Source */}
        <div className="bg-green-700 rounded-xl p-6 text-white relative overflow-hidden shadow-lg group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <RefreshCw size={100} />
            </div>
            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <h3 className="font-bold text-lg">Source Données</h3>
                    <button onClick={() => setShowConfig(true)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                        <Settings size={20} />
                    </button>
                </div>
                
                {sheetUrl ? (
                    <div className="space-y-3">
                        <div className="flex items-center text-sm bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                            <LinkIcon size={16} className="mr-2" />
                            <span className="truncate flex-1">Connecté au Sheet</span>
                        </div>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => handleSync(sheetUrl)}
                                disabled={isSyncing}
                                className="flex-1 bg-white text-green-800 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-green-50 flex items-center justify-center"
                            >
                                <RefreshCw size={16} className={`mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
                                {isSyncing ? '...' : 'Sync'}
                            </button>
                        </div>
                        {lastSync && <p className="text-[10px] opacity-80 mt-1">Dernière maj: {lastSync.toLocaleTimeString()}</p>}
                        {syncError && <p className="text-xs bg-red-500/20 p-1 rounded text-red-100">{syncError}</p>}
                    </div>
                ) : (
                    <div>
                        <button 
                            onClick={() => setShowConfig(true)}
                            className="bg-white text-green-800 px-4 py-2 rounded-lg font-bold text-sm shadow-sm hover:bg-green-50 flex items-center transition-colors mb-2"
                        >
                            <LinkIcon size={16} className="mr-2" />
                            Connecter Drive
                        </button>
                        <p className="text-xs opacity-70">ou import manuel ci-dessous</p>
                    </div>
                )}
            </div>
        </div>

        {/* Card 2: Unassigned Count */}
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm flex flex-col justify-between group relative">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-gray-500 font-medium mb-1">Commandes à attribuer</h3>
                    <div className="text-4xl font-black text-gray-800">{unassignedOrders.length}</div>
                </div>
                {sheetUrl && (
                    <button 
                        onClick={() => handleSync(sheetUrl)}
                        disabled={isSyncing}
                        className="bg-green-50 text-green-700 p-2 rounded-lg hover:bg-green-100 transition-colors border border-green-100 shadow-sm active:scale-90"
                        title="Synchroniser Google Drive"
                    >
                        <RefreshCw size={20} className={isSyncing ? 'animate-spin' : ''} />
                    </button>
                )}
            </div>
            {unassignedOrders.length > 0 && (
                <div className="text-xs text-orange-600 font-medium mt-2 bg-orange-50 inline-block px-2 py-1 rounded self-start">
                    Action requise
                </div>
            )}
        </div>

        {/* Card 3: Scheduled Count */}
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm flex flex-col justify-between group relative">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="text-gray-500 font-medium mb-1">Commandes programmées</h3>
                    <div className="text-4xl font-black text-purple-600">{scheduledOrders.length}</div>
                </div>
                {sheetUrl && (
                    <button 
                        onClick={() => handleSync(sheetUrl)}
                        disabled={isSyncing}
                        className="bg-purple-50 text-purple-700 p-2 rounded-lg hover:bg-purple-100 transition-colors border border-purple-100 shadow-sm active:scale-90"
                        title="Synchroniser Google Drive"
                    >
                        <RefreshCw size={20} className={isSyncing ? 'animate-spin' : ''} />
                    </button>
                )}
            </div>
            <div className="text-xs text-purple-600 font-medium mt-2 bg-purple-50 inline-block px-2 py-1 rounded self-start">
                Planifiées pour le futur
            </div>
        </div>

        {/* Card 4: Manual Import */}
        <label className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center cursor-pointer hover:border-green-500 hover:bg-green-50 transition-all border-dashed border-2">
            <Upload size={32} className="text-green-600 mb-2" />
            <span className="font-bold text-gray-700 text-sm">Import Excel Manuel</span>
            <span className="text-xs text-gray-400 mt-1">(Uniquement statut "validé")</span>
            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
        </label>
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
        <div className="p-4 md:p-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center justify-between w-full md:w-auto">
                <h2 className="text-lg font-bold text-gray-800">Commandes non attribuées</h2>
                {sheetUrl && (
                    <button 
                        onClick={() => handleSync(sheetUrl)}
                        disabled={isSyncing}
                        className="lg:hidden flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg font-bold text-xs border border-green-200 active:scale-95 transition-transform"
                        title="Synchroniser Google Drive"
                    >
                        <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                        <span>Rafraîchir {isSyncing ? '...' : ''}</span>
                    </button>
                )}
            </div>
            <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                <input 
                    type="text" 
                    placeholder="Rechercher ID, Client..." 
                    className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-green-500 focus:border-green-500 bg-white text-gray-900"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>
        </div>

        {/* --- MOBILE CARD VIEW --- */}
        <div className="md:hidden bg-gray-50 p-4 space-y-4">
            {filteredOrders.length === 0 ? (
                <div className="text-center text-gray-400 py-8 bg-white rounded-lg border border-dashed">
                    <p>Aucune commande à afficher.</p>
                </div>
            ) : (
                filteredOrders?.map(order => {
                    const currentAssign = assignments[order.id] || { driverId: '', zoneId: '' };
                    const isConfirming = deleteConfirmId === order.id;
                    const isPostponed = order.postponedAt;
                    const selectedZone = zones.find(z => z.id === currentAssign.zoneId);
                    const isRegional = selectedZone?.type === 'regional';

                    return (
                        <div key={order.id} className={`bg-white p-4 rounded-xl shadow-sm border ${isPostponed ? 'border-purple-200' : 'border-gray-200'}`}>
                             <div className="flex justify-between items-start mb-3">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-gray-900">{order.clientName}</span>
                                        <button onClick={() => openEditModal(order)} className="text-gray-400 hover:text-green-600">
                                            <Edit2 size={12} />
                                        </button>
                                    </div>
                                    <div className="text-sm text-gray-700 font-medium flex items-center mt-1">
                                        <Phone size={12} className="mr-1" />
                                        {order.clientPhone || 'Pas de numéro'}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <span className="block font-bold text-green-700 bg-green-50 px-2 py-1 rounded text-xs border border-green-100">
                                        {formatFCFA(order.amount)}
                                    </span>
                                    <span className="text-[10px] text-gray-400 mt-1 block">#{order.id}</span>
                                </div>
                             </div>

                             <div className="text-sm text-gray-600 mb-3 flex items-start bg-gray-50 p-2 rounded">
                                <MapPin size={14} className="mt-0.5 mr-1.5 text-gray-400 flex-shrink-0" />
                                <span className="line-clamp-2">{order.address}</span>
                             </div>

                             {order.remarks && (
                                <div className="text-xs text-orange-700 mb-2 bg-orange-50 p-2 rounded flex items-start gap-1.5 border border-orange-100 font-medium">
                                    <MessageSquare size={14} className="mt-0.5 flex-shrink-0" />
                                    <span><strong>Remarque :</strong> {order.remarks}</span>
                                </div>
                             )}

                             {order.assignmentRemarks && (
                                <div className="text-xs text-blue-700 mb-2 bg-blue-50 p-2 rounded flex items-start gap-1.5 border border-blue-100 font-medium">
                                    <MessageSquare size={14} className="mt-0.5 flex-shrink-0" />
                                    <span><strong>Note Attribution :</strong> {order.assignmentRemarks}</span>
                                </div>
                             )}

                             {order.shippingRemarks && (
                                <div className="text-xs text-indigo-700 mb-3 bg-indigo-50 p-2 rounded flex items-start gap-1.5 border border-indigo-100 font-medium">
                                    <MessageSquare size={14} className="mt-0.5 flex-shrink-0" />
                                    <span><strong>Note Région :</strong> {order.shippingRemarks}</span>
                                </div>
                             )}

                             {order.products && order.products.length > 0 ? (
                                <div className="text-xs text-gray-900 mb-3 bg-gray-50 p-2 rounded whitespace-pre-wrap">
                                    {order.products?.map((p, i) => (
                                        <div key={i}>{p.quantity > 1 ? <span className="font-bold text-green-700">{p.quantity}x</span> : ''} {p.name}</div>
                                    ))}
                                </div>
                             ) : order.productDetails && (
                                <div className="text-xs text-gray-900 mb-3 bg-gray-50 p-2 rounded whitespace-pre-wrap">
                                    {order.productDetails.split('\n')?.map((line, i) => {
                                        const { quantity, productName } = parseProductCommand(line);
                                        return <div key={i}>{quantity > 1 ? <span className="font-bold text-green-700">{quantity}x</span> : ''} {productName}</div>;
                                    })}
                                </div>
                             )}

                             {/* Status Info */}
                             {order.refusedBy && (
                                <div className="mb-3 flex items-center text-[10px] text-red-600 font-bold bg-red-50 px-2 py-1 rounded border border-red-100">
                                    <AlertTriangle size={10} className="mr-1" />
                                    Refusé par: {order.refusedBy}
                                </div>
                            )}
                            
                            {/* Notification for Postponed orders */}
                            {isPostponed && (
                                <div className="mb-3 flex items-center text-[10px] text-purple-700 font-bold bg-purple-50 px-2 py-1 rounded border border-purple-100">
                                    <CalendarClock size={10} className="mr-1" />
                                    Reporté au : {new Date(order.postponedAt!).toLocaleString()}
                                </div>
                            )}

                             <div className="grid grid-cols-2 gap-3 mb-4">
                                {/* ... Selects ... */}
                                <div className={isRegional ? 'col-span-2' : ''}>
                                    <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">Zone</label>
                                    <select 
                                        className="border rounded-lg px-2 py-2 w-full bg-white text-gray-900 text-sm focus:ring-green-500 focus:border-green-500"
                                        value={currentAssign.zoneId || ''}
                                        onChange={(e) => handleAssignmentChange(order.id, 'zoneId', e.target.value)}
                                    >
                                        <option value="">Choisir...</option>
                                        {zones?.map(z => (
                                            <option key={z.id} value={z.id}>{z.name} {z.type === 'regional' ? '(Delta)' : ''}</option>
                                        ))}
                                    </select>
                                </div>
                                {!isRegional && (
                                    <div>
                                        <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">Livreur</label>
                                        <select 
                                            className="border rounded-lg px-2 py-2 w-full bg-white text-gray-900 text-sm focus:ring-green-500 focus:border-green-500"
                                            value={currentAssign.driverId || ''}
                                            onChange={(e) => handleAssignmentChange(order.id, 'driverId', e.target.value)}
                                        >
                                            <option value="">Choisir...</option>
                                            {drivers?.map(d => (
                                                <option key={d.id} value={d.id}>{d.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                             </div>

                             <div className="flex gap-2 justify-end border-t pt-3 border-gray-100">
                                {currentUser?.role === 'super_admin' && (
                                    <button 
                                        onClick={() => handleCancelClick(order.id)}
                                        className={`flex items-center justify-center rounded-lg px-3 py-2 text-xs font-bold transition-colors
                                            ${isConfirming 
                                                ? 'bg-red-600 text-white' 
                                                : 'text-gray-400 hover:text-red-600 bg-gray-50 hover:bg-red-50'
                                            }
                                        `}
                                        title="Annuler la commande"
                                    >
                                        {isConfirming ? "Confirmer ?" : <Ban size={16} />}
                                    </button>
                                )}
                                <button 
                                    onClick={() => handleScheduleClick(order.id)}
                                    className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded-lg font-bold text-sm transition-colors bg-purple-600 text-white hover:bg-purple-700 shadow-sm"
                                    title="Programmer pour plus tard"
                                >
                                    <CalendarClock size={16} className="mr-2" /> Programmer
                                </button>
                                <button 
                                    onClick={() => confirmAssignment(order.id)}
                                    className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded-lg font-bold text-sm transition-colors bg-green-700 text-white hover:bg-green-800 shadow-sm"
                                >
                                    {isRegional ? (
                                         <><CalendarClock size={16} className="mr-2" /> Confier</>
                                    ) : (
                                         <><UserPlus size={16} className="mr-2" /> Attribuer</>
                                    )}
                                </button>
                             </div>
                        </div>
                    )
                })
            )}
        </div>

        {/* --- DESKTOP TABLE VIEW --- */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 text-gray-800 font-semibold uppercase tracking-wider text-xs">
              <tr>
                <th className="px-6 py-4">ID / Date</th>
                <th className="px-6 py-4">Client / Contact</th>
                <th className="px-6 py-4">Produit</th>
                <th className="px-6 py-4">Montant / Mode</th>
                <th className="px-6 py-4">Zone</th>
                <th className="px-6 py-4">Livreur</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredOrders.length === 0 ? (
                 <tr>
                     <td colSpan={7} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center justify-center text-gray-400">
                            {orders.length === 0 ? (
                                <>
                                    <Upload size={32} className="mb-2 opacity-50" />
                                    <p>Aucune commande.</p>
                                    <p className="text-xs mt-1">Importez un fichier Excel ou connectez Google Drive.</p>
                                </>
                            ) : (
                                <>
                                    <Check size={32} className="mb-2 opacity-50" />
                                    <p>Toutes les commandes "validées" sont attribuées.</p>
                                </>
                            )}
                        </div>
                     </td>
                 </tr>
              ) : (
                filteredOrders?.map(order => {
                    const currentAssign = assignments[order.id] || { driverId: '', zoneId: '' };
                    const isConfirming = deleteConfirmId === order.id;
                    const isPostponed = order.postponedAt;
                    const selectedZone = zones.find(z => z.id === currentAssign.zoneId);
                    const isRegional = selectedZone?.type === 'regional';

                    return (
                        <tr key={order.id} className={`hover:bg-gray-50 transition-colors ${isPostponed ? 'bg-purple-50/10' : ''}`}>
                        <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{order.id}</div>
                            <div className="text-xs text-gray-400">{order.date}</div>
                            {order.refusedBy && (
                                <div className="mt-1 inline-flex items-center text-[10px] text-red-600 font-bold bg-red-100 px-1.5 py-0.5 rounded">
                                    <AlertTriangle size={10} className="mr-1" />
                                    Refusé par: {order.refusedBy}
                                </div>
                            )}
                            {/* Notification for Postponed orders */}
                            {isPostponed && (
                                <div className="mt-1 inline-flex items-center text-[10px] text-purple-700 font-bold bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">
                                    <CalendarClock size={10} className="mr-1" />
                                    {new Date(order.postponedAt!).toLocaleDateString()} {new Date(order.postponedAt!).toLocaleTimeString().slice(0,5)}
                                </div>
                            )}
                        </td>
                        {/* ... Remaining Desktop Columns ... */}
                        <td className="px-6 py-4">
                            <div className="text-gray-900 font-medium flex items-center gap-2">
                                {order.clientName}
                                <button onClick={() => openEditModal(order)} className="text-gray-400 hover:text-green-600">
                                    <Edit2 size={12} />
                                </button>
                            </div>
                            <div className="text-sm text-gray-700 font-medium">{order.clientPhone || 'Pas de numéro'}</div>
                            <div className="text-xs text-gray-400 truncate max-w-[150px]">{order.address}</div>
                            {order.remarks && (
                                <div className="mt-1 flex items-center gap-1 text-[10px] text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100 w-fit">
                                    <MessageSquare size={10} />
                                    <span className="font-semibold">Client: {order.remarks}</span>
                                </div>
                            )}
                            {order.assignmentRemarks && (
                                <div className="mt-1 flex items-center gap-1 text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 w-fit font-medium">
                                    <MessageSquare size={10} />
                                    <span className="font-semibold">Livreur: {order.assignmentRemarks}</span>
                                </div>
                            )}
                            {order.shippingRemarks && (
                                <div className="mt-1 flex items-center gap-1 text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 w-fit font-medium">
                                    <MessageSquare size={10} />
                                    <span className="font-semibold">Région: {order.shippingRemarks}</span>
                                </div>
                            )}
                        </td>
                         <td className="px-6 py-4">
                            <div className="text-gray-900 text-xs whitespace-pre-wrap">
                                {order.products && order.products.length > 0 ? order.products?.map((p, i) => (
                                    <div key={i}>{p.quantity > 1 ? <span className="font-bold text-green-700">{p.quantity}x</span> : ''} {p.name}</div>
                                )) : order.productDetails ? order.productDetails.split('\n')?.map((line, i) => {
                                    const { quantity, productName } = parseProductCommand(line);
                                    return <div key={i}>{quantity > 1 ? <span className="font-bold text-green-700">{quantity}x</span> : ''} {productName}</div>;
                                }) : '-'}
                            </div>
                        </td>
                        <td className="px-6 py-4">
                            <div className="font-bold text-gray-900">{formatFCFA(order.amount)}</div>
                        </td>
                        <td className="px-6 py-4">
                            <select 
                                className="border rounded px-2 py-1.5 w-full md:w-32 bg-white text-gray-900"
                                value={currentAssign.zoneId || ''}
                                onChange={(e) => handleAssignmentChange(order.id, 'zoneId', e.target.value)}
                            >
                                <option value="">Zone...</option>
                                {zones?.map(z => (
                                    <option key={z.id} value={z.id}>{z.name} {z.type === 'regional' ? '(Delta)' : ''}</option>
                                ))}
                            </select>
                        </td>
                        <td className="px-6 py-4">
                            {!isRegional ? (
                                <select 
                                    className="border rounded px-2 py-1.5 w-full md:w-32 bg-white text-gray-900"
                                    value={currentAssign.driverId || ''}
                                    onChange={(e) => handleAssignmentChange(order.id, 'driverId', e.target.value)}
                                >
                                    <option value="">Livreur...</option>
                                    {drivers?.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                            ) : (
                                <span className="text-xs text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded">Delta Transport</span>
                            )}
                        </td>
                        <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                            {currentUser?.role === 'super_admin' && (
                                <button 
                                    onClick={() => handleCancelClick(order.id)}
                                    className={`flex items-center justify-center transition-all duration-200 rounded-lg cursor-pointer
                                        ${isConfirming 
                                            ? 'bg-red-600 text-white px-3 py-1.5 text-xs font-bold w-auto' 
                                            : 'text-gray-400 hover:text-red-600 hover:bg-red-50 p-2 w-10'
                                        }
                                    `}
                                    title="Annuler la commande"
                                >
                                    {isConfirming ? "Confirmer ?" : <Ban size={16} />}
                                </button>
                            )}
                            <button 
                                onClick={() => handleScheduleClick(order.id)}
                                className="inline-flex items-center px-3 py-1.5 rounded-lg font-medium transition-colors bg-purple-600 text-white hover:bg-purple-700"
                                title="Programmer pour plus tard"
                            >
                                <CalendarClock size={16} className="mr-1.5" />
                                Programmer
                            </button>
                            <button 
                                onClick={() => confirmAssignment(order.id)}
                                className="inline-flex items-center px-3 py-1.5 rounded-lg font-medium transition-colors bg-green-700 text-white hover:bg-green-800"
                            >
                                {isRegional ? <CalendarClock size={16} className="mr-1.5" /> : <UserPlus size={16} className="mr-1.5" />}
                                {isRegional ? 'Confier' : 'Attribuer'}
                            </button>
                        </td>
                        </tr>
                    );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Scheduled Orders Section */}
      {scheduledOrders.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
            <div className="p-4 md:p-6 border-b border-gray-100 bg-purple-50">
                <div className="flex items-center gap-2">
                    <CalendarClock className="text-purple-600" size={20} />
                    <h2 className="text-lg font-bold text-purple-900">Commandes programmées (Futur)</h2>
                </div>
                <p className="text-xs text-purple-700 mt-1">Ces commandes apparaîtront automatiquement dans la liste à attribuer le jour de leur programmation.</p>
            </div>
            {/* CARD VIEW FOR MOBILE */}
            <div className="md:hidden bg-gray-50 p-4 space-y-4">
                {scheduledOrders.map(order => (
                    <div key={order.id} className="bg-white p-4 rounded-xl shadow-sm border border-purple-100">
                        <div className="flex justify-between items-start mb-3">
                            <div>
                                <span className="font-bold text-gray-900">{order.clientName}</span>
                                <div className="text-sm text-gray-700 font-medium flex items-center mt-1">
                                    <Phone size={12} className="mr-1" />
                                    {order.clientPhone || 'Pas de numéro'}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-purple-700 font-bold bg-purple-50 px-2 py-1 rounded border border-purple-100 flex items-center gap-1">
                                    <CalendarClock size={10} />
                                    {new Date(order.scheduledAt!).toLocaleDateString()}
                                </div>
                                <span className="text-[10px] text-gray-400 mt-1 block">#{order.id}</span>
                            </div>
                        </div>

                        <div className="text-sm text-gray-600 mb-2 flex items-start bg-gray-50 p-2 rounded">
                            <MapPin size={14} className="mt-0.5 mr-1.5 text-gray-400 flex-shrink-0" />
                            <span className="line-clamp-2">{order.address}</span>
                        </div>

                        {/* Remarks display for scheduled */}
                        {(order.remarks || order.assignmentRemarks || order.shippingRemarks) && (
                            <div className="space-y-1 mb-3">
                                {order.remarks && (
                                    <div className="text-[10px] text-orange-700 bg-orange-50 p-1.5 rounded flex items-start gap-1 border border-orange-100 font-medium">
                                        <MessageSquare size={12} className="mt-0.5 flex-shrink-0" />
                                        <span><strong>Client:</strong> {order.remarks}</span>
                                    </div>
                                )}
                                {order.assignmentRemarks && (
                                    <div className="text-[10px] text-blue-700 bg-blue-50 p-1.5 rounded flex items-start gap-1 border border-blue-100 font-medium">
                                        <MessageSquare size={12} className="mt-0.5 flex-shrink-0" />
                                        <span><strong>Livreur:</strong> {order.assignmentRemarks}</span>
                                    </div>
                                )}
                                {order.shippingRemarks && (
                                    <div className="text-[10px] text-indigo-700 bg-indigo-50 p-1.5 rounded flex items-start gap-1 border border-indigo-100 font-medium">
                                        <MessageSquare size={12} className="mt-0.5 flex-shrink-0" />
                                        <span><strong>Région:</strong> {order.shippingRemarks}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Products list on scheduled mobile card */}
                        <div className="text-xs bg-purple-50/50 p-2 rounded border border-purple-100/50 mb-3">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-purple-700 uppercase mb-1">
                                <Package size={12} /> Produits
                            </div>
                            <div className="text-gray-700 max-h-24 overflow-y-auto">
                                {order.products && order.products.length > 0 ? (
                                    order.products?.map((p, i) => (
                                        <div key={i} className="flex justify-between border-b border-purple-50 last:border-0 py-0.5">
                                            <span>{p.name}</span>
                                            <span className="font-bold text-purple-800">x{p.quantity}</span>
                                        </div>
                                    ))
                                ) : order.productDetails ? (
                                    <div className="whitespace-pre-wrap text-[11px]">{order.productDetails}</div>
                                ) : (
                                    <span className="italic text-gray-400 text-[11px]">Aucun produit spécifié</span>
                                )}
                            </div>
                        </div>

                        {/* Actions for Scheduled */}
                        <div className="flex gap-2 justify-end border-t pt-3 border-gray-100">
                             <button 
                                onClick={() => openEditModal(order)} 
                                className="text-gray-400 hover:bg-gray-50 p-2 rounded transition-colors" 
                                title="Modifier les détails"
                            >
                                <Edit2 size={18} />
                            </button>
                            <button 
                                onClick={() => handleScheduleClick(order.id)} 
                                className="text-purple-600 hover:bg-purple-50 p-2 rounded transition-colors" 
                                title="Modifier la programmation"
                            >
                                <CalendarClock size={18} />
                            </button>
                            <button 
                                onClick={() => handleDeliverImmediately(order.id)} 
                                className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded-lg font-bold text-sm transition-colors bg-green-700 text-white hover:bg-green-800 shadow-sm"
                            >
                                <PlayCircle size={16} className="mr-2" /> Livrer maintenant
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* TABLE VIEW FOR DESKTOP */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                        <tr>
                            <th className="px-6 py-4">ID</th>
                            <th className="px-6 py-4">Date Programmée</th>
                            <th className="px-6 py-4">Client</th>
                            <th className="px-6 py-4">Produits</th>
                            <th className="px-6 py-4">Adresse</th>
                            <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {scheduledOrders.map(order => (
                            <tr key={order.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 font-medium">{order.id}</td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <span className="text-purple-700 font-bold">{new Date(order.scheduledAt!).toLocaleDateString()}</span>
                                        <span className="text-[10px] text-gray-400">{new Date(order.scheduledAt!).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="font-medium text-gray-900">{order.clientName}</div>
                                    <div className="text-xs text-gray-400">{order.clientPhone}</div>
                                    {order.remarks && (
                                        <div className="mt-1 flex items-center gap-1 text-[10px] text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100 w-fit">
                                            <MessageSquare size={10} />
                                            <span className="font-semibold">Client: {order.remarks}</span>
                                        </div>
                                    )}
                                    {order.assignmentRemarks && (
                                        <div className="mt-1 flex items-center gap-1 text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 w-fit font-medium">
                                            <MessageSquare size={10} />
                                            <span className="font-semibold">Livreur: {order.assignmentRemarks}</span>
                                        </div>
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    <div className="text-gray-900 text-xs whitespace-pre-wrap">
                                        {order.products && order.products.length > 0 ? order.products?.map((p, i) => (
                                            <div key={i}>{p.quantity > 1 ? <span className="font-bold text-green-700">{p.quantity}x</span> : ''} {p.name}</div>
                                        )) : order.productDetails ? order.productDetails.split('\n')?.map((line, i) => {
                                            const { quantity, productName } = parseProductCommand(line);
                                            return <div key={i}>{quantity > 1 ? <span className="font-bold text-green-700">{quantity}x</span> : ''} {productName}</div>;
                                        }) : '-'}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-gray-500">
                                    <div className="max-w-xs truncate" title={order.address}>
                                        {order.address}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
                                    <button 
                                        onClick={() => handleDeliverImmediately(order.id)} 
                                        className="text-green-600 hover:bg-green-50 p-2 rounded transition-colors flex items-center gap-1 text-xs font-bold" 
                                        title="Livrer immédiatement"
                                    >
                                        <PlayCircle size={16} />
                                        <span>Livrer</span>
                                    </button>
                                    <button 
                                        onClick={() => handleScheduleClick(order.id)} 
                                        className="text-purple-600 hover:bg-purple-50 p-2 rounded transition-colors" 
                                        title="Modifier la programmation"
                                    >
                                        <CalendarClock size={16} />
                                    </button>
                                    <button 
                                        onClick={() => openEditModal(order)} 
                                        className="text-gray-400 hover:bg-gray-50 p-2 rounded transition-colors" 
                                        title="Modifier les détails de la commande"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
      )}

      {/* PRODUCT RESOLUTION MODAL */}
      {resolvingOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
                  <div className="flex items-start gap-4 mb-6">
                      <div className="bg-orange-100 p-3 rounded-full text-orange-600">
                          <AlertTriangle size={24} />
                      </div>
                      <div>
                          <h3 className="text-lg font-bold text-gray-900">Produit Inconnu</h3>
                          <p className="text-sm text-gray-500 mt-1">
                              Le produit de cette commande ne correspond à aucune référence Shopify active.
                          </p>
                      </div>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6">
                      <div className="text-xs font-bold text-gray-500 uppercase mb-1">Commande #{resolvingOrder.id}</div>
                      <div className="font-medium text-gray-900 text-lg whitespace-pre-wrap">
                          {resolvingOrder.products && resolvingOrder.products.length > 0 ? resolvingOrder.products?.map((p, i) => (
                              <div key={i}>{p.quantity > 1 ? <span className="font-bold text-green-700">{p.quantity}x</span> : ''} {p.name}</div>
                          )) : resolvingOrder.productDetails ? resolvingOrder.productDetails.split('\n')?.map((line, i) => {
                              const { quantity, productName } = parseProductCommand(line);
                              return <div key={i}>{quantity > 1 ? <span className="font-bold text-green-700">{quantity}x</span> : ''} {productName}</div>;
                          }) : '-'}
                      </div>
                  </div>

                  <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                          Associer à un produit Shopify :
                      </label>
                      <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                          <select
                              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white"
                              value={selectedProductId}
                              onChange={(e) => setSelectedProductId(e.target.value)}
                          >
                              <option value="">Sélectionner un produit...</option>
                              {products.filter(p => p.status === 'active')?.map(p => {
                                  const skuText = p.variants && p.variants.length > 0 ? p.variants?.map(v => v.sku).filter(Boolean).join(', ') : '';
                                  return (
                                      <option key={p.id} value={p.id}>
                                          {p.title} {skuText ? `(${skuText})` : ''}
                                      </option>
                                  );
                              })}
                          </select>
                      </div>
                      {/* Suggestion Logic */}
                      {(() => {
                          const suggestion = findMatchingProduct(resolvingOrder.productDetails);
                          if (suggestion && !selectedProductId) {
                              return (
                                  <button 
                                      className="mt-2 w-full text-left text-sm text-blue-600 bg-blue-50 p-2 rounded flex items-center gap-2 cursor-pointer hover:bg-blue-100 border border-blue-100"
                                      onClick={() => setSelectedProductId(suggestion.id)}
                                  >
                                      <Package size={14} />
                                      <span>Suggestion : <strong>{suggestion.title}</strong></span>
                                  </button>
                              );
                          }
                          return null;
                      })()}
                  </div>

                  <div className="flex justify-end gap-3">
                      <button 
                          onClick={() => { 
                              setResolvingOrder(null); 
                              setSelectedProductId(''); 
                              setPendingAssignment(null);
                          }}
                          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                      >
                          Annuler
                      </button>
                      <button 
                          onClick={() => {
                              setResolvingOrder(null);
                              setSelectedProductId('');
                              if (pendingAssignment?.orderId) {
                                  setTimeout(() => {
                                      const orderId = pendingAssignment.orderId;
                                      setPendingAssignment(null);
                                      const assign = assignments[orderId];
                                      const zone = zones.find(z => z.id === assign?.zoneId);
                                      if (assign && zone) {
                                          setAssignmentModal({
                                              orderId,
                                              zoneId: assign.zoneId,
                                              driverId: assign.driverId,
                                              isRegional: zone.type === 'regional'
                                          });
                                          setAssignmentType('immediate');
                                          setAssignmentComment('');
                                          const now = new Date();
                                          const offsetMs = now.getTimezoneOffset() * 60 * 1000;
                                          const localTime = new Date(now.getTime() - offsetMs);
                                          setScheduledDate(localTime.toISOString().slice(0, 16));
                                      }
                                  }, 100);
                              }
                          }}
                          className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition-colors"
                      >
                          Ignorer
                      </button>
                      <button 
                          onClick={handleResolveProduct}
                          disabled={!selectedProductId}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                          <Check size={18} />
                          Valider & Associer
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* ASSIGNMENT MODAL */}
      {assignmentModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
                  <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-gray-900">
                          {isConfirmingAssignment 
                            ? "Validation finale" 
                            : (assignmentType === 'immediate' ? "Attribuer maintenant" : "Programmer la livraison")
                          }
                      </h3>
                      <button onClick={() => setAssignmentModal(null)} className="text-gray-400 hover:text-gray-600">
                          <X size={20} />
                      </button>
                  </div>
                  
                  {isConfirmingAssignment ? (
                      <div className="bg-green-50 border border-green-100 rounded-lg p-4 mb-6">
                          <p className="text-sm text-green-800 font-medium mb-3">Veuillez valider les détails suivants :</p>
                          <div className="space-y-2 text-sm">
                              {assignmentType === 'immediate' && (
                                  <div className="flex justify-between">
                                      <span className="text-green-600">Zone :</span>
                                      <span className="font-bold">{zones.find(z => z.id === assignmentModal.zoneId)?.name || 'Non définie'}</span>
                                  </div>
                              )}
                              {assignmentModal.driverId && (
                                  <div className="flex justify-between">
                                      <span className="text-green-600">Livreur :</span>
                                      <span className="font-bold">{drivers.find(d => d.id === assignmentModal.driverId)?.name}</span>
                                  </div>
                              )}
                              <div className="flex justify-between border-t border-green-100 pt-2 mt-2">
                                  <span className="text-green-600">Type :</span>
                                  <span className="font-bold">{assignmentType === 'immediate' ? 'Immédiate' : 'Programmée'}</span>
                              </div>
                              {assignmentType === 'scheduled' && (
                                  <div className="flex justify-between">
                                      <span className="text-green-600">Date :</span>
                                      <span className="font-bold">{new Date(scheduledDate).toLocaleString()}</span>
                                  </div>
                              )}
                          </div>
                      </div>
                  ) : (
                      <>
                          <div className="mb-6 space-y-4">
                              {assignmentType === 'immediate' && (
                                  <div>
                                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Zone de Livraison</label>
                                      <select 
                                          className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                          value={assignmentModal.zoneId}
                                          onChange={(e) => {
                                              const zId = e.target.value;
                                              const z = zones.find(zone => zone.id === zId);
                                              setAssignmentModal({
                                                  ...assignmentModal,
                                                  zoneId: zId,
                                                  isRegional: z?.type === 'regional'
                                              });
                                          }}
                                      >
                                          <option value="">Sélectionner une zone...</option>
                                          {zones.map(z => (
                                              <option key={z.id} value={z.id}>{z.name}</option>
                                          ))}
                                      </select>
                                  </div>
                              )}

                              {assignmentType === 'immediate' ? (
                                  <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                                      <p className="text-sm text-blue-800">
                                          Cette commande sera attribuée <strong>immédiatement</strong> au livreur sélectionné.
                                      </p>
                                  </div>
                              ) : (
                                  <div className="space-y-4">
                                      <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg">
                                          <p className="text-sm text-purple-800">
                                              Choisissez la date et l'heure à laquelle cette commande doit apparaître dans le dashboard.
                                          </p>
                                      </div>
                                      <div>
                                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date et Heure de Programmation</label>
                                          <input 
                                              type="datetime-local" 
                                              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                              value={scheduledDate}
                                              onChange={(e) => setScheduledDate(e.target.value)}
                                          />
                                      </div>
                                  </div>
                              )}
                          </div>

                          <div className="mb-4">
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                  Remarque d'Attribution (Interne)
                              </label>
                              <textarea 
                                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none h-16 resize-none"
                                  placeholder="Ex: Client privilège, Appeler avant midi..."
                                  value={assignmentComment}
                                  onChange={(e) => setAssignmentComment(e.target.value)}
                              />
                          </div>

                          {assignmentModal.isRegional && (
                              <div className="mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
                                  <label className="block text-xs font-bold text-indigo-500 uppercase mb-1 flex items-center">
                                      <Package size={12} className="mr-1" />
                                      Remarque d'Expédition (Région)
                                  </label>
                                  <textarea 
                                      className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-indigo-50/30 h-16 resize-none"
                                      placeholder="Ex: Emballage fragile, Prise en charge par Delta..."
                                      value={shippingComment}
                                      onChange={(e) => setShippingComment(e.target.value)}
                                  />
                                  <p className="text-[10px] text-indigo-400 mt-1">Sera visible sur le PDF Delta.</p>
                              </div>
                          )}
                      </>
                  )}

                  {assignmentAlerts.length > 0 && (
                    <div className="mb-6 space-y-2">
                        {assignmentAlerts.map((alerte, i) => (
                            <div
                                key={i}
                                className={`p-3 rounded text-sm font-medium ${
                                    alerte.niveau === "ERREUR"
                                        ? "bg-red-100 text-red-800 border border-red-300"
                                        : alerte.niveau === "AVERTISSEMENT"
                                        ? "bg-orange-100 text-orange-800 border border-orange-300"
                                        : "bg-blue-50 text-blue-700 border border-blue-200"
                                }`}
                            >
                                {alerte.message}
                            </div>
                        ))}
                        <p className="text-xs text-gray-500 italic">
                            Vous pouvez quand même attribuer cette commande.
                        </p>
                    </div>
                  )}

                  <div className="flex justify-end gap-3">
                      <button 
                          onClick={() => {
                              if (isConfirmingAssignment) {
                                  setIsConfirmingAssignment(false);
                              } else {
                                  setAssignmentModal(null);
                              }
                          }}
                          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium text-sm"
                      >
                          {isConfirmingAssignment ? 'Retour' : 'Annuler'}
                      </button>
                      <button 
                          onClick={handleFinalizeAssignment}
                          className={`px-4 py-2 ${isConfirmingAssignment ? 'bg-green-600' : 'bg-green-700'} text-white rounded-lg font-bold text-sm hover:bg-green-800 transition-colors shadow-sm flex items-center gap-2`}
                      >
                          <Check size={16} />
                          {isConfirmingAssignment ? 'Valider Définitivement' : 'Confirmer'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* CONFIG MODAL */}
      {showConfig && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
                <h3 className="text-lg font-bold mb-4 flex items-center text-gray-800">
                    <LinkIcon className="mr-2 text-green-600" /> Configuration Source
                </h3>
                <p className="text-sm text-gray-500 mb-4 leading-relaxed">
                    Entrez le lien public de votre Google Sheet pour synchroniser automatiquement les nouvelles commandes "validées".
                </p>
                <div className="mb-4">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Lien Google Sheet (Public)</label>
                    <input
                        type="text"
                        className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none"
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        value={sheetUrl}
                        onChange={(e) => setSheetUrl(e.target.value)}
                    />
                </div>
                <div className="flex justify-end gap-2">
                     <button 
                        onClick={() => setShowConfig(false)} 
                        className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg font-medium text-sm transition-colors"
                    >
                        Annuler
                    </button>
                     <button 
                        onClick={handleUrlSave} 
                        className="px-4 py-2 bg-green-700 text-white rounded-lg font-bold text-sm hover:bg-green-800 transition-colors shadow-sm"
                    >
                        Sauvegarder & Sync
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* EDIT MODAL */}
      <OrderModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingOrder(null);
        }}
        order={editingOrder}
        onSave={async (order) => {
          if (originalEditId && originalEditId !== order.id) {
            await DataService.deleteOrder(originalEditId);
            setOrders(prev => prev.filter(o => o.id !== originalEditId));
          }

          // Stock management based on status change
          const oldOrder = editingOrder;
          const newOrder = order;
          const isDelivered = (s: string) => s === 'livré' || s === 'terminé' || s === 'attente_paiement';
          
          if (newOrder.driverId) {
              const wasDelivered = oldOrder ? isDelivered(oldOrder.status) : false;
              const isNowDelivered = isDelivered(newOrder.status);
              
              if (!wasDelivered && isNowDelivered) {
                  // Deduct stock
                  if (newOrder.driverId) {
                      if (newOrder.productId) {
                          const { quantity: parsedQty } = parseProductCommand(newOrder.productDetails || '');
                          const finalQty = newOrder.quantity || parsedQty || 1;
                          await DataService.updateDriverStock(newOrder.productId, newOrder.driverId, finalQty, 'deduct');
                      } else if (newOrder.products && newOrder.products.length > 0) {
                          for (const p of newOrder.products) {
                              if (p.sku) {
                                  await DataService.updateDriverStock(p.sku, newOrder.driverId, p.quantity, 'deduct');
                              }
                          }
                      }
                  }
              } else if (wasDelivered && !isNowDelivered) {
                  // Restore stock
                  if (oldOrder?.driverId) {
                      if (oldOrder.productId) {
                          const { quantity: parsedQty } = parseProductCommand(oldOrder.productDetails || '');
                          const finalQty = oldOrder.quantity || parsedQty || 1;
                          await DataService.updateDriverStock(oldOrder.productId, oldOrder.driverId!, finalQty, 'restore');
                      } else if (oldOrder.products && oldOrder.products.length > 0) {
                          for (const p of oldOrder.products) {
                              if (p.sku) {
                                  await DataService.updateDriverStock(p.sku, oldOrder.driverId!, p.quantity, 'restore');
                              }
                          }
                      }
                  }
              }
          }

          await DataService.saveOrder(order);
          setOrders(prev => {
              const filtered = prev.filter(o => o.id !== originalEditId); 
              const existingIdx = filtered.findIndex(o => o.id === order.id);
              if (existingIdx >= 0) {
                  const updated = [...filtered];
                  updated[existingIdx] = order;
                  return updated;
              }
              return [order, ...filtered];
          });
          setIsModalOpen(false);
          setEditingOrder(null);
          setOriginalEditId(null);
        }}
        zones={zones}
        drivers={drivers}
        products={products}
      />
    </div>
  );
};