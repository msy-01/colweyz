import React, { useState, useEffect, useMemo } from 'react';
import { Driver, Order, FundRequest, SystemUser, Zone } from '../types';
import { DataService } from '../services/dataService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatFCFA, formatNumber } from '../utils/formatters';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';
import { Download, CheckCheck, Wallet, TrendingUp, HandCoins, Plus, CheckCircle, Clock, Send, AlertTriangle, XCircle, ArrowRightLeft, ArrowUpRight, ArrowDownLeft, FileText, Package } from 'lucide-react';

interface BalancesProps {
    currentUser?: SystemUser;
}

export const Balances: React.FC<BalancesProps> = ({ currentUser }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [fundRequests, setFundRequests] = useState<FundRequest[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedDriverId, setSelectedDriverId] = useState<string>('all');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'all' | 'cash' | 'wave' | 'om'>('all');

  // Fund Request Modal State
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);
  const [newFundAmount, setNewFundAmount] = useState('');
  const [newFundDriverId, setNewFundDriverId] = useState('');
  const [transactionType, setTransactionType] = useState<'collect' | 'payout'>('collect');

  const [isAdjModalOpen, setIsAdjModalOpen] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjDriverId, setAdjDriverId] = useState('');

  useEffect(() => {
    const unsubscribeOrders = DataService.subscribeToOrders((newOrders) => {
        setOrders(newOrders);
    });
    const unsubscribeDrivers = DataService.subscribeToDrivers((newDrivers) => {
        setDrivers(newDrivers);
    });
    const unsubscribeFunds = DataService.subscribeToFundRequests((newFunds) => {
        setFundRequests(newFunds);
    });
    const unsubscribeZones = DataService.subscribeToZones((newZones) => {
        setZones(newZones);
    });
    
    return () => {
        unsubscribeOrders();
        unsubscribeDrivers();
        unsubscribeFunds();
        unsubscribeZones();
    };
  }, []);

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjDriverId || !adjAmount) return;

    const driver = drivers.find(d => d.id === adjDriverId);
    if (!driver) return;

    try {
      const amount = Number(adjAmount);
      // Adjusting initialBalance because balance = cash - remun - initialBalance
      // If we want to ADD money to the driver's credit (reduce what they owe), we increase initialBalance.
      const newInitialBalance = (driver.initialBalance || 0) + amount;
      
      await DataService.saveDriver({
        ...driver,
        initialBalance: newInitialBalance
      });

      // Log it
      await DataService.logStockOperation({
          date: new Date().toISOString(),
          productId: 'balance_adjustment',
          productName: `Ajustement: ${adjReason || 'Sans raison'}`,
          type: 'si_ajustement',
          quantity: amount,
          livreurId: adjDriverId,
          source: 'balance_adjustment'
      });

      setIsAdjModalOpen(false);
      setAdjAmount('');
      setAdjReason('');
      alert('Solde ajusté avec succès !');
    } catch (e) {
      console.error(e);
      alert('Erreur lors de l\'ajustement');
    }
  };

  const estProgrammee = (o: Order) => {
    const dateProg = o.scheduledAt || (o as any).dateProgrammee || (o as any).scheduledDate || (o as any).scheduled_date;
    if (!dateProg) return false;
    const now = new Date();
    const schedDate = new Date(dateProg);
    return now.getTime() < (schedDate.getTime() + 60000);
  };

  // Filter Logic
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      // Identity Logic from Deliveries.tsx
      const isRegionalStatus = [
          'regional_en_attente', 
          'expedition_en_cours', 'expedition_livree', 
          'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
          'regional_injoignable_x2', 'regional_injoignable_x3',
          'regional_reporte', 'regional_annule'
      ].includes(o.status);
      const isRegionalZone = o.zoneId && zones.find(zo => zo.id === o.zoneId)?.type === 'regional';
      const isRegional = isRegionalStatus || (isRegionalZone && o.status === 'validé');
      
      let matchesDate = false;
      if (isRegional) {
        if (!selectedDate) return false;
        if (estProgrammee(o)) return false;
        const dateToUse = o.scheduledAt || o.assignedAt || o.date;
        matchesDate = dateToUse?.startsWith(selectedDate) || false;
      } else {
        const orderDate = o.deliveredAt || o.assignedAt || o.date;
        matchesDate = orderDate?.startsWith(selectedDate) || false;
      }

      // Filter by status (must be attributed or delivered/pending etc)
      const hasStatus = ['attribué', 'en_cours', 'expedition_en_cours', 'livré', 'terminé', 'expedition_livree', 'regional_en_attente', 'regional_relance', 'regional_contacte', 'regional_injoignable', 'regional_injoignable_x2', 'regional_injoignable_x3', 'regional_prete'].includes(o.status);
      
      // Filter by driver
      const matchesDriver = selectedDriverId === 'all' || o.driverId === selectedDriverId;
      
      // Filter by payment method
      const matchesPayment = selectedPaymentMethod === 'all' || o.paymentMethod === selectedPaymentMethod;
      
      return matchesDate && hasStatus && matchesDriver && matchesPayment;
    });
  }, [orders, selectedDate, selectedDriverId, selectedPaymentMethod, zones]);

  // Global Balance Calculation (Independent of Payment Filters)
  const globalStats = useMemo(() => {
    // 1. Base filtered orders by Date & Driver (ignoring payment filter for projected revenue matching)
    const ordersByDateAndDriver = orders.filter(o => {
        const isRegionalStatus = [
            'regional_en_attente', 
            'expedition_en_cours', 'expedition_livree', 
            'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
            'regional_injoignable_x2', 'regional_injoignable_x3',
            'regional_reporte', 'regional_annule'
        ].includes(o.status);
        const isRegionalZone = o.zoneId && zones.find(zo => zo.id === o.zoneId)?.type === 'regional';
        const isRegional = isRegionalStatus || (isRegionalZone && o.status === 'validé');
        
        let matchesDate = false;
        if (isRegional) {
          if (!selectedDate) return false;
          if (estProgrammee(o)) return false;
          const dateToUse = o.scheduledAt || o.assignedAt || o.date;
          matchesDate = dateToUse?.startsWith(selectedDate) || false;
        } else {
          const orderDate = o.deliveredAt || o.assignedAt || o.date;
          matchesDate = orderDate?.startsWith(selectedDate) || false;
        }
        const matchesDriver = selectedDriverId === 'all' || o.driverId === selectedDriverId;
        return matchesDate && matchesDriver;
    });

    // 2. Projected Revenue (Matches Deliveries.tsx)
    const pendingStatuses = [
        'attribué', 'en_cours', 'expedition_en_cours', 
        'regional_en_attente', 'regional_relance', 'regional_contacte', 
        'regional_injoignable', 'regional_injoignable_x2', 'regional_injoignable_x3', 
        'regional_prete'
    ];
    const isRegionalOrder = (o: Order) => {
        const isRegionalStatus = [
            'regional_en_attente', 
            'expedition_en_cours', 'expedition_livree', 
            'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
            'regional_injoignable_x2', 'regional_injoignable_x3',
            'regional_reporte', 'regional_annule'
        ].includes(o.status);
        const isRegionalZone = o.zoneId && zones.find(zo => zo.id === o.zoneId)?.type === 'regional';
        return isRegionalStatus || (isRegionalZone && o.status === 'validé');
    };

    const projectedOrders = ordersByDateAndDriver.filter(o => pendingStatuses.includes(o.status));
    const projectedRevenue = projectedOrders.reduce((sum, o) => {
        const remun = isRegionalOrder(o) ? 0 : (o.remuneration || 0);
        return sum + ((o.amount ?? 0) - remun);
    }, 0);

    // 3. Relevant Orders for Debt (Global, not date filtered)
    const relevantOrders = orders.filter(o => 
        (selectedDriverId === 'all' || o.driverId === selectedDriverId) &&
        (o.status === 'livré' || o.status === 'terminé' || o.status === 'expedition_livree')
    );

    // 4. Calculate Totals (Needed for Balance)
    const totalCash = relevantOrders
        .filter(o => o.modePaiement === 'Espèces' || (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod)))
        .reduce((sum, o) => sum + (o.amount ?? 0), 0);

    const totalRemun = relevantOrders.reduce((sum, o) => {
        if (isRegionalOrder(o)) return sum;
        return sum + (o.remuneration || 0);
    }, 0);

    // 5. Initial Balance
    const initial = selectedDriverId !== 'all' 
        ? drivers.find(d => d.id === selectedDriverId)?.initialBalance || 0 
        : drivers.reduce((sum, d) => sum + (d.initialBalance || 0), 0);

    // 6. Net Balance Formula: (Initial + Remuneration) - CashCollected
    const balance = (initial + totalRemun) - totalCash;

    return { balance, initial, projectedRevenue };
  }, [orders, drivers, zones, selectedDriverId, selectedDate]);

  // View Stats (Dependent on Filters - for daily/filtered view)
  const viewStats = useMemo(() => {
    // For CA, Cash, Digital, Remun, we only count finished orders from the filtered set
    const finishedStatuses = ['livré', 'terminé', 'expedition_livree'];
    const deliveredOrders = filteredOrders.filter(o => finishedStatuses.includes(o.status));

    const totalCA = deliveredOrders.reduce((sum, o) => sum + (o.amount ?? 0), 0);

    const totalEspeces = deliveredOrders
        .filter(o => o.modePaiement === 'Espèces' || (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod)))
        .reduce((sum, o) => sum + (o.amount ?? 0), 0);
    
    const totalWaveOM = deliveredOrders
        .filter(o => o.modePaiement === 'Wave' || o.modePaiement === 'OM' || (o.paymentMethod === 'wave' || o.paymentMethod === 'om'))
        .reduce((sum, o) => sum + (o.amount ?? 0), 0);

    const totalRemun = deliveredOrders.reduce((sum, o) => {
        const isRegionalStatus = [
            'regional_en_attente', 'expedition_en_cours', 'expedition_livree', 
            'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
            'regional_injoignable_x2', 'regional_injoignable_x3',
            'regional_reporte', 'regional_annule'
        ].includes(o.status);
        const isRegionalZone = o.zoneId && zones.find(zo => zo.id === o.zoneId)?.type === 'regional';
        if (isRegionalStatus || (isRegionalZone && o.status === 'validé')) return sum;
        return sum + (o.remuneration || 0);
    }, 0);

    return { totalCA, totalEspeces, totalWaveOM, totalRemun };
  }, [filteredOrders]);

  // Chart Data (Last 7 days)
  const chartData = useMemo(() => {
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      // Calculate daily volume
      const dayOrders = orders.filter(o => 
        (o.assignedAt?.startsWith(dateStr) || o.deliveredAt?.startsWith(dateStr)) && 
        ['livré', 'terminé'].includes(o.status) &&
        (selectedDriverId === 'all' || o.driverId === selectedDriverId)
      );

      data.push({
        date: dateStr.split('-').slice(1).join('/'),
        CA: dayOrders.reduce((acc, o) => acc + o.amount, 0),
        Commissions: dayOrders.reduce((acc, o) => acc + (o.remuneration || 0), 0),
      });
    }
    return data;
  }, [orders, selectedDriverId]);

  // DRIVER STATEMENT LOGIC (When a driver is selected)
  const driverStatement = useMemo(() => {
      if (selectedDriverId === 'all') return [];

      const history: any[] = [];
      const driver = drivers.find(d => d.id === selectedDriverId);
      if (!driver) return [];

      // 1. Orders (Cash Collection & Gains)
      // We look at ALL orders for this driver, not just the selected date, to build a full history
      // BUT if we want a daily statement, we filter. The user asked for "Relevé du livreur", usually implies full history or filtered by date range.
      // Let's use the selectedDate as a filter if applied, or maybe show all if date is cleared? 
      // For now, let's respect the selectedDate for consistency with the rest of the page, 
      // OR better: Show ALL history for the selected driver to calculate true balance.
      
      // Actually, let's show history for the selected date to match the "Détail des courses" view, 
      // but maybe we need a separate "Full History" view?
      // The request says "Je ne vois pas le relevé du livreur".
      // Let's show the history for the selected date primarily, but maybe we need a "Tout voir" option.
      // For this implementation, I will filter by selectedDate to keep it consistent with the UI.
      
      const relevantOrders = orders.filter(o => 
          o.driverId === selectedDriverId && 
          (o.status === 'livré' || o.status === 'terminé') && 
          o.deliveredAt?.startsWith(selectedDate) &&
          (selectedPaymentMethod === 'all' || o.paymentMethod === selectedPaymentMethod)
      );

      relevantOrders.forEach(o => {
          if (o.paymentMethod === 'cash') {
              history.push({
                  id: `col-${o.id}`,
                  date: o.deliveredAt,
                  type: 'collection',
                  label: `Encaissement #${o.id}`,
                  details: o.clientName,
                  amount: o.amount,
                  impact: 'negative', // Driver owes this
                  method: 'Espèce'
              });
          }
          if (o.remuneration) {
              const isRegionalStatus = [
                  'regional_en_attente', 'expedition_en_cours', 'expedition_livree', 
                  'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
                  'regional_injoignable_x2', 'regional_injoignable_x3',
                  'regional_reporte', 'regional_annule'
              ].includes(o.status);
              const isRegionalZone = o.zoneId && zones.find(zo => zo.id === o.zoneId)?.type === 'regional';
              const isRegional = isRegionalStatus || (isRegionalZone && o.status === 'validé');

              if (!isRegional) {
                history.push({
                    id: `rem-${o.id}`,
                    date: o.deliveredAt,
                    type: 'gain',
                    label: `Commission #${o.id}`,
                    details: 'Gain',
                    amount: o.remuneration,
                    impact: 'positive', // Driver earns this
                    method: 'N/A'
                });
              }
          }
      });

      // 2. Fund Requests
      const relevantRequests = fundRequests.filter(req => 
          req.driverId === selectedDriverId && 
          req.status === 'confirmed' && 
          req.confirmedAt?.startsWith(selectedDate)
      );

      relevantRequests.forEach(req => {
          const isPayout = req.type === 'payout';
          history.push({
              id: req.id,
              date: req.confirmedAt,
              type: isPayout ? 'payout' : 'payment',
              label: isPayout ? 'Versement Reçu (Admin)' : 'Versement Effectué',
              details: isPayout ? 'Sortie Caisse' : 'Entrée Caisse',
              amount: req.amount,
              impact: isPayout ? 'negative' : 'positive',
              method: req.paymentMethod || 'Espèce'
          });
      });

      return history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [orders, fundRequests, selectedDriverId, selectedDate, selectedPaymentMethod, drivers]);

  const markAsDelivered = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    
    // Default to 'cash' if payment method is not already set (e.g. for Wave/OM)
    const updated = { 
        ...order, 
        status: 'livré' as const, 
        deliveredAt: new Date().toISOString(),
        paymentMethod: order.paymentMethod || 'cash'
    };

    // Deduct stock if not already deducted (not attente_paiement, livré, or terminé)
    if (order.driverId && order.status !== 'attente_paiement' && order.status !== 'livré' && order.status !== 'terminé') {
        if (order.productId) {
            await DataService.updateDriverStock(order.productId, order.driverId, order.quantity || 1, 'deduct');
        } else if (order.products && order.products.length > 0) {
            for (const p of order.products) {
                // Use SKU if available, otherwise name (fixes q10 sortie issue)
                const identifier = p.sku || p.name;
                if (identifier) {
                    await DataService.updateDriverStock(identifier, order.driverId, p.quantity, 'deduct');
                }
            }
        }
    }

    await DataService.saveOrder(updated);
    setOrders(prev => prev?.map(o => o.id === orderId ? updated : o));
  };

  // --- HELPER: CALCULATE LIVE DRIVER BALANCE FOR DROPDOWN ---
  const getDriverLiveBalance = (driverId: string) => {
      const driver = drivers.find(d => d.id === driverId);
      if (!driver) return 0;

      // Debt = Total Cash Collected - Total Remuneration - InitialBalance(payments made)
      const myOrders = orders.filter(o => o.driverId === driverId && (o.status === 'livré' || o.status === 'terminé'));
      
      const totalCashCollected = myOrders
        .filter(o => o.modePaiement === 'Espèces' || (!o.modePaiement && (o.paymentMethod === 'cash' || !o.paymentMethod)))
        .reduce((sum, o) => sum + o.amount, 0);

      const totalRemuneration = myOrders
        .reduce((sum, o) => {
            const isRegionalStatus = [
                'regional_en_attente', 'expedition_en_cours', 'expedition_livree', 
                'regional_contacte', 'regional_relance', 'regional_prete', 'regional_injoignable', 
                'regional_injoignable_x2', 'regional_injoignable_x3',
                'regional_reporte', 'regional_annule'
            ].includes(o.status);
            const isRegionalZone = o.zoneId && zones.find(zo => zo.id === o.zoneId)?.type === 'regional';
            if (isRegionalStatus || (isRegionalZone && o.status === 'validé')) return sum;
            return sum + (o.remuneration || 0);
        }, 0);

      const balance = totalCashCollected - totalRemuneration - driver.initialBalance;

      return balance;
  };

  // --- FUND REQUEST LOGIC ---
  const openModal = (type: 'collect' | 'payout') => {
      setTransactionType(type);
      setNewFundAmount('');
      setNewFundDriverId('');
      setIsFundModalOpen(true);
  };

  const handleCreateFundRequest = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newFundDriverId || !newFundAmount) return;

      const newRequest: FundRequest = {
          id: `fund-${Date.now()}`,
          driverId: newFundDriverId,
          amount: parseInt(newFundAmount),
          type: transactionType,
          status: transactionType === 'payout' ? 'confirmed' : 'pending', // Payouts usually instant
          createdAt: new Date().toISOString(),
          confirmedAt: transactionType === 'payout' ? new Date().toISOString() : undefined,
          paymentMethod: transactionType === 'payout' ? 'cash' : undefined
      };

      await DataService.saveFundRequest(newRequest);
      setFundRequests(prev => [...prev, newRequest]);
      
      // If it's a payout, immediately update driver balance
      if (transactionType === 'payout') {
          await confirmFundReceipt(newRequest, true); // Auto-execute balance update for payout
          alert("Paiement enregistré. Le solde du livreur a été mis à jour.");
      } else {
          // If collect, ask for WhatsApp
          const driver = drivers.find(d => d.id === newFundDriverId);
          if (driver && confirm("Demande créée. Voulez-vous envoyer le lien Wave par WhatsApp au livreur ?")) {
              sendFundWhatsApp(newRequest, driver);
          }
      }

      setIsFundModalOpen(false);
  };

  const sendFundWhatsApp = (req: FundRequest, driver: Driver) => {
      const waveLink = `https://pay.wave.com/m/M_N1UnVCV3hufj/c/sn/?amount=${req.amount}`;
      const message = `Bonjour ${driver.name}, merci de verser la somme de ${formatFCFA(req.amount)} via ce lien Wave : ${waveLink}`;
      const url = `https://wa.me/${driver.phone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
  };

  const confirmFundReceipt = async (req: FundRequest, skipConfirm = false) => {
      if (!skipConfirm && !confirm(`Confirmer cette transaction de ${formatFCFA(req.amount)} ?`)) return;

      // 1. Update Request Status (if not already done)
      if (req.status !== 'confirmed') {
          const updatedReq: FundRequest = { 
              ...req, 
              status: 'confirmed', 
              confirmedAt: new Date().toISOString() 
          };
          await DataService.saveFundRequest(updatedReq);
          setFundRequests(prev => prev?.map(r => r.id === req.id ? updatedReq : r));
      }

      // 2. Update Driver Balance
      // If Collect: Driver pays -> Debt reduces -> initialBalance INCREASES
      // If Payout: Company pays -> Debt increases (or credit reduces) -> initialBalance DECREASES
      const driver = drivers.find(d => d.id === req.driverId);
      if (driver) {
          const adjustment = (req.type === 'payout') ? -req.amount : req.amount;
          
          const updatedDriver: Driver = {
              ...driver,
              initialBalance: driver.initialBalance + adjustment
          };
          await DataService.saveDriver(updatedDriver);
          setDrivers(prev => prev?.map(d => d.id === driver.id ? updatedDriver : d));
      }
  };

  const deleteFundRequest = async (id: string) => {
      if(confirm("Supprimer cette transaction ?")) {
          await DataService.deleteFundRequest(id);
          setFundRequests(prev => prev.filter(r => r.id !== id));
      }
  };

  const generatePDF = async () => {
    const doc = new jsPDF();
    const driverName = selectedDriverId === 'all' 
        ? "Tous les livreurs" 
        : drivers.find(d => d.id === selectedDriverId)?.name || "Livreur Inconnu";
    
    try {
        const settings = await DataService.getSettings();
        if (settings.logoUrl) {
            doc.addImage(settings.logoUrl, 'PNG', 14, 10, 30, 10);
        }
    } catch (e) {
        console.error("Could not load logo for PDF", e);
    }

    // 1. Header
    doc.setFontSize(18);
    doc.text("Relevé de Compte - Colweyz", 14, 30);
    
    doc.setFontSize(12);
    doc.text(`Livreur: ${driverName}`, 14, 40);
    doc.text(`Date du relevé: ${new Date().toLocaleDateString()}`, 14, 46);

    // 2. Summary Metrics
    doc.setFontSize(14);
    doc.text("Résumé Financier", 14, 60);
    
    const summaryData = [
        ["Total CA", formatFCFA(viewStats.totalCA)],
        ["Total Espèces", formatFCFA(viewStats.totalEspeces)],
        ["Total OM/Wave", formatFCFA(viewStats.totalWaveOM)],
        ["Rémunération Livreur", formatFCFA(viewStats.totalRemun)],
        ["Balance (À verser)", formatFCFA(globalStats.balance)]
    ];

    autoTable(doc, {
        startY: 65,
        head: [['Métrique', 'Montant']],
        body: summaryData,
        theme: 'grid',
        headStyles: { fillColor: [22, 163, 74] }, // Green-600
        columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
        margin: { left: 14, right: 14 }
    });

    // 3. Transactions Table
    const finalY = (doc as any).lastAutoTable.finalY || 55;
    doc.text("Détail des Transactions", 14, finalY + 15);

    const tableHeaders = [['Date', 'Type', 'Libellé', 'Paiement', 'Montant']];
    
    // Prepare data based on current view (Driver Statement or Global Orders)
    let tableData = [];
    
    if (selectedDriverId !== 'all') {
        // Use driverStatement
        tableData = driverStatement?.map((item: any) => [
            new Date(item.date).toLocaleDateString() + ' ' + new Date(item.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
            item.type === 'collection' ? 'Encaissement' : item.type === 'gain' ? 'Gain' : item.type === 'payment' ? 'Versement' : 'Autre',
            item.label,
            item.method,
            (item.impact === 'positive' ? '+ ' : '- ') + formatFCFA(item.amount)
        ]);
    } else {
        // Use filteredOrders
        tableData = filteredOrders?.map(o => [
            o.deliveredAt ? new Date(o.deliveredAt).toLocaleDateString() : '-',
            'Course',
            `Course #${o.id} (${drivers.find(d => d.id === o.driverId)?.name})`,
            o.paymentMethod || 'Espèce',
            formatFCFA(o.amount)
        ]);
    }

    autoTable(doc, {
        startY: finalY + 20,
        head: tableHeaders,
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] }, // Blue
        columnStyles: { 4: { halign: 'right' } },
        margin: { left: 14, right: 14 }
    });

    doc.save(`releve_${driverName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
         <h2 className="text-2xl font-bold text-gray-800">Balances & Fonds</h2>
         {currentUser?.role === 'super_admin' && (
             <div className="flex gap-2">
                 <button 
                    onClick={() => openModal('payout')}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm hover:bg-blue-700 flex items-center text-sm font-bold"
                 >
                     <ArrowRightLeft size={18} className="mr-2" />
                     Verser au Livreur
                 </button>
                 <button 
                    onClick={() => openModal('collect')}
                    className="bg-green-700 text-white px-4 py-2 rounded-lg shadow-sm hover:bg-green-800 flex items-center text-sm font-bold"
                 >
                     <HandCoins size={18} className="mr-2" />
                     Appel de Fonds
                 </button>
             </div>
         )}
      </div>

      {/* Controls */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        <div className="flex flex-col md:flex-row gap-4 flex-1">
          <input 
            type="date" 
            className="border rounded-lg px-3 py-2 text-sm focus:ring-green-500 w-full md:w-auto"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <select 
            className="border rounded-lg px-3 py-2 text-sm bg-white min-w-[200px] focus:ring-green-500 w-full md:w-auto"
            value={selectedDriverId}
            onChange={(e) => setSelectedDriverId(e.target.value)}
          >
            <option value="all">Tous les livreurs</option>
            {drivers?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select 
            className="border rounded-lg px-3 py-2 text-sm bg-white focus:ring-green-500 w-full md:w-auto"
            value={selectedPaymentMethod}
            onChange={(e) => setSelectedPaymentMethod(e.target.value as any)}
          >
            <option value="all">Tous paiements</option>
            <option value="cash">Espèces</option>
            <option value="wave">Wave</option>
            <option value="om">Orange Money</option>
          </select>
        </div>
        <button 
          onClick={generatePDF}
          className="flex items-center justify-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
        >
          <Download size={16} className="mr-2" />
          PDF
        </button>
      </div>

      {/* Big Numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500">Recettes Prévisionnelles</p>
          <p className="text-2xl font-bold text-blue-600">{formatFCFA(globalStats.projectedRevenue)}</p>
          <p className="text-[10px] text-gray-400 mt-1">En cours de livraison</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500">Total Courses (CA)</p>
          <p className="text-2xl font-bold text-gray-800">{formatFCFA(viewStats.totalCA)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500">Espèces Collectées</p>
          <p className="text-2xl font-bold text-yellow-600">{formatFCFA(viewStats.totalEspeces)}</p>
        </div>
         <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500">Wave / OM (Colweyz)</p>
          <p className="text-2xl font-bold text-blue-600">{formatFCFA(viewStats.totalWaveOM)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500">Gains du Jour (Frais)</p>
          <p className="text-2xl font-bold text-green-600">{formatFCFA(viewStats.totalRemun)}</p>
        </div>
        <div className={`p-6 rounded-xl shadow-sm border ${globalStats.balance >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <div className="flex justify-between items-start mb-2">
              <p className={`text-sm font-medium ${globalStats.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {globalStats.balance >= 0 
                    ? (selectedDriverId === 'all' ? "Montant dû au(x) livreur(s)" : "Montant dû au livreur")
                    : (selectedDriverId === 'all' ? "Montant dû à Colweyz (Total)" : "Montant dû à Colweyz")
                }
              </p>
              {selectedDriverId !== 'all' && (
                  <button 
                    onClick={() => {
                        setAdjDriverId(selectedDriverId);
                        setIsAdjModalOpen(true);
                    }}
                    className="p-1 hover:bg-white rounded transition-colors text-orange-600"
                    title="Ajuster le solde"
                  >
                    <HandCoins size={16} />
                  </button>
              )}
          </div>
          <p className={`text-3xl font-bold ${globalStats.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {formatFCFA(Math.abs(globalStats.balance))}
          </p>
        </div>
      </div>

      {/* Detailed Order Table (Spreadsheet Model) */}
      {selectedDriverId !== 'all' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 font-semibold text-gray-700 bg-gray-50 flex justify-between items-center">
            <div className="flex items-center">
              <FileText size={18} className="mr-2 text-green-600" />
              Détail des Courses - Modèle Relevé
            </div>
            <div className="text-xs text-gray-400">
              {filteredOrders.filter(o => o.status === 'livré').length} courses livrées
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-gray-100 text-gray-600 uppercase font-bold border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 border-r border-gray-200">Client / Adresse</th>
                  <th className="px-3 py-3 border-r border-gray-200">Produit</th>
                  <th className="px-3 py-3 border-r border-gray-200 text-right bg-gray-200/50">Prix (CFA)</th>
                  <th className="px-3 py-3 border-r border-gray-200 text-center">Mode</th>
                  <th className="px-3 py-3 border-r border-gray-200 text-right">Frais (CFA)</th>
                  <th className="px-3 py-3 text-center">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredOrders.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-400 italic">Aucune commande pour cette sélection.</td></tr>
                ) : (
                  filteredOrders.map(o => {
                    const isDigital = o.modePaiement === 'Wave' || o.modePaiement === 'OM' || (o.paymentMethod === 'wave' || o.paymentMethod === 'om');
                    return (
                      <tr key={o.id} className="hover:bg-green-50/30 transition-colors">
                        <td className="px-3 py-2 border-r border-gray-100 max-w-[200px] truncate font-medium" title={o.address}>
                          {o.address || o.clientName}
                        </td>
                        <td className="px-3 py-2 border-r border-gray-100 max-w-[150px] truncate italic">
                          {o.productDetails || (o.products && o.products.length > 0 ? o.products[0].name : 'Produit inconnu')}
                        </td>
                        <td className={`px-3 py-2 border-r border-gray-100 text-right font-bold ${isDigital ? 'text-gray-400 line-through bg-gray-50' : 'bg-gray-50'}`}>
                          {formatNumber(o.amount)}
                        </td>
                        <td className="px-3 py-2 border-r border-gray-100 text-center">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase border ${
                            isDigital ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-green-50 text-green-600 border-green-100'
                          }`}>
                            {o.modePaiement || (o.paymentMethod === 'wave' ? 'Wave' : o.paymentMethod === 'om' ? 'OM' : 'Espèces')}
                          </span>
                        </td>
                        <td className="px-3 py-2 border-r border-gray-100 text-right font-bold text-green-700">
                          {formatNumber(o.remuneration || 0)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                            o.status === 'livré' ? 'bg-green-600 text-white' : 'bg-yellow-400 text-green-900'
                          }`}>
                            {o.status === 'livré' ? 'Livrée' : o.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filteredOrders.length > 0 && (
                <tfoot className="bg-gray-800 text-white font-bold">
                  <tr>
                    <td colSpan={2} className="px-3 py-3 text-right uppercase tracking-wider text-[10px]">Totaux</td>
                    <td className="px-3 py-3 text-right text-sm">
                      {formatNumber(filteredOrders.reduce((sum, o) => sum + o.amount, 0))}
                    </td>
                    <td className="px-3 py-3 text-center text-[10px] text-gray-400">
                      Modes
                    </td>
                    <td className="px-3 py-3 text-right text-sm text-green-400">
                      {formatNumber(filteredOrders.reduce((sum, o) => sum + (o.remuneration || 0), 0))}
                    </td>
                    <td className="px-3 py-3 text-center text-[10px] text-gray-400">
                      Net: {formatNumber(filteredOrders.reduce((sum, o) => sum + o.amount, 0) - filteredOrders.reduce((sum, o) => sum + (o.remuneration || 0), 0))} F
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          
          {/* Summary Box requested by user */}
          <div className="p-6 bg-gray-900 text-white border-t border-gray-700">
            <div className="max-w-md ml-auto space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">TOTAL COURSES (CA)</span>
                <span className="font-mono font-bold">{formatFCFA(viewStats.totalCA)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">ESPÈCES COLLECTÉES</span>
                <span className="font-mono font-bold text-yellow-400">{formatFCFA(viewStats.totalEspeces)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">WAVE / OM (COLWEYZ)</span>
                <span className="font-mono text-blue-400">{formatFCFA(viewStats.totalWaveOM)}</span>
              </div>
              <div className="border-t border-gray-700 pt-3 flex justify-between items-center">
                <span className="text-sm font-bold">GAINS TOTAL LIVREUR</span>
                <span className="text-lg font-bold text-green-400">{formatFCFA(viewStats.totalRemun)}</span>
              </div>
              <p className="text-[10px] text-gray-500 italic text-right mt-2">
                * Le livreur garde ses frais et remet les espèces collectées à Digital Afrika.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Table Orders OR Driver Statement */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 font-semibold text-gray-700 flex justify-between">
            <span>{selectedDriverId === 'all' ? `Détail des courses (${selectedDate})` : `Mouvements de Caisse (${selectedDate})`}</span>
          </div>
          <div className="overflow-x-auto">
            {selectedDriverId !== 'all' ? (
                /* DRIVER STATEMENT VIEW */
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                        <tr>
                            <th className="px-4 py-3">Heure</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Libellé</th>
                            <th className="px-4 py-3">Paiement</th>
                            <th className="px-4 py-3 text-right">Montant</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {driverStatement.filter(item => item.type === 'payment' || item.type === 'payout').length === 0 ? (
                            <tr><td colSpan={5} className="p-4 text-center text-gray-400">Aucun mouvement de caisse ce jour.</td></tr>
                        ) : (
                            driverStatement.filter(item => item.type === 'payment' || item.type === 'payout').map((item: any) => (
                                <tr key={item.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 text-gray-500 text-xs">
                                        {new Date(item.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${
                                            item.type === 'collection' ? 'bg-gray-100 text-gray-600' :
                                            item.type === 'gain' ? 'bg-green-100 text-green-600' :
                                            item.type === 'payment' ? 'bg-blue-100 text-blue-600' :
                                            'bg-purple-100 text-purple-600'
                                        }`}>
                                            {item.type === 'collection' ? 'Encaissement' :
                                             item.type === 'gain' ? 'Gain' :
                                             item.type === 'payment' ? 'Versement' : 'Autre'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-gray-800">{item.label}</div>
                                        <div className="text-xs text-gray-500">{item.details}</div>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-600 uppercase font-bold">{item.method}</td>
                                    <td className={`px-4 py-3 text-right font-bold ${item.impact === 'positive' ? 'text-green-600' : 'text-red-500'}`}>
                                        {item.impact === 'positive' ? '+' : '-'}{formatFCFA(item.amount)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            ) : (
                /* GLOBAL ORDERS VIEW */
                <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Livreur</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Paiement</th>
                  <th className="px-4 py-3">Gain</th>
                  <th className="px-4 py-3 text-right">Etat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOrders.length === 0 ? (
                  <tr><td colSpan={6} className="p-4 text-center text-gray-400">Aucune course ce jour.</td></tr>
                ) : (
                  filteredOrders?.map(o => (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{o.id}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {drivers.find(d => d.id === o.driverId)?.name}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{formatFCFA(o.amount)}</td>
                      <td className="px-4 py-3">
                          {o.status === 'livré' && (
                              <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${
                                  o.paymentMethod === 'wave' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                  o.paymentMethod === 'om' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                  'bg-green-50 text-green-600 border-green-100'
                              }`}>
                                  {o.paymentMethod || 'Espèce'}
                              </span>
                          )}
                      </td>
                      <td className="px-4 py-3 text-green-600">{formatFCFA(o.remuneration || 0)}</td>
                      <td className="px-4 py-3 text-right">
                        {o.status === 'livré' ? (
                          <span className="inline-flex items-center text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full">
                            Livré
                          </span>
                        ) : (
                          <button 
                            onClick={() => markAsDelivered(o.id)}
                            className="inline-flex items-center text-xs font-medium text-green-600 hover:text-green-800 border border-green-200 hover:bg-green-50 px-2 py-1 rounded"
                          >
                            <CheckCheck size={12} className="mr-1" />
                            Marquer Livré
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h4 className="font-semibold text-gray-700 mb-4 flex items-center">
                <TrendingUp size={18} className="mr-2 text-green-600"/> 
                Évolution (7 jours)
            </h4>
            <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" fontSize={12} />
                        <YAxis fontSize={12} />
                        <Tooltip 
                            formatter={(value: number) => formatFCFA(value)}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Bar dataKey="CA" fill="#15803d" radius={[4, 4, 0, 0]} name="CA Total" /> {/* Green-700 */}
                        <Bar dataKey="Commissions" fill="#facc15" radius={[4, 4, 0, 0]} name="Commissions" /> {/* Yellow-400 */}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
      </div>
      
      {/* FUND REQUESTS SECTION */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 font-semibold text-gray-700 bg-gray-50 flex items-center">
              <ArrowRightLeft size={18} className="mr-2 text-gray-500" />
              Historique des Transactions (Entrées / Sorties)
          </div>
          <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                 <thead className="text-gray-500 border-b border-gray-100 text-xs uppercase bg-gray-50">
                     <tr>
                         <th className="px-6 py-3">Date</th>
                         <th className="px-6 py-3">Type</th>
                         <th className="px-6 py-3">Livreur</th>
                         <th className="px-6 py-3">Montant</th>
                         <th className="px-6 py-3">Statut</th>
                         <th className="px-6 py-3 text-right">Actions</th>
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100">
                     {fundRequests.length === 0 ? (
                         <tr><td colSpan={6} className="p-6 text-center text-gray-400">Aucune transaction.</td></tr>
                     ) : (
                         fundRequests.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())?.map(req => {
                             const driver = drivers.find(d => d.id === req.driverId);
                             const isPayout = req.type === 'payout';
                             return (
                                 <tr key={req.id} className="hover:bg-gray-50">
                                     <td className="px-6 py-3 text-gray-500">{new Date(req.createdAt).toLocaleDateString()}</td>
                                     <td className="px-6 py-3">
                                         {isPayout ? (
                                             <span className="flex items-center text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded w-fit">
                                                 <ArrowUpRight size={14} className="mr-1" /> Paiement Livreur
                                             </span>
                                         ) : (
                                             <span className="flex items-center text-xs font-bold text-green-700 bg-green-50 px-2 py-1 rounded w-fit">
                                                 <ArrowDownLeft size={14} className="mr-1" /> Encaissement
                                             </span>
                                         )}
                                     </td>
                                     <td className="px-6 py-3 font-medium text-gray-800">{driver?.name || 'Inconnu'}</td>
                                     <td className={`px-6 py-3 font-bold ${isPayout ? 'text-blue-600' : 'text-green-700'}`}>
                                         {isPayout ? '- ' : '+ '}{formatFCFA(req.amount)}
                                     </td>
                                     <td className="px-6 py-3">
                                         {req.status === 'confirmed' ? (
                                             <span className="inline-flex items-center text-xs font-bold text-green-700 bg-green-100 px-2 py-1 rounded">
                                                 <CheckCircle size={12} className="mr-1" /> Validé
                                             </span>
                                         ) : req.status === 'paid_by_driver' ? (
                                             <span className="inline-flex items-center text-xs font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded">
                                                 <CheckCircle size={12} className="mr-1" /> Payé (Attente Valid.)
                                             </span>
                                         ) : req.status === 'declined' ? (
                                             <span className="inline-flex items-center text-xs font-bold text-red-700 bg-red-100 px-2 py-1 rounded">
                                                 <XCircle size={12} className="mr-1" /> Refusé
                                             </span>
                                         ) : (
                                             <span className="inline-flex items-center text-xs font-bold text-orange-700 bg-orange-100 px-2 py-1 rounded">
                                                 <Clock size={12} className="mr-1" /> En attente
                                             </span>
                                         )}
                                     </td>
                                     <td className="px-6 py-3 text-right flex justify-end gap-2">
                                         {!isPayout && req.status !== 'confirmed' && req.status !== 'declined' && (
                                            <>
                                                <button 
                                                    onClick={() => sendFundWhatsApp(req, driver!)}
                                                    className="p-2 text-green-600 hover:bg-green-50 rounded transition-colors"
                                                    title="Renvoyer Lien WhatsApp"
                                                >
                                                    <Send size={16} />
                                                </button>
                                                {currentUser?.role === 'super_admin' && (
                                                    <button 
                                                        onClick={() => confirmFundReceipt(req)}
                                                        className="px-3 py-1 bg-green-600 text-white rounded text-xs font-bold hover:bg-green-700 shadow-sm"
                                                    >
                                                        Valider
                                                    </button>
                                                )}
                                            </>
                                         )}
                                         {currentUser?.role === 'super_admin' && (
                                             <button 
                                                onClick={() => deleteFundRequest(req.id)}
                                                className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                title="Supprimer"
                                             >
                                                &times;
                                             </button>
                                         )}
                                     </td>
                                 </tr>
                             );
                         })
                     )}
                 </tbody>
             </table>
          </div>
      </div>

      {/* Transaction Modal */}
      {isFundModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
                  <h3 className={`text-lg font-bold mb-4 flex items-center ${transactionType === 'payout' ? 'text-blue-700' : 'text-green-800'}`}>
                      {transactionType === 'payout' ? (
                          <><ArrowRightLeft className="mr-2" size={20}/> Paiement au Livreur</>
                      ) : (
                          <><HandCoins className="mr-2" size={20}/> Nouvel Appel de Fonds</>
                      )}
                  </h3>
                  
                  <div className={`text-sm mb-4 p-3 rounded-lg ${transactionType === 'payout' ? 'bg-blue-50 text-blue-800' : 'bg-green-50 text-green-800'}`}>
                      {transactionType === 'payout' 
                        ? "Sortie de caisse : Vous versez de l'argent au livreur (commissions ou solde négatif)." 
                        : "Entrée de caisse : Le livreur vous verse l'argent collecté."}
                  </div>

                  <form onSubmit={handleCreateFundRequest} className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Livreur</label>
                          <select 
                              className="w-full border rounded-lg px-3 py-2 bg-white"
                              value={newFundDriverId}
                              onChange={e => setNewFundDriverId(e.target.value)}
                              required
                          >
                              <option value="">Sélectionner...</option>
                              {drivers?.map(d => (
                                  <option key={d.id} value={d.id}>
                                    {d.name} (Solde : {formatFCFA(getDriverLiveBalance(d.id))})
                                  </option>
                              ))}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Montant (F CFA)</label>
                          <input 
                              type="number" 
                              className="w-full border rounded-lg px-3 py-2 font-bold"
                              value={newFundAmount}
                              onChange={e => setNewFundAmount(e.target.value)}
                              placeholder="Ex: 50000"
                              required
                          />
                      </div>
                      <div className="flex gap-3 pt-4">
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
                              {transactionType === 'payout' ? 'Confirmer Paiement' : 'Créer & Envoyer'}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};