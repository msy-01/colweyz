import React, { useState, useEffect } from 'react';
import { Save, MessageCircle, Image as ImageIcon, Upload, Trash2, AlertCircle, Download } from 'lucide-react';
import { DataService } from '../services/dataService';
import { AppSettings, Order } from '../types';
import { parseProductCommand } from '../utils/productParser';

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>({ adminPhone: '', logoUrl: '' });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const unsubscribe = DataService.subscribeToSettings((data) => {
        setSettings(data);
        setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await DataService.saveSettings(settings);
    setSaved(true);
    // Reload page to reflect logo changes globally
    setTimeout(() => window.location.reload(), 1000); 
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) { // Limit to 2MB to preserve localStorage
          alert("Le fichier est trop volumineux (Max 2MB).");
          return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
          setSettings(prev => ({ ...prev, logoUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
  };

  const removeLogo = () => {
      setSettings(prev => ({ ...prev, logoUrl: '' }));
  };

  const handleExportFacebookCSV = async () => {
      const orders = await DataService.getOrders();
      const zones = await DataService.getZones();
      const productsList = await DataService.getProducts();
      const dailyEntries = await DataService.getDailyEntries();
      
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

      const conversions = [];

      for (const o of orders) {
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

          if (isConversion) {
              // Format phone: +221XXXXXXXXX
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

              // Format fn (First Name / Full Name)
              let fn = o.clientName || "";
              fn = fn.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z\s]/g, "").toLowerCase().trim();

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

              const valueUSD = (o.amount / rate).toFixed(2);

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

              conversions.push({
                  event_name: "Purchase",
                  event_time: isoTime,
                  value: valueUSD,
                  currency: "USD",
                  phone: phone,
                  payment_method: "cash_on_delivery",
                  delivery_category: "home_delivery",
                  content_type: "product"
              });
          }
      }

      const header = "event_name,event_time,value,currency,phone,payment_method,delivery_category,content_type\n";
      const rows = conversions?.map(c => `${c.event_name},${c.event_time},${c.value},${c.currency},${c.phone},${c.payment_method},${c.delivery_category},${c.content_type}`).join("\n");
      const csvContent = header + rows;

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", "colweyz_facebook_cod_conversions.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  if (loading) return <div className="p-8">Chargement...</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <h2 className="text-2xl font-bold text-gray-800">Paramètres de l'application</h2>

      <form onSubmit={handleSave} className="space-y-6">
          {/* LOGO SECTION */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
             <h3 className="font-semibold text-gray-700 mb-4 flex items-center">
                <ImageIcon className="mr-2 text-green-600" size={20} /> Logo de l'entreprise
             </h3>

             <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50">
                 {settings.logoUrl ? (
                     <div className="relative group">
                         <img src={settings.logoUrl} alt="Logo Preview" className="h-32 object-contain rounded-lg bg-white p-2 shadow-sm" />
                         <button 
                            type="button"
                            onClick={removeLogo}
                            className="absolute -top-2 -right-2 bg-red-500 text-white p-1.5 rounded-full hover:bg-red-600 shadow-md transition-transform transform hover:scale-110"
                            title="Supprimer le logo"
                         >
                             <Trash2 size={16} />
                         </button>
                     </div>
                 ) : (
                     <div className="text-center text-gray-400 py-4">
                         <ImageIcon size={48} className="mx-auto mb-2 opacity-50" />
                         <p className="text-sm font-medium">Aucun logo défini</p>
                         <p className="text-xs mt-1">Le logo par défaut sera utilisé</p>
                     </div>
                 )}

                 <div className="mt-6">
                     <label className="cursor-pointer bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium shadow-sm hover:bg-gray-50 hover:border-gray-400 inline-flex items-center transition-all">
                         <Upload size={18} className="mr-2 text-blue-600" />
                         <span>{settings.logoUrl ? 'Changer le logo' : 'Importer un logo'}</span>
                         <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                     </label>
                 </div>
                 <p className="text-xs text-gray-400 mt-3 text-center max-w-xs">
                    Format recommandé: PNG avec transparence.<br/>Taille max: 2MB.
                 </p>
             </div>
             
             <div className="mt-4 bg-blue-50 p-4 rounded-lg flex items-start text-xs text-blue-800 border border-blue-100">
                 <AlertCircle size={16} className="mr-2 mt-0.5 flex-shrink-0 text-blue-600" />
                 <p>Ce logo sera affiché sur la page de connexion, dans le menu principal, sur l'interface livreur et sur les factures/bons de commande PDF.</p>
             </div>
          </div>

          {/* NOTIFICATIONS SECTION */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-700 mb-4 flex items-center">
                <MessageCircle className="mr-2 text-green-600" size={20} /> Notifications WhatsApp
            </h3>
            
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Numéro WhatsApp Administrateur (Réception des paiements)
                </label>
                <div className="relative">
                    <input 
                        type="tel" 
                        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 pl-4 bg-white focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all outline-none"
                        value={settings.adminPhone}
                        onChange={(e) => setSettings({ ...settings, adminPhone: e.target.value })}
                        placeholder="Ex: 221770000000"
                    />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                    Ce numéro sera utilisé lorsqu'un livreur clique sur "Déjà payé (Wave/OM)" pour notifier l'administration. 
                    <br/>Format recommandé : avec l'indicatif (ex: 221...) sans le "+".
                </p>
            </div>
          </div>

          {/* EXPORT SECTION */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-700 mb-4 flex items-center">
                <Download className="mr-2 text-blue-600" size={20} /> Export Facebook Conversions
            </h3>
            <p className="text-sm text-gray-600 mb-4">
                Téléchargez le fichier CSV contenant toutes les conversions hors ligne (livraisons Dakar et Delta Transport) pour l'importer dans Facebook Ads.
            </p>
            <button
                type="button"
                onClick={handleExportFacebookCSV}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex items-center transition-colors"
            >
                <Download size={18} className="mr-2" />
                Télécharger le fichier CSV
            </button>
          </div>

          <div className="pt-4 pb-8">
            <button 
                type="submit" 
                disabled={saved}
                className={`w-full flex items-center justify-center px-6 py-4 rounded-xl text-white font-bold text-lg transition-all shadow-lg transform active:scale-95 ${saved ? 'bg-green-600 cursor-default' : 'bg-green-700 hover:bg-green-800 hover:shadow-xl'}`}
            >
                <Save size={24} className="mr-2" />
                {saved ? 'Paramètres Enregistrés !' : 'Enregistrer les modifications'}
            </button>
            {saved && (
                <p className="text-center text-sm text-gray-500 mt-3 animate-pulse">
                    L'application va se rafraîchir pour appliquer le nouveau logo...
                </p>
            )}
          </div>
      </form>
    </div>
  );
};