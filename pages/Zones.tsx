
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, MapPin, Edit2, Save, X, AlertTriangle, Globe } from 'lucide-react';
import { Zone, SystemUser, ZoneType } from '../types';
import { DataService } from '../services/dataService';
import { formatFCFA } from '../utils/formatters';

interface ZonesProps {
  currentUser?: SystemUser;
}

export const Zones: React.FC<ZonesProps> = ({ currentUser }) => {
  const [zones, setZones] = useState<Zone[]>([]);
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneRate, setNewZoneRate] = useState('');
  const [newZoneType, setNewZoneType] = useState<ZoneType>('local');
  
  // Edit State
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Delete Confirmation State
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    loadZones();
  }, []);

  const loadZones = async () => {
    const data = await DataService.getZones();
    setZones(data);
  };

  const handleSaveZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZoneName || !newZoneRate) return;

    const zoneToSave: Zone = {
      id: editingId || `zone-${Date.now()}`,
      name: newZoneName,
      rate: parseInt(newZoneRate),
      type: newZoneType
    };

    // Optimistic UI update for add/edit
    if (editingId) {
        setZones(prev => prev?.map(z => z.id === editingId ? zoneToSave : z));
    } else {
        setZones(prev => [...prev, zoneToSave]);
    }

    await DataService.saveZone(zoneToSave);
    
    // Reset form
    setNewZoneName('');
    setNewZoneRate('');
    setNewZoneType('local');
    setEditingId(null);
    loadZones();
  };

  const handleDeleteClick = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (deleteConfirmId === id) {
        // Second click: ACTUAL DELETE
        setZones(prev => prev.filter(z => z.id !== id)); // Optimistic remove
        try {
            await DataService.deleteZone(id);
            setDeleteConfirmId(null);
        } catch (error) {
            console.error("Error deleting zone", error);
            loadZones(); // Revert on error
        }
    } else {
        // First click: ASK CONFIRMATION
        setDeleteConfirmId(id);
        // Auto-reset confirmation after 3 seconds if not clicked
        setTimeout(() => setDeleteConfirmId(prev => prev === id ? null : prev), 3000);
    }
  };

  const handleEdit = (e: React.MouseEvent, zone: Zone) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteConfirmId(null); // Cancel any pending delete
    setEditingId(zone.id);
    setNewZoneName(zone.name);
    setNewZoneRate(zone.rate.toString());
    setNewZoneType(zone.type || 'local');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setNewZoneName('');
    setNewZoneRate('');
    setNewZoneType('local');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Gestion des Zones</h2>

      {currentUser?.role === 'super_admin' && (
        <div className={`p-6 rounded-xl shadow-sm border transition-colors ${editingId ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-100'}`}>
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-700">
                    {editingId ? 'Modifier la zone' : 'Ajouter une nouvelle zone'}
                </h3>
                {editingId && (
                    <button onClick={cancelEdit} type="button" className="text-sm text-gray-500 hover:text-gray-700 flex items-center">
                        <X size={16} className="mr-1"/> Annuler
                    </button>
                )}
            </div>
            <form onSubmit={handleSaveZone} className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom de la Zone</label>
                <input 
                type="text" 
                placeholder="Ex: Dakar Centre"
                className="w-full border rounded-lg px-3 py-2 focus:ring-green-500"
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                />
            </div>
             <div className="w-full md:w-40">
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de Zone</label>
                <select 
                    className="w-full border rounded-lg px-3 py-2 bg-white focus:ring-green-500"
                    value={newZoneType}
                    onChange={(e) => setNewZoneType(e.target.value as ZoneType)}
                >
                    <option value="local">Locale (Livreur)</option>
                    <option value="regional">Régionale (Delta)</option>
                </select>
            </div>
            <div className="w-full md:w-48">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    {newZoneType === 'local' ? 'Tarif Livreur' : 'Tarif Transport'}
                </label>
                <input 
                type="number" 
                placeholder="750"
                className="w-full border rounded-lg px-3 py-2 focus:ring-green-500"
                value={newZoneRate}
                onChange={(e) => setNewZoneRate(e.target.value)}
                />
            </div>
            <button 
                type="submit"
                className={`w-full md:w-auto px-6 py-2.5 rounded-lg font-medium text-white flex items-center justify-center shadow-sm ${editingId ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-700 hover:bg-green-800'}`}
            >
                {editingId ? <Save size={20} className="mr-2" /> : <Plus size={20} className="mr-2" />}
                {editingId ? 'Modifier' : 'Ajouter'}
            </button>
            </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-6 py-4">Nom de la zone</th>
              <th className="px-6 py-4">Type</th>
              <th className="px-6 py-4">Tarif</th>
              {currentUser?.role === 'super_admin' && <th className="px-6 py-4 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {zones?.map(zone => {
              const isConfirming = deleteConfirmId === zone.id;
              
              return (
              <tr key={zone.id} className={`hover:bg-gray-50 ${editingId === zone.id ? 'bg-yellow-50/50' : ''}`}>
                <td className="px-6 py-4">
                  <div className="flex items-center font-medium text-gray-900">
                    <MapPin size={16} className="text-gray-400 mr-2" />
                    {zone.name}
                  </div>
                </td>
                <td className="px-6 py-4">
                  {zone.type === 'regional' ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-blue-100 text-blue-700">
                          <Globe size={12} className="mr-1" /> Régional (Delta)
                      </span>
                  ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-gray-100 text-gray-600">
                          Local
                      </span>
                  )}
                </td>
                <td className="px-6 py-4 text-green-700 font-semibold">
                  {formatFCFA(zone.rate)}
                </td>
                {currentUser?.role === 'super_admin' && (
                    <td className="px-6 py-4 text-right flex justify-end gap-2 items-center">
                    <button 
                        type="button"
                        onClick={(e) => handleEdit(e, zone)}
                        className="text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 p-2 rounded-full transition-colors cursor-pointer"
                        title="Modifier"
                    >
                        <Edit2 size={16} />
                    </button>
                    
                    <button 
                        type="button"
                        onClick={(e) => handleDeleteClick(e, zone.id)}
                        className={`flex items-center justify-center transition-all duration-200 rounded-full cursor-pointer
                            ${isConfirming 
                                ? 'bg-red-600 text-white px-3 py-1.5 text-xs font-bold w-auto' 
                                : 'text-red-500 hover:text-red-700 hover:bg-red-50 p-2 w-10'
                            }
                        `}
                        title="Supprimer"
                    >
                        {isConfirming ? (
                            <>Confirmer ?</>
                        ) : (
                            <Trash2 size={16} />
                        )}
                    </button>
                    </td>
                )}
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  );
};
