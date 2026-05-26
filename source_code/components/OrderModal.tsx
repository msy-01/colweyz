import React, { useState, useEffect } from 'react';
import { Order, Product, Zone, Driver } from '../types';
import { X, Plus, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { parseProductCommand } from '../utils/productParser';
import { trouverProduitShopify } from '../utils/productMatcher';

import { formatNumber } from '../utils/formatters';

interface OrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (order: Order) => Promise<void>;
  order?: Order | null;
  zones: Zone[];
  drivers: Driver[];
  products: Product[];
}

export const OrderModal: React.FC<OrderModalProps> = ({
  isOpen,
  onClose,
  onSave,
  order,
  zones,
  drivers,
  products
}) => {
  const [formData, setFormData] = useState<Partial<Order>>({
    clientName: '',
    clientPhone: '',
    address: '',
    zoneId: '',
    driverId: '',
    status: 'validé',
    modePaiement: 'Espèces',
    productDetails: '',
    amount: 0,
    products: []
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (order) {
      setFormData({
        ...order,
        products: order.products || []
      });
    } else {
      setFormData({
        clientName: '',
        clientPhone: '',
        address: '',
        zoneId: '',
        driverId: '',
        status: 'validé',
        modePaiement: 'Espèces',
        productDetails: '',
        amount: 0,
        products: [],
        date: new Date().toISOString()
      });
    }
  }, [order, isOpen]);

  const handleAddProduct = () => {
    setFormData(prev => ({
      ...prev,
      products: [
        ...(prev.products || []),
        { name: '', quantity: 1, ponctuel: false, prixUnitaire: 0, sku: null }
      ]
    }));
  };

  const handleRemoveProduct = (index: number) => {
    setFormData(prev => {
      const newProducts = [...(prev.products || [])];
      newProducts.splice(index, 1);
      return { ...prev, products: newProducts };
    });
  };

  const handleProductChange = (index: number, field: string, value: any) => {
    setFormData(prev => {
      const newProducts = [...(prev.products || [])];
      newProducts[index] = { ...newProducts[index], [field]: value };

      if (field === 'ponctuel') {
        if (value) {
          newProducts[index].sku = null;
          newProducts[index].name = '';
          newProducts[index].prixUnitaire = 0;
        } else {
          newProducts[index].name = '';
          newProducts[index].prixUnitaire = 0;
          newProducts[index].sku = null;
        }
      }

      if (field === 'sku' && !newProducts[index].ponctuel) {
        const product = products.find(p => p.id === value);
        if (product) {
          newProducts[index].name = product.title;
          newProducts[index].prixUnitaire = product.sellingPrice || 0;
        }
      }

      return { ...prev, products: newProducts };
    });
  };

  useEffect(() => {
    // Recalculate total amount and productDetails string
    if (formData.products && formData.products.length > 0) {
      const total = formData.products.reduce((acc, p) => acc + ((p.prixUnitaire || 0) * (p.quantity || 1)), 0);
      const details = formData.products?.map(p => `${p.quantity} x ${p.name}`).join(', ');
      setFormData(prev => ({ ...prev, amount: total, productDetails: details }));
    }
  }, [formData.products]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.clientName || !formData.clientPhone) {
      alert("Le nom et le téléphone sont obligatoires.");
      return;
    }

    setSaving(true);
    try {
      const productsMAJ = (formData.products || [])?.map(p => ({
        name: p.name || '',
        prixUnitaire: Number(p.prixUnitaire || 0),
        quantity: Number(p.quantity || 1),
        sku: p.sku || null,
        ponctuel: Boolean(p.ponctuel)
      }));

      let finalProducts = [...productsMAJ];
      let finalProductDetails = productsMAJ?.map(p => `${p.quantity} x ${p.name}`).join(', ') || formData.productDetails || '';
      let finalProductId = productsMAJ.length === 1 && !productsMAJ[0].ponctuel 
          ? productsMAJ[0].sku 
          : (productsMAJ.length > 0 
              ? null 
              : (formData.productDetails !== order?.productDetails ? null : (formData.productId || null)));

      // Auto-match and convert if no structured products exist and we have text details
      if (finalProducts.length === 0 && finalProductDetails) {
         if (formData.productDetails !== order?.productDetails || !finalProductId) {
             const lines = finalProductDetails.split('\n').filter(l => l.trim() !== '');
             const matchedProducts = [];

             for (const line of lines) {
                 const { quantity, productName } = parseProductCommand(line);
                 const match = trouverProduitShopify(productName, products);
                 if (match) {
                     matchedProducts.push({
                         name: match.title,
                         prixUnitaire: match.sellingPrice || 0,
                         quantity: quantity,
                         sku: match.id,
                         ponctuel: false
                     });
                 } else {
                     matchedProducts.push({
                         name: productName || line,
                         prixUnitaire: 0,
                         quantity: quantity,
                         sku: null,
                         ponctuel: true
                     });
                 }
             }

             if (matchedProducts.length > 0) {
                 finalProducts = matchedProducts;
                 finalProductDetails = matchedProducts?.map(p => `${p.quantity} x ${p.name}`).join(', ');
                 finalProductId = matchedProducts.length === 1 && !matchedProducts[0].ponctuel ? matchedProducts[0].sku : null;
             }
         }
      }

      const montantTotal = finalProducts.reduce((acc, p) => acc + (p.prixUnitaire * p.quantity), 0);

      const orderToSave: Order = {
        ...formData,
        id: order?.id || `#CW${Math.floor(Math.random() * 90000) + 10000}`,
        date: formData.date || new Date().toISOString(),
        clientName: formData.clientName || '',
        address: formData.address || '',
        amount: finalProducts.length > 0 ? montantTotal : (formData.amount || 0),
        status: formData.status || 'validé',
        products: finalProducts,
        productDetails: finalProductDetails,
        productId: finalProductId,
      } as Order;

      // Strip undefined values to prevent Firestore errors
      Object.keys(orderToSave).forEach(key => {
        if (orderToSave[key as keyof Order] === undefined) {
          delete orderToSave[key as keyof Order];
        }
      });

      if ((orderToSave.status === 'livré' || orderToSave.status === 'terminé') && order?.status !== 'livré' && order?.status !== 'terminé' && !orderToSave.deliveredAt) {
          orderToSave.deliveredAt = new Date().toISOString();
      }

      await onSave(orderToSave);
      onClose();
    } catch (error) {
      console.error("Error saving order:", error);
      alert("Erreur lors de la sauvegarde.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const availableDrivers = drivers.filter(d => d.status === 'disponible');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">
            {order ? 'Modifier Commande' : 'Nouvelle Commande'}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1">
          <form id="order-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom Client *</label>
                <input required type="text" className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})} />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone *</label>
                <input required type="text" className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.clientPhone} onChange={e => setFormData({...formData, clientPhone: e.target.value})} />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Date de Commande</label>
                <input 
                  type="datetime-local" 
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.date ? format(parseISO(formData.date), "yyyy-MM-dd'T'HH:mm") : ''} 
                  onChange={e => {
                    if (e.target.value) {
                      setFormData({...formData, date: new Date(e.target.value).toISOString()});
                    }
                  }} 
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Date Programmée / Reportée</label>
                <input 
                  type="datetime-local" 
                  className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.scheduledAt ? format(parseISO(formData.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ''} 
                  onChange={e => {
                    if (e.target.value) {
                      setFormData({...formData, scheduledAt: new Date(e.target.value).toISOString()});
                    } else {
                      setFormData({...formData, scheduledAt: undefined});
                    }
                  }} 
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse / Quartier</label>
                <input type="text" className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1 font-bold text-orange-600">Remarques (Import Excel)</label>
                <textarea 
                  className="w-full border rounded-lg px-3 py-2 text-sm h-20 resize-none bg-orange-50/30 focus:ring-2 focus:ring-orange-500 outline-none" 
                  value={formData.remarks || ''} 
                  onChange={e => setFormData({...formData, remarks: e.target.value})}
                  placeholder="Remarques éventuelles importées depuis Excel..."
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Zone</label>
                <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.zoneId || ''} onChange={e => setFormData({...formData, zoneId: e.target.value})}>
                  <option value="">Sélectionner une zone</option>
                  {zones?.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Livreur</label>
                <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.driverId || ''} onChange={e => setFormData({...formData, driverId: e.target.value})}>
                  <option value="">Sélectionner un livreur</option>
                  {availableDrivers?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.status} onChange={e => setFormData({...formData, status: e.target.value as any})}>
                  <option value="validé">Validé</option>
                  <option value="attribué">Attribué</option>
                  <option value="en_cours">En cours</option>
                  <option value="livré">Livré</option>
                  <option value="annulé">Annulé</option>
                  <option value="reporté">Reporté</option>
                  <option value="injoignable">Injoignable</option>
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Mode de paiement</label>
                <select className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={formData.modePaiement || 'Espèces'} onChange={e => setFormData({...formData, modePaiement: e.target.value as any})}>
                  <option value="Espèces">💵 Espèces</option>
                  <option value="Wave">〰️ Wave</option>
                  <option value="OM">〰️ OM</option>
                </select>
              </div>
              {(formData.status === 'livré' || formData.status === 'terminé') && (
                <div className="sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date de Livraison</label>
                  <input 
                    type="datetime-local" 
                    className="w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                    value={formData.deliveredAt ? format(parseISO(formData.deliveredAt), "yyyy-MM-dd'T'HH:mm") : ''} 
                    onChange={e => {
                      if (e.target.value) {
                        setFormData({...formData, deliveredAt: new Date(e.target.value).toISOString()});
                      }
                    }} 
                  />
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-medium text-gray-900">Produits</h4>
                <button type="button" onClick={handleAddProduct} className="text-sm bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg flex items-center hover:bg-blue-100">
                  <Plus size={16} className="mr-1" /> Ajouter un produit
                </button>
              </div>
              
              <div className="space-y-4">
                {formData.products?.map((p, i) => (
                  <div key={i} className="p-4 border rounded-lg bg-gray-50 relative">
                    <button type="button" onClick={() => handleRemoveProduct(i)} className="absolute top-2 right-2 text-red-500 hover:bg-red-50 p-1 rounded">
                      <Trash2 size={16} />
                    </button>
                    
                    <div className="mb-3 flex gap-4">
                      <label className="flex items-center text-sm">
                        <input type="radio" name={`type-${i}`} checked={!p.ponctuel} onChange={() => handleProductChange(i, 'ponctuel', false)} className="mr-2" />
                        Produit Shopify
                      </label>
                      <label className="flex items-center text-sm">
                        <input type="radio" name={`type-${i}`} checked={p.ponctuel} onChange={() => handleProductChange(i, 'ponctuel', true)} className="mr-2" />
                        Produit ponctuel
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {!p.ponctuel ? (
                        <div className="md:col-span-2">
                          <label className="block text-xs text-gray-500 mb-1">Produit</label>
                          <select className="w-full border rounded px-2 py-1.5 text-sm" value={p.sku || ''} onChange={e => handleProductChange(i, 'sku', e.target.value)}>
                            <option value="">Sélectionner un produit</option>
                            {products.filter(pr => pr.status === 'active' || pr.status === 'actif')?.map(pr => (
                              <option key={pr.id} value={pr.id}>{pr.title}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="md:col-span-2">
                          <label className="block text-xs text-gray-500 mb-1">Nom du produit</label>
                          <input type="text" className="w-full border rounded px-2 py-1.5 text-sm" value={p.name} onChange={e => handleProductChange(i, 'name', e.target.value)} placeholder="Ex: Câble USB" />
                        </div>
                      )}
                      
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Prix Unitaire (CFA)</label>
                        <input type="number" className="w-full border rounded px-2 py-1.5 text-sm" value={p.prixUnitaire || 0} onChange={e => handleProductChange(i, 'prixUnitaire', Number(e.target.value))} />
                      </div>
                      
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Quantité</label>
                        <input type="number" min="1" className="w-full border rounded px-2 py-1.5 text-sm" value={p.quantity || 1} onChange={e => handleProductChange(i, 'quantity', Number(e.target.value))} />
                      </div>
                    </div>
                  </div>
                ))}
                {(!formData.products || formData.products.length === 0) && (
                  <div className="space-y-4">
                    <div className="text-center py-4 text-gray-500 text-sm border border-dashed rounded-lg">
                      Aucun produit structuré ajouté. <br />
                      <span className="text-xs text-gray-400">(Vous pouvez ajouter des produits ci-dessus ou utiliser les champs libres ci-dessous)</span>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Détails Produit (Texte libre)</label>
                      <input type="text" className="w-full border rounded-lg px-3 py-2" 
                        value={formData.productDetails || ''} onChange={e => setFormData({...formData, productDetails: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Montant Total (CFA)</label>
                      <input type="number" className="w-full border rounded-lg px-3 py-2" 
                        value={formData.amount || 0} onChange={e => setFormData({...formData, amount: Number(e.target.value)})} />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Remarque (Import / Client)</label>
                  <textarea className="w-full border rounded-lg px-3 py-2 text-sm h-16 resize-none" 
                    value={formData.remarks || ''} onChange={e => setFormData({...formData, remarks: e.target.value})} 
                    placeholder="Remarque originale importée ou note client..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 font-bold text-blue-600">Note d'Attribution</label>
                  <textarea className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm h-16 resize-none bg-blue-50/30" 
                    value={formData.assignmentRemarks || ''} onChange={e => setFormData({...formData, assignmentRemarks: e.target.value})} 
                    placeholder="Note interne pour le livreur..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 font-bold text-indigo-600">Note d'Expédition (Région)</label>
                  <textarea className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm h-16 resize-none bg-indigo-50/30" 
                    value={formData.shippingRemarks || ''} onChange={e => setFormData({...formData, shippingRemarks: e.target.value})} 
                    placeholder="Note pour Delta Transport..." />
                </div>
              </div>
            </div>

            {formData.products && formData.products.length > 0 && (
              <div className="border-t pt-4">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-700">Montant Total (Calculé):</span>
                  <span className="text-xl font-bold text-green-600">{formatNumber(formData.amount || 0)} CFA</span>
                </div>
              </div>
            )}
          </form>
        </div>
        
        <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">
            Annuler
          </button>
          <button type="submit" form="order-form" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center">
            {saving ? 'Enregistrement...' : (order ? 'Mettre à jour' : 'Créer la commande')}
          </button>
        </div>
      </div>
    </div>
  );
};
