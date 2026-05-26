import React, { useState, useEffect, useMemo } from 'react';
import { 
    DollarSign, 
    TrendingUp, 
    TrendingDown, 
    Plus, 
    Trash2, 
    Save, 
    AlertCircle
} from 'lucide-react';
import { DataService } from '../services/dataService';
import { Order, Product, ProductFinancialConfig, DailyFinancialEntry, DailyFinanceData } from '../types';
import { parseProductCommand } from '../utils/productParser';
import { trouverProduitShopify } from '../utils/productMatcher';
import { usePersistedDateRange } from '../hooks/usePersistedDateRange';
import { DateRangePicker } from '../components/DateRangePicker';
import { ClaudeAnalysisModal } from '../components/ClaudeAnalysisModal';
import { ClaudeService } from '../services/claudeService';
import { parseISO, format, isSameDay, startOfDay, endOfDay, isWithinInterval, isBefore } from 'date-fns';

import { formatNumber } from '../utils/formatters';

export default function Finance() {
    const [dateRange, setDateRange] = usePersistedDateRange('finance_date_range', {
        startDate: new Date(),
        endDate: new Date()
    });
    
    const isSingleDay = isSameDay(dateRange.startDate, dateRange.endDate);
    const selectedDateStr = format(dateRange.startDate, 'yyyy-MM-dd');

    const [loading, setLoading] = useState(true);
    
    // Data States
    const [orders, setOrders] = useState<Order[]>([]);
    const [dailyEntries, setDailyEntries] = useState<DailyFinancialEntry[]>([]);
    const [configs, setConfigs] = useState<ProductFinancialConfig[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [allFinanceData, setAllFinanceData] = useState<DailyFinanceData[]>([]);
    
    // Current Day Finance Data (for editing)
    const [currentDayFinance, setCurrentDayFinance] = useState<DailyFinanceData>({
        date: selectedDateStr,
        otherRevenues: [],
        otherExpenses: []
    });

    const [missingCosts, setMissingCosts] = useState<{orderId: string, product: string}[]>([]);

    // Manual Entry States
    const [newRevenueLabel, setNewRevenueLabel] = useState('');
    const [newRevenueAmount, setNewRevenueAmount] = useState('');
    const [newExpenseLabel, setNewExpenseLabel] = useState('');
    const [newExpenseAmount, setNewExpenseAmount] = useState('');

    // Claude Analysis State
    const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<string | null>(null);

    useEffect(() => {
        const unsubs: (() => void)[] = [];

        unsubs.push(DataService.subscribeToOrders((newOrders) => {
            setOrders(newOrders);
        }));

        unsubs.push(DataService.subscribeToDailyEntries((allEntries) => {
            setDailyEntries(allEntries);
        }));

        unsubs.push(DataService.subscribeToFinancialConfigs((allConfigs) => {
            setConfigs(allConfigs);
        }));

        unsubs.push(DataService.subscribeToAllDailyFinanceData((allDailyFinance) => {
            setAllFinanceData(allDailyFinance);
            
            // Set current day finance for editing
            const dayData = allDailyFinance.find(d => d.date === selectedDateStr);
            if (dayData) {
                setCurrentDayFinance(dayData);
            } else {
                setCurrentDayFinance({
                    date: selectedDateStr,
                    otherRevenues: [],
                    otherExpenses: []
                });
            }
        }));

        unsubs.push(DataService.subscribeToProducts((allProducts) => {
            setProducts(allProducts);
        }));

        return () => unsubs.forEach(unsub => unsub());
    }, [selectedDateStr]); 

    // Initial load state management
    useEffect(() => {
        if (orders.length > 0 || dailyEntries.length > 0) {
            setLoading(false);
        }
    }, [orders, dailyEntries]);

    const isDeltaPaid = (o: any) => {
        const status = o?.paiementProduit 
            ?? o?.paiement_produit 
            ?? o?.paymentProduct
            ?? o?.regionalPaymentStatus 
            ?? "";
        const s = String(status).toLowerCase();
        return s === "payé" || s === "paid" || s === "paye";
    };

    const getOrderDate = (o: any, isRegional: boolean) => {
        if (isRegional) {
            return o?.deliveredAt || o?.dateAttribution || o?.assignedAt?.split("T")[0] || o?.date || "";
        }
        return o?.deliveredAt || o?.date || "";
    };

    // --- CALCULATIONS ---

    const periodStats = useMemo(() => {
        const START_DATE = '2026-03-05';
        
        // 1. REVENUES
        
        // CA Livraisons Dakar (Status 'livré' or 'terminé')
        const dakarOrders = orders.filter(o => {
            if (o.status !== 'livré' && o.status !== 'terminé') return false;
            // Dakar Date = deliveredAt
            const date = getOrderDate(o, false);
            if (!date) return false;
            
            // Check interval
            const dateObj = parseISO(date);
            if (isNaN(dateObj.getTime())) return false;
            if (isBefore(dateObj, parseISO(START_DATE))) return false;
            return isWithinInterval(dateObj, { start: startOfDay(dateRange.startDate), end: endOfDay(dateRange.endDate) });
        });
        const caDakar = dakarOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

        // CA Expéditions Régions (Delta Transport, Status 'paid' or 'expedition_livree')
        const regionOrders = (orders || []).filter(o => {
            // Check status for delivered regional orders OR payment status
            const isDeliveredRegional = o.status === 'expedition_livree';
            if (!isDeltaPaid(o) && !isDeliveredRegional) return false;
            
            // Delta Date = assignedAt
            const date = getOrderDate(o, true); 
            if (!date) return false;

            // Check interval
            const dateObj = parseISO(date);
            if (isNaN(dateObj.getTime())) return false;
            if (isBefore(dateObj, parseISO(START_DATE))) return false;
            return isWithinInterval(dateObj, { start: startOfDay(dateRange.startDate), end: endOfDay(dateRange.endDate) });
        });
        const caRegions = regionOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

        // Autres Produits (Manual) - Aggregate from allFinanceData within range
        const relevantFinanceData = allFinanceData.filter(d => {
            const dateObj = parseISO(d.date);
            if (isNaN(dateObj.getTime())) return false;
            if (isBefore(dateObj, parseISO(START_DATE))) return false;
            return isWithinInterval(dateObj, { start: startOfDay(dateRange.startDate), end: endOfDay(dateRange.endDate) });
        });

        // If single day and no data saved yet, use currentDayFinance state
        let otherProducts = 0;
        let otherCharges = 0;
        let periodOtherRevenues: {id: string, label: string, amount: number, date: string}[] = [];
        let periodOtherExpenses: {id: string, label: string, amount: number, date: string}[] = [];

        if (isSingleDay) {
            const selectedDateObj = parseISO(selectedDateStr);
            if (!isNaN(selectedDateObj.getTime()) && !isBefore(selectedDateObj, parseISO(START_DATE))) {
                otherProducts = currentDayFinance?.otherRevenues?.reduce((sum, item) => sum + item.amount, 0) || 0;
                otherCharges = currentDayFinance?.otherExpenses?.reduce((sum, item) => sum + item.amount, 0) || 0;
                periodOtherRevenues = (currentDayFinance?.otherRevenues || [])?.map(i => ({...i, date: selectedDateStr}));
                periodOtherExpenses = (currentDayFinance?.otherExpenses || [])?.map(i => ({...i, date: selectedDateStr}));
            }
        } else {
            relevantFinanceData.forEach(day => {
                day.otherRevenues.forEach(item => {
                    otherProducts += item.amount;
                    periodOtherRevenues.push({...item, date: day.date});
                });
                day.otherExpenses.forEach(item => {
                    otherCharges += item.amount;
                    periodOtherExpenses.push({...item, date: day.date});
                });
            });
        }

        const totalProduits = caDakar + caRegions + otherProducts;

        // 2. CHARGES

        // Get Daily Entries for Ad Spend ONLY (Profitability Module) within range
        const relevantEntries = dailyEntries.filter(e => {
            const dateObj = parseISO(e.date);
            if (isNaN(dateObj.getTime())) return false;
            if (isBefore(dateObj, parseISO(START_DATE))) return false;
            return isWithinInterval(dateObj, { start: startOfDay(dateRange.startDate), end: endOfDay(dateRange.endDate) });
        });

        let fraisPub = 0;
        let appliedExchangeRate = 600;

        relevantEntries.forEach(entry => {
            const exchangeRate = entry.exchangeRate || 600;
            if (isSingleDay) appliedExchangeRate = exchangeRate;
            
            if (entry.entries) {
                Object.entries(entry.entries).forEach(([prodId, data]) => {
                    fraisPub += (data.spendUsd || 0) * 1.18 * exchangeRate;
                });
            }
        });

        // Calculate Appro for ALL Orders (from Inventory Purchase Price or Snapshot)
        // Iterate through all delivered/paid orders of the period
        const allDeliveredOrders = [...dakarOrders, ...regionOrders];
        let coutsAppro = 0;
        const missingList: {orderId: string, product: string}[] = [];

        allDeliveredOrders.forEach(order => {
            let orderAppro = 0;
            let missingItems: string[] = [];

            // 1. Multi-product support
            if (order.products && order.products.length > 0) {
                order.products.forEach(item => {
                    if (item.ponctuel) return; // Skip ponctuel products
                    
                    let foundProduct: Product | undefined;
                    
                    if (item.sku) {
                        foundProduct = products.find(p => p.id === item.sku);
                    }
                    
                    if (!foundProduct) {
                        const searchName = item.name.toLowerCase().trim();
                        // Try exact match first, then fuzzy
                        foundProduct = products.find(p => p.title.toLowerCase().trim() === searchName);
                        
                        if (!foundProduct) {
                             foundProduct = products.find(p => 
                                p.title.toLowerCase().trim().includes(searchName) || 
                                searchName.includes(p.title.toLowerCase().trim())
                            );
                        }
                    }

                    if (foundProduct && foundProduct.purchasePrice !== undefined) {
                        orderAppro += foundProduct.purchasePrice * item.quantity;
                    } else {
                        const nameToDisplay = foundProduct?.title || (item.name?.trim() ? item.name.trim() : 'Produit Inconnu');
                        missingItems.push(nameToDisplay);
                    }
                });
            } else {
                // 2. Single product fallback
                let unitCost = 0;
                let foundProduct: Product | undefined;
                let costFound = false;

                // Try by ID
                if (order.productId) {
                    if (order.purchaseCost !== undefined) {
                        unitCost = order.purchaseCost;
                        costFound = true;
                    } else {
                        foundProduct = products.find(p => p.id === order.productId);
                        if (foundProduct && foundProduct.purchasePrice !== undefined) {
                            unitCost = foundProduct.purchasePrice;
                            costFound = true;
                        }
                    }
                } 
                
                // Fallback: Try by Name
                if (!costFound) {
                    if (!foundProduct && order.productDetails) {
                        const { quantity, productName } = parseProductCommand(order.productDetails);
                        foundProduct = trouverProduitShopify(productName, products) || undefined;
                        
                        if (foundProduct && foundProduct.purchasePrice !== undefined) {
                            unitCost = foundProduct.purchasePrice * quantity;
                            costFound = true;
                        }
                    }
                }

                if (costFound) {
                    orderAppro += unitCost;
                } else {
                    const nameToDisplay = foundProduct?.title || (order.productDetails?.trim() ? order.productDetails.trim() : 'Produit Inconnu');
                    missingItems.push(nameToDisplay);
                }
            }

            if (orderAppro > 0) {
                coutsAppro += orderAppro;
            }
            
            if (missingItems.length > 0) {
                missingList.push({
                    orderId: order.id, 
                    product: missingItems.join(', ')
                });
            }
        });

        // Frais de Livraison (Gains Livreurs) - Only for Dakar orders (Regional transport is paid directly by client to driver)
        const fraisLivraison = dakarOrders.reduce((sum, o) => sum + (o.remuneration || 0), 0);

        const totalCharges = fraisPub + coutsAppro + fraisLivraison + otherCharges;

        // 3. RESULT
        const margeBrute = totalProduits - totalCharges;
        const tauxMarge = totalCharges > 0 ? (margeBrute / totalCharges) * 100 : 0;

        return {
            caDakar,
            caRegions,
            otherProducts,
            totalProduits,
            fraisPub,
            coutsAppro,
            fraisLivraison,
            otherCharges,
            totalCharges,
            margeBrute,
            tauxMarge,
            missingList,
            periodOtherRevenues,
            periodOtherExpenses,
            appliedExchangeRate
        };
    }, [orders, dailyEntries, configs, allFinanceData, currentDayFinance, dateRange, products, isSingleDay]);

    // --- MONTHLY STATS ---
    const monthlyStats = useMemo(() => {
        // Use End Date to determine month context
        const currentMonth = format(dateRange.endDate, 'yyyy-MM');
        const START_DATE = '2026-03-05';
        
        // 1. Identify all relevant orders for the month
        const monthDakarOrders = orders.filter(o => {
            if (o.status !== 'livré' && o.status !== 'terminé') return false;
            const d = getOrderDate(o, false);
            return d && d.startsWith(currentMonth) && d >= START_DATE;
        });

        const monthRegionOrders = (orders || []).filter(o => {
            const isDeliveredRegional = o.status === 'expedition_livree';
            if (!isDeltaPaid(o) && !isDeliveredRegional) return false;
            const d = getOrderDate(o, true);
            return d && d.startsWith(currentMonth) && d >= START_DATE;
        });

        // CA
        const mCaDakar = monthDakarOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
        const mCaRegions = monthRegionOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

        // Frais Livraison - Only for Dakar orders (Regional transport is paid directly by client to driver)
        const mFraisLivraison = monthDakarOrders.reduce((sum, o) => sum + (o.remuneration || 0), 0);

        // 2. Daily Entries in Month (Pub ONLY)
        const monthEntries = dailyEntries.filter(e => 
            e.date.startsWith(currentMonth) &&
            e.date >= START_DATE
        );
        let mFraisPub = 0;
        
        monthEntries.forEach(e => {
            const rate = e.exchangeRate;
            Object.entries(e.entries).forEach(([prodId, data]) => {
                mFraisPub += (data.spendUsd || 0) * 1.18 * rate;
            });
        });

        // 3. Appro (ALL Orders from Stock/Snapshot)
        let mCoutsAppro = 0;

        const allMonthOrders = [...monthDakarOrders, ...monthRegionOrders];
        allMonthOrders.forEach(order => {
            let orderAppro = 0;

            // 1. Multi-product support
            if (order.products && order.products.length > 0) {
                order.products.forEach(item => {
                    if (item.ponctuel) return; // Skip ponctuel products
                    
                    let foundProduct: Product | undefined;
                    
                    if (item.sku) {
                        foundProduct = products.find(p => p.id === item.sku);
                    }
                    
                    if (!foundProduct) {
                        const searchName = item.name.toLowerCase().trim();
                        // Try exact match first, then fuzzy
                        foundProduct = products.find(p => p.title.toLowerCase().trim() === searchName);
                        
                        if (!foundProduct) {
                             foundProduct = products.find(p => 
                                p.title.toLowerCase().trim().includes(searchName) || 
                                searchName.includes(p.title.toLowerCase().trim())
                            );
                        }
                    }

                    if (foundProduct && foundProduct.purchasePrice !== undefined) {
                        orderAppro += foundProduct.purchasePrice * item.quantity;
                    }
                });
            } else {
                // 2. Single product fallback
                let unitCost = 0;
                let foundProduct: Product | undefined;
                let costFound = false;

                // Try by ID
                if (order.productId) {
                    if (order.purchaseCost !== undefined) {
                        unitCost = order.purchaseCost;
                        costFound = true;
                    } else {
                        foundProduct = products.find(p => p.id === order.productId);
                        if (foundProduct && foundProduct.purchasePrice !== undefined) {
                            unitCost = foundProduct.purchasePrice;
                            costFound = true;
                        }
                    }
                } 
                
                // Fallback: Try by Name
                if (!costFound) {
                    if (!foundProduct && order.productDetails) {
                        const { quantity, productName } = parseProductCommand(order.productDetails);
                        foundProduct = trouverProduitShopify(productName, products) || undefined;
                        
                        if (foundProduct && foundProduct.purchasePrice !== undefined) {
                            unitCost = foundProduct.purchasePrice * quantity;
                            costFound = true;
                        }
                    }
                }

                if (costFound) {
                    orderAppro += unitCost; 
                }
            }

            if (orderAppro > 0) {
                mCoutsAppro += orderAppro;
            }
        });

        // 4. Manual Entries (All Finance Data for Month)
        const monthFinanceData = allFinanceData.filter(d => 
            d.date.startsWith(currentMonth) &&
            d.date >= START_DATE
        );
        
        const mOtherProducts = monthFinanceData.reduce((total, day) => {
            return total + day.otherRevenues.reduce((sum, item) => sum + item.amount, 0);
        }, 0);

        const mOtherCharges = monthFinanceData.reduce((total, day) => {
            return total + day.otherExpenses.reduce((sum, item) => sum + item.amount, 0);
        }, 0);

        const mTotalProduits = mCaDakar + mCaRegions + mOtherProducts;
        const mTotalCharges = mFraisPub + mCoutsAppro + mFraisLivraison + mOtherCharges;
        const mMarge = mTotalProduits - mTotalCharges;
        const mTauxMarge = mTotalCharges > 0 ? (mMarge / mTotalCharges) * 100 : 0;

        return { mTotalProduits, mTotalCharges, mMarge, mTauxMarge };
    }, [orders, dailyEntries, configs, dateRange, allFinanceData, products]);

    // --- ACTIONS ---

    const handleAddRevenue = () => {
        if (!isSingleDay) return;
        if (!newRevenueLabel || !newRevenueAmount) return;
        const newItem = {
            id: Date.now().toString(),
            label: newRevenueLabel,
            amount: parseFloat(newRevenueAmount)
        };
        const updated = {
            ...currentDayFinance,
            otherRevenues: [...currentDayFinance.otherRevenues, newItem]
        };
        setCurrentDayFinance(updated);
        DataService.saveDailyFinanceData(updated);
        
        // Update allFinanceData locally to reflect changes immediately
        const idx = allFinanceData.findIndex(d => d.date === selectedDateStr);
        if (idx >= 0) {
            const newAll = [...allFinanceData];
            newAll[idx] = updated;
            setAllFinanceData(newAll);
        } else {
            setAllFinanceData([...allFinanceData, updated]);
        }

        setNewRevenueLabel('');
        setNewRevenueAmount('');
    };

    const handleAddExpense = () => {
        if (!isSingleDay) return;
        if (!newExpenseLabel || !newExpenseAmount) return;
        const newItem = {
            id: Date.now().toString(),
            label: newExpenseLabel,
            amount: parseFloat(newExpenseAmount)
        };
        const updated = {
            ...currentDayFinance,
            otherExpenses: [...currentDayFinance.otherExpenses, newItem]
        };
        setCurrentDayFinance(updated);
        DataService.saveDailyFinanceData(updated);

        // Update allFinanceData locally
        const idx = allFinanceData.findIndex(d => d.date === selectedDateStr);
        if (idx >= 0) {
            const newAll = [...allFinanceData];
            newAll[idx] = updated;
            setAllFinanceData(newAll);
        } else {
            setAllFinanceData([...allFinanceData, updated]);
        }

        setNewExpenseLabel('');
        setNewExpenseAmount('');
    };

    const removeRevenue = (id: string) => {
        if (!isSingleDay) return;
        const updated = {
            ...currentDayFinance,
            otherRevenues: currentDayFinance.otherRevenues.filter(i => i.id !== id)
        };
        setCurrentDayFinance(updated);
        DataService.saveDailyFinanceData(updated);
        
        // Update allFinanceData locally
        const idx = allFinanceData.findIndex(d => d.date === selectedDateStr);
        if (idx >= 0) {
            const newAll = [...allFinanceData];
            newAll[idx] = updated;
            setAllFinanceData(newAll);
        }
    };

    const removeExpense = (id: string) => {
        if (!isSingleDay) return;
        const updated = {
            ...currentDayFinance,
            otherExpenses: currentDayFinance.otherExpenses.filter(i => i.id !== id)
        };
        setCurrentDayFinance(updated);
        DataService.saveDailyFinanceData(updated);

        // Update allFinanceData locally
        const idx = allFinanceData.findIndex(d => d.date === selectedDateStr);
        if (idx >= 0) {
            const newAll = [...allFinanceData];
            newAll[idx] = updated;
            setAllFinanceData(newAll);
        }
    };

    const handleAnalyzeWithClaude = async () => {
        if (!isSingleDay) {
            alert("L'analyse n'est disponible que pour une journée spécifique.");
            return;
        }
        
        setIsAnalysisModalOpen(true);
        setIsAnalyzing(true);
        
        try {
            // Check if we already have an analysis for this date
            const existingAnalysis = await DataService.getClaudeAnalysis(selectedDateStr);
            if (existingAnalysis) {
                setAnalysisResult(existingAnalysis);
                setIsAnalyzing(false);
                return;
            }
            
            // Get exchange rate for the day
            const dailyEntry = dailyEntries.find(e => e.date === selectedDateStr);
            const exchangeRate = dailyEntry ? dailyEntry.exchangeRate : 600;

            const result = await ClaudeService.analyze(selectedDateStr, exchangeRate);
            setAnalysisResult(result);
        } catch (error: any) {
            console.error("Analysis error:", error);
            setAnalysisResult(null);
            alert(error.message || "Erreur lors de l'analyse. Veuillez réessayer.");
            setIsAnalysisModalOpen(false);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const formatMoney = (val: number) => formatNumber(Math.round(val));
    const formatPercent = (val: number) => val.toFixed(1) + '%';

    return (
        <div className="p-6 max-w-5xl mx-auto pb-24">
            {/* HEADER & CONTROLS */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-800">
                    <DollarSign className="text-green-600" />
                    Résultat Financier
                </h1>
                
                <div className="flex items-center gap-3">
                    {isSingleDay && (
                        <button 
                            onClick={handleAnalyzeWithClaude}
                            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 shadow-sm transition-colors"
                        >
                            <span className="text-lg">✨</span>
                            Analyser avec Claude
                        </button>
                    )}
                    <div className="bg-white p-1 rounded-lg shadow-sm border">
                        <DateRangePicker 
                            dateRange={dateRange}
                            onUpdate={setDateRange}
                            align="right"
                        />
                    </div>
                </div>
            </div>

            {/* ALERTS */}
            {periodStats.missingList && periodStats.missingList.length > 0 && (
                <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="text-red-600 mt-0.5" size={20} />
                        <div>
                            <h3 className="font-bold text-red-800 mb-1">Coûts d'achat manquants ({periodStats.missingList.length})</h3>
                            <p className="text-sm text-red-700 mb-2">
                                Impossible de calculer le coût d'appro pour certaines commandes. Vérifiez que les produits existent dans le Stock et ont un prix d'achat.
                            </p>
                            <ul className="text-xs text-red-600 list-disc list-inside space-y-1 max-h-32 overflow-y-auto">
                                {periodStats.missingList?.map((item, idx) => (
                                    <li key={idx}>
                                        Commande <strong>{item.orderId.startsWith('#') ? item.orderId : '#' + item.orderId}</strong> : {item.product}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* MONTHLY SUMMARY */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                    <p className="text-xs font-bold text-blue-400 uppercase mb-1">Total CA (Mois)</p>
                    <p className="text-2xl font-black text-blue-700">{formatMoney(monthlyStats.mTotalProduits)}</p>
                </div>
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-100">
                    <p className="text-xs font-bold text-orange-400 uppercase mb-1">Total Charges (Mois)</p>
                    <p className="text-2xl font-black text-orange-700">{formatMoney(monthlyStats.mTotalCharges)}</p>
                </div>
                <div className={`p-4 rounded-xl border ${monthlyStats.mMarge >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                    <p className={`text-xs font-bold uppercase mb-1 ${monthlyStats.mMarge >= 0 ? 'text-green-500' : 'text-red-500'}`}>Marge Cumulée</p>
                    <p className={`text-2xl font-black ${monthlyStats.mMarge >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatMoney(monthlyStats.mMarge)}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <p className="text-xs font-bold text-gray-400 uppercase mb-1">Taux Marge Moyen</p>
                    <p className="text-2xl font-black text-gray-700">{formatPercent(monthlyStats.mTauxMarge)}</p>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
                {/* 1. PRODUITS (REVENUES) */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                    <div className="bg-green-50 px-6 py-4 border-b border-green-100 flex justify-between items-center">
                    <h2 className="font-bold text-green-800 flex items-center gap-2">
                            <TrendingUp size={18} /> PRODUITS (Revenus)
                        </h2>
                        <span className="text-xl font-black text-green-700">{formatMoney(periodStats.totalProduits)}</span>
                    </div>
                    
                    <div className="p-6 flex-1">
                        <table className="w-full text-sm">
                            <tbody className="divide-y divide-gray-100">
                                <tr>
                                    <td className="py-3 text-gray-600">CA Livraisons Dakar</td>
                                    <td className="py-3 text-right font-bold">{formatMoney(periodStats.caDakar)}</td>
                                    <td className="w-8"></td>
                                </tr>
                                <tr>
                                    <td className="py-3 text-gray-600">CA Expéditions Régions</td>
                                    <td className="py-3 text-right font-bold">{formatMoney(periodStats.caRegions)}</td>
                                    <td className="w-8"></td>
                                </tr>
                                {periodStats.periodOtherRevenues?.map((item, idx) => (
                                    <tr key={`${item.id}-${idx}`} className="group">
                                        <td className="py-3 text-gray-600 italic">
                                            {item.label}
                                            {!isSingleDay && <span className="text-xs text-gray-400 ml-2">({item.date})</span>}
                                        </td>
                                        <td className="py-3 text-right font-bold">{formatMoney(item.amount)}</td>
                                        <td className="py-3 text-right">
                                            {isSingleDay && (
                                                <button onClick={() => removeRevenue(item.id)} className="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* Add Manual Revenue - Only visible if Single Day */}
                        {isSingleDay ? (
                            <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
                                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Ajouter un autre produit</p>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        placeholder="Libellé (ex: Vente accessoire)" 
                                        className="flex-1 border rounded px-3 py-2 text-sm"
                                        value={newRevenueLabel}
                                        onChange={e => setNewRevenueLabel(e.target.value)}
                                    />
                                    <input 
                                        type="number" 
                                        placeholder="Montant" 
                                        className="w-24 border rounded px-3 py-2 text-sm text-right"
                                        value={newRevenueAmount}
                                        onChange={e => setNewRevenueAmount(e.target.value)}
                                    />
                                    <button 
                                        onClick={handleAddRevenue}
                                        disabled={!newRevenueLabel || !newRevenueAmount}
                                        className="bg-green-100 text-green-700 p-2 rounded hover:bg-green-200 disabled:opacity-50"
                                    >
                                        <Plus size={18} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4 pt-4 border-t border-dashed border-gray-200 text-center text-xs text-gray-400 italic">
                                Sélectionnez une date unique pour ajouter des entrées manuelles.
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. CHARGES (EXPENSES) */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                    <div className="bg-red-50 px-6 py-4 border-b border-red-100 flex justify-between items-center">
                        <h2 className="font-bold text-red-800 flex items-center gap-2">
                            <TrendingDown size={18} /> CHARGES
                        </h2>
                        <span className="text-xl font-black text-red-700">{formatMoney(periodStats.totalCharges)}</span>
                    </div>
                    
                    <div className="p-6 flex-1">
                        <table className="w-full text-sm">
                            <tbody className="divide-y divide-gray-100">
                                <tr>
                                    <td className="py-3 text-gray-600">
                                        Frais de publicité
                                        {isSingleDay && (
                                            <span className="text-xs text-gray-400 ml-2">
                                                (Taux: {periodStats.appliedExchangeRate} FCFA)
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-3 text-right font-bold">{formatMoney(periodStats.fraisPub)}</td>
                                    <td className="w-8"></td>
                                </tr>
                                <tr>
                                    <td className="py-3 text-gray-600">Coûts d'approvisionnement</td>
                                    <td className="py-3 text-right font-bold">{formatMoney(periodStats.coutsAppro)}</td>
                                    <td className="w-8"></td>
                                </tr>
                                <tr>
                                    <td className="py-3 text-gray-600">Frais de livraison (Livreurs)</td>
                                    <td className="py-3 text-right font-bold">{formatMoney(periodStats.fraisLivraison)}</td>
                                    <td className="w-8"></td>
                                </tr>
                                {periodStats.periodOtherExpenses?.map((item, idx) => (
                                    <tr key={`${item.id}-${idx}`} className="group">
                                        <td className="py-3 text-gray-600 italic">
                                            {item.label}
                                            {!isSingleDay && <span className="text-xs text-gray-400 ml-2">({item.date})</span>}
                                        </td>
                                        <td className="py-3 text-right font-bold">{formatMoney(item.amount)}</td>
                                        <td className="py-3 text-right">
                                            {isSingleDay && (
                                                <button onClick={() => removeExpense(item.id)} className="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* Add Manual Expense - Only visible if Single Day */}
                        {isSingleDay ? (
                            <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
                                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Ajouter une autre charge</p>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        placeholder="Libellé (ex: Transport, Repas)" 
                                        className="flex-1 border rounded px-3 py-2 text-sm"
                                        value={newExpenseLabel}
                                        onChange={e => setNewExpenseLabel(e.target.value)}
                                    />
                                    <input 
                                        type="number" 
                                        placeholder="Montant" 
                                        className="w-24 border rounded px-3 py-2 text-sm text-right"
                                        value={newExpenseAmount}
                                        onChange={e => setNewExpenseAmount(e.target.value)}
                                    />
                                    <button 
                                        onClick={handleAddExpense}
                                        disabled={!newExpenseLabel || !newExpenseAmount}
                                        className="bg-red-100 text-red-700 p-2 rounded hover:bg-red-200 disabled:opacity-50"
                                    >
                                        <Plus size={18} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4 pt-4 border-t border-dashed border-gray-200 text-center text-xs text-gray-400 italic">
                                Sélectionnez une date unique pour ajouter des entrées manuelles.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 3. RESULTAT */}
            <div className="mt-8 bg-gray-900 text-white rounded-2xl p-8 shadow-xl">
                <div className="flex flex-col md:flex-row justify-between items-center gap-8">
                    <div className="text-center md:text-left">
                        <p className="text-gray-400 font-bold uppercase tracking-wider text-sm mb-2">
                            {isSingleDay ? 'Résultat Net du Jour' : 'Résultat Net de la Période'}
                        </p>
                        <div className="flex items-baseline gap-4">
                            <span className={`text-5xl font-black ${periodStats.margeBrute >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatMoney(periodStats.margeBrute)} <span className="text-2xl text-gray-500">FCFA</span>
                            </span>
                        </div>
                    </div>
                    
                    <div className="flex gap-8">
                        <div className="text-center">
                            <p className="text-gray-500 text-xs font-bold uppercase mb-1">Taux de Marge</p>
                            <p className={`text-3xl font-black ${periodStats.tauxMarge >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatPercent(periodStats.tauxMarge)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <ClaudeAnalysisModal
                isOpen={isAnalysisModalOpen}
                onClose={() => setIsAnalysisModalOpen(false)}
                analysis={analysisResult}
                isAnalyzing={isAnalyzing}
                dateStr={selectedDateStr}
            />
        </div>
    );
}
