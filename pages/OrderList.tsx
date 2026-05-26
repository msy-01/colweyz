import React, { useState, useEffect, useMemo } from 'react';
import { DataService } from '../services/dataService';
import { InvoiceService } from '../services/invoiceService';
import { Order, Zone, Driver, SystemUser, Product, OrderStatus } from '../types';
import { Search, Edit2, X, Save, Trash2, ArrowUpDown, Calendar, MapPin, User, Filter, Phone, FileText, Download, Loader, RefreshCw, Plus, MessageSquare } from 'lucide-react';
import { usePersistedDateRange } from '../hooks/usePersistedDateRange';
import { DateRangePicker } from '../components/DateRangePicker';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { parseProductCommand } from '../utils/productParser';
import { OrderModal } from '../components/OrderModal';
import { formatFCFA } from '../utils/formatters';

interface OrderListProps {
  currentUser?: SystemUser;
}

export const OrderList: React.FC<OrderListProps> = ({ currentUser }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Advanced Filters State
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [filterDriver, setFilterDriver] = useState('all');
  
  // Initialize with today's date (Local Time)
  const getTodayString = () => {
      const today = new Date();
      return today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  };
  
  const [dateRange, setDateRange] = usePersistedDateRange('orders_date_range', {
      startDate: new Date(),
      endDate: new Date()
  });

  const safeDateRange = useMemo(() => {
    if (!dateRange.startDate || !dateRange.endDate || isNaN(dateRange.startDate.getTime()) || isNaN(dateRange.endDate.getTime())) {
        return { startDate: new Date(), endDate: new Date() };
    }
    return dateRange;
  }, [dateRange]);

  // Edit State
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [originalEditId, setOriginalEditId] = useState<string | null>(null);

  // Delete Confirmation State
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [reexpediteConfirmId, setReexpediteConfirmId] = useState<string | null>(null);
  
  // Facebook Export State
  const [lastFacebookExportDate, setLastFacebookExportDate] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);

  const handleSyncDrive = async () => {
    if (!sheetUrl) return;
    setIsSyncing(true);
    try {
      const { count, ignored } = await DataService.syncFromGoogleSheet(sheetUrl);
      let msg = count === 0 ? "Aucune NOUVELLE commande 'validé' trouvée." : `${count} nouvelles commandes importées !`;
      if (ignored > 0) msg += `\n(${ignored} ignorées car statut incorrect)`;
      alert(msg);
    } catch (error: any) {
      console.error("Sync failed", error);
      alert("Erreur lors de la synchronisation : " + error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const resetFacebookExportDate = async () => {
      if (window.confirm("Voulez-vous réinitialiser la date du dernier export ? Cela vous permettra de ré-exporter les commandes déjà traitées.")) {
          setLastFacebookExportDate(null);
          await DataService.saveConfig('lastFacebookExportDate_USD_v2', null);
      }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = DataService.subscribeToOrders((newOrders) => {
        setOrders(newOrders);
    });

    const unsubscribeSheet = DataService.subscribeToConfig('googleSheetUrl', (val) => {
        setSheetUrl(val);
    });

    const unsubscribeExportDate = DataService.subscribeToConfig('lastFacebookExportDate_USD_v2', (val) => {
        setLastFacebookExportDate(val);
    });

    return () => {
        unsubscribe();
        unsubscribeSheet();
        unsubscribeExportDate();
    };
  }, []);

  const loadData = () => {
    Promise.all([
      DataService.getZones(),
      DataService.getDrivers(),
      DataService.getProducts()
    ]).then(([z, d, p]) => {
      setZones(z);
      setDrivers(d);
      setProducts(p);
    });
  };

  const handleReexpedite = async (orderId: string) => {
      if (reexpediteConfirmId === orderId) {
          try {
              const order = orders.find(o => o.id === orderId);
              if (!order) return;

              const updatedOrder: Order = { 
                  ...order, 
                  status: 'validé' as OrderStatus,
                  driverId: null,
                  zoneId: null,
                  assignedAt: null,
                  deliveredAt: null,
                  postponedAt: null,
                  scheduledAt: null,
                  refusedBy: null,
                  cancelReason: null
              };
              
              setOrders(prev => prev?.map(o => o.id === orderId ? updatedOrder : o));
              await DataService.saveOrder(updatedOrder);
              setReexpediteConfirmId(null);
          } catch (e) {
              console.error("Error re-expediting", e);
              alert("Erreur lors de la réexpédition");
              loadData(); // Revert on error
          }
      } else {
          setReexpediteConfirmId(orderId);
          setTimeout(() => setReexpediteConfirmId(prev => prev === orderId ? null : prev), 3000);
      }
  };

  // --- FILTERING & SORTING LOGIC ---
  const estProgrammee = (o: Order, referenceDate: Date) => {
    const dateProg = o.scheduledAt || (o as any).dateProgrammee || (o as any).scheduledDate || (o as any).scheduled_date;
    if (!dateProg) return false;
    const schedDate = new Date(dateProg.split('T')[0]);
    return schedDate > referenceDate;
  };

  const baseFilteredOrdersForStatus = useMemo(() => {
    const start = startOfDay(safeDateRange.startDate);
    const end = endOfDay(safeDateRange.endDate);

    return orders.filter(o => {
        // 1. Search (ID or Client or Phone)
        const matchesSearch = o.clientName.toLowerCase().includes(search.toLowerCase()) || 
                              o.id.toLowerCase().includes(search.toLowerCase()) ||
                              (o.clientPhone && o.clientPhone.includes(search));
        
        // 2. Zone
        const matchesZone = filterZone === 'all' || o.zoneId === filterZone;

        // 3. Driver
        const matchesDriver = filterDriver === 'all' || o.driverId === filterDriver;

        // 4. Date
        const orderDateStr = o.importedAt ? o.importedAt.split('T')[0] : o.date.split('T')[0];
        const orderDate = new Date(orderDateStr);
        const matchesDate = isWithinInterval(orderDate, { start, end });

        // Special case: Scheduled orders for the future should appear in 'Tous' even if they don't match the selected date
        const isFutureScheduled = estProgrammee(o, end);

        return matchesSearch && matchesZone && matchesDriver && (matchesDate || isFutureScheduled);
    });
  }, [orders, search, filterZone, filterDriver, safeDateRange]);

  const statusCounts = useMemo(() => {
      const counts = { all: 0, validé: 0, attribué: 0, en_cours: 0, attente_paiement: 0, livré: 0, injoignable: 0, reporté: 0, annulé: 0, programmé: 0 };
      const end = endOfDay(safeDateRange.endDate);
      
      baseFilteredOrdersForStatus.forEach(o => {
          counts.all++;
          
          if (estProgrammee(o, end)) {
              counts.programmé++;
          } else {
              if (o.status === 'validé') counts.validé++;
              else if (o.status === 'attribué') counts.attribué++;
              else if (o.status === 'en_cours') counts.en_cours++;
              else if (o.status === 'attente_paiement') counts.attente_paiement++;
              else if (o.status === 'livré' || o.status === 'terminé') counts.livré++;
              else if (o.status === 'injoignable' || o.status === 'regional_injoignable') counts.injoignable++;
              else if (o.status === 'reporté' || o.status === 'regional_reporte') counts.reporté++;
              else if (o.status === 'annulé' || o.status === 'regional_annule') counts.annulé++;
          }
      });
      return counts;
  }, [baseFilteredOrdersForStatus, safeDateRange]);

  const processedOrders = useMemo(() => {
    const end = endOfDay(safeDateRange.endDate);
    
    let result = baseFilteredOrdersForStatus.filter(o => {
        // Status
        if (filterStatus === 'all') return true;
        
        if (filterStatus === 'programmé') {
            return estProgrammee(o, end);
        }

        // If we are in another tab, we should exclude future scheduled orders
        if (estProgrammee(o, end)) return false;

        if (filterStatus === 'injoignable') return o.status === 'injoignable' || o.status === 'regional_injoignable';
        if (filterStatus === 'reporté') return o.status === 'reporté' || o.status === 'regional_reporte';
        if (filterStatus === 'annulé') return o.status === 'annulé' || o.status === 'regional_annule';
        return o.status === filterStatus;
    });

    // Sorting
    result.sort((a, b) => {
        const dateA = new Date(a.importedAt || a.date).getTime();
        const dateB = new Date(b.importedAt || b.date).getTime();
        return dateB - dateA;
    });

    return result;
  }, [baseFilteredOrdersForStatus, filterStatus]);

  // --- HELPERS ---
  const getStatusColor = (status: string) => {
    switch(status) {
      case 'validé': return 'bg-gray-100 text-gray-600';
      case 'attribué': return 'bg-yellow-100 text-yellow-700';
      case 'en_cours': return 'bg-blue-100 text-blue-600';
      case 'livré': return 'bg-green-100 text-green-700';
      case 'attente_paiement': return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
      case 'injoignable': 
      case 'regional_injoignable': return 'bg-orange-100 text-orange-800';
      case 'reporté': 
      case 'regional_reporte': return 'bg-slate-100 text-slate-700';
      case 'annulé': 
      case 'regional_annule': return 'bg-red-100 text-red-700';
      case 'programmé': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const resetFilters = () => {
      setSearch('');
      setFilterStatus('all');
      setFilterZone('all');
      setFilterDriver('all');
      setDateRange({ startDate: new Date(), endDate: new Date() });
  };

  // --- ACTIONS ---
  const openEditModal = (order: Order) => {
    setEditingOrder({ ...order }); // Clone
    setOriginalEditId(order.id);
    setIsModalOpen(true);
  };

  const handleDeleteClick = async (orderId: string) => {
      if (deleteConfirmId === orderId) {
          try {
              setOrders(prev => prev.filter(o => o.id !== orderId)); // Optimistic
              await DataService.deleteOrder(orderId);
              setDeleteConfirmId(null);
          } catch (e) {
              console.error("Delete failed", e);
              loadData();
          }
      } else {
          setDeleteConfirmId(orderId);
          setTimeout(() => setDeleteConfirmId(prev => prev === orderId ? null : prev), 3000);
      }
  };

  const handleInvoice = (order: Order) => {
      InvoiceService.sendViaWhatsApp(order);
  };

  // --- FACEBOOK EXPORT ---
  const exportableOrders = useMemo(() => {
      const isDelta = (o: Order) => {
          const zone = zones.find(z => z.id === o.zoneId);
          return zone?.type === 'regional' || (o as any).source === 'Expéditions Delta Transport - Auto';
      };

      const isDeltaPaid = (o: Order) => {
          const status = (o as any).paiementProduit 
              ?? (o as any).paiement_produit 
              ?? (o as any).paymentProduct
              ?? o.regionalPaymentStatus 
              ?? "";
          const s = String(status).toLowerCase();
          return s === "payé" || s === "paid" || s === "paye";
      };

      return orders.filter(o => {
          let isConversion = false;
          let eventTime = "";

          if (isDelta(o)) {
              if (isDeltaPaid(o)) {
                  isConversion = true;
                  eventTime = o.deliveredAt || o.assignedAt || o.date;
              }
          } else {
              if ((o.status === 'livré' || o.status === 'terminé') && (o.paymentMethod === 'cash' || o.paymentMethod === 'wave' || o.paymentMethod === 'om')) {
                  isConversion = true;
                  eventTime = o.deliveredAt || o.date;
              }
          }

          if (!isConversion) return false;
          if (!eventTime) return false;
          
          if (lastFacebookExportDate) {
              return new Date(eventTime).getTime() > new Date(lastFacebookExportDate).getTime();
          }
          return true;
      });
  }, [orders, zones, lastFacebookExportDate]);

  const handleFacebookExport = async () => {
      console.log("Starting Facebook Export...", { exportableCount: exportableOrders.length });
      if (exportableOrders.length === 0) {
          alert("Aucune nouvelle commande à exporter.");
          return;
      }
      
      setIsExporting(true);
      try {
          // Fetch Daily Entries to get Exchange Rate (XOF -> USD) per date
          console.log("Fetching daily entries for exchange rates...");
          const dailyEntries = await DataService.getDailyEntries();

          // CSV Header
          const headers = ['event_name', 'event_time', 'value', 'currency', 'phone', 'payment_method', 'delivery_category', 'content_type'];
          const rows = exportableOrders?.map(o => {
              const isDelta = (o: Order) => {
                  const zone = zones.find(z => z.id === o.zoneId);
                  return zone?.type === 'regional' || (o as any).source === 'Expéditions Delta Transport - Auto';
              };

              const isDeltaPaid = (o: Order) => {
                  const status = (o as any).paiementProduit 
                      ?? (o as any).paiement_produit 
                      ?? (o as any).paymentProduct
                      ?? o.regionalPaymentStatus 
                      ?? "";
                  const s = String(status).toLowerCase();
                  return s === "payé" || s === "paid" || s === "paye";
              };

              let eventTime = "";
              if (isDelta(o)) {
                  if (isDeltaPaid(o)) {
                      eventTime = o.deliveredAt || o.assignedAt || o.date;
                  }
              } else {
                  if ((o.status === 'livré' || o.status === 'terminé') && (o.paymentMethod === 'cash' || o.paymentMethod === 'wave' || o.paymentMethod === 'om')) {
                      eventTime = o.deliveredAt || o.date;
                  }
              }

              let isoTime = "";
              try {
                  const d = new Date(eventTime);
                  if (!isNaN(d.getTime())) {
                      isoTime = d.toISOString();
                  } else {
                      isoTime = new Date().toISOString();
                  }
              } catch (e) {
                  isoTime = new Date().toISOString();
              }
              
              // Format Phone: +221...
              let phone = o.clientPhone || "";
              phone = phone.replace(/\D/g, '');
              if (phone.startsWith('00221')) {
                  phone = phone.substring(2);
              }
              if (!phone.startsWith('221') && phone.length === 9) {
                  phone = '221' + phone;
              }
              if (phone.length > 0 && !phone.startsWith('+')) {
                  phone = '+' + phone;
              }

              // Get exchange rate for the order's date
              let orderDate = "";
              try {
                  const d = new Date(o.date);
                  orderDate = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
              } catch (e) {
                  orderDate = new Date().toISOString().split('T')[0];
              }
              
              const dailyEntry = dailyEntries.find(e => e.date === orderDate);
              const rate = dailyEntry?.exchangeRate || 600;

              // Convert Amount to USD
              const amountUSD = (o.amount / rate).toFixed(2);

              return [
                  'Purchase',
                  isoTime,
                  amountUSD,
                  'USD',
                  phone,
                  'cash_on_delivery',
                  'home_delivery',
                  'product'
              ].join(',');
          });

          console.log(`Generated ${rows.length} rows for CSV.`);
          const csvContent = [headers.join(','), ...rows].join('\n');
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          
          const today = new Date();
          const dd = String(today.getDate()).padStart(2, '0');
          const mm = String(today.getMonth() + 1).padStart(2, '0');
          const yyyy = today.getFullYear();
          const filename = `facebook_export_usd_${dd}${mm}${yyyy}.csv`;

          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', filename);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);

          // Update last export date
          const now = new Date().toISOString();
          setLastFacebookExportDate(now);
          await DataService.saveConfig('lastFacebookExportDate_USD_v2', now);
          console.log("Export successful. Last export date updated to:", now);
      } catch (error) {
          console.error("Export failed", error);
          alert("Erreur lors de l'exportation : " + (error instanceof Error ? error.message : String(error)));
      } finally {
          setIsExporting(false);
      }
  };

  return (
    <div className="space-y-6 pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center justify-between w-full md:w-auto">
                    <h2 className="text-2xl font-bold text-gray-800">Toutes les commandes</h2>
                    {sheetUrl && (
                        <button 
                            onClick={handleSyncDrive}
                            disabled={isSyncing}
                            className="lg:hidden flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg font-bold text-xs border border-green-200 active:scale-95 transition-transform"
                            title="Synchroniser Google Drive"
                        >
                            <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                            <span>Rafraîchir {isSyncing ? '...' : ''}</span>
                        </button>
                    )}
                </div>
        <div className="flex gap-2 items-center flex-wrap">
            <button
                onClick={() => {
                    setEditingOrder(null);
                    setIsModalOpen(true);
                }}
                className="flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-bold shadow-sm transition-all bg-blue-600 text-white hover:bg-blue-700"
            >
                <Plus size={14} />
                <span className="hidden md:inline">Nouvelle commande</span>
                <span className="md:hidden">Nouveau</span>
            </button>

            <button
                onClick={handleFacebookExport}
                disabled={isExporting}
                className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-bold shadow-sm transition-all mr-2 ${
                    exportableOrders.length > 0 && !isExporting
                    ? 'bg-[#1877F2] text-white hover:bg-blue-700' 
                    : 'bg-gray-200 text-gray-400'
                }`}
            >
                {isExporting ? <Loader size={14} className="animate-spin" /> : <Download size={14} />}
                <span className="hidden md:inline">
                    {isExporting 
                        ? "Conversion en cours..." 
                        : exportableOrders.length > 0 
                            ? `Exporter Facebook USD (${exportableOrders.length})` 
                            : "Facebook: Rien à exporter"
                    }
                </span>
                <span className="md:hidden">
                    {isExporting ? "..." : `FB USD (${exportableOrders.length})`}
                </span>
            </button>

            {lastFacebookExportDate && (
                <button 
                    onClick={resetFacebookExportDate}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    title="Réinitialiser la date d'export"
                >
                    <RefreshCw size={14} />
                </button>
            )}

            <button 
             onClick={resetFilters} 
             className="text-sm text-gray-500 hover:text-red-500 underline"
           >
             Réinitialiser filtres
           </button>
        </div>
      </div>

      {/* --- STATUS TABS --- */}
      <div className="flex flex-wrap gap-3 mb-6">
          <button
              onClick={() => setFilterStatus('all')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'all' 
                  ? 'bg-gray-800 text-white shadow-md' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
          >
              <span>Tous</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'all' ? 'bg-white text-gray-800' : 'bg-gray-200 text-gray-700'}`}>
                  {statusCounts.all}
              </span>
          </button>
          <button
              onClick={() => setFilterStatus('validé')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'validé' 
                  ? 'bg-gray-600 text-white shadow-md' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
          >
              <span>Validé</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'validé' ? 'bg-white text-gray-600' : 'bg-gray-200 text-gray-700'}`}>
                  {statusCounts.validé}
              </span>
          </button>
          <button
              onClick={() => setFilterStatus('attribué')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'attribué' 
                  ? 'bg-yellow-500 text-white shadow-md' 
                  : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
              }`}
          >
              <span>Attribué</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'attribué' ? 'bg-white text-yellow-600' : 'bg-yellow-100 text-yellow-700'}`}>
                  {statusCounts.attribué}
              </span>
          </button>
          <button
              onClick={() => setFilterStatus('en_cours')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'en_cours' 
                  ? 'bg-blue-500 text-white shadow-md' 
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
          >
              <span>En cours</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'en_cours' ? 'bg-white text-blue-600' : 'bg-blue-100 text-blue-700'}`}>
                  {statusCounts.en_cours}
              </span>
          </button>
          <button
              onClick={() => setFilterStatus('attente_paiement')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'attente_paiement' 
                  ? 'bg-orange-500 text-white shadow-md' 
                  : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
              }`}
          >
              <span>Attente Paiement</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'attente_paiement' ? 'bg-white text-orange-600' : 'bg-orange-100 text-orange-700'}`}>
                  {statusCounts.attente_paiement}
              </span>
          </button>
          <button
              onClick={() => setFilterStatus('livré')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'livré' 
                  ? 'bg-green-500 text-white shadow-md' 
                  : 'bg-green-50 text-green-700 hover:bg-green-100'
              }`}
          >
              <span>Livré</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'livré' ? 'bg-white text-green-600' : 'bg-green-100 text-green-700'}`}>
                  {statusCounts.livré}
              </span>
          </button>
          <button
              onClick={() => setFilterStatus('injoignable')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'injoignable' 
                  ? 'bg-orange-600 text-white shadow-md' 
                  : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
              }`}
          >
              <span>Injoignable</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'injoignable' ? 'bg-white text-orange-600' : 'bg-orange-100 text-orange-700'}`}>
                  {statusCounts.injoignable}
              </span>
          </button>
          <button
              onClick={() => setFilterStatus('reporté')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'reporté' 
                  ? 'bg-slate-600 text-white shadow-md' 
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
          >
              <span>Reportée</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'reporté' ? 'bg-white text-slate-600' : 'bg-slate-100 text-slate-700'}`}>
                  {statusCounts.reporté}
              </span>
          </button>
          <button
              onClick={() => setFilterStatus('annulé')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'annulé' 
                  ? 'bg-red-600 text-white shadow-md' 
                  : 'bg-red-50 text-red-700 hover:bg-red-100'
              }`}
          >
              <span>Annulé</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'annulé' ? 'bg-white text-red-600' : 'bg-red-100 text-red-700'}`}>
                  {statusCounts.annulé}
              </span>
          </button>
          <button
              onClick={() => setFilterStatus('programmé')}
              className={`relative px-5 py-3 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-between min-w-[140px] ${
                  filterStatus === 'programmé' 
                  ? 'bg-purple-600 text-white shadow-md' 
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
              }`}
          >
              <span>Programmé</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${filterStatus === 'programmé' ? 'bg-white text-purple-600' : 'bg-purple-100 text-purple-700'}`}>
                  {statusCounts.programmé}
              </span>
          </button>
      </div>

      {/* --- FILTERS TOOLBAR --- */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Search */}
        <div className="relative col-span-1 md:col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16}/>
            <input 
                type="text" 
                placeholder="Rechercher ID, Client..." 
                className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-green-500 bg-white text-gray-900"
                value={search}
                onChange={e => setSearch(e.target.value)}
            />
        </div>

        {/* Date Filter */}
        <div className="relative">
            <DateRangePicker 
                dateRange={safeDateRange}
                onUpdate={setDateRange}
                align="right"
            />
        </div>

        {/* Zone Filter */}
        <div className="relative">
             <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16}/>
             <select 
                className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm bg-white text-gray-900 focus:ring-green-500"
                value={filterZone}
                onChange={e => setFilterZone(e.target.value)}
            >
                <option value="all">Toutes les zones</option>
                {zones?.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
        </div>

        {/* Driver Filter */}
        <div className="relative">
             <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16}/>
             <select 
                className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm bg-white text-gray-900 focus:ring-green-500"
                value={filterDriver}
                onChange={e => setFilterDriver(e.target.value)}
            >
                <option value="all">Tous les livreurs</option>
                {drivers?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
        </div>

         <div className="flex items-center justify-end md:justify-start lg:col-span-1">
            <span className="text-sm font-semibold text-gray-500">
                {processedOrders.length} résultat(s)
            </span>
         </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        
        {/* --- MOBILE CARD VIEW --- */}
        <div className="md:hidden bg-gray-50 p-4 space-y-4">
            {processedOrders.length === 0 ? (
                <div className="text-center text-gray-400 py-8 bg-white rounded-lg border border-dashed">
                    <p>Aucun résultat.</p>
                </div>
            ) : (
                processedOrders?.map(order => {
                    const isConfirming = deleteConfirmId === order.id;
                    return (
                        <div key={order.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getStatusColor(order.status)}`}>
                                        {order.status}
                                    </span>
                                    <div className="mt-2 font-bold text-gray-900">{order.clientName}</div>
                                </div>
                                <div className="text-right">
                                    <span className="block font-bold text-gray-700 bg-gray-50 px-2 py-1 rounded text-xs border border-gray-100">
                                        {formatFCFA(order.amount)}
                                    </span>
                                    <span className="text-[10px] text-gray-400 mt-1 block">
                                        {order.scheduledAt ? (
                                            <span className="text-purple-600 font-bold">
                                                Prévu : {new Date(order.scheduledAt).toLocaleDateString()}
                                            </span>
                                        ) : (
                                            order.importedAt ? new Date(order.importedAt).toLocaleDateString() : order.date
                                        )}
                                    </span>
                                </div>
                            </div>
                            
                            <div className="text-sm text-gray-700 font-medium flex items-center mb-3">
                                <Phone size={14} className="mr-1" />
                                {order.clientPhone || 'Pas de numéro'}
                            </div>

                            <div className="text-sm text-gray-600 mb-3 flex items-start bg-gray-50 p-2 rounded">
                                <MapPin size={14} className="mt-0.5 mr-1.5 text-gray-400 flex-shrink-0" />
                                <span className="line-clamp-2">{order.address}</span>
                            </div>

                            {order.remarks && (
                                <div className="text-xs text-orange-700 mb-3 bg-orange-50 p-2 rounded flex items-start gap-1.5 border border-orange-100 font-medium">
                                    <MessageSquare size={14} className="mt-0.5 flex-shrink-0" />
                                    <span><strong>Remarque :</strong> {order.remarks}</span>
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

                            <div className="flex items-center justify-between text-xs text-gray-500 mb-3 bg-gray-50 px-2 py-1.5 rounded">
                                <span>Zone: <b className="text-gray-700">{zones.find(z => z.id === order.zoneId)?.name || '-'}</b></span>
                                <span>Livreur: <b className="text-gray-700">{drivers.find(d => d.id === order.driverId)?.name || '-'}</b></span>
                            </div>

                            <div className="flex justify-end gap-2 border-t pt-3 border-gray-100">
                                {order.status === 'annulé' && (
                                    <button 
                                        onClick={() => handleReexpedite(order.id)} 
                                        className={`p-2 rounded transition-colors text-xs flex items-center font-medium border ${
                                            reexpediteConfirmId === order.id 
                                            ? 'bg-blue-600 text-white border-blue-600' 
                                            : 'text-blue-600 hover:bg-blue-50 border-blue-200'
                                        }`}
                                    >
                                        <RefreshCw size={14} className="mr-1" /> 
                                        {reexpediteConfirmId === order.id ? "Confirmer ?" : "Réexpédier"}
                                    </button>
                                )}
                                {(order.status === 'livré' || order.status === 'terminé') && (
                                    <button 
                                        onClick={() => handleInvoice(order)} 
                                        className="text-green-600 hover:bg-green-50 p-2 rounded transition-colors text-xs flex items-center font-medium border border-green-200"
                                    >
                                        <FileText size={14} className="mr-1" /> Facture
                                    </button>
                                )}
                                <button 
                                    onClick={() => openEditModal(order)} 
                                    className="text-gray-500 hover:text-green-600 hover:bg-green-50 p-2 rounded transition-colors text-xs flex items-center font-medium"
                                >
                                    <Edit2 size={14} className="mr-1" /> Modifier
                                </button>
                                
                                {currentUser?.role === 'super_admin' && (
                                    <button 
                                        onClick={() => handleDeleteClick(order.id)}
                                        className={`flex items-center justify-center rounded px-3 py-1.5 text-xs font-bold transition-colors
                                            ${isConfirming 
                                                ? 'bg-red-600 text-white' 
                                                : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                                            }
                                        `}
                                    >
                                        {isConfirming ? "Confirmer ?" : <Trash2 size={14} />}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })
            )}
        </div>

        {/* --- DESKTOP TABLE VIEW --- */}
        <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                    <tr>
                        <th className="px-6 py-4">ID</th>
                        <th className="px-6 py-4">Date</th>
                        <th className="px-6 py-4">Client</th>
                        <th className="px-6 py-4">Produit</th>
                        <th className="px-6 py-4">Zone</th>
                        <th className="px-6 py-4">Livreur</th>
                        <th className="px-6 py-4">Montant</th>
                        <th className="px-6 py-4">Statut</th>
                        <th className="px-6 py-4 text-right">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {processedOrders.length === 0 ? (
                        <tr>
                            <td colSpan={9} className="px-6 py-8 text-center text-gray-400">
                                Aucun résultat pour ces filtres.
                            </td>
                        </tr>
                    ) : (
                    processedOrders?.map(order => {
                        const isConfirming = deleteConfirmId === order.id;
                        return (
                        <tr key={order.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 font-medium">{order.id}</td>
                            <td className="px-6 py-4 text-gray-500">
                                {order.scheduledAt ? (
                                    <div className="flex flex-col">
                                        <span className="text-purple-600 font-bold text-xs">Prévu :</span>
                                        <span className="text-purple-700 font-bold">{new Date(order.scheduledAt).toLocaleDateString()}</span>
                                        <span className="text-[10px] text-gray-400">{new Date(order.scheduledAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    </div>
                                ) : (
                                    order.importedAt ? new Date(order.importedAt).toLocaleDateString() : order.date
                                )}
                            </td>
                            <td className="px-6 py-4">
                                <div className="font-medium text-gray-900">{order.clientName}</div>
                                <div className="text-sm text-gray-700 font-medium">{order.clientPhone || 'Pas de numéro'}</div>
                                <div className="text-xs text-gray-400">{order.address}</div>
                                {order.remarks && (
                                    <div className="mt-1 flex items-center gap-1 text-[10px] text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100 w-fit">
                                        <MessageSquare size={10} />
                                        <span className="font-semibold">{order.remarks}</span>
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
                                {zones.find(z => z.id === order.zoneId)?.name || '-'}
                            </td>
                            <td className="px-6 py-4 text-gray-500">
                                {drivers.find(d => d.id === order.driverId)?.name || '-'}
                            </td>
                            <td className="px-6 py-4 font-medium text-gray-800">
                                {formatFCFA(order.amount)}
                            </td>
                            <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${getStatusColor(order.status)}`}>
                                    {order.status}
                                </span>
                            </td>
                            <td className="px-6 py-4 text-right flex justify-end gap-2 items-center">
                                {order.status === 'annulé' && (
                                    <button 
                                        onClick={() => handleReexpedite(order.id)} 
                                        className={`p-2 rounded transition-colors ${
                                            reexpediteConfirmId === order.id 
                                            ? 'bg-blue-600 text-white' 
                                            : 'text-blue-600 hover:bg-blue-50'
                                        }`}
                                        title="Réexpédier"
                                    >
                                        {reexpediteConfirmId === order.id ? <span className="text-xs font-bold px-1">Confirmer ?</span> : <RefreshCw size={16} />}
                                    </button>
                                )}
                                {(order.status === 'livré' || order.status === 'terminé') && (
                                    <button 
                                        onClick={() => handleInvoice(order)} 
                                        className="text-gray-500 hover:text-green-700 hover:bg-green-50 p-2 rounded transition-colors" 
                                        title="Générer Facture"
                                    >
                                        <FileText size={16} />
                                    </button>
                                )}
                                <button onClick={() => openEditModal(order)} className="text-green-600 hover:bg-green-50 p-2 rounded transition-colors" title="Modifier">
                                    <Edit2 size={16} />
                                </button>
                                
                                {currentUser?.role === 'super_admin' && (
                                    <button 
                                        onClick={() => handleDeleteClick(order.id)}
                                        className={`flex items-center justify-center transition-all duration-200 rounded text-xs font-bold
                                            ${isConfirming 
                                                ? 'bg-red-600 text-white px-3 py-1.5' 
                                                : 'text-gray-400 hover:text-red-600 hover:bg-red-50 p-2'
                                            }
                                        `}
                                        title="Supprimer"
                                    >
                                        {isConfirming ? "Confirmer ?" : <Trash2 size={16} />}
                                    </button>
                                )}
                            </td>
                        </tr>
                    )}))}
                </tbody>
            </table>
        </div>
      </div>

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
          }
          await DataService.saveOrder(order);
          loadData();
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