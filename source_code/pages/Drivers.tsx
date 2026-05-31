
import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Plus, Edit2, Phone, Save, X, Smartphone, Trash2, Lock, User, HandCoins, AlertCircle, ArrowRightLeft, Package, Box, Link as LinkIcon, Download, FileText, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Driver, SystemUser, FundRequest, Order, Product, StockLivreurEntry, DateRange, StockOperation } from '../types';
import { DataService, db, auth } from '../services/dataService';
import { formatFCFA } from '../utils/formatters';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { DateRangePicker } from '../components/DateRangePicker';
import { usePersistedDateRange } from '../hooks/usePersistedDateRange';
import { parseProductCommand } from '../utils/productParser';
import { initializeApp, deleteApp, getApp, getApps } from 'firebase/app';
import { getAuth as getSecondaryAuth } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

interface DriversProps {
  currentUser?: SystemUser;
}

export const Drivers: React.FC<DriversProps> = ({ currentUser }) => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]); // Load products for names
  const [stockEntries, setStockEntries] = useState<StockLivreurEntry[]>([]);
  const [stockOperations, setStockOperations] = useState<StockOperation[]>([]);
  const [dateRange, setDateRange] = usePersistedDateRange('drivers-date-range', {
    startDate: startOfDay(new Date()),
    endDate: endOfDay(new Date())
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Partial<Driver>>({});
  const [notification, setNotification] = useState<{message: string, type: "success"|"error"} | null>(null);
  const navigate = useNavigate();

  const showNotif = (message: string, type: "success"|"error") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Delete Confirmation State
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Fund Modal State
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState('');
  const [selectedDriverForFund, setSelectedDriverForFund] = useState<Driver | null>(null);
  const [transactionType, setTransactionType] = useState<'collect' | 'payout'>('collect');
  const [confirmPayoutStep, setConfirmPayoutStep] = useState(false); // 2-step validation for payout

  // Stock Modal State
  const [stockModalDriver, setStockModalDriver] = useState<Driver | null>(null);
  const [editingStock, setEditingStock] = useState<Record<string, { SI: number; entrees: number }>>({});

  useEffect(() => {
    const unsubscribeDrivers = DataService.subscribeToDrivers((d) => setDrivers(d));
    const unsubscribeOrders = DataService.subscribeToOrders((o) => setOrders(o));
    const unsubscribeProducts = DataService.subscribeToProducts((p) => setProducts(p));
    const unsubscribeStock = DataService.subscribeToStockLivreurs((entries) => setStockEntries(entries));
    const unsubscribeOps = DataService.subscribeToStockOperations((ops) => setStockOperations(ops));

    return () => {
        unsubscribeDrivers();
        unsubscribeOrders();
        unsubscribeProducts();
        unsubscribeStock();
        unsubscribeOps();
    };
  }, []);

  const loadData = async () => {
    const [d, o, p, entries, ops] = await Promise.all([
        DataService.getDrivers(),
        DataService.getOrders(),
        DataService.getProducts(),
        DataService.getStockLivreurs(),
        DataService.getStockOperations()
    ]);
    setDrivers(d);
    setOrders(o);
    setProducts(p);
    setStockEntries(entries);
    setStockOperations(ops);
  };

  const handleSave = async () => {
    console.log("=== ENREGISTRER LIVREUR ===", { 
        nom: editingDriver.name, 
        telephone: editingDriver.phone, 
        identifiant: editingDriver.username, 
        motDePasse: editingDriver.password 
    });

    try {
        if (!editingDriver.name || !editingDriver.phone) {
            showNotif("Veuillez remplir le nom et le téléphone.", "error");
            return;
        }

        const telephone = editingDriver.phone.trim();
        const identifiant = (editingDriver.username || '').trim().toLowerCase().replace(/\s+/g, '');

        // 1. Vérifier doublon par téléphone
        const snapTel = await getDocs(query(
          collection(db, "drivers"),
          where("phone", "==", telephone)
        ));
        if (!snapTel.empty && (!editingDriver.id || snapTel.docs.some(d => d.id !== editingDriver.id))) {
          showNotif(`Un livreur avec le numéro ${telephone} existe déjà.`, "error");
          return;
        }

        // 2. Vérifier doublon par identifiant
        if (identifiant) {
          const snapId = await getDocs(query(
            collection(db, "drivers"),
            where("username", "==", identifiant)
          ));
          if (!snapId.empty && (!editingDriver.id || snapId.docs.some(d => d.id !== editingDriver.id))) {
            showNotif(`L'identifiant "${identifiant}" est déjà utilisé sur un autre compte.`, "error");
            return;
          }
        }

        // 3. Valider le mot de passe s'il est fourni (Firebase Auth requiert min 6 caractères)
        if (!editingDriver.id && editingDriver.password && editingDriver.password.length < 6) {
          showNotif("Le mot de passe doit contenir au moins 6 caractères pour Firebase Auth.", "error");
          return;
        }

        const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
        
        let finalId = editingDriver.id;
        // For new drivers, use identifiant as ID if provided, otherwise generate one
        if (!finalId) {
            if (identifiant) {
                finalId = identifiant;
            } else {
                const lowerName = editingDriver.name.toLowerCase();
                if (lowerName.includes('mouhamed') || lowerName.includes('aliou')) {
                    finalId = normalize(editingDriver.name);
                } else {
                    finalId = `drv-${Date.now()}`;
                }
            }
        }

        const newDriver: Driver = {
          id: finalId!,
          name: editingDriver.name,
          phone: telephone,
          initialBalance: Number(editingDriver.initialBalance) || 0,
          status: editingDriver.status || 'disponible',
          uid: editingDriver.uid,
          username: identifiant,
          password: editingDriver.password || '',
          stock: editingDriver.stock || {},
          color: editingDriver.color || '#3b82f6' // Default blue
        };

        // Si c'est un nouveau livreur et qu'on a un mot de passe, on peut tenter de créer le compte Auth
        // On utilise une application secondaire pour éviter de déconnecter l'admin actuel
        if (!editingDriver.id && newDriver.password && identifiant) {
            let secondaryApp;
            try {
                const appName = `SecondaryAuth_${Date.now()}`;
                secondaryApp = initializeApp(firebaseConfig, appName);
                const secondaryAuth = getSecondaryAuth(secondaryApp);
                
                const userCredential = await createUserWithEmailAndPassword(secondaryAuth, `${identifiant}@ocgrun.com`, newDriver.password);
                newDriver.uid = userCredential.user.uid;
                
                // On supprime l'app secondaire après usage
                await deleteApp(secondaryApp);
            } catch (authErr: any) {
                console.error("Erreur création Auth:", authErr);
                if (secondaryApp) await deleteApp(secondaryApp).catch(() => {});
                
                if (authErr.code === 'auth/email-already-in-use') {
                    showNotif("Attention: Le compte Firebase Auth existe déjà pour cet identifiant. Le livreur est créé dans Firestore mais non lié. Utilisez 'Lier UID' plus tard.", "error");
                } else if (authErr.code === 'auth/weak-password') {
                    showNotif("Erreur: Le mot de passe est trop faible (min 6 caractères). Le livreur a été créé sans compte Auth.", "error");
                } else {
                    showNotif("Note: Compte Auth non créé : " + authErr.message, "error");
                }
            }
        }

        await DataService.saveDriver(newDriver);
        setIsModalOpen(false);
        setEditingDriver({});
        loadData();
    } catch (e) {
        console.error("Erreur création livreur:", e);
        showNotif("Erreur : " + (e as any).message, "error");
    }
  };

  const handleDeleteClick = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (deleteConfirmId === id) {
        // Second click: Delete
        setDrivers(prev => prev.filter(d => d.id !== id)); // Optimistic UI
        try {
            await DataService.deleteDriver(id);
            setDeleteConfirmId(null);
        } catch (error) {
            console.error("Error deleting driver", error);
            loadData(); // Revert
        }
    } else {
        // First click: Confirm
        setDeleteConfirmId(id);
        setTimeout(() => setDeleteConfirmId(prev => prev === id ? null : prev), 3000);
    }
  };

  const openModal = (driver?: Driver) => {
    setDeleteConfirmId(null); // Cancel delete state if opening modal
    setEditingDriver(driver || { status: 'disponible', initialBalance: 0 });
    setIsModalOpen(true);
  };

  // --- STOCK MANAGEMENT ---
  const openStockModal = (driver: Driver) => {
      setStockModalDriver(driver);
      const driverEntries = stockEntries.filter(e => e.livreurId === driver.id);
      const stockMap: Record<string, { SI: number; entrees: number }> = {};
      driverEntries.forEach(e => {
          stockMap[e.produitId] = { SI: e.SI || 0, entrees: e.entrees || 0 };
      });
      setEditingStock(stockMap);
  };

  const handleSaveStock = async () => {
      if (!stockModalDriver) return;

      // Calculate differences to update Main Inventory
      const oldStockMap = new Map(stockEntries.filter(e => e.livreurId === stockModalDriver.id).map(e => [e.produitId, e]));
      const newStock = editingStock;
      
      // We need to update products in DB too
      const productsToUpdate: Product[] = [];
      const entriesToUpdate: StockLivreurEntry[] = [];
      const currentProductsMap = new Map(products?.map(p => [p.id, p]));

      for (const [prodId, data] of Object.entries(newStock)) {
          const oldEntry = oldStockMap.get(prodId);
          const oldSI = oldEntry?.SI || 0;
          const oldEntrees = oldEntry?.entrees || 0;
          
          const diffSI = data.SI - oldSI;
          const diffEntrees = data.entrees - oldEntrees;

          if (diffSI !== 0 || diffEntrees !== 0) {
              const product = currentProductsMap.get(prodId);
              if (product) {
                  // Update Stock Global ONLY for diffEntrees (SI entered manually doesn't affect global)
                  if (diffEntrees !== 0) {
                      const currentGlobal = product.stockGlobal || { si: product.mainStock || 0, entrees: 0, sorties: 0, sf: product.mainStock || 0 };
                      const si = currentGlobal.si ?? product.mainStock ?? 0;
                      let entrees = currentGlobal.entrees ?? 0;
                      let sorties = currentGlobal.sorties ?? 0;
                      
                      if (diffEntrees > 0) {
                          // Giving to driver: Increase global sorties
                          sorties += diffEntrees;
                      } else {
                          // Taking back from driver: Increase global entrees
                          entrees += Math.abs(diffEntrees);
                      }
                      const sf = si + entrees - sorties;
                      
                      const updatedGlobal = {
                          si,
                          entrees,
                          sorties,
                          sf
                      };
                      
                      const updatedProduct = { 
                          ...product, 
                          mainStock: si,
                          stockGlobal: updatedGlobal
                      };
                      productsToUpdate.push(updatedProduct);
                      currentProductsMap.set(prodId, updatedProduct);
                  }

                  // Update Stock Livreur Entry
                  let entry = oldEntry;
                  if (!entry) {
                      entry = {
                          livreurId: stockModalDriver.id,
                          produitId: prodId,
                          produitNom: product.title,
                          SI: data.SI || 0,
                          entrees: data.entrees || 0,
                          sorties: 0,
                          SF: (data.SI || 0) + (data.entrees || 0)
                      };
                  } else {
                      const si = data.SI ?? entry.SI ?? 0;
                      const entrees = data.entrees ?? entry.entrees ?? 0;
                      const sorties = entry.sorties ?? 0;
                      entry.SI = si;
                      entry.entrees = entrees;
                      entry.sorties = sorties;
                      entry.SF = si + entrees - sorties;
                  }
                  entriesToUpdate.push(entry);
              }
          }
      }

      // Save all updated products and entries
      await Promise.all([
          ...productsToUpdate?.map(p => DataService.saveProduct(p)),
          ...entriesToUpdate?.map(e => DataService.saveStockLivreurEntry(e))
      ]);

      // Log operations
      for (const entry of entriesToUpdate) {
          await DataService.logStockOperation({
              date: new Date().toISOString(),
              productId: entry.produitId,
              productName: entry.produitNom,
              type: 'si_ajustement',
              quantity: entry.SI,
              livreurId: entry.livreurId,
              source: 'manual'
          });
          if (entry.entrees > 0) {
              await DataService.logStockOperation({
                  date: new Date().toISOString(),
                  productId: entry.produitId,
                  productName: entry.produitNom,
                  type: 'entree',
                  quantity: entry.entrees,
                  livreurId: entry.livreurId,
                  source: 'manual'
              });
          }
      }
      
      // Update local states
      setProducts(Array.from(currentProductsMap.values()));
      setStockEntries(prev => {
          const newEntries = [...prev];
          entriesToUpdate.forEach(updatedEntry => {
              const index = newEntries.findIndex(e => e.livreurId === updatedEntry.livreurId && e.produitId === updatedEntry.produitId);
              if (index >= 0) {
                  newEntries[index] = updatedEntry;
              } else {
                  newEntries.push(updatedEntry);
              }
          });
          return newEntries;
      });

      setStockModalDriver(null);
  };

  const handleStockChange = (productId: string, field: 'SI' | 'entrees', val: string) => {
      const num = parseInt(val) || 0;
      setEditingStock(prev => ({
          ...prev,
          [productId]: {
              ...(prev[productId] || { SI: 0, entrees: 0 }),
              [field]: num
          }
      }));
  };

  // --- FUND REQUEST ---
  const openTransactionModal = (driver: Driver, type: 'collect' | 'payout') => {
      setSelectedDriverForFund(driver);
      setTransactionType(type);
      setFundAmount('');
      setConfirmPayoutStep(false);
      setIsFundModalOpen(true);
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedDriverForFund || !fundAmount) return;

      // 2-Step Validation for Payout
      if (transactionType === 'payout' && !confirmPayoutStep) {
          setConfirmPayoutStep(true);
          return;
      }

      const newRequest: FundRequest = {
          id: `fund-${Date.now()}`,
          driverId: selectedDriverForFund.id,
          amount: parseInt(fundAmount),
          type: transactionType,
          status: transactionType === 'payout' ? 'confirmed' : 'pending',
          createdAt: new Date().toISOString(),
          confirmedAt: transactionType === 'payout' ? new Date().toISOString() : undefined
      };

      await DataService.saveFundRequest(newRequest);
      
      if (transactionType === 'collect') {
          const waveLink = `https://pay.wave.com/m/M_N1UnVCV3hufj/c/sn/?amount=${newRequest.amount}`;
          const message = `Bonjour ${selectedDriverForFund.name}, merci de verser la somme de ${formatFCFA(newRequest.amount)} via ce lien Wave : ${waveLink}`;
          const url = `https://wa.me/${selectedDriverForFund.phone}?text=${encodeURIComponent(message)}`;
          window.open(url, '_blank');
      } else {
          // Update Balance Immediately for Payout
          const driver = drivers.find(d => d.id === selectedDriverForFund.id);
          if (driver) {
              const updatedDriver: Driver = {
                  ...driver,
                  initialBalance: driver.initialBalance - newRequest.amount
              };
              await DataService.saveDriver(updatedDriver);
              setDrivers(prev => prev?.map(d => d.id === driver.id ? updatedDriver : d));
          }
      }

      setIsFundModalOpen(false);
      setFundAmount('');
      setSelectedDriverForFund(null);
      setConfirmPayoutStep(false);
  };

  const calculateCurrentBalance = (driver: Driver) => {
      // Calculate Balance from Driver's perspective (to match DriverView)
      // Positive = Company owes Driver. Negative = Driver owes Company.
      const myOrders = orders.filter(
        (o) =>
          o.driverId === driver.id &&
          (o.status === 'livré' ||
            o.status === 'terminé' ||
            o.status === 'expedition_livree')
      );

      const totalCashCollected = myOrders
        .filter(o => o.modePaiement === 'Espèces' || (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod)))
        .reduce((sum, o) => sum + o.amount, 0);

      const totalRemuneration = myOrders.reduce((sum, o) => {
        const isRegionalStatus = [
          'regional_en_attente',
          'expedition_en_cours',
          'expedition_livree',
          'regional_contacte',
          'regional_relance',
          'regional_prete',
          'regional_injoignable',
          'regional_injoignable_x2',
          'regional_injoignable_x3',
          'regional_reporte',
          'regional_annule',
        ].includes(o.status);
        if (isRegionalStatus) return sum;
        return sum + (o.remuneration || 0);
      }, 0);

      const balance = (driver.initialBalance + totalRemuneration) - totalCashCollected;

      return balance;
  };

  const exportDriverStockPDF = async (driver: Driver) => {
    const doc = new jsPDF();
    const settings = await DataService.getSettings();
    
    if (settings.logoUrl) {
      try {
        doc.addImage(settings.logoUrl, 'PNG', 14, 10, 30, 10);
      } catch (e) {}
    }

    const title = `Inventaire Stock: ${driver.name}`;
    const period = `Période: ${format(dateRange.startDate, 'dd/MM/yyyy')} au ${format(dateRange.endDate, 'dd/MM/yyyy')}`;
    
    doc.setFontSize(16);
    doc.text(title, 14, 30);
    doc.setFontSize(10);
    doc.text(period, 14, 38);

    // Calculate stock for the period
    const start = startOfDay(dateRange.startDate);
    const end = endOfDay(dateRange.endDate);

    const driverEntries = stockEntries.filter(e => e.livreurId === driver.id);
    const ops = stockOperations.filter(op => op.livreurId === driver.id);

    const tableData = driverEntries.map(entry => {
        const productOps = ops.filter(op => op.productId === entry.produitId);
        
        // Calculate SI at start of period
        // Current SI is the SI at the time of the last reset or manual adjustment
        // We need to backtrack from current state
        const opsAfterEnd = productOps.filter(op => new Date(op.date) > end);
        const opsInPeriod = productOps.filter(op => {
            const d = new Date(op.date);
            return d >= start && d <= end;
        });

        // Current state
        let currentSF = (entry.SI || 0) + (entry.entrees || 0) - (entry.sorties || 0);
        
        // Backtrack to end of period
        let sfAtEnd = currentSF;
        opsAfterEnd.forEach(op => {
            if (op.type === 'entree' || op.type === 'si_ajustement') sfAtEnd -= op.quantity;
            if (op.type === 'sortie') sfAtEnd += op.quantity;
        });

        // Calculate period stats
        let periodEntrees = 0;
        let periodSorties = 0;
        opsInPeriod.forEach(op => {
            if (op.type === 'entree') periodEntrees += op.quantity;
            if (op.type === 'sortie') periodSorties += op.quantity;
        });

        let siAtStart = sfAtEnd - periodEntrees + periodSorties;

        return {
            name: entry.produitNom,
            si: siAtStart,
            entrees: periodEntrees,
            sorties: periodSorties,
            sf: sfAtEnd
        };
    }).filter(item => item.sf !== 0);

    if (tableData.length === 0) {
        alert("Aucun stock mouvementé ou présent sur cette période.");
        return;
    }

    autoTable(doc, {
        startY: 45,
        head: [['Produit', 'SI', 'Entrées', 'Sorties', 'SF']],
        body: tableData.map(i => [i.name, i.si, i.entrees, i.sorties, i.sf]),
        theme: 'grid',
        headStyles: { fillColor: [22, 163, 74] }
    });

    // Add Operations History
    const periodOps = ops.filter(op => {
        const d = new Date(op.date);
        return d >= start && d <= end;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (periodOps.length > 0) {
        doc.addPage();
        doc.setFontSize(14);
        doc.text("Historique des Opérations", 14, 20);
        
        autoTable(doc, {
            startY: 25,
            head: [['Date', 'Produit', 'Type', 'Qté', 'Source']],
            body: periodOps.map(op => [
                format(new Date(op.date), 'dd/MM/yyyy HH:mm'),
                op.productName,
                op.type.toUpperCase(),
                op.quantity,
                op.source
            ]),
            theme: 'striped',
            styles: { fontSize: 8 }
        });
    }

    doc.save(`Stock_${driver.name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const exportDriverFinancialBalancePDF = async (driver: Driver) => {
    const doc = new jsPDF();
    const settings = await DataService.getSettings();
    const allFundRequests = await DataService.getFundRequests();
    
    if (settings.logoUrl) {
      try {
        doc.addImage(settings.logoUrl, 'PNG', 14, 10, 30, 10);
      } catch (e) {}
    }

    const title = `Solde Financier: ${driver.name}`;
    const period = `Période: ${format(dateRange.startDate, 'dd/MM/yyyy')} au ${format(dateRange.endDate, 'dd/MM/yyyy')}`;
    
    doc.setFontSize(16);
    doc.text(title, 14, 30);
    doc.setFontSize(10);
    doc.text(period, 14, 38);

    const start = startOfDay(dateRange.startDate);
    const end = endOfDay(dateRange.endDate);

    // Replicate DriverView balance history logic
    const history: any[] = [];
    const myOrders = orders.filter(o => o.driverId === driver.id);
    const myFunds = allFundRequests.filter(r => r.driverId === driver.id);

    myOrders.forEach(o => {
        if ((o.status === 'livré' || o.status === 'terminé') && o.deliveredAt) {
            const d = new Date(o.deliveredAt);
            if (d >= start && d <= end) {
                const isCash = o.modePaiement === 'Espèces' || (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod));
                const mode = o.modePaiement || (o.paymentMethod === 'wave' ? 'Wave' : o.paymentMethod === 'om' ? 'OM' : 'Espèces');
                
                history.push({
                    date: o.deliveredAt,
                    type: 'Encaissement',
                    label: `Commande #${o.id}`,
                    details: `${o.clientName} (${mode})`,
                    amount: o.amount,
                    isPositive: false // Cash collected is what driver owes
                });

                if (o.remuneration) {
                    history.push({
                        date: o.deliveredAt,
                        type: 'Commission',
                        label: `Gain #${o.id}`,
                        details: 'Livraison effectuée',
                        amount: o.remuneration,
                        isPositive: true
                    });
                }
            }
        }
    });

    myFunds.forEach(req => {
        if (req.status === 'confirmed' && req.confirmedAt) {
            const d = new Date(req.confirmedAt);
            if (d >= start && d <= end) {
                const isPayout = req.type === 'payout';
                history.push({
                    date: req.confirmedAt,
                    type: isPayout ? 'Paiement Reçu' : 'Versement Fait',
                    label: isPayout ? 'Reçu de l\'admin' : 'Versé à l\'admin',
                    details: req.paymentMethod || 'cash',
                    amount: req.amount,
                    isPositive: isPayout // Payout to driver increases their balance (reduces what they owe)
                });
            }
        }
    });

    history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Calculate stats for the period
    const periodStats = history.reduce((acc, item) => {
        if (item.type === 'Encaissement') acc.cash += item.amount;
        if (item.type === 'Commission') acc.gains += item.amount;
        if (item.type === 'Paiement Reçu') acc.received += item.amount;
        if (item.type === 'Versement Fait') acc.paid += item.amount;
        return acc;
    }, { cash: 0, gains: 0, received: 0, paid: 0 });

    const currentBalance = calculateCurrentBalance(driver);

    doc.setFontSize(12);
    doc.text(`Solde Actuel: ${formatFCFA(currentBalance)}`, 14, 48);
    
    autoTable(doc, {
        startY: 55,
        head: [['Date', 'Type', 'Libellé', 'Détails', 'Montant']],
        body: history.map(h => [
            format(new Date(h.date), 'dd/MM/yyyy HH:mm'),
            h.type,
            h.label,
            h.details,
            `${h.isPositive ? '+' : '-'}${formatFCFA(h.amount)}`
        ]),
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] }
    });

    doc.save(`Solde_${driver.name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800">Gestion des Livreurs</h2>
        <div className="flex flex-wrap items-center gap-3">
            <DateRangePicker dateRange={dateRange} onUpdate={setDateRange} align="right" className="w-full" />
            {currentUser?.role === 'super_admin' && (
                <button 
                onClick={() => openModal()}
                className="bg-green-700 text-white px-4 py-2 rounded-lg hover:bg-green-800 flex items-center shadow-sm"
                >
                <Plus size={20} className="mr-2" />
                Nouveau Livreur
                </button>
            )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {drivers?.map(driver => {
          const isConfirming = deleteConfirmId === driver.id;
          const currentBalance = calculateCurrentBalance(driver);
          
          // Color Logic (Admin Perspective):
          // < 0 (Driver owes company) -> Green (Money coming in)
          // > 0 (Company owes driver) -> Red (Money going out)
          // 0 -> Gray
          let balanceStyle = "bg-gray-50 border-gray-100 text-gray-500";
          if (currentBalance < 0) balanceStyle = "bg-green-50 border-green-200 text-green-700";
          if (currentBalance > 0) balanceStyle = "bg-red-50 border-red-200 text-red-700";

          const driverStock = stockEntries.filter(e => e.livreurId === driver.id);
          const hasNegativeStock = driverStock.some(s => ((s.SI || 0) + (s.entrees || 0) - (s.sorties || 0)) < 0);
          const totalStockItems = driverStock.reduce((acc, s) => acc + ((s.SI || 0) + (s.entrees || 0) - (s.sorties || 0)), 0);

          return (
          <div key={driver.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 relative group">
            <div className={`absolute top-4 right-4 flex space-x-2 transition-opacity ${isConfirming ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                <button 
                    onClick={() => exportDriverStockPDF(driver)}
                    className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                    title="Télécharger l'inventaire stock (PDF)"
                >
                    <Package size={18} />
                </button>
                <button 
                    onClick={() => exportDriverFinancialBalancePDF(driver)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Télécharger le solde financier (PDF)"
                >
                    <FileText size={18} />
                </button>
                <button 
                    onClick={() => navigate(`/simulation/${driver.id}`)}
                    className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    title="Simuler l'application livreur"
                >
                    <Smartphone size={18} />
                </button>
                {currentUser?.role === 'super_admin' && (
                    <>
                    <button 
                        onClick={() => openModal(driver)}
                        className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Modifier"
                    >
                        <Edit2 size={18} />
                    </button>
                    <button 
                        onClick={(e) => handleDeleteClick(e, driver.id)}
                        className={`flex items-center justify-center transition-all duration-200 rounded-lg cursor-pointer
                            ${isConfirming 
                                ? 'bg-red-600 text-white px-3 py-1.5 text-xs font-bold' 
                                : 'p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50'
                            }
                        `}
                        title="Supprimer"
                    >
                        {isConfirming ? "Confirmer ?" : <Trash2 size={18} />}
                    </button>
                    </>
                )}
            </div>
            
            <div className="flex items-center space-x-4 mb-4">
              <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center text-green-700 font-bold text-lg border border-green-100">
                {driver.name.charAt(0)}
              </div>
              <div>
                <h3 className="font-bold text-gray-800">{driver.name}</h3>
                <div className="flex items-center text-gray-500 text-sm">
                  <Phone size={14} className="mr-1" />
                  {driver.phone}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm mb-3">
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="block text-gray-500 text-xs">Statut</span>
                <span className={`font-medium ${driver.status === 'disponible' ? 'text-green-600' : 'text-orange-600'}`}>
                  {driver.status.charAt(0).toUpperCase() + driver.status.slice(1)}
                </span>
              </div>
              {/* CURRENT BALANCE DISPLAY */}
              <div className={`p-3 rounded-lg border ${balanceStyle}`}>
                <span className="block text-xs opacity-80">Solde Actuel</span>
                <span className="font-bold">
                   {formatFCFA(currentBalance)}
                </span>
              </div>
            </div>

            {/* STOCK SUMMARY INDICATOR */}
            <div className={`mb-3 p-2 rounded-lg border flex items-center justify-between text-xs ${hasNegativeStock ? 'bg-red-50 border-red-100 text-red-700' : 'bg-orange-50 border-orange-100 text-orange-700'}`}>
                <div className="flex items-center gap-1.5 font-medium">
                    <Package size={14} />
                    <span>Stock Embarqué</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="font-bold">{totalStockItems} unités</span>
                    {hasNegativeStock && (
                        <span className="bg-red-600 text-white px-1.5 py-0.5 rounded-full text-[10px] flex items-center animate-pulse">
                            <AlertCircle size={10} className="mr-1" /> ANOMALIE
                        </span>
                    )}
                </div>
            </div>

            {driver.username && (
                <div className="mb-1 text-xs text-gray-400 flex items-center gap-1 bg-gray-50 px-2 py-1 rounded inline-block">
                    <User size={10} />
                    ID: <span className="font-mono text-gray-600">{driver.username}</span>
                </div>
            )}

            <div className="mb-4 flex items-center gap-2">
                {driver.uid ? (
                    <div className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full flex items-center font-bold">
                        <LinkIcon size={10} className="mr-1" /> Compte Lié
                    </div>
                ) : (
                    <div className="text-[10px] bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full flex items-center font-bold">
                        <LinkIcon size={10} className="mr-1" /> Non Lié
                    </div>
                )}
                <div className="text-[10px] bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full font-mono">
                    {driver.id}
                </div>
                {!driver.uid && currentUser?.role === 'super_admin' && (
                    <button 
                        onClick={() => {
                            const uid = prompt("Entrez l'UID Firebase pour ce livreur (ou laissez vide pour annuler):");
                            if (uid) {
                                const updated = { ...driver, uid };
                                DataService.saveDriver(updated).then(() => {
                                    setDrivers(prev => prev.map(d => d.id === driver.id ? updated : d));
                                });
                            }
                        }}
                        className="text-[10px] bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full flex items-center font-bold hover:bg-yellow-100 transition-colors"
                    >
                        Lier UID
                    </button>
                )}
            </div>
            
            {/* ACTION BUTTONS */}
            {currentUser?.role === 'super_admin' && (
                <div className="flex flex-col gap-2 mt-3">
                    <div className="flex gap-2">
                        <button 
                            onClick={() => openTransactionModal(driver, 'collect')}
                            className="flex-1 bg-green-50 text-green-700 border border-green-200 py-2 rounded-lg font-bold text-xs flex items-center justify-center hover:bg-green-100 transition-colors"
                            title="Demander de l'argent au livreur"
                        >
                            <HandCoins size={14} className="mr-1.5" />
                            Récupérer
                        </button>
                        <button 
                            onClick={() => openTransactionModal(driver, 'payout')}
                            className="flex-1 bg-blue-50 text-blue-700 border border-blue-200 py-2 rounded-lg font-bold text-xs flex items-center justify-center hover:bg-blue-100 transition-colors"
                            title="Verser de l'argent au livreur"
                        >
                            <ArrowRightLeft size={14} className="mr-1.5" />
                            Payer
                        </button>
                    </div>
                    <button 
                        onClick={() => openStockModal(driver)}
                        className="w-full bg-orange-50 text-orange-700 border border-orange-200 py-2 rounded-lg font-bold text-xs flex items-center justify-center hover:bg-orange-100 transition-colors"
                    >
                        <Package size={14} className="mr-1.5" />
                        Gérer Stock Livreur
                    </button>
                </div>
            )}
          </div>
        )})}
      </div>

      {/* Driver Modal */}
      {isModalOpen && (
        <>
          {/* Overlay - ferme la modale si on clique EN DEHORS */}
          <div
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 50 }}
            onClick={() => setIsModalOpen(false)}
          />

          {/* Modale - PAR-DESSUS l'overlay, clics isolés */}
          <div
            style={{ 
              position: "fixed", 
              top: "50%", left: "50%", 
              transform: "translate(-50%, -50%)",
              zIndex: 100,  // supérieur à l'overlay
              backgroundColor: "white",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "500px",
              maxHeight: "90vh",
              overflowY: "auto"
            }}
            onClick={(e) => e.stopPropagation()}  // empêche la propagation vers l'overlay
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold">
                {editingDriver.id ? 'Modifier' : 'Ajouter'} Livreur
              </h3>
              <button onClick={() => setIsModalOpen(false)}><X size={24} className="text-gray-400" /></button>
            </div>
            
            {notification && (
              <div style={{
                padding: "10px",
                borderRadius: "8px",
                backgroundColor: notification.type === "success" ? "#d1fae5" : "#fee2e2",
                color: notification.type === "success" ? "#065f46" : "#991b1b",
                marginBottom: "12px"
              }}>
                {notification.message}
              </div>
            )}
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom complet *</label>
                <input 
                  type="text" 
                  className="w-full border rounded-lg px-3 py-2 focus:ring-green-500"
                  value={editingDriver.name || ''}
                  onChange={e => setEditingDriver({...editingDriver, name: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone *</label>
                <input 
                  type="tel" 
                  className="w-full border rounded-lg px-3 py-2 focus:ring-green-500"
                  value={editingDriver.phone || ''}
                  onChange={e => setEditingDriver({...editingDriver, phone: e.target.value})}
                  required
                />
              </div>
              <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                <label className="block text-sm font-medium text-gray-700 mb-1">Solde Initial (Ajustement)</label>
                <input 
                  type="number" 
                  className="w-full border rounded-lg px-3 py-2 focus:ring-green-500"
                  value={editingDriver.initialBalance}
                  onChange={e => setEditingDriver({...editingDriver, initialBalance: parseFloat(e.target.value)})}
                  placeholder="0"
                />
                <p className="text-xs text-gray-500 mt-1 flex items-center"><AlertCircle size={10} className="mr-1"/> Augmenter ce montant réduit la dette du livreur.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Couleur d'affichage</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="color" 
                    className="w-12 h-10 border rounded-lg p-1 cursor-pointer"
                    value={editingDriver.color || '#3b82f6'}
                    onChange={e => setEditingDriver({...editingDriver, color: e.target.value})}
                  />
                  <input 
                    type="text" 
                    className="flex-1 border rounded-lg px-3 py-2 focus:ring-green-500 font-mono text-sm"
                    value={editingDriver.color || '#3b82f6'}
                    onChange={e => setEditingDriver({...editingDriver, color: e.target.value})}
                    placeholder="#3b82f6"
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Cette couleur sera utilisée pour identifier les livraisons de ce livreur.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                <select 
                  className="w-full border rounded-lg px-3 py-2 bg-white focus:ring-green-500"
                  value={editingDriver.status}
                  onChange={e => setEditingDriver({...editingDriver, status: e.target.value as any})}
                >
                  <option value="disponible">Disponible</option>
                  <option value="occupé">Occupé</option>
                </select>
              </div>

              <div className="pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center">
                      <Lock size={14} className="mr-1" /> Accès Application
                  </h4>
                  <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Identifiant (optionnel)</label>
                        <input 
                            type="text" 
                            className="w-full border rounded-lg px-3 py-2 focus:ring-green-500 bg-gray-50"
                            value={editingDriver.username || ''}
                            onChange={e => setEditingDriver({...editingDriver, username: e.target.value.toLowerCase().replace(/\s+/g, '')})}
                            placeholder="Nom d'utilisateur ou laisser vide"
                        />
                        <p className="text-[10px] text-gray-400 mt-1">Si vide, le livreur utilisera son téléphone comme identifiant.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Mot de passe</label>
                        <input 
                            type="text" 
                            className="w-full border rounded-lg px-3 py-2 focus:ring-green-500 bg-gray-50 font-mono"
                            value={editingDriver.password || ''}
                            onChange={e => setEditingDriver({...editingDriver, password: e.target.value})}
                            placeholder="Mot de passe"
                        />
                      </div>
                  </div>
              </div>
              
              <button 
                type="button"
                style={{ pointerEvents: "auto", zIndex: 9999 }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSave();
                }}
                className="w-full bg-green-700 text-white py-2.5 rounded-lg font-medium hover:bg-green-800 flex justify-center items-center mt-6"
              >
                <Save size={18} className="mr-2" />
                Enregistrer
              </button>
            </div>
          </div>
        </>
      )}

      {/* TRANSACTION MODAL */}
      {isFundModalOpen && selectedDriverForFund && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                  <h3 className={`text-lg font-bold mb-1 flex items-center ${transactionType === 'payout' ? 'text-blue-700' : 'text-green-800'}`}>
                      {transactionType === 'payout' ? (
                          <><ArrowRightLeft className="mr-2" size={20}/> Paiement à {selectedDriverForFund.name}</>
                      ) : (
                          <><HandCoins className="mr-2" size={20}/> Récupérer de {selectedDriverForFund.name}</>
                      )}
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">Solde actuel du livreur : {formatFCFA(calculateCurrentBalance(selectedDriverForFund))}</p>
                  
                  <form onSubmit={handleCreateTransaction} className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Montant (F CFA)</label>
                          <input 
                              type="number" 
                              className="w-full border rounded-lg px-3 py-2 text-lg font-bold text-gray-800"
                              value={fundAmount}
                              onChange={e => setFundAmount(e.target.value)}
                              placeholder="50000"
                              autoFocus
                              required
                          />
                      </div>
                      
                      {transactionType === 'collect' && (
                        <div className="bg-orange-50 p-3 rounded-lg text-xs text-orange-800 border border-orange-100">
                            <p>⚠️ Après création, WhatsApp s'ouvrira avec le lien de paiement Wave pré-rempli pour le livreur.</p>
                        </div>
                      )}
                      
                      {transactionType === 'payout' && (
                        <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-800 border border-blue-100">
                            <p>ℹ️ Cette action confirmera immédiatement que vous avez payé le livreur et mettra à jour son solde.</p>
                        </div>
                      )}

                      <div className="flex gap-3 pt-2">
                          <button 
                            type="button" 
                            onClick={() => setIsFundModalOpen(false)}
                            className="flex-1 py-2 text-gray-500 font-medium hover:bg-gray-100 rounded-lg"
                          >
                              Annuler
                          </button>
                          <button 
                            type="submit"
                            className={`flex-1 py-2 text-white font-bold rounded-lg shadow-sm ${
                                transactionType === 'payout' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-700 hover:bg-green-800'
                            }`}
                          >
                              {transactionType === 'payout' 
                                ? (confirmPayoutStep ? "Sûr ?" : "Confirmer Payer") 
                                : 'Créer Demande'
                              }
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {/* STOCK MANAGEMENT MODAL */}
      {stockModalDriver && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-lg font-bold flex items-center">
                          <Box className="mr-2 text-orange-600" />
                          Stock: {stockModalDriver.name}
                      </h3>
                      <button onClick={() => setStockModalDriver(null)}><X size={24} className="text-gray-400" /></button>
                  </div>

                  <div className="bg-blue-50 p-4 rounded-lg mb-4 text-sm text-blue-800">
                      <p>Gérez ici le stock embarqué par le livreur. Ce stock sera automatiquement déduit lors des livraisons.</p>
                  </div>

                  <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                      {products.filter(p => p.status === 'active' || p.status === 'actif')?.map(product => {
                          const currentData = editingStock[product.id] || { SI: 0, entrees: 0 };
                          const existingEntry = stockEntries.find(e => e.livreurId === stockModalDriver.id && e.produitId === product.id);
                          const sorties = existingEntry?.sorties || 0;
                          const sf = currentData.SI + currentData.entrees - sorties;

                          return (
                            <div key={product.id} className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                                <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                                    <div className="flex-1">
                                        <div className="font-bold text-gray-900">{product.title}</div>
                                        <div className="text-xs text-gray-500">SKU: {product.variants[0]?.sku || 'N/A'}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] text-gray-400 uppercase font-bold">Stock Final</div>
                                        <div className={`text-lg font-black ${sf < 0 ? 'text-red-600' : 'text-blue-600'}`}>{sf}</div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Stock Initial (SI)</label>
                                        <input 
                                            type="number" 
                                            className="w-full border rounded px-2 py-1.5 text-center font-bold text-gray-800 focus:ring-orange-500"
                                            value={currentData.SI}
                                            onChange={(e) => handleStockChange(product.id, 'SI', e.target.value)}
                                        />
                                        <p className="text-[9px] text-gray-400 mt-1">N'affecte pas le stock global</p>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Entrées</label>
                                        <input 
                                            type="number" 
                                            className="w-full border rounded px-2 py-1.5 text-center font-bold text-green-600 focus:ring-green-500"
                                            value={currentData.entrees}
                                            onChange={(e) => handleStockChange(product.id, 'entrees', e.target.value)}
                                        />
                                        <p className="text-[9px] text-gray-400 mt-1">Sort du stock global</p>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Sorties</label>
                                        <div className="w-full bg-gray-100 border rounded px-2 py-1.5 text-center font-bold text-orange-600">
                                            {sorties}
                                        </div>
                                        <p className="text-[9px] text-gray-400 mt-1">Calculé (Livraisons)</p>
                                    </div>
                                </div>
                            </div>
                          );
                      })}
                      {products.length === 0 && (
                          <div className="text-center py-8 text-gray-400 italic">
                              Aucun produit actif trouvé. Importez d'abord les produits dans l'onglet Stock.
                          </div>
                      )}
                  </div>

                  <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
                      <button 
                          onClick={() => setStockModalDriver(null)}
                          className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                      >
                          Annuler
                      </button>
                      <button 
                          onClick={handleSaveStock}
                          className="px-4 py-2 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 flex items-center"
                      >
                          <Save size={18} className="mr-2" />
                          Enregistrer Stock
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
