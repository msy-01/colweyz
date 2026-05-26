import React, { useState, useEffect, useMemo } from 'react';

import { 
  Plus, 
  Trash2, 
  FileText, 
  Download, 
  Eye, 
  Search, 
  Package, 
  ShoppingCart, 
  X, 
  Save,
  Printer,
  CheckCircle,
  Clock,
  Truck,
  DollarSign,
  Upload,
  Paperclip,
  ArrowLeft,
  Edit,
  Check,
  Copy
} from 'lucide-react';
import { DataService } from '../services/dataService';
import { Product, PurchaseOrder, PurchaseOrderItem, PurchaseOrderDocument, Fournisseur } from '../types';
import { formatNumber, formatFCFA } from '../utils/formatters';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function Procurement() {
  const [activeTab, setActiveTab] = useState<'list' | 'create' | 'view'>('list');
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Create PO State
  const [poItems, setPoItems] = useState<PurchaseOrderItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [poNumber, setPoNumber] = useState<string>('');
  const [transportFees, setTransportFees] = useState<number>(0);
  const [fournisseur, setFournisseur] = useState<{ societe: string; telephone: string; adresse?: string; email?: string }>({ societe: '', telephone: '', adresse: '', email: '' });
  const [formError, setFormError] = useState<string | null>(null);

  // View PO State
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  // Document Upload State
  const [docLabel, setDocLabel] = useState('Ticket de paiement');
  const [uploading, setUploading] = useState(false);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const [duplicationEnCours, setDuplicationEnCours] = useState(false);
  const [confirmStep, setConfirmStep] = useState<'paid' | 'delivered' | null>(null);

  const showNotif = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const generateId = () => {
    return typeof crypto.randomUUID === 'function' 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  };

  useEffect(() => {
    loadData();
    // Nettoyage des doublons COPIE- (une seule fois au chargement)
    const cleanupDuplicates = async () => {
      try {
        // Logic moved to backend. No direct Firestore usage on frontend.
      } catch (e) {
        console.error("Erreur lors du nettoyage:", e);
      }
    };
    cleanupDuplicates();
  }, []);

  useEffect(() => {
    setConfirmStep(null);
  }, [activeTab, selectedPO?.id]);

  const suppliers = useMemo(() => {
    const uniqueSuppliers = new Map<string, Fournisseur>();
    purchaseOrders.forEach(po => {
      if (po.fournisseur && po.fournisseur.societe) {
        uniqueSuppliers.set(po.fournisseur.societe.toLowerCase(), po.fournisseur);
      }
    });
    return Array.from(uniqueSuppliers.values());
  }, [purchaseOrders]);

  const loadData = async () => {
    setLoading(true);
    const [pos, prods] = await Promise.all([
      DataService.getPurchaseOrders(),
      DataService.getProducts()
    ]);
    setPurchaseOrders(pos);
    setAllProducts(prods);
    setLoading(false);
  };

  const generatePoNumber = () => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const count = purchaseOrders.filter(po => po.date.startsWith(date.toISOString().slice(0, 10))).length + 1;
    return `PO-${dateStr}-${count.toString().padStart(3, '0')}`;
  };

  const handleStartCreate = () => {
    setPoNumber(generatePoNumber());
    setPoItems([]);
    setTransportFees(0);
    setFournisseur({ societe: '', telephone: '', adresse: '', email: '' });
    setFormError(null);
    setSelectedPO(null);
    setActiveTab('create');
  };

  const handleEditPO = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setPoNumber(po.number);
    setPoItems(po.items);
    setTransportFees(po.transportFees || 0);
    setFournisseur(po.fournisseur || { societe: '', telephone: '', adresse: '', email: '' });
    setFormError(null);
    setActiveTab('create');
  };

  const handleViewPO = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setActiveTab('view');
  };

  const handleAddItem = () => {
    if (!selectedProductId || quantity <= 0) return;

    const product = allProducts.find(p => p.id === selectedProductId);

    if (product) {
      const newItem: PurchaseOrderItem = {
        productId: selectedProductId,
        productName: product.title,
        quantity: quantity,
        unitPrice: product.purchasePrice || 0,
        total: (product.purchasePrice || 0) * quantity,
        source: product.source === 'ponctuel' ? 'ponctuel' : 'stock'
      };
      setPoItems([...poItems, newItem]);
      setSelectedProductId('');
      setQuantity(1);
    }
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...poItems];
    newItems.splice(index, 1);
    setPoItems(newItems);
  };

  const handleUpdateItemQuantity = (index: number, newQuantity: number) => {
    if (newQuantity <= 0) return;
    const newItems = [...poItems];
    newItems[index].quantity = newQuantity;
    newItems[index].total = newItems[index].unitPrice * newQuantity;
    setPoItems(newItems);
  };

  const handleUpdateItemPrice = (index: number, newPrice: number) => {
    if (newPrice < 0) return;
    const newItems = [...poItems];
    newItems[index].unitPrice = newPrice;
    newItems[index].total = newPrice * newItems[index].quantity;
    setPoItems(newItems);
  };

  const handleSavePO = async () => {
    if (poItems.length === 0) return;
    
    if (!fournisseur.societe || !fournisseur.telephone) {
      setFormError("Le nom de la société et le numéro de téléphone du fournisseur sont obligatoires.");
      return;
    }

    const totalAmount = poItems.reduce((sum, item) => sum + item.total, 0) + transportFees;
    
    if (selectedPO) {
        const updatedPO: PurchaseOrder = {
            ...selectedPO,
            items: poItems,
            totalAmount,
            transportFees,
            fournisseur,
            date: new Date().toISOString()
        };
        await DataService.savePurchaseOrder(updatedPO);
    } else {
        const newPO: PurchaseOrder = {
          id: generateId(),
          number: poNumber,
          date: new Date().toISOString(),
          items: poItems,
          totalAmount,
          transportFees,
          fournisseur,
          status: 'draft',
          createdAt: new Date().toISOString(),
          documents: []
        };
        await DataService.savePurchaseOrder(newPO);
    }

    await loadData();
    setActiveTab('list');
    setSelectedPO(null);
  };

  const handleUpdatePO = async (updatedPO: PurchaseOrder) => {
      await DataService.savePurchaseOrder(updatedPO);
      setSelectedPO(updatedPO);
      await loadData();
  };

  const dupliquerBon = async (bon: PurchaseOrder) => {
    if (duplicationEnCours) return;
    setDuplicationEnCours(true);
    
    try {
      console.log("=== DUPLICATION ===", bon)
      
      const newId = generateId();
      const nouveauBon: PurchaseOrder = {
        ...bon,
        id: newId,
        number: `COPIE-${bon.number}`,
        status: 'draft',
        createdAt: new Date().toISOString(),
        date: new Date().toISOString(),
        documents: []
      };
      
      // Nettoyer l'objet : retirer les champs de statut temporel
      delete nouveauBon.paidAt;
      delete nouveauBon.deliveredAt;
      delete nouveauBon.validatedAt;
      delete nouveauBon.ponctuelStockUpdated;
      
      console.log("Objet à créer:", nouveauBon)
      await DataService.savePurchaseOrder(nouveauBon);
      
      showNotif("Bon de commande dupliqué avec succès !");
      await loadData();
    } catch (e: any) {
      console.error("ERREUR DUPLICATION:", e)
      showNotif("Erreur lors de la duplication.", "error");
    } finally {
      setDuplicationEnCours(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedPO || !e.target.files || e.target.files.length === 0) return;
      
      const file = e.target.files[0];
      setUploading(true);

      const reader = new FileReader();
      reader.onloadend = async () => {
          const base64 = reader.result as string;
          const newDoc: PurchaseOrderDocument = {
              id: crypto.randomUUID(),
              name: file.name,
              type: file.type,
              data: base64,
              label: docLabel,
              date: new Date().toISOString()
          };

          const updatedPO = {
              ...selectedPO,
              documents: [...(selectedPO.documents || []), newDoc]
          };

          await handleUpdatePO(updatedPO);
          setUploading(false);
          // Reset input
          e.target.value = '';
      };
      reader.readAsDataURL(file);
  };

  const handleDeletePO = async (id: string) => {
      if (confirmAction === `${id}-delete`) {
          const poToDelete = purchaseOrders.find(p => p.id === id);
          
          if (poToDelete && (poToDelete.status === 'delivered' || poToDelete.ponctuelStockUpdated)) {
              // Reverse stock changes
              const products = await DataService.getProducts();
              let stockReversed = false;

              for (const item of poToDelete.items) {
                  if (item.source === 'stock' || item.source === 'ponctuel' || item.source === 'adhoc') {
                      let product = null;
                      if (item.productId) {
                          product = products.find(p => p.id === item.productId);
                      }
                      
                      // Fallback for ponctuel products
                      if (!product && (item.source === 'ponctuel' || item.source === 'adhoc')) {
                          product = products.find(p => 
                              p.source === 'ponctuel' && 
                              p.title.toLowerCase() === item.productName.toLowerCase()
                          );
                      }

                      if (product) {
                          const currentGlobal = product.stockGlobal || { si: product.mainStock || 0, entrees: 0, sorties: 0, sf: product.mainStock || 0 };
                          const si = currentGlobal.si ?? product.mainStock ?? 0;
                          const entrees = currentGlobal.entrees ?? 0;
                          const sorties = currentGlobal.sorties ?? 0;
                          
                          // Reverse the entry: subtract from entrees
                          const newEntrees = entrees - item.quantity;
                          const newSF = si + newEntrees - sorties;
                          
                          const updatedProduct = {
                              ...product,
                              mainStock: si,
                              stockGlobal: {
                                  si,
                                  entrees: newEntrees,
                                  sorties,
                                  sf: newSF
                              }
                          };
                          await DataService.saveProduct(updatedProduct);
                          stockReversed = true;

                          // Log reversal operation
                          await DataService.logStockOperation({
                              date: new Date().toISOString(),
                              productId: product.id,
                              productName: product.title,
                              type: 'sortie',
                              quantity: item.quantity,
                              source: 'annulation_achat',
                              referenceId: id
                          });
                      }
                  }
              }
              if (stockReversed) {
                  showNotif("Stock ajusté : les quantités ont été retirées.");
              }
          }

          await DataService.deletePurchaseOrder(id);
          setConfirmAction(null);
          await loadData();
      } else {
          setConfirmAction(`${id}-delete`);
          setTimeout(() => setConfirmAction(null), 3000);
      }
  };

  const handleAdvanceStatus = async (step: 'validated' | 'paid' | 'delivered') => {
      if (!selectedPO) return;
      
      // Double validation logic
      if ((step === 'paid' || step === 'delivered') && confirmStep !== step) {
          setConfirmStep(step);
          return;
      }

      const now = new Date().toISOString();
      let updatedPO = { ...selectedPO };

      if (step === 'validated') {
          updatedPO.status = 'validated';
          updatedPO.validatedAt = now;
          if (updatedPO.number.startsWith('COPIE-')) {
              updatedPO.number = generatePoNumber();
          }
      } else if (step === 'paid') {
          updatedPO.status = 'paid';
          updatedPO.paidAt = now;
      } else if (step === 'delivered') {
          // Idempotence : ne pas recréditer si déjà livré
          if (selectedPO.status === 'delivered') return;

          updatedPO.status = 'delivered';
          updatedPO.deliveredAt = now;
          updatedPO.ponctuelStockUpdated = true;
          
          // Update stockGlobal.entrees for Shopify and Ponctuel products
          let stockUpdated = false;
          const allProducts = await DataService.getProducts();
          for (const item of updatedPO.items) {
            // Fix: Allow ponctuel products even if productId is missing (fallback to name)
            if (item.source === 'stock' || item.source === 'ponctuel' || item.source === 'adhoc') {
              let product = null;
              if (item.productId) {
                  product = allProducts.find(p => p.id === item.productId);
              }
              
              // Fallback to title matching for ponctuel products
              if (!product && (item.source === 'ponctuel' || item.source === 'adhoc')) {
                product = allProducts.find(p => 
                  p.source === 'ponctuel' && 
                  p.title.toLowerCase() === item.productName.toLowerCase()
                );
              }

              if (product) {
                const currentGlobal = product.stockGlobal || { si: product.mainStock || 0, entrees: 0, sorties: 0, sf: product.mainStock || 0 };
                const si = currentGlobal.si ?? product.mainStock ?? 0;
                const entrees = currentGlobal.entrees ?? 0;
                const sorties = currentGlobal.sorties ?? 0;
                
                const newEntrees = entrees + item.quantity;
                const newSF = si + newEntrees - sorties;
                
                const updatedProduct = {
                  ...product,
                  mainStock: si,
                  stockGlobal: {
                    si,
                    entrees: newEntrees,
                    sorties,
                    sf: newSF
                  }
                };
                await DataService.saveProduct(updatedProduct);
                stockUpdated = true;

                // Log operation
                await DataService.logStockOperation({
                  date: new Date().toISOString(),
                  productId: product.id,
                  productName: product.title,
                  type: 'entree',
                  quantity: item.quantity,
                  source: 'purchase_order',
                  referenceId: updatedPO.id
                });
              }
            }
          }
          if (stockUpdated) {
            showNotif("Stock mis à jour : entrées comptabilisées.");
          }
      }

      setConfirmStep(null);
      await handleUpdatePO(updatedPO);
  };

  const generatePDF = async (po: PurchaseOrder) => {
    const doc = new jsPDF();
    
    // Load logo
    const logoImg = new Image();
    
    // Try to get logo from settings first
    try {
        const settings = await DataService.getSettings();
        logoImg.src = settings.logoUrl || '/logo.png';
    } catch (e) {
        logoImg.src = '/logo.png';
    }

    await new Promise((resolve) => {
        logoImg.onload = resolve;
        logoImg.onerror = resolve;
    });

    // Header
    let startY = 30;
    if (logoImg.complete && logoImg.naturalHeight !== 0) {
        const imgWidth = 40; 
        const imgHeight = (logoImg.naturalHeight * imgWidth) / logoImg.naturalWidth;
        doc.addImage(logoImg, 'PNG', 14, 10, imgWidth, imgHeight);
        
        doc.setFontSize(20);
        doc.text('BON DE COMMANDE', 105, 20, { align: 'center' });
        
        doc.setFontSize(12);
        startY = 15 + imgHeight + 10;
        doc.text(`Date: ${new Date(po.date).toLocaleDateString()}`, 14, startY);
        doc.text(`N° Bon: ${po.number}`, 14, startY + 10);
        startY += 20;
    } else {
        doc.setFontSize(20);
        doc.text('BON DE COMMANDE', 105, 20, { align: 'center' });
        
        doc.setFontSize(12);
        doc.text(`Colweyz`, 14, 30);
        doc.text(`Date: ${new Date(po.date).toLocaleDateString()}`, 14, 40);
        doc.text(`N° Bon: ${po.number}`, 14, 50);
        startY = 60;
    }

    if (po.fournisseur) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Fournisseur:', 120, startY - 20);
        doc.setFont('helvetica', 'normal');
        doc.text(po.fournisseur.societe, 120, startY - 10);
        doc.text(`Tél: ${po.fournisseur.telephone}`, 120, startY);
        let fY = startY + 10;
        if (po.fournisseur.adresse) {
            doc.text(po.fournisseur.adresse, 120, fY);
            fY += 10;
        }
        if (po.fournisseur.email) {
            doc.text(po.fournisseur.email, 120, fY);
            fY += 10;
        }
    }

    // Table
    const tableColumn = ["Produit", "Quantité", "Prix Unitaire (FCFA)", "Total (FCFA)"];
    const tableRows: any[] = [];

    po.items.forEach(item => {
      const itemData = [
        item.productName,
        item.quantity,
        formatNumber(item.unitPrice),
        formatNumber(item.total)
      ];
      tableRows.push(itemData);
    });

    // Add Transport Fees row if > 0
    if (po.transportFees && po.transportFees > 0) {
        tableRows.push([
            "Frais de transport",
            "1",
            formatNumber(po.transportFees),
            formatNumber(po.transportFees)
        ]);
    }

    const tableStartY = logoImg.complete && logoImg.naturalHeight !== 0 
        ? 15 + ((logoImg.naturalHeight * 40) / logoImg.naturalWidth) + 30 
        : 60;

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: Math.max(tableStartY, startY + 20),
    });

    // Total
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL GÉNÉRAL: ${formatFCFA(po.totalAmount)}`, 140, finalY, { align: 'right' });

    // Signature
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Validation / Signature:', 14, finalY + 30);
    doc.line(14, finalY + 40, 80, finalY + 40);

    doc.save(`${po.number}.pdf`);
  };

  const formatMoney = (amount: number) => {
    return formatFCFA(amount);
  };

  const renderTimeline = (po: PurchaseOrder) => {
      const steps = [
          { id: 'draft', label: 'Éditée', date: po.createdAt || po.date, icon: FileText, done: true },
          { id: 'validated', label: 'Validée', date: po.validatedAt, icon: CheckCircle, done: !!po.validatedAt },
          { id: 'paid', label: 'Payée', date: po.paidAt, icon: DollarSign, done: !!po.paidAt },
          { id: 'delivered', label: 'Livrée', date: po.deliveredAt, icon: Truck, done: !!po.deliveredAt },
      ];

      return (
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between w-full relative mb-8 gap-6 md:gap-0">
              {/* Desktop Line */}
              <div className="hidden md:block absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-10 transform -translate-y-1/2"></div>
              <div className="hidden md:block absolute top-1/2 left-0 h-1 bg-green-500 -z-10 transform -translate-y-1/2 transition-all duration-500" 
                   style={{ width: `${(steps.filter(s => s.done).length - 1) / (steps.length - 1) * 100}%` }}></div>
              
              {/* Mobile Vertical Line */}
              <div className="md:hidden absolute left-5 top-0 w-1 h-full bg-gray-200 -z-10"></div>
              <div className="md:hidden absolute left-5 top-0 w-1 bg-green-500 -z-10 transition-all duration-500"
                   style={{ height: `${(steps.filter(s => s.done).length - 1) / (steps.length - 1) * 100}%` }}></div>

              {steps?.map((step, index) => {
                  const Icon = step.icon;
                  const isNext = !step.done && (
                      (step.id === 'validated' && steps[0].done) ||
                      (step.id === 'paid' && steps[1].done) ||
                      (step.id === 'delivered' && (steps[1].done || (step.id === 'delivered' && steps[2].done)))
                  );
                  
                  return (
                      <div key={step.id} className="flex flex-row md:flex-col items-center md:items-center bg-white px-2 w-full md:w-auto">
                          <div className="flex flex-col items-center md:items-center">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 mb-2 transition-colors ${
                                  step.done 
                                    ? 'bg-green-100 border-green-500 text-green-600' 
                                    : 'bg-gray-50 border-gray-300 text-gray-400'
                              }`}>
                                  <Icon size={20} />
                              </div>
                          </div>
                          
                          <div className="ml-4 md:ml-0 flex flex-col items-start md:items-center flex-1">
                              <span className={`text-xs font-bold uppercase mb-1 ${step.done ? 'text-green-700' : 'text-gray-500'}`}>
                                  {step.label}
                              </span>
                              {step.date && (
                                  <span className="text-[10px] text-gray-400 font-mono">
                                      {new Date(step.date).toLocaleDateString()}
                                  </span>
                              )}
                              {isNext && (
                                  <div className="flex flex-col gap-1 mt-2 w-full md:w-auto">
                                      <button 
                                          onClick={() => handleAdvanceStatus(step.id as any)}
                                          className={`text-[10px] px-4 md:px-2 py-1 rounded shadow-sm font-bold transition-colors w-full md:w-auto ${
                                              confirmStep === step.id 
                                              ? 'bg-orange-600 text-white animate-pulse' 
                                              : 'bg-blue-600 text-white hover:bg-blue-700'
                                          }`}
                                      >
                                          {confirmStep === step.id ? 'Confirmer ?' : 'Valider'}
                                      </button>
                                      {confirmStep === step.id && (
                                          <button 
                                              onClick={(e) => {
                                                  e.stopPropagation();
                                                  setConfirmStep(null);
                                              }}
                                              className="text-[9px] text-gray-500 hover:text-red-600 font-medium text-center"
                                          >
                                              Annuler
                                          </button>
                                      )}
                                  </div>
                              )}
                          </div>
                      </div>
                  );
              })}
          </div>
      );
  };

  if (loading) return <div className="p-8 text-center">Chargement...</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto relative">
      {notification && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg border transition-all duration-300 transform translate-y-0 ${
          notification.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          <div className="flex items-center gap-2 font-bold">
            {notification.type === 'success' ? <CheckCircle size={20} /> : <X size={20} />}
            {notification.message}
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
          <ShoppingCart className="text-blue-600" />
          Approvisionnement
        </h1>
        <div className="flex w-full sm:w-auto gap-2">
          {activeTab === 'list' && (
            <button 
              onClick={handleStartCreate}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-blue-700 flex-1 sm:flex-none"
            >
              <Plus size={20} /> <span className="hidden xs:inline">Nouveau Bon</span><span className="xs:hidden">Nouveau</span>
            </button>
          )}
          {activeTab === 'view' && (
               <button 
                  onClick={() => setActiveTab('list')}
                  className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-gray-200 flex-1 sm:flex-none"
               >
                  <ArrowLeft size={20} /> Retour
               </button>
          )}
        </div>
      </div>

      {activeTab === 'list' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 sm:px-6 py-3 text-xs font-bold text-gray-500 uppercase">N° Bon</th>
                  <th className="px-4 sm:px-6 py-3 text-xs font-bold text-gray-500 uppercase hidden sm:table-cell">Date</th>
                  <th className="px-4 sm:px-6 py-3 text-xs font-bold text-gray-500 uppercase">Statut</th>
                  <th className="px-4 sm:px-6 py-3 text-xs font-bold text-gray-500 uppercase text-right">Montant</th>
                  <th className="px-4 sm:px-6 py-3 text-xs font-bold text-gray-500 uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {purchaseOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-400">
                      Aucun bon de commande trouvé.
                    </td>
                  </tr>
                ) : (
                  purchaseOrders?.map(po => (
                    <tr key={po.id} className="hover:bg-gray-50">
                      <td className="px-4 sm:px-6 py-4 font-mono font-medium text-blue-600 text-sm whitespace-nowrap">{po.number}</td>
                      <td className="px-4 sm:px-6 py-4 text-gray-600 text-sm hidden sm:table-cell">{new Date(po.date).toLocaleDateString()}</td>
                      <td className="px-4 sm:px-6 py-4">
                          <div className="flex flex-col gap-1">
                              <span className={`text-[10px] sm:text-xs px-2 py-0.5 sm:py-1 rounded-full font-bold uppercase w-fit ${
                                  po.status === 'delivered' ? 'bg-green-100 text-green-700' :
                                  po.status === 'paid' ? 'bg-blue-100 text-blue-700' :
                                  po.status === 'validated' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-600'
                              }`}>
                                  {po.status === 'delivered' ? 'Livrée' : 
                                   po.status === 'paid' ? 'Payée' : 
                                   po.status === 'validated' ? 'Validée' : 'Éditée'}
                              </span>
                              <div className="sm:hidden text-[9px] text-gray-500">{new Date(po.date).toLocaleDateString()}</div>
                          </div>
                      </td>
                      <td className="px-4 sm:px-6 py-4 font-bold text-right text-sm">{formatMoney(po.totalAmount)}</td>
                      <td className="px-4 sm:px-6 py-4 text-right">
                        <div className="flex justify-end gap-1 sm:gap-2">
                          <button 
                            onClick={() => dupliquerBon(po)}
                            disabled={duplicationEnCours}
                            style={{ opacity: duplicationEnCours ? 0.5 : 1 }}
                            className="p-1 sm:p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="Dupliquer"
                          >
                            <Copy size={16} className="sm:w-[18px] sm:h-[18px]" />
                          </button>
                          {(po.status === 'draft' || po.status === 'validated') && (
                              <button 
                                onClick={() => handleEditPO(po)}
                                className="p-1 sm:p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                                title="Éditer"
                              >
                                <Edit size={16} className="sm:w-[18px] sm:h-[18px]" />
                              </button>
                          )}
                          <button 
                            onClick={() => handleViewPO(po)}
                            className="p-1 sm:p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="Voir détails"
                          >
                            <Eye size={16} className="sm:w-[18px] sm:h-[18px]" />
                          </button>
                          <button 
                            onClick={() => generatePDF(po)}
                            className="p-1 sm:p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg"
                            title="Télécharger PDF"
                          >
                            <Download size={16} className="sm:w-[18px] sm:h-[18px]" />
                          </button>
                          <button 
                            onClick={() => handleDeletePO(po.id)}
                            className={`p-1 sm:p-2 rounded-lg transition-colors ${
                                confirmAction === `${po.id}-delete`
                                ? 'bg-red-600 text-white hover:bg-red-700'
                                : 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                            }`}
                            title={confirmAction === `${po.id}-delete` ? "Confirmer" : "Supprimer"}
                          >
                            <Trash2 size={16} className="sm:w-[18px] sm:h-[18px]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'view' && selectedPO ? (
          <div className="space-y-6">
              {/* Timeline Card */}
              <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
                  {renderTimeline(selectedPO)}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left: Details */}
                  <div className="lg:col-span-2 space-y-6">
                      {selectedPO.fournisseur && (
                          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                              <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2">
                                  🏭 Informations Fournisseur
                              </h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                  <div>
                                      <span className="text-gray-500 block mb-1">Société</span>
                                      <span className="font-medium">{selectedPO.fournisseur.societe}</span>
                                  </div>
                                  <div>
                                      <span className="text-gray-500 block mb-1">Téléphone</span>
                                      <span className="font-medium">{selectedPO.fournisseur.telephone}</span>
                                  </div>
                                  {selectedPO.fournisseur.adresse && (
                                      <div>
                                          <span className="text-gray-500 block mb-1">Adresse</span>
                                          <span className="font-medium">{selectedPO.fournisseur.adresse}</span>
                                      </div>
                                  )}
                                  {selectedPO.fournisseur.email && (
                                      <div>
                                          <span className="text-gray-500 block mb-1">Email</span>
                                          <span className="font-medium">{selectedPO.fournisseur.email}</span>
                                      </div>
                                  )}
                              </div>
                          </div>
                      )}

                      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                          <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                              <h3 className="font-bold text-gray-700">Détails de la commande</h3>
                              <div className="flex items-center gap-4">
                                  <span className="font-mono text-blue-600 font-bold">{selectedPO.number}</span>
                                  {(selectedPO.status === 'draft' || selectedPO.status === 'validated') && (
                                      <button 
                                          onClick={() => handleEditPO(selectedPO)}
                                          className="text-sm bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 font-medium flex items-center gap-2"
                                      >
                                          <Edit size={14} /> Éditer
                                      </button>
                                  )}
                              </div>
                          </div>
                          <div className="overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                  <thead className="bg-gray-50 border-b border-gray-200">
                                      <tr>
                                          <th className="px-4 py-3 font-bold text-gray-500">Produit</th>
                                          <th className="px-4 py-3 font-bold text-gray-500 text-right">Prix Unitaire</th>
                                          <th className="px-4 py-3 font-bold text-gray-500 text-center">Qté</th>
                                          <th className="px-4 py-3 font-bold text-gray-500 text-right">Total</th>
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                      {selectedPO.items?.map((item, idx) => (
                                          <tr key={idx}>
                                              <td className="px-4 py-3 min-w-[150px]">
                                                  <div className="font-medium text-gray-900">{item.productName}</div>
                                                  <div className="text-xs text-gray-500 uppercase">{item.source === 'stock' ? 'Stock' : 'Ponctuel'}</div>
                                              </td>
                                              <td className="px-4 py-3 text-right whitespace-nowrap">{formatMoney(item.unitPrice)}</td>
                                              <td className="px-4 py-3 text-center">{item.quantity}</td>
                                              <td className="px-4 py-3 text-right font-bold whitespace-nowrap">{formatMoney(item.total)}</td>
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      </div>

                      {/* Documents Section */}
                      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                          <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2">
                              <Paperclip size={20} /> Documents joints
                          </h3>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                              {selectedPO.documents && selectedPO.documents.length > 0 ? (
                                  selectedPO.documents?.map(doc => (
                                      <div key={doc.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                                          <div className="flex items-center gap-3 overflow-hidden">
                                              <div className="bg-blue-100 p-2 rounded text-blue-600">
                                                  <FileText size={20} />
                                              </div>
                                              <div className="truncate">
                                                  <p className="font-bold text-sm truncate">{doc.label}</p>
                                                  <p className="text-xs text-gray-500 truncate">{doc.name}</p>
                                              </div>
                                          </div>
                                          <a 
                                              href={doc.data} 
                                              download={doc.name}
                                              className="text-gray-400 hover:text-blue-600"
                                          >
                                              <Download size={18} />
                                          </a>
                                      </div>
                                  ))
                              ) : (
                                  <div className="col-span-2 text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                                      Aucun document joint.
                                  </div>
                              )}
                          </div>

                          <div className="flex flex-col sm:flex-row items-end gap-4 pt-4 border-t border-gray-100">
                              <div className="w-full sm:flex-1">
                                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Type de document</label>
                                  <select 
                                      value={docLabel}
                                      onChange={(e) => setDocLabel(e.target.value)}
                                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                  >
                                      <option>Ticket de paiement</option>
                                      <option>Bon de livraison</option>
                                      <option>Facture fournisseur</option>
                                      <option>Autre</option>
                                  </select>
                              </div>
                              <div className="w-full sm:flex-1">
                                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Fichier</label>
                                  <div className="relative">
                                      <input 
                                          type="file" 
                                          accept=".pdf,image/*"
                                          onChange={handleFileUpload}
                                          disabled={uploading}
                                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                      />
                                      <div className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-2 bg-gray-50 hover:bg-gray-100 transition-colors text-gray-600">
                                          {uploading ? <span className="animate-pulse">Chargement...</span> : <><Upload size={16} /> Choisir un fichier</>}
                                      </div>
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>

                  {/* Right: Summary & Actions */}
                  <div className="space-y-6">
                      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                          <h3 className="font-bold text-gray-800 mb-4">Finances</h3>
                          
                          <div className="space-y-4 mb-6">
                              <div className="flex justify-between text-sm">
                                  <span className="text-gray-600">Sous-total Produits</span>
                                  <span className="font-medium">
                                      {formatMoney(selectedPO.items.reduce((sum, item) => sum + item.total, 0))}
                                  </span>
                              </div>
                              
                              <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Frais de transport</label>
                                  <div className="flex items-center gap-2">
                                      <input 
                                          type="number" 
                                          value={selectedPO.transportFees || 0}
                                          onChange={(e) => {
                                              const val = parseInt(e.target.value) || 0;
                                              handleUpdatePO({
                                                ...selectedPO,
                                                transportFees: val,
                                                totalAmount:
                                                  selectedPO.items.reduce((s, i) => s + i.total, 0) + val,
                                              });
                                          }}
                                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-right"
                                      />
                                      <span className="text-xs font-bold text-gray-500">FCFA</span>
                                  </div>
                              </div>

                              <div className="border-t border-gray-100 pt-3 flex justify-between items-center">
                                  <span className="font-bold text-gray-800">TOTAL GÉNÉRAL</span>
                                  <span className="font-black text-xl text-blue-600">
                                      {formatMoney(selectedPO.totalAmount)}
                                  </span>
                              </div>

                              {selectedPO.status === 'delivered' && (
                                  <div className={`mt-4 p-3 rounded-lg text-center font-bold text-sm ${selectedPO.paidAt ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
                                      {selectedPO.paidAt ? 'Paiement: Payé ✅' : 'Paiement: En attente ⏳'}
                                  </div>
                              )}
                          </div>

                          <button 
                              onClick={() => generatePDF(selectedPO)}
                              className="w-full bg-gray-800 text-white py-3 rounded-lg font-bold hover:bg-gray-900 flex items-center justify-center gap-2"
                          >
                              <Download size={20} /> Télécharger PDF
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      ) : (
        // CREATE FORM
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* LEFT: Form */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Fournisseur Form */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                🏭 Informations Fournisseur
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nom de la société *</label>
                  <input
                    type="text"
                    placeholder="Société"
                    list="suppliers-list"
                    value={fournisseur.societe}
                    onChange={e => {
                      const name = e.target.value;
                      setFournisseur({...fournisseur, societe: name});
                      const existing = suppliers.find(s => s.societe.toLowerCase() === name.toLowerCase());
                      if (existing) {
                        setFournisseur(existing);
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <datalist id="suppliers-list">
                    {suppliers.map((s, idx) => (
                      <option key={idx} value={s.societe} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Téléphone *</label>
                  <input
                    type="text"
                    placeholder="Téléphone"
                    value={fournisseur.telephone}
                    onChange={e => setFournisseur({...fournisseur, telephone: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Adresse (Optionnel)</label>
                  <input
                    type="text"
                    placeholder="Adresse"
                    value={fournisseur.adresse || ''}
                    onChange={e => setFournisseur({...fournisseur, adresse: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email (Optionnel)</label>
                  <input
                    type="email"
                    placeholder="Email"
                    value={fournisseur.email || ''}
                    onChange={e => setFournisseur({...fournisseur, email: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-bold text-lg">Ajouter des produits</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Sélectionner un produit</label>
                  <select 
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Sélectionner un produit...</option>
                    {allProducts.sort((a, b) => a.title.localeCompare(b.title)).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.title} {p.source === 'ponctuel' ? '(Ponctuel)' : ''} ({formatMoney(p.purchasePrice || 0)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-end gap-4">
                <div className="w-full sm:flex-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Quantité</label>
                  <input 
                    type="number" 
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <button 
                  onClick={handleAddItem}
                  disabled={!selectedProductId}
                  className="w-full sm:w-auto bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Ajouter
                </button>
              </div>
            </div>

            {/* Items List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 font-bold text-gray-500">Produit</th>
                      <th className="px-4 py-3 font-bold text-gray-500 text-right">Prix</th>
                      <th className="px-4 py-3 font-bold text-gray-500 text-center">Qté</th>
                      <th className="px-4 py-3 font-bold text-gray-500 text-right">Total</th>
                      <th className="px-4 py-3 font-bold text-gray-500 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {poItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                          Aucun produit ajouté au bon de commande.
                        </td>
                      </tr>
                    ) : (
                      poItems?.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-3 min-w-[120px]">
                            <div className="font-medium text-gray-900">{item.productName}</div>
                            <div className="text-xs text-gray-500 uppercase">{item.source === 'stock' ? 'Stock' : 'Ponctuel'}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <input 
                              type="number" 
                              value={item.unitPrice}
                              onChange={(e) => handleUpdateItemPrice(idx, parseInt(e.target.value) || 0)}
                              className="w-20 sm:w-24 border border-gray-300 rounded px-1 sm:px-2 py-1 text-xs sm:text-sm text-right inline-block"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input 
                              type="number" 
                              value={item.quantity}
                              min="1"
                              onChange={(e) => handleUpdateItemQuantity(idx, parseInt(e.target.value) || 1)}
                              className="w-12 sm:w-16 border border-gray-300 rounded px-1 sm:px-2 py-1 text-xs sm:text-sm text-center inline-block"
                            />
                          </td>
                          <td className="px-4 py-3 text-right font-bold whitespace-nowrap">{formatMoney(item.total)}</td>
                          <td className="px-4 py-3 text-right">
                            <button 
                              onClick={() => handleRemoveItem(idx)}
                              className="text-red-400 hover:text-red-600"
                            >
                              <X size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* RIGHT: Summary */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h3 className="font-bold text-gray-800 mb-4">Récapitulatif</h3>
              
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">N° Bon</span>
                  <span className="font-mono font-bold">{poNumber}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Date</span>
                  <span className="font-medium">{new Date().toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Articles</span>
                  <span className="font-medium">{poItems.length}</span>
                </div>
                
                <div className="pt-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Frais de transport</label>
                    <input 
                        type="number" 
                        value={transportFees}
                        onChange={(e) => setTransportFees(parseInt(e.target.value) || 0)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-right"
                    />
                </div>

                <div className="border-t border-gray-100 pt-3 flex justify-between items-center">
                  <span className="font-bold text-gray-800">TOTAL</span>
                  <span className="font-black text-xl text-blue-600">
                    {formatMoney(poItems.reduce((sum, item) => sum + item.total, 0) + transportFees)}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                {formError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-200">
                    {formError}
                  </div>
                )}
                <button 
                  onClick={handleSavePO}
                  disabled={poItems.length === 0}
                  className="w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Save size={20} /> Valider le Bon
                </button>
                <button 
                  onClick={() => setActiveTab('list')}
                  className="w-full bg-gray-100 text-gray-600 py-3 rounded-lg font-bold hover:bg-gray-200"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AdHoc Modal removed - centralized in Inventory */}
    </div>
  );
}
