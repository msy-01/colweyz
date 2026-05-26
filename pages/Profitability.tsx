import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DataService } from '../services/dataService';
import { Product, ProductFinancialConfig, DailyFinancialEntry, Order, Zone } from '../types';
import { parseProductCommand } from '../utils/productParser';
import { trouverProduitShopify } from '../utils/productMatcher';
import { TrendingUp, RefreshCw, AlertCircle, Edit2, ArrowUpDown, ChevronLeft, ChevronRight, Save, Calendar, Plus, Download } from 'lucide-react';
import { usePersistedDateRange } from '../hooks/usePersistedDateRange';
import { DateRangePicker } from '../components/DateRangePicker';
import { Modal } from '../components/Modal';
import { format, isSameDay, eachDayOfInterval, parseISO, isWithinInterval, startOfDay, endOfDay, addDays, subDays, startOfMonth, endOfMonth, isBefore } from 'date-fns';
import { fr } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatNumber, formatFCFA } from '../utils/formatters';
import { configEffectDate } from '../utils/financialConfig';

function normaliser(str: string): string {
  return (str ?? '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // supprime accents
    .replace(/\s+/g, ' ')            // normalise espaces multiples
}

function matcherLigneProduit(ligne: string, produit: any): boolean {
  const { productName } = parseProductCommand(ligne);
  const nomLigne = normaliser(productName);
  const nomCampagne = normaliser(produit?.title ?? produit?.name ?? produit?.nom ?? '')

  if (!nomLigne || !nomCampagne) return false

  // Comparaison exacte — jamais includes/startsWith
  return nomLigne === nomCampagne
}

const FINANCE_START_DATE = new Date('2026-03-05');

export const Profitability: React.FC = () => {
  // --- STATE ---
  const [products, setProducts] = useState<Product[]>([]);
  const [configs, setConfigs] = useState<ProductFinancialConfig[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyFinancialEntry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
        setLoading(true);
        // Ensure legacy data is migrated
        await DataService.migrateFinancialConfigs();
        
        const [p, c, d, o, z] = await Promise.all([
            DataService.getProducts(),
            DataService.getFinancialConfigs(),
            DataService.getDailyEntries(),
            DataService.getOrders(),
            DataService.getZones()
        ]);
        setProducts(p);
        setConfigs(c);
        setDailyEntries(d);
        setOrders(o);
        setZones(z);
        setLoading(false);
    } catch (e) {
        console.error("Error loading data", e);
        setError("Erreur lors du chargement des données");
        setLoading(false);
    }
  };

  // Sorting & Editing State
  const [productOrder, setProductOrder] = useState<string[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProductFinancialConfig>>({});
  
  // Launch Campaign State
  const [isLaunchModalOpen, setIsLaunchModalOpen] = useState(false);
  const [launchForm, setLaunchForm] = useState<{ productId: string; cau: number; appro: number; dailyBudgetUsd: number }>({
      productId: '',
      cau: 0,
      appro: 0,
      dailyBudgetUsd: 0
  });

  // Date Range State
  const [dateRange, setDateRange] = usePersistedDateRange('profitability_date_range', {
      startDate: new Date(),
      endDate: new Date()
  });

  // Safety check for dateRange
  const safeDateRange = useMemo(() => {
      if (!dateRange.startDate || !dateRange.endDate || isNaN(dateRange.startDate.getTime()) || isNaN(dateRange.endDate.getTime())) {
          return { startDate: new Date(), endDate: new Date() };
      }
      return dateRange;
  }, [dateRange]);

  const isSingleDay = isSameDay(safeDateRange.startDate, safeDateRange.endDate);
  const selectedDateStr = format(safeDateRange.startDate, 'yyyy-MM-dd');

  // Daily State (Only relevant for single day editing)
  const [exchangeRate, setExchangeRate] = useState<number>(600); 
  const [dailyData, setDailyData] = useState<Record<string, { soldQty: number | string; spendUsd: number | string }>>({});

  // Sync Daily Data
  useEffect(() => {
    if (isSingleDay) {
        const entry = dailyEntries.find(e => e.date === selectedDateStr);
        if (entry) {
            setExchangeRate(entry.exchangeRate);
            setDailyData(entry.entries);
            setProductOrder(entry.productOrder || []);
        } else {
            setDailyData({});
            setExchangeRate(600);
            // Comme l'ancienne app : réutiliser le dernier productOrder du mois (ex. 22/05 si 23/05 vide)
            const monthPrefix = selectedDateStr.slice(0, 7);
            const fallback = [...dailyEntries]
                .filter(
                    e =>
                        e.date.startsWith(monthPrefix) &&
                        e.date <= selectedDateStr &&
                        (e.productOrder?.length ?? 0) > 0
                )
                .sort((a, b) => b.date.localeCompare(a.date))[0];
            setProductOrder(fallback?.productOrder || []);
        }
    } else {
        setProductOrder([]);
    }
  }, [selectedDateStr, dailyEntries, isSingleDay]);

  // --- HELPERS ---
  const getLatestConfig = useCallback((productId: string, allConfigs: ProductFinancialConfig[]) => {
      const productConfigs = allConfigs.filter(c => c.productId === productId);
      productConfigs.sort((a, b) => {
          const dateA = configEffectDate(a);
          const dateB = configEffectDate(b);
          if (dateA !== dateB) return dateB.localeCompare(dateA);
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      });
      return productConfigs[0];
  }, []);

  const getConfigForDate = useCallback((productId: string, date: string) => {
      const productConfigs = configs.filter(c => c.productId === productId);
      
      const validConfigs = productConfigs.filter(c => {
          const effectDate = configEffectDate(c);
          return effectDate && effectDate <= date;
      });

      if (validConfigs.length === 0) return null;

      validConfigs.sort((a, b) => {
          const dateA = configEffectDate(a);
          const dateB = configEffectDate(b);
          if (dateA !== dateB) return dateB.localeCompare(dateA);
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });

      return validConfigs[0];
  }, [configs]);

  // --- CALCULATIONS ---

  const isOrderForProduct = useCallback((order: Order, prod: Product) => {
    // ⚠️ NE JAMAIS utiliser includes(), startsWith(), indexOf() pour matcher
    // les noms de produits — risque de faux positifs entre noms similaires
    // (ex: "Bose Ultra" ⊂ "Bose QC Ultra").
    // Toujours : ID en priorité → SKU → nom EXACT uniquement.

    // ── PRIORITÉ 1 : comparaison par ID Shopify (infaillible) ──
    if (order.productId && prod.id && order.productId === prod.id) {
        return true;
    }

    // Gestion multi-produits (tableau structuré)
    if (order.products && order.products.length > 0) {
        return order.products.some(p => {
            // ID ou SKU
            if (p.sku === prod.id) return true;
            // Nom exact
            const nomLigne = normaliser(p.name || '');
            const nomProduit = normaliser(prod.title || '');
            return nomLigne && nomProduit && nomLigne === nomProduit;
        });
    }

    // ── PRIORITÉ 3 : comparaison nom EXACTE uniquement (via matcherLigneProduit pour chaque ligne) ──
    const detailLignes = (order.productDetails || '').split('\n').filter(l => l.trim() !== '');
    return detailLignes.some(ligne => matcherLigneProduit(ligne, prod));
  }, []);

  const getQuantityInOrder = useCallback((order: Order, prod?: Product): number => {
      try {
          if (order.products && order.products.length > 0) {
              if (prod) {
                  return order.products
                      .filter(p => {
                          // ID ou SKU
                          if (p.sku === prod.id) return true;
                          // Nom exact
                          const nomLigne = normaliser(p.name || '');
                          const nomProduit = normaliser(prod.title || '');
                          return nomLigne && nomProduit && nomLigne === nomProduit;
                      })
                      .reduce((acc, p) => acc + (p.quantity || 1), 0);
              }
              return order.products.reduce((acc, p) => acc + (p.quantity || 1), 0);
          }
          
          const productDetails = order.productDetails || '';
          
          if (prod) {
              // PRIORITÉ 1: ID global de la commande
              if (order.productId && order.productId === prod.id) {
                  const { quantity } = parseProductCommand(productDetails);
                  return quantity;
              }
              // PRIORITÉ 3: Matching par ligne dans productDetails
              const detailLignes = productDetails.split('\n').filter(l => l.trim() !== '');
              let totalQty = 0;
              detailLignes.forEach(ligne => {
                  if (matcherLigneProduit(ligne, prod)) {
                      const { quantity } = parseProductCommand(ligne);
                      totalQty += quantity;
                  }
              });
              return totalQty;
          }
          
          // Si pas de produit spécifique, on somme toutes les quantités détectées
          const detailLignes = productDetails.split('\n').filter(l => l.trim() !== '');
          return detailLignes.reduce((sum, ligne) => {
              const { quantity } = parseProductCommand(ligne);
              return sum + quantity;
          }, 0);
      } catch (e) {
          console.error("Error parsing quantity", e);
          return 1;
      }
  }, []);

  const isDeltaPaid = (o: any) => {
      const pStatus = o?.paymentStatus || o?.statusPaiement || "";
      const isGlobalPaid = String(pStatus).toLowerCase() === "payé" || String(pStatus).toLowerCase() === "paid";
      
      const regionalStatus = o?.paiementProduit 
          ?? o?.paiement_produit 
          ?? o?.paymentProduct
          ?? o?.regionalPaymentStatus 
          ?? o?.payment_product
          ?? "";
      const isRegPaid = String(regionalStatus).toLowerCase() === "payé" || String(regionalStatus).toLowerCase() === "paid" || String(regionalStatus).toLowerCase() === "paye";
      
      return isGlobalPaid || isRegPaid;
  };

  const getIsDelta = useCallback((o: any) => {
      const regionalStatuses = [
          'regional_en_attente', 'regional_contacte', 'regional_relance', 'regional_injoignable', 
          'regional_injoignable_x2', 'regional_injoignable_x3',
          'expedition_en_cours', 'expedition_livree', 'regional_annule', 'regional_reporte'
      ];
      if (regionalStatuses.includes(o?.status || '')) return true;
      
      if (isDeltaPaid(o)) return true;
      
      if (o?.zoneId) {
          const zone = zones.find(z => z.id === o.zoneId);
          if (zone && zone.type === 'regional') return true;
      }
      
      return false;
  }, [zones]);

  const getOrderDate = (order: any, isDelta: boolean): string => {
    if (isDelta) {
      // Delta : date de paiement en priorité, sinon date attribution
      return order?.datePaiement?.split('T')[0]
        ?? order?.paiementAt?.split('T')[0]
        ?? order?.dateAttribution?.split('T')[0]
        ?? order?.assignedAt?.split('T')[0]
        ?? '';
    } else {
      // Dakar : date d'attribution au livreur
      return order?.dateAttribution?.split('T')[0]
        ?? order?.assignedAt?.split('T')[0]
        ?? '';
    }
  };

  const calculateRealSales = useCallback((orderList: Order[], prod?: Product, dateFilter?: string) => {
      return orderList.reduce((sum, o) => {
          const isRegional = getIsDelta(o);

          const targetDate = getOrderDate(o, isRegional);
          if (!targetDate) return sum;
          
          if (dateFilter && !targetDate.startsWith(dateFilter)) return sum;

          const qty = getQuantityInOrder(o, prod);
          if (qty === 0) return sum;

          const status = (o?.status || '').toLowerCase();
          if (isRegional) {
              if (isDeltaPaid(o) || status === 'livré' || status === 'terminé' || status === 'expedition_livree') return sum + qty;
          } else {
              if (status === 'livré' || status === 'terminé') return sum + qty;
          }
          return sum;
      }, 0);
  }, [getIsDelta, getQuantityInOrder]);

  const calculateToDeliver = useCallback((orderList: Order[], prod?: Product, dateFilter?: string) => {
      return orderList.reduce((sum, o) => {
          const isRegional = getIsDelta(o);

          const targetDate = getOrderDate(o, isRegional);
          if (!targetDate) return sum;
          if (dateFilter && !targetDate.startsWith(dateFilter)) return sum;

          const qty = getQuantityInOrder(o, prod);
          if (qty === 0) return sum;

          const status = (o?.status || '').toLowerCase();
          if (isRegional) {
              if (isDeltaPaid(o) || status === 'livré' || status === 'terminé' || status === 'expedition_livree') return sum + qty;
          } else {
              const isExcluded = ['annulé', 'injoignable', 'refusé'].includes(status);
              if (o?.driverId && !isExcluded) return sum + qty;
          }
          return sum;
      }, 0);
  }, [getIsDelta, getQuantityInOrder]);

  const calculateRow = useCallback((product: Product) => {
      if (!safeDateRange.startDate || !safeDateRange.endDate) {
          return {
              CA: 0, APPRO: 0, PUB_CFA: 0, MARGE: 0, TAUX_MARGE: 0, MER: 0, ROI: 0, CPAu: 0,
              soldQty: 0, spendUsd: 0, pointMort: 0, allocatedPubCfa: 0, realSales: 0,
              score: 0, toDeliver: 0, config: null
          };
      }

      let aggCA = 0;
      let aggAPPRO = 0;
      let aggPUB_CFA = 0;
      let aggSoldQty = 0;
      let aggSpendUsd = 0;
      let aggPointMort = 0;
      let aggAllocatedPubCfa = 0;
      
      let days: Date[] = [];
      try {
          days = eachDayOfInterval({ start: safeDateRange.startDate, end: safeDateRange.endDate });
      } catch (e) {
          console.error("Invalid date interval", e);
          days = [];
      }
      
      const productOrders = orders.filter(o => isOrderForProduct(o, product));

      days.forEach(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const config = getConfigForDate(product.id, dateStr);
          
          let rate = 600;
          if (isSingleDay && dateStr === selectedDateStr) {
              rate = exchangeRate;
          } else {
              const entry = dailyEntries.find(e => e.date === dateStr);
              if (entry) {
                  rate = entry.exchangeRate;
              }
          }

          const CAU = config?.cau || 0;
          const APPRO_U = config?.appro || 0;
          const dailyAllocatedBudgetUsd = config?.dailyBudgetUsd || 0;
          const dailyAllocatedPubCfa = dailyAllocatedBudgetUsd * 1.18 * rate;
          const marginUnit = CAU - APPRO_U;
          const dailyPointMort = marginUnit > 0 ? Math.ceil(dailyAllocatedPubCfa / marginUnit) : 0;
          
          aggPointMort += dailyPointMort;
          aggAllocatedPubCfa += dailyAllocatedPubCfa;

          // FINANCE START DATE CHECK
          if (isBefore(day, FINANCE_START_DATE)) {
              return; // Skip other calculations for days before March 5, 2026
          }

          let soldQty = 0;
          let spendUsd = 0;

          if (isSingleDay && dateStr === selectedDateStr) {
              soldQty = Number(dailyData[product.id]?.soldQty) || 0;
              spendUsd = Number(dailyData[product.id]?.spendUsd) || 0;
          } else {
              const entry = dailyEntries.find(e => e.date === dateStr);
              if (entry) {
                  soldQty = entry.entries[product.id]?.soldQty || 0;
                  spendUsd = entry.entries[product.id]?.spendUsd || 0;
              }
          }
          
          const dailyCA = soldQty * CAU;
          const dailyAPPRO = soldQty * APPRO_U;
          const dailyPUB_CFA = spendUsd * 1.18 * rate;
          
          aggCA += dailyCA;
          aggAPPRO += dailyAPPRO;
          aggPUB_CFA += dailyPUB_CFA;
          aggSoldQty += soldQty;
          aggSpendUsd += spendUsd;
      });

      const MARGE = aggCA - aggAPPRO - aggPUB_CFA;
      const TAUX_MARGE = (aggAPPRO + aggPUB_CFA) > 0 ? (MARGE / (aggAPPRO + aggPUB_CFA)) * 100 : 0;
      const MER = aggPUB_CFA > 0 ? aggCA / aggPUB_CFA : 0;
      const ROI = aggPUB_CFA > 0 ? MARGE / aggPUB_CFA : 0;
      const CPAu = aggSoldQty > 0 ? aggPUB_CFA / aggSoldQty : 0;

      const rangeOrders = productOrders.filter(o => {
          const isRegional = getIsDelta(o);

          const d = getOrderDate(o, isRegional);
          if (!d) return false;
          try {
              const dateObj = parseISO(d);
              if (isNaN(dateObj.getTime())) return false;
              if (isBefore(dateObj, FINANCE_START_DATE)) return false;
              return isWithinInterval(dateObj, { start: startOfDay(safeDateRange.startDate), end: endOfDay(safeDateRange.endDate) });
          } catch (e) {
              return false;
          }
      });

      const realSales = calculateRealSales(rangeOrders, product);
      const toDeliver = calculateToDeliver(rangeOrders, product);
      
      let score = 0;
      if (!isBefore(safeDateRange.startDate, FINANCE_START_DATE)) {
          score = realSales - aggPointMort;
      }

      const latestConfig = getConfigForDate(product.id, format(safeDateRange.endDate, 'yyyy-MM-dd'));

      return {
          CA: aggCA,
          APPRO: aggAPPRO,
          PUB_CFA: aggPUB_CFA,
          MARGE,
          TAUX_MARGE,
          MER,
          ROI,
          CPAu,
          soldQty: aggSoldQty,
          spendUsd: aggSpendUsd,
          pointMort: aggPointMort,
          allocatedPubCfa: aggAllocatedPubCfa,
          realSales,
          score,
          toDeliver,
          config: latestConfig
      };
  }, [safeDateRange, orders, dailyEntries, dailyData, exchangeRate, isSingleDay, selectedDateStr, getConfigForDate, isOrderForProduct, calculateRealSales, calculateToDeliver]);

  // --- FILTERING & SORTING ---
  const activeCampaignProducts = useMemo(() => {
      if (!safeDateRange.endDate || isNaN(safeDateRange.endDate.getTime())) return [];
      
      const active = products.filter(p => {
          try {
              const config = getConfigForDate(p.id, format(safeDateRange.endDate, 'yyyy-MM-dd'));
              return config?.isCampaignActive === true;
          } catch (e) {
              console.error("Error checking active campaign", e);
              return false;
          }
      });

      // Aligner l'affichage sur l'ancienne app quand productOrder est défini (jour ou fallback mensuel)
      if (isSingleDay && productOrder.length > 0) {
          const orderSet = new Set(productOrder);
          const ordered = productOrder
              .map(id => active.find(p => p.id === id))
              .filter((p): p is Product => !!p);
          active.forEach(p => {
              if (!orderSet.has(p.id)) ordered.push(p);
          });
          return ordered;
      }

      return active;
  }, [products, configs, safeDateRange, getConfigForDate, isSingleDay, productOrder]);

  const displayProducts = useMemo(() => {
      return activeCampaignProducts?.map(p => ({
          product: p,
          row: calculateRow(p)
      }));
  }, [activeCampaignProducts, calculateRow]);

  const sortedProducts = useMemo(() => {
      let result = [...displayProducts];
      
      if (productOrder.length > 0) {
          const productMap = new Map(displayProducts?.map(item => [item.product.id, item]));
          result = productOrder?.map(id => productMap.get(id)).filter(Boolean) as typeof displayProducts;
          
          const orderSet = new Set(productOrder);
          displayProducts.forEach(item => {
              if (!orderSet.has(item.product.id)) {
                  result.push(item);
              }
          });
      } else if (!isSingleDay) {
          // For date ranges (no editing), we can sort by MARGE desc
          result.sort((a, b) => b.row.MARGE - a.row.MARGE);
      }
      // If isSingleDay and productOrder is empty (new day), we do NOT sort dynamically
      // to keep the rows 100% frozen during input.
      
      return result;
  }, [displayProducts, productOrder, isSingleDay]);

  // --- MONTHLY STATS ---
  const monthlyStats = useMemo(() => {
      if (!safeDateRange.startDate) return { CA: 0, MARGE: 0, ROI: 0 };
      
      const targetMonthStr = format(safeDateRange.startDate, 'yyyy-MM');
      const start = startOfMonth(safeDateRange.startDate);
      const end = endOfMonth(safeDateRange.startDate);
      const daysInMonth = eachDayOfInterval({ start, end });
      
      let totalCA = 0;
      let totalAPPRO = 0;
      let totalPUB_CFA = 0;

      // Find all products that have data in this month
      const productsWithData = products.filter(p => {
          const hasDailyData = dailyEntries.some(
              e => e.date.startsWith(targetMonthStr) && e.entries?.[p.id]
          );
          return hasDailyData;
      });

      productsWithData.forEach(product => {
          daysInMonth.forEach(day => {
              // FINANCE START DATE CHECK
              if (isBefore(day, FINANCE_START_DATE)) {
                  return; // Skip days before March 5, 2026
              }

              const dateStr = format(day, 'yyyy-MM-dd');
              const config = getConfigForDate(product.id, dateStr);
              
              let soldQty = 0;
              let spendUsd = 0;
              let rate = 600;

              // Use current dailyData if we are looking at the selected day, otherwise use dailyEntries
              if (isSingleDay && dateStr === selectedDateStr) {
                  soldQty = Number(dailyData[product.id]?.soldQty) || 0;
                  spendUsd = Number(dailyData[product.id]?.spendUsd) || 0;
                  rate = exchangeRate;
              } else {
                  const entry = dailyEntries.find(e => e.date === dateStr);
                  if (entry?.entries) {
                      soldQty = entry.entries[product.id]?.soldQty || 0;
                      spendUsd = entry.entries[product.id]?.spendUsd || 0;
                      rate = entry.exchangeRate;
                  }
              }

              const CAU = config?.cau || 0;
              const APPRO_U = config?.appro || 0;
              
              totalCA += soldQty * CAU;
              totalAPPRO += soldQty * APPRO_U;
              totalPUB_CFA += spendUsd * 1.18 * rate;
          });
      });

      const totalMargin = totalCA - totalAPPRO - totalPUB_CFA;
      const totalROI = totalPUB_CFA > 0 ? totalMargin / totalPUB_CFA : 0;

      return {
          CA: totalCA,
          MARGE: totalMargin,
          ROI: totalROI
      };
  }, [safeDateRange, products, configs, dailyEntries, dailyData, exchangeRate, isSingleDay, selectedDateStr, getConfigForDate]);

  // --- TOTALS FOR CURRENT VIEW ---
  const viewTotals = useMemo(() => {
      return displayProducts.reduce((acc, { row }) => ({
          soldQty: acc.soldQty + row.soldQty,
          spendUsd: acc.spendUsd + row.spendUsd,
          CA: acc.CA + row.CA,
          APPRO: acc.APPRO + row.APPRO,
          PUB_CFA: acc.PUB_CFA + row.PUB_CFA,
          MARGE: acc.MARGE + row.MARGE,
          toDeliver: acc.toDeliver + row.toDeliver,
          realSales: acc.realSales + row.realSales,
          pointMort: acc.pointMort + row.pointMort,
          score: acc.score + row.score
      }), {
          soldQty: 0, spendUsd: 0, CA: 0, APPRO: 0, PUB_CFA: 0, MARGE: 0, toDeliver: 0, realSales: 0, pointMort: 0, score: 0
      });
  }, [displayProducts]);

  const viewROI = viewTotals.PUB_CFA > 0 ? viewTotals.MARGE / viewTotals.PUB_CFA : 0;
  const viewMarginRate = (viewTotals.APPRO + viewTotals.PUB_CFA) > 0 ? (viewTotals.MARGE / (viewTotals.APPRO + viewTotals.PUB_CFA)) * 100 : 0;
  const viewMER = viewTotals.PUB_CFA > 0 ? viewTotals.CA / viewTotals.PUB_CFA : 0;

  // --- OTHER PRODUCTS METRICS (AUTRES PRODUITS) ---
  const otherProductsMetrics = useMemo(() => {
      if (!safeDateRange.startDate || !safeDateRange.endDate) {
          return { toDeliver: 0, realized: 0, objective: 0, score: 0 };
      }

      let toDeliver = 0;
      let realized = 0;

      // Identify active campaign product IDs
      const activeProductIds = new Set(activeCampaignProducts?.map(p => p.id));

      orders.forEach(o => {
          const isDelta = getIsDelta(o);

          // Check date against range
          const orderDate = getOrderDate(o, isDelta);
          if (!orderDate) return;
          
          try {
              const dateObj = parseISO(orderDate);
              if (isNaN(dateObj.getTime())) return;
              if (isBefore(dateObj, FINANCE_START_DATE)) return;
              const isInRange = isWithinInterval(dateObj, { 
                  start: startOfDay(safeDateRange.startDate), 
                  end: endOfDay(safeDateRange.endDate) 
              });
              if (!isInRange) return;
          } catch (e) {
              return;
          }

          // Count quantities specifically for items that ARE NOT campaign products
          let orderOtherQty = 0;
          if (o.products && o.products.length > 0) {
              orderOtherQty = o.products.reduce((acc, p) => {
                  const isAC = activeProductIds.has(p.sku || '') || 
                      activeCampaignProducts.some(cp => normaliser(p.name || '') === normaliser(cp.title || ''));
                  return isAC ? acc : acc + (p.quantity || 1);
              }, 0);
          } else {
              const detailLignes = (o.productDetails || '').split('\n').filter(l => l.trim() !== '');
              orderOtherQty = detailLignes.reduce((acc, ligne) => {
                  const isCampaign = activeCampaignProducts.some(cp => matcherLigneProduit(ligne, cp));
                  if (!isCampaign) {
                      const { quantity } = parseProductCommand(ligne);
                      return acc + quantity;
                  }
                  return acc;
              }, 0);
              
              // If global productId matches an active campaign, skip everything for consistency
              if (o.productId && activeProductIds.has(o.productId)) {
                  orderOtherQty = 0;
              }
          }

          if (orderOtherQty === 0) return;

          // Logic for To Deliver (À LIVRER)
          let isCountedToDeliver = false;
          if (isDelta) {
               if (isDeltaPaid(o)) isCountedToDeliver = true;
          } else {
               const status = (o?.status || '').toLowerCase();
               const isExcluded = ['annulé', 'injoignable', 'refusé'].includes(status);
               if (o?.driverId && !isExcluded) isCountedToDeliver = true;
          }

          if (isCountedToDeliver) {
              toDeliver += orderOtherQty;
          }

          // Logic for Realized (RÉALISÉ) - supporting both 'livré' and 'terminé'
          let isCountedRealized = false;
          const status = (o?.status || '').toLowerCase();
          if (isDelta) {
              if (isDeltaPaid(o) || status === 'livré' || status === 'terminé') isCountedRealized = true;
          } else {
              if (status === 'livré' || status === 'terminé') isCountedRealized = true;
          }

          if (isCountedRealized) {
              realized += orderOtherQty;
          }
      });

      return {
          toDeliver,
          realized,
          objective: toDeliver,
          score: realized - toDeliver
      };

  }, [orders, activeCampaignProducts, safeDateRange, zones, isOrderForProduct, getIsDelta]);


  useEffect(() => {
    loadData();
    const unsubs: (() => void)[] = [];

    unsubs.push(DataService.subscribeToProducts((p) => {
        setProducts(p);
    }));

    unsubs.push(DataService.subscribeToFinancialConfigs((c) => {
        setConfigs(c);
    }));

    unsubs.push(DataService.subscribeToDailyEntries((d) => {
        setDailyEntries(d);
    }));

    unsubs.push(DataService.subscribeToZones((z) => {
        setZones(z);
    }));

    unsubs.push(DataService.subscribeToOrders((newOrders) => {
        setOrders(newOrders);
    }));

    return () => unsubs.forEach(unsub => unsub());
  }, []);

  // Initial load state management
  useEffect(() => {
    if (products.length > 0 || orders.length > 0) {
        setLoading(false);
    }
  }, [products, orders]);

  // --- HANDLERS ---
  const handleDailyInputChange = (productId: string, field: 'soldQty' | 'spendUsd', value: string) => {
      setDailyData(prev => ({
          ...prev,
          [productId]: {
              ...(prev[productId] || { soldQty: 0, spendUsd: 0 }),
              [field]: value === '' ? '' : (parseFloat(value) || 0)
          }
      }));
  };

  const handleDailyInputFocus = (productId: string, field: 'soldQty' | 'spendUsd', currentValue: number | string) => {
      if (currentValue === 0) {
          setDailyData(prev => ({
              ...prev,
              [productId]: {
                  ...(prev[productId] || { soldQty: 0, spendUsd: 0 }),
                  [field]: ''
              }
          }));
      }
  };

  const handleDailyInputBlur = (productId: string, field: 'soldQty' | 'spendUsd', currentValue: number | string) => {
      if (currentValue === '' || currentValue === undefined) {
          setDailyData(prev => ({
              ...prev,
              [productId]: {
                  ...(prev[productId] || { soldQty: 0, spendUsd: 0 }),
                  [field]: 0
              }
          }));
      }
  };

  const handleSaveDailyData = async () => {
      if (!isSingleDay) return;
      
      try {
          const entriesToSave = Object.fromEntries(
              Object.entries(dailyData)?.map(([id, data]) => [
                  id,
                  {
                      soldQty: Number(data.soldQty) || 0,
                      spendUsd: Number(data.spendUsd) || 0
                  }
              ])
          );

          // Sort products by MARGE descending based on current data
          const sorted = [...displayProducts].sort((a, b) => b.row.MARGE - a.row.MARGE);
          const newOrder = sorted?.map(item => item.product.id);

          await DataService.saveDailyEntry({
              date: selectedDateStr,
              exchangeRate,
              entries: entriesToSave,
              productOrder: newOrder
          });
          
          setProductOrder(newOrder);
          
          // Refresh data to ensure consistency
          await loadData();
          alert('Données sauvegardées avec succès');
      } catch (e) {
          console.error("Error saving daily data", e);
          alert('Erreur lors de la sauvegarde');
      }
  };

  const openEditModal = (product: Product) => {
      const config = getLatestConfig(product.id, configs);
      setEditingProduct(product);
      setEditForm({
          cau: config?.cau || 0,
          appro: config?.appro || 0,
          dailyBudgetUsd: config?.dailyBudgetUsd || 0,
          isCampaignActive: config?.isCampaignActive ?? true
      });
  };

  const handleSaveConfig = async () => {
      if (!editingProduct) return;
      
      try {
          const dateEffet = new Date().toISOString().split('T')[0];
          const newConfig: ProductFinancialConfig = {
              productId: editingProduct.id,
              dateEffet: dateEffet,
              updatedAt: new Date().toISOString(),
              cau: editForm.cau || 0,
              appro: editForm.appro || 0,
              dailyBudgetUsd: editForm.dailyBudgetUsd || 0,
              isCampaignActive: editForm.isCampaignActive ?? true
          };
          
          await DataService.saveFinancialConfig(newConfig);
          await loadData(); // Refresh
          setEditingProduct(null);
          alert('Configuration sauvegardée avec succès (Versionnée au ' + dateEffet + ')');
      } catch (e) {
          console.error("Error saving config", e);
          alert("Erreur lors de la sauvegarde de la configuration");
      }
  };

  const handleLaunchCampaign = async () => {
      if (!launchForm.productId) return;
      
      try {
          const dateEffet = new Date().toISOString().split('T')[0];
          const newConfig: ProductFinancialConfig = {
              productId: launchForm.productId,
              dateEffet: dateEffet,
              updatedAt: new Date().toISOString(),
              cau: launchForm.cau || 0,
              appro: launchForm.appro || 0,
              dailyBudgetUsd: launchForm.dailyBudgetUsd || 0,
              isCampaignActive: true
          };
          
          await DataService.saveFinancialConfig(newConfig);
          await loadData();
          setIsLaunchModalOpen(false);
          setLaunchForm({ productId: '', cau: 0, appro: 0, dailyBudgetUsd: 0 });
          alert('Campagne lancée avec succès (Versionnée au ' + dateEffet + ')');
      } catch (e) {
          console.error("Error launching campaign", e);
          alert("Erreur lors du lancement de la campagne");
      }
  };

  const handlePrevDay = () => {
      const newDate = subDays(safeDateRange.startDate, 1);
      setDateRange({ startDate: newDate, endDate: newDate });
  };

  const handleNextDay = () => {
      const newDate = addDays(safeDateRange.startDate, 1);
      setDateRange({ startDate: newDate, endDate: newDate });
  };

  const exportToPDF = async () => {
      const doc = new jsPDF('landscape');
      
      try {
          const settings = await DataService.getSettings();
          if (settings.logoUrl) {
              doc.addImage(settings.logoUrl, 'PNG', 14, 10, 30, 10);
          }
      } catch (e) {
          console.error("Could not load logo for PDF", e);
      }

      const title = `Rapport de Rentabilité - ${isSingleDay ? format(safeDateRange.startDate, 'dd/MM/yyyy') : `${format(safeDateRange.startDate, 'dd/MM/yyyy')} au ${format(safeDateRange.endDate, 'dd/MM/yyyy')}`}`;
      
      doc.setFontSize(16);
      doc.text(title, 14, 30);

      doc.setFontSize(10);
      doc.text(`Total CA (Mois): ${formatFCFA(Math.round(monthlyStats.CA))}`, 14, 40);
      doc.text(`Marge (Mois): ${formatFCFA(Math.round(monthlyStats.MARGE))}`, 14, 45);
      doc.text(`ROI (Mois): ${monthlyStats.ROI.toFixed(2)}`, 14, 50);

      const tableData = sortedProducts?.map(({ product, row }) => {
          return [
              product.title,
              row.soldQty.toString(),
              formatFCFA(Math.round(row.CA)),
              formatFCFA(Math.round(row.APPRO)),
              formatFCFA(Math.round(row.PUB_CFA)),
              formatFCFA(Math.round(row.MARGE)),
              `${Math.round(row.TAUX_MARGE)}%`,
              row.MER.toFixed(2),
              row.ROI.toFixed(2),
              formatFCFA(Math.round(row.CPAu))
          ];
      });

      autoTable(doc, {
          startY: 60,
          head: [['Produit', 'Ventes', 'CA', 'Appro', 'Pub (FCFA)', 'Marge', 'Taux Marge', 'MER', 'ROI', 'CPA U.']],
          body: tableData,
          theme: 'grid',
          styles: { fontSize: 8 },
          headStyles: { fillColor: [41, 128, 185] },
      });

      // Add Totals row
      const finalY = (doc as any).lastAutoTable.finalY || 60;
      autoTable(doc, {
          startY: finalY,
          body: [[
              'TOTAL',
              viewTotals.soldQty.toString(),
              formatFCFA(Math.round(viewTotals.CA)),
              formatFCFA(Math.round(viewTotals.APPRO)),
              formatFCFA(Math.round(viewTotals.PUB_CFA)),
              formatFCFA(Math.round(viewTotals.MARGE)),
              `${Math.round(viewMarginRate)}%`,
              viewMER.toFixed(2),
              viewROI.toFixed(2),
              '-'
          ]],
          theme: 'grid',
          styles: { fontSize: 8, fontStyle: 'bold', fillColor: [240, 240, 240] },
      });

      doc.save(`rentabilite_${format(safeDateRange.startDate, 'yyyy-MM-dd')}.pdf`);
  };

  // --- RENDER ---
  if (loading) return (
      <div className="p-8 text-center flex flex-col items-center justify-center h-64">
          <RefreshCw className="animate-spin mb-4 text-blue-600" size={32} />
          <p className="text-gray-600 font-medium">Chargement des données...</p>
      </div>
  );

  if (error) return (
      <div className="p-8 text-center flex flex-col items-center justify-center h-64">
          <AlertCircle className="mb-4 text-red-600" size={32} />
          <p className="text-red-600 font-bold mb-4">{error}</p>
          <button 
              onClick={loadData}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
              Réessayer
          </button>
      </div>
  );

  return (
    <div className="p-6 max-w-[1600px] mx-auto pb-24 space-y-8">
      
      {/* BLOC 1: HEADER & MONTHLY TOTALS */}
      <div className="bg-white p-6 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-gray-100">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
              
              {/* Date Navigation & Rate */}
              <div className="flex flex-col gap-4 w-full xl:w-auto">
                  <div className="flex items-center flex-wrap gap-2 sm:gap-3">
                      <div className="flex items-center gap-1">
                        <button onClick={handlePrevDay} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                            <ChevronLeft size={20} className="text-gray-600" />
                        </button>
                        
                        <DateRangePicker 
                            dateRange={safeDateRange} 
                            onUpdate={setDateRange} 
                            align="left" 
                            className="min-w-[140px] sm:min-w-[200px]"
                        />

                        <button onClick={handleNextDay} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                            <ChevronRight size={20} className="text-gray-600" />
                        </button>
                      </div>
                      
                      <button 
                          onClick={exportToPDF}
                          className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                      >
                          <Download size={16} />
                          <span className="font-medium">PDF</span>
                      </button>
                  </div>

                  {isSingleDay && (
                      <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 w-fit">
                          <span className="text-sm font-medium text-gray-600">Taux USD :</span>
                          <input 
                              type="number" 
                              value={exchangeRate}
                              onChange={(e) => setExchangeRate(parseFloat(e.target.value) || 0)}
                              className="w-20 p-1 border rounded text-right font-mono text-sm"
                          />
                          <span className="text-sm text-gray-500">FCFA</span>
                      </div>
                  )}
              </div>

              {/* Monthly Totals — mois calendaire du début de la période sélectionnée */}
              <div className="flex flex-col gap-1">
              <p className="text-[10px] text-gray-500 font-medium">
                  Mois de {format(safeDateRange.startDate, 'MMMM yyyy', { locale: fr })} (tous produits avec saisie pub)
              </p>
              <div className="flex gap-4">
                  <div className="bg-blue-100 px-6 py-3 rounded-2xl border border-blue-200 shadow-sm">
                      <p className="text-xs text-blue-800 font-bold uppercase tracking-wider mb-1">Total CA (Mois)</p>
                      <p className="text-2xl font-bold text-blue-900">{formatFCFA(Math.round(monthlyStats.CA))}</p>
                  </div>
                  <div className="bg-green-100 px-6 py-3 rounded-2xl border border-green-200 shadow-sm">
                      <p className="text-xs text-green-800 font-bold uppercase tracking-wider mb-1">Marge (Mois)</p>
                      <p className="text-2xl font-bold text-green-900">{formatFCFA(Math.round(monthlyStats.MARGE))}</p>
                  </div>
                  <div className="bg-purple-100 px-6 py-3 rounded-2xl border border-purple-200 shadow-sm">
                      <p className="text-xs text-purple-800 font-bold uppercase tracking-wider mb-1">ROI (Mois)</p>
                      <p className="text-2xl font-bold text-purple-900">{monthlyStats.ROI.toFixed(2)}</p>
                  </div>
              </div>
              </div>

              {/* Actions: Save Day & Launch Campaign */}
              <div className="flex gap-3">
                  {isSingleDay && (
                      <button 
                          onClick={handleSaveDailyData}
                          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 shadow-sm transition-colors"
                      >
                          <Save size={20} />
                          Enregistrer Journée
                      </button>
                  )}
                  <button 
                      onClick={() => setIsLaunchModalOpen(true)}
                      className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 shadow-sm transition-colors"
                  >
                      <Plus size={20} />
                      Lancer une campagne
                  </button>
              </div>
          </div>
      </div>

      {/* BLOC 2: DAILY INPUT TABLE */}
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-gray-50 text-gray-700 font-semibold sticky top-0 z-20">
                      <tr>
                          <th className="p-3 border-b text-left min-w-[300px] sticky left-0 bg-gray-50 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">PRODUIT</th>
                          <th className="p-3 border-b text-center w-24">QTES V.</th>
                          <th className="p-3 border-b text-center w-24">PUB ($)</th>
                          <th className="p-3 border-b text-right">CA</th>
                          <th className="p-3 border-b text-right">APPRO</th>
                          <th className="p-3 border-b text-right">PUB (CFA)</th>
                          <th className="p-3 border-b text-right">MARGE</th>
                          <th className="p-3 border-b text-right">% MARGE</th>
                          <th className="p-3 border-b text-right">MER</th>
                          <th className="p-3 border-b text-right">ROI</th>
                          <th className="p-3 border-b text-right">CPAU</th>
                          <th className="p-3 border-b text-center w-16">ACTIONS</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                      {sortedProducts?.map(({ product, row }) => (
                          <tr key={product.id} className="hover:bg-gray-50 transition-colors group">
                              <td className="p-3 border-r font-medium text-gray-900 truncate max-w-[300px] sticky left-0 bg-white z-10 group-hover:bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" title={product.title}>
                                  {product.title}
                              </td>
                              
                              {/* QTES V - Editable */}
                              <td className="p-2 border-r text-center bg-[#FFF4E5] w-24">
                                  {isSingleDay ? (
                                      <input 
                                          type="number"
                                          value={dailyData[product.id]?.soldQty ?? row.soldQty}
                                          onChange={(e) => handleDailyInputChange(product.id, 'soldQty', e.target.value)}
                                          onFocus={() => handleDailyInputFocus(product.id, 'soldQty', dailyData[product.id]?.soldQty ?? row.soldQty)}
                                          onBlur={() => handleDailyInputBlur(product.id, 'soldQty', dailyData[product.id]?.soldQty ?? row.soldQty)}
                                          className="w-full p-1 text-center border border-orange-200 rounded focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                                      />
                                  ) : (
                                      <span className="font-bold">{row.soldQty}</span>
                                  )}
                              </td>

                              {/* PUB ($) - Editable */}
                              <td className="p-2 border-r text-center bg-[#FFF4E5] w-24">
                                  {isSingleDay ? (
                                      <input 
                                          type="number"
                                          value={dailyData[product.id]?.spendUsd ?? row.spendUsd}
                                          onChange={(e) => handleDailyInputChange(product.id, 'spendUsd', e.target.value)}
                                          onFocus={() => handleDailyInputFocus(product.id, 'spendUsd', dailyData[product.id]?.spendUsd ?? row.spendUsd)}
                                          onBlur={() => handleDailyInputBlur(product.id, 'spendUsd', dailyData[product.id]?.spendUsd ?? row.spendUsd)}
                                          className="w-full p-1 text-center border border-orange-200 rounded focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                                      />
                                  ) : (
                                      <span className="font-bold">{Number(row.spendUsd).toFixed(2)}</span>
                                  )}
                              </td>

                              <td className="p-3 border-r text-right font-bold text-gray-800">
                                  {formatNumber(Math.round(row.CA))}
                              </td>
                              <td className="p-3 border-r text-right font-bold text-gray-800">
                                  {formatNumber(Math.round(row.APPRO))}
                              </td>
                              <td className="p-3 border-r text-right font-bold text-gray-800">
                                  {formatNumber(Math.round(row.PUB_CFA))}
                              </td>
                              
                              <td className={`p-3 border-r text-right font-bold ${row.MARGE >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {formatNumber(Math.round(row.MARGE))}
                              </td>
                              
                              <td className="p-3 border-r text-right font-bold text-gray-800">
                                  {Math.round(row.TAUX_MARGE)}%
                              </td>
                              <td className="p-3 border-r text-right font-bold text-gray-800">
                                  {row.MER.toFixed(2)}
                              </td>
                              <td className={`p-3 border-r text-right font-bold ${row.ROI >= 2 ? 'text-black' : row.ROI >= 1 ? 'text-orange-500' : 'text-red-600'}`}>
                                  {row.ROI.toFixed(2)}
                              </td>
                              <td className="p-3 border-r text-right font-bold text-gray-800">
                                  {formatNumber(Math.round(row.CPAu))}
                              </td>
                              <td className="p-2 text-center w-16">
                                  <button 
                                      onClick={() => openEditModal(product)}
                                      className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                      title="Modifier la configuration"
                                  >
                                      <Edit2 size={16} />
                                  </button>
                              </td>
                          </tr>
                      ))}

                      {/* TOTAL ROW */}
                      <tr className="bg-gray-100 font-bold border-t-2 border-gray-200">
                          <td className="p-3 border-r text-gray-800 sticky left-0 bg-gray-100 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">TOTAL</td>
                          <td className="p-3 border-r text-center">{viewTotals.soldQty}</td>
                          <td className="p-3 border-r text-center">{viewTotals.spendUsd.toFixed(2)}</td>
                          <td className="p-3 border-r text-right">{formatNumber(Math.round(viewTotals.CA))}</td>
                          <td className="p-3 border-r text-right">{formatNumber(Math.round(viewTotals.APPRO))}</td>
                          <td className="p-3 border-r text-right">{formatNumber(Math.round(viewTotals.PUB_CFA))}</td>
                          <td className={`p-3 border-r text-right ${viewTotals.MARGE >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {formatNumber(Math.round(viewTotals.MARGE))}
                          </td>
                          <td className="p-3 border-r text-right">{Math.round(viewMarginRate)}%</td>
                          <td className="p-3 border-r text-right">{viewMER.toFixed(2)}</td>
                          <td className={`p-3 border-r text-right ${viewROI >= 2 ? 'text-green-700' : 'text-red-700'}`}>
                              {viewROI.toFixed(2)}
                          </td>
                          <td className="p-3 border-r text-right">-</td>
                          <td className="p-3"></td>
                      </tr>
                  </tbody>
              </table>
          </div>
          
          {/* Footer Actions */}
          {isSingleDay && (
              <div className="p-4 border-t bg-gray-50 flex justify-end">
                  <button 
                      onClick={handleSaveDailyData}
                      className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 shadow-sm transition-colors"
                  >
                      Sauvegarder les modifications
                  </button>
              </div>
          )}
      </div>

      {/* BLOC 3: POINTS MORTS (OBJECTIFS QUOTIDIENS) */}
      <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-gray-100 overflow-hidden">
          <div className="bg-white p-6 border-b border-gray-200">
              <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                <div>
                  <h3 className="font-bold text-gray-900 uppercase tracking-wide text-lg">Objectifs Quotidiens</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Période : {format(safeDateRange.startDate, 'dd/MM/yyyy')} → {format(safeDateRange.endDate, 'dd/MM/yyyy')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4">
                    <div className="bg-blue-50 px-4 py-3 rounded-xl border border-blue-100 shadow-sm flex flex-col items-center min-w-[140px]">
                        <span className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">À LIVRER TOTAL</span>
                        <span className="text-2xl font-bold text-blue-600">{viewTotals.toDeliver + otherProductsMetrics.toDeliver}</span>
                    </div>
                    <div className="bg-green-50 px-4 py-3 rounded-xl border border-green-100 shadow-sm flex flex-col items-center min-w-[140px]">
                        <span className="text-xs font-bold text-green-400 uppercase tracking-wider mb-1">RÉALISÉ TOTAL</span>
                        <span className="text-2xl font-bold text-green-600">{viewTotals.realSales + otherProductsMetrics.realized}</span>
                    </div>
                    <div className="bg-orange-50 px-4 py-3 rounded-xl border border-orange-100 shadow-sm flex flex-col items-center min-w-[140px]">
                        <span className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-1">OBJECTIF TOTAL</span>
                        <span className="text-2xl font-bold text-orange-600">{viewTotals.pointMort + otherProductsMetrics.objective}</span>
                    </div>
                  <div className="bg-purple-50 px-4 py-3 rounded-xl border border-purple-100 shadow-sm flex flex-col items-center min-w-[140px]">
                      <span className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-1">SCORE TOTAL</span>
                      <span className={`text-2xl font-bold ${(viewTotals.score + otherProductsMetrics.score) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {viewTotals.score + otherProductsMetrics.score > 0 ? '+' : ''}{viewTotals.score + otherProductsMetrics.score}
                      </span>
                  </div>
                </div>
              </div>
          </div>
          
          <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-white text-gray-600 border-b sticky top-0 z-20">
                      <tr>
                          <th className="p-3 border-r min-w-[200px] sticky left-0 bg-white z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">PRODUIT</th>
                          <th className="p-3 border-r text-right">BUDGET ($)</th>
                          <th className="p-3 border-r text-right">COÛT ACHAT</th>
                          <th className="p-3 border-r text-center">À LIVRER</th>
                          <th className="p-3 border-r text-center">RÉALISÉ</th>
                          <th className="p-3 border-r text-center">OBJECTIF</th>
                          <th className="p-3 border-r text-center">SCORE</th>
                          <th className="p-3 text-center">STATUS</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                      {sortedProducts?.map(({ product, row }) => (
                          <tr key={product.id} className="hover:bg-gray-50 transition-colors group">
                              <td className="p-3 border-r font-medium text-gray-900 truncate max-w-[200px] sticky left-0 bg-white z-10 group-hover:bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                  {product.title}
                              </td>
                              <td className="p-3 border-r text-right font-bold text-gray-800">
                                  {row.config?.dailyBudgetUsd || 0}
                              </td>
                              <td className="p-3 border-r text-right font-bold text-gray-800">
                                  {formatNumber(Math.round(row.config?.appro || 0))}
                              </td>
                              <td className="p-3 border-r text-center font-bold text-blue-600">
                                  {row.toDeliver}
                              </td>
                              <td className="p-3 border-r text-center font-bold text-green-600">
                                  {row.realSales}
                              </td>
                              <td className="p-3 border-r text-center font-bold text-gray-800">
                                  {row.pointMort}
                              </td>
                              <td className={`p-3 border-r text-center font-bold ${row.score >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {row.score > 0 ? '+' : ''}{row.score}
                              </td>
                              <td className="p-3 text-center">
                                  {row.score >= 0 ? (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                          ATTEINT
                                      </span>
                                  ) : (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                          EN COURS
                                      </span>
                                  )}
                              </td>
                          </tr>
                      ))}
                      
                      {/* AUTRES PRODUITS ROW */}
                      <tr className="bg-gray-50 font-medium border-t-2 border-gray-200">
                          <td className="p-3 border-r text-gray-800 italic sticky left-0 bg-gray-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Autres Produits</td>
                          <td className="p-3 border-r text-right text-gray-400">-</td>
                          <td className="p-3 border-r text-right text-gray-400">-</td>
                          <td className="p-3 border-r text-center font-bold text-blue-600">
                              {otherProductsMetrics.toDeliver}
                          </td>
                          <td className="p-3 border-r text-center font-bold text-green-600">
                              {otherProductsMetrics.realized}
                          </td>
                          <td className="p-3 border-r text-center font-bold text-gray-800">
                              {otherProductsMetrics.objective}
                          </td>
                          <td className={`p-3 border-r text-center font-bold ${otherProductsMetrics.score >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {otherProductsMetrics.score > 0 ? '+' : ''}{otherProductsMetrics.score}
                          </td>
                          <td className="p-3 text-center">
                              {otherProductsMetrics.score >= 0 ? (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                      ATTEINT
                                  </span>
                              ) : (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                      EN COURS
                                  </span>
                              )}
                          </td>
                      </tr>
                  </tbody>
              </table>
          </div>
      </div>

      {/* EDIT MODAL */}
      <Modal 
          isOpen={!!editingProduct} 
          onClose={() => setEditingProduct(null)}
          title={`Configuration: ${editingProduct?.title}`}
      >
          <div className="space-y-4">
              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Statut Campagne</label>
                  <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                              type="radio" 
                              checked={editForm.isCampaignActive === true}
                              onChange={() => setEditForm(prev => ({ ...prev, isCampaignActive: true }))}
                              className="text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm">Active</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                              type="radio" 
                              checked={editForm.isCampaignActive === false}
                              onChange={() => setEditForm(prev => ({ ...prev, isCampaignActive: false }))}
                              className="text-red-600 focus:ring-red-500"
                          />
                          <span className="text-sm">Inactive</span>
                      </label>
                  </div>
              </div>

              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CA Unitaire (FCFA)</label>
                  <input 
                      type="number" 
                      value={editForm.cau || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, cau: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
              </div>

              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Coût d'Appro (FCFA)</label>
                  <input 
                      type="number" 
                      value={editForm.appro || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, appro: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
              </div>

              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Budget Journalier ($)</label>
                  <input 
                      type="number" 
                      value={editForm.dailyBudgetUsd || ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, dailyBudgetUsd: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
              </div>

              <div className="pt-4 flex justify-end gap-3">
                  <button 
                      onClick={() => setEditingProduct(null)}
                      className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                      Annuler
                  </button>
                  <button 
                      onClick={handleSaveConfig}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                      Enregistrer
                  </button>
              </div>
          </div>
      </Modal>

      {/* LAUNCH CAMPAIGN MODAL */}
      <Modal 
          isOpen={isLaunchModalOpen} 
          onClose={() => setIsLaunchModalOpen(false)}
          title="Lancer une nouvelle campagne"
      >
          <div className="space-y-4">
              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Produit</label>
                  <select
                      value={launchForm.productId}
                      onChange={(e) => setLaunchForm(prev => ({ ...prev, productId: e.target.value }))}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                      <option value="">Sélectionner un produit</option>
                      {products?.map(p => (
                          <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                  </select>
              </div>

              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CA Unitaire (FCFA)</label>
                  <input 
                      type="number" 
                      value={launchForm.cau || ''}
                      onChange={(e) => setLaunchForm(prev => ({ ...prev, cau: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: 15000"
                  />
              </div>

              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Coût d'Appro (FCFA)</label>
                  <input 
                      type="number" 
                      value={launchForm.appro || ''}
                      onChange={(e) => setLaunchForm(prev => ({ ...prev, appro: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: 4000"
                  />
              </div>

              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Budget Journalier ($)</label>
                  <input 
                      type="number" 
                      value={launchForm.dailyBudgetUsd || ''}
                      onChange={(e) => setLaunchForm(prev => ({ ...prev, dailyBudgetUsd: parseFloat(e.target.value) || 0 }))}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Ex: 50"
                  />
              </div>

              <div className="pt-4 flex justify-end gap-3">
                  <button 
                      onClick={() => setIsLaunchModalOpen(false)}
                      className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                  >
                      Annuler
                  </button>
                  <button 
                      onClick={handleLaunchCampaign}
                      disabled={!launchForm.productId}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                      Lancer la campagne
                  </button>
              </div>
          </div>
      </Modal>
    </div>
  );
};

export default Profitability;
