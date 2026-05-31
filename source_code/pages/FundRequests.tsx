
import React, { useState, useEffect } from 'react';
import { Driver, FundRequest, Order } from '../types';
import { DataService } from '../services/dataService';
import { formatFCFA } from '../utils/formatters';
import { HandCoins, CheckCircle, Send, XCircle, Trash2, Clock, Ban } from 'lucide-react';

export const FundRequests: React.FC = () => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [requests, setRequests] = useState<FundRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Double Validation State
  const [actionId, setActionId] = useState<string | null>(null);
  // actionType can now be specific confirm types
  const [actionType, setActionType] = useState<'confirm_wave' | 'confirm_om' | 'cancel' | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [d, o, f] = await Promise.all([
      DataService.getDrivers(),
      DataService.getOrders(),
      DataService.getFundRequests()
    ]);
    setDrivers(d);
    setOrders(o);
    setRequests(f);
    setLoading(false);
  };

  const calculateDriverDebt = (driverId: string) => {
      const driver = drivers.find(d => d.id === driverId);
      if (!driver) return 0;

      const myOrders = orders.filter(
        (o) =>
          o.driverId === driverId &&
          (o.status === 'livré' ||
            o.status === 'terminé' ||
            o.status === 'expedition_livree')
      );

      const totalCashCollected = myOrders
        .filter(
          (o) =>
            o.modePaiement === 'Espèces' ||
            (!o.modePaiement &&
              (o.paymentMethod === 'cash' || !o.paymentMethod))
        )
        .reduce((sum, o) => sum + o.amount, 0);

      const totalRemuneration = myOrders
        .reduce((sum, o) => sum + (o.remuneration || 0), 0);

      // Ensure proper number subtraction
      return totalCashCollected - totalRemuneration - (Number(driver.initialBalance) || 0);
  };

  const handleConfirmClick = async (req: FundRequest, method: 'wave' | 'om') => {
      // Prevent confirming declined requests
      if (req.status === 'declined') return;

      const typeKey = method === 'wave' ? 'confirm_wave' : 'confirm_om';

      if (actionId === req.id && actionType === typeKey) {
          // Second click: Execute
          const updatedReq: FundRequest = { 
              ...req, 
              status: 'confirmed', 
              confirmedAt: new Date().toISOString(),
              paymentMethod: method
          };
          await DataService.saveFundRequest(updatedReq);
          setRequests(prev => prev?.map(r => r.id === req.id ? updatedReq : r));

          // Update Driver Balance
          const driver = drivers.find(d => d.id === req.driverId);
          if (driver) {
              const updatedDriver: Driver = {
                  ...driver,
                  initialBalance: (Number(driver.initialBalance) || 0) + req.amount
              };
              await DataService.saveDriver(updatedDriver);
              setDrivers(prev => prev?.map(d => d.id === driver.id ? updatedDriver : d));
          }
          resetAction();
      } else {
          // First click: Ask confirmation
          setActionId(req.id);
          setActionType(typeKey);
          setTimeout(() => resetAction(), 3000); // Auto reset
      }
  };

  const handleCancelClick = async (req: FundRequest) => {
      if (actionId === req.id && actionType === 'cancel') {
          // Second click: Execute DELETE & REVERSE BALANCE IF CONFIRMED
          
          if (req.status === 'confirmed') {
              const driver = drivers.find(d => d.id === req.driverId);
              if (driver) {
                  // Reverse logic:
                  // If it was a 'payout' (Driver balance decreased), we increase it back.
                  // If it was a 'collect' (Driver balance increased), we decrease it back.
                  // However, the standard FundRequest logic in this app uses 'initialBalance' to track total paid/received.
                  // Confirmed Request = Balance Increased by amount.
                  // So to reverse, we decrease Balance by amount.
                  // Special check for Payout type (usually negative logic in creating, but here FundRequest stores positive amount)
                  
                  let reversalAmount = req.amount;
                  if (req.type === 'payout') {
                      // Payout logic usually decreases initialBalance (company paid driver -> debt increased or credit decreased)
                      // Wait, let's check Balances.tsx creation logic:
                      // Payout -> adjustment = -req.amount
                      // Collect -> adjustment = req.amount
                      // So here we do the inverse.
                      reversalAmount = -req.amount; // Reversing a negative is adding
                  }
                  
                  // Wait, if I am deleting a Confirmed Collect (+10000), I need to remove 10000.
                  // If I am deleting a Confirmed Payout (-10000), I need to add 10000.
                  
                  // Let's look at `handleConfirmClick` above:
                  // initialBalance = initialBalance + req.amount (This is for Collect/Confirm)
                  // So to reverse a Collect: initialBalance - req.amount.
                  
                  // What about Payout? Payouts are usually auto-confirmed in Balances.tsx:
                  // adjustment = (req.type === 'payout') ? -req.amount : req.amount;
                  
                  const reverseAdjustment = (req.type === 'payout') ? req.amount : -req.amount;
                  
                  const updatedDriver: Driver = {
                      ...driver,
                      initialBalance: (Number(driver.initialBalance) || 0) + reverseAdjustment
                  };
                  await DataService.saveDriver(updatedDriver);
                  setDrivers(prev => prev?.map(d => d.id === driver.id ? updatedDriver : d));
              }
          }

          await DataService.deleteFundRequest(req.id);
          setRequests(prev => prev.filter(r => r.id !== req.id));
          resetAction();
      } else {
          // First click: Ask confirmation
          setActionId(req.id);
          setActionType('cancel');
          setTimeout(() => resetAction(), 3000);
      }
  };

  const resetAction = () => {
      setActionId(null);
      setActionType(null);
  };

  const sendWhatsApp = (req: FundRequest) => {
      if (req.status === 'declined') return;
      const driver = drivers.find(d => d.id === req.driverId);
      if (!driver) return;

      const waveLink = `https://pay.wave.com/m/M_N1UnVCV3hufj/c/sn/?amount=${req.amount}`;
      const message = `Bonjour ${driver.name}, merci de verser la somme de ${formatFCFA(req.amount)} via ce lien Wave : ${waveLink}`;
      const url = `https://wa.me/${driver.phone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Chargement...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3 mb-6">
          <div className="bg-orange-100 p-3 rounded-full text-orange-600">
              <HandCoins size={28} />
          </div>
          <div>
              <h2 className="text-2xl font-bold text-gray-800">Gestion des Appels de Fonds</h2>
              <p className="text-gray-500 text-sm">Suivez, confirmez ou annulez les demandes de versement.</p>
          </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                 <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                     <tr>
                         <th className="px-6 py-4">Date</th>
                         <th className="px-6 py-4">Livreur & Solde</th>
                         <th className="px-6 py-4">Montant demandé</th>
                         <th className="px-6 py-4">Statut</th>
                         <th className="px-6 py-4 text-right">Actions</th>
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100">
                     {requests.length === 0 ? (
                         <tr>
                             <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                                 Aucun appel de fonds en cours ou historique.
                             </td>
                         </tr>
                     ) : (
                         requests.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())?.map(req => {
                             const driver = drivers.find(d => d.id === req.driverId);
                             const currentDebt = driver ? calculateDriverDebt(driver.id) : 0;
                             
                             // Color logic: Green = Driver owes (Positive), Red = Company owes (Negative)
                             // Note: In this app context, positive debt means the driver has cash to pay back.
                             let balanceClass = "text-gray-500";
                             if (currentDebt > 0) balanceClass = "text-green-600";
                             if (currentDebt < 0) balanceClass = "text-red-600";
                             
                             // Interaction Logic
                             const isConfirmingWave = actionId === req.id && actionType === 'confirm_wave';
                             const isConfirmingOM = actionId === req.id && actionType === 'confirm_om';
                             const isCanceling = actionId === req.id && actionType === 'cancel';
                             const isDeclined = req.status === 'declined';

                             // Status Badge Logic
                             let statusBadge;
                             if (req.status === 'confirmed') {
                                 const methodText = req.paymentMethod === 'om' ? 'Via OM' : req.paymentMethod === 'wave' ? 'Via Wave' : 'Reçu';
                                 const methodColor = req.paymentMethod === 'om' 
                                    ? 'bg-orange-100 text-orange-700 border-orange-200' 
                                    : req.paymentMethod === 'wave'
                                        ? 'bg-blue-100 text-blue-700 border-blue-200'
                                        : 'bg-green-100 text-green-700 border-green-200';
                                        
                                 statusBadge = (
                                    <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full border ${methodColor}`}>
                                        <CheckCircle size={14} className="mr-1.5" /> {methodText}
                                    </span>
                                 );
                             } else if (req.status === 'paid_by_driver') {
                                 const methodText = req.paymentMethod === 'om' ? '(OM)' : req.paymentMethod === 'wave' ? '(Wave)' : '';
                                 statusBadge = (
                                    <span className="inline-flex items-center text-xs font-bold text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full border border-blue-200 animate-pulse">
                                        <CheckCircle size={14} className="mr-1.5" /> Paiement Envoyé {methodText}
                                    </span>
                                 );
                             } else if (req.status === 'declined') {
                                 statusBadge = (
                                    <span className="inline-flex items-center text-xs font-bold text-red-700 bg-red-100 px-2.5 py-1 rounded-full border border-red-200">
                                        <XCircle size={14} className="mr-1.5" /> Refusé par livreur
                                    </span>
                                 );
                             } else {
                                 statusBadge = (
                                    <span className="inline-flex items-center text-xs font-bold text-orange-700 bg-orange-100 px-2.5 py-1 rounded-full border border-orange-200">
                                        <Clock size={14} className="mr-1.5" /> En attente
                                    </span>
                                 );
                             }

                             return (
                                 <tr key={req.id} className="hover:bg-gray-50">
                                     <td className="px-6 py-4 text-gray-500">
                                         {new Date(req.createdAt).toLocaleDateString()}
                                         <div className="text-xs text-gray-400">{new Date(req.createdAt).toLocaleTimeString().slice(0,5)}</div>
                                     </td>
                                     <td className="px-6 py-4">
                                         <div className="font-bold text-gray-800">{driver?.name || 'Inconnu'}</div>
                                         <div className="text-xs mt-1 flex items-center">
                                             <span className="text-gray-500 mr-1">Solde actuel:</span>
                                             <span className={`font-bold ${balanceClass}`}>
                                                 {formatFCFA(currentDebt)}
                                             </span>
                                         </div>
                                     </td>
                                     <td className="px-6 py-4 font-bold text-gray-900 text-lg">
                                         {formatFCFA(req.amount)}
                                     </td>
                                     <td className="px-6 py-4">
                                         {statusBadge}
                                     </td>
                                     <td className="px-6 py-4 text-right">
                                         <div className="flex justify-end gap-2">
                                             {req.status !== 'confirmed' && (
                                                 <>
                                                     {/* WHATSAPP BUTTON */}
                                                     <button 
                                                         onClick={() => sendWhatsApp(req)}
                                                         disabled={isDeclined}
                                                         className={`p-2 rounded-lg border border-transparent transition-colors ${
                                                             isDeclined 
                                                             ? 'text-gray-300 cursor-not-allowed' 
                                                             : 'text-green-600 hover:bg-green-50 hover:border-green-200'
                                                         }`}
                                                         title={isDeclined ? "Action impossible (Refusé)" : "Renvoyer lien WhatsApp"}
                                                     >
                                                         <Send size={18} />
                                                     </button>
                                                     
                                                     {/* SPLIT CONFIRM BUTTONS (Disabled if declined) */}
                                                     {isDeclined ? (
                                                        <button 
                                                            disabled
                                                            className="bg-gray-100 text-gray-400 border border-gray-200 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center cursor-not-allowed"
                                                            title="Le livreur a refusé cet appel de fonds"
                                                        >
                                                            <Ban size={14} className="mr-1.5" />
                                                            Refusé
                                                        </button>
                                                     ) : (
                                                        <div className="flex gap-1">
                                                            {/* WAVE BUTTON */}
                                                            <button 
                                                                onClick={() => handleConfirmClick(req, 'wave')}
                                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center transition-all
                                                                    ${isConfirmingWave
                                                                        ? 'bg-blue-700 text-white ring-2 ring-blue-500 ring-offset-1 w-24 justify-center' 
                                                                        : 'bg-[#1da1f2] text-white hover:bg-blue-600'
                                                                    }
                                                                    ${actionId === req.id && !isConfirmingWave && actionType?.startsWith('confirm') ? 'hidden' : ''}
                                                                `}
                                                            >
                                                                {isConfirmingWave ? 'Sûr ?' : 'Wave'}
                                                            </button>

                                                            {/* OM BUTTON */}
                                                            <button 
                                                                onClick={() => handleConfirmClick(req, 'om')}
                                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center transition-all
                                                                    ${isConfirmingOM
                                                                        ? 'bg-orange-700 text-white ring-2 ring-orange-500 ring-offset-1 w-24 justify-center' 
                                                                        : 'bg-[#ff7900] text-white hover:bg-orange-600'
                                                                    }
                                                                    ${actionId === req.id && !isConfirmingOM && actionType?.startsWith('confirm') ? 'hidden' : ''}
                                                                `}
                                                            >
                                                                {isConfirmingOM ? 'Sûr ?' : 'OM'}
                                                            </button>
                                                        </div>
                                                     )}

                                                     {/* CANCEL/DELETE BUTTON */}
                                                     <button 
                                                         onClick={() => handleCancelClick(req)}
                                                         className={`border px-3 py-1.5 rounded-lg text-xs font-bold flex items-center transition-all
                                                             ${isCanceling 
                                                                 ? 'bg-red-600 text-white border-red-600 ring-2 ring-red-400 ring-offset-1' 
                                                                 : 'bg-white text-red-500 border-gray-200 hover:bg-red-50 hover:border-red-200'
                                                             }
                                                         `}
                                                     >
                                                         <Trash2 size={14} />
                                                     </button>
                                                 </>
                                             )}
                                             
                                             {/* If confirmed, allow delete to clean up history if needed AND REVERSE BALANCE */}
                                             {req.status === 'confirmed' && (
                                                <button 
                                                    onClick={() => handleCancelClick(req)}
                                                    className={`p-2 rounded transition-colors ${isCanceling ? 'bg-red-100 text-red-600' : 'text-gray-400 hover:text-red-500'}`}
                                                    title="Annuler la transaction (Remboursement)"
                                                >
                                                    {isCanceling ? 'Annuler ?' : <Trash2 size={16} />}
                                                </button>
                                             )}
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
    </div>
  );
};
