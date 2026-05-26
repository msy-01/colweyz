import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Shield, Lock, Save, X, CheckSquare, Square, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SystemUser } from '../types';
import { DataService } from '../services/dataService';

const AVAILABLE_PAGES = [
    { path: '/', label: 'Dashboard' },
    { path: '/orders', label: 'Commandes' },
    { path: '/drivers', label: 'Livreurs' },
    { path: '/zones', label: 'Zones' },
    { path: '/balances', label: 'Balances' }
];

export const Users: React.FC = () => {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<SystemUser>>({});
  const navigate = useNavigate();
  
  // Delete confirmation state (2-step)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const data = await DataService.getUsers();
    setUsers(data);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser.username || !editingUser.password) return;

    const newUser: SystemUser = {
      id: editingUser.id || `usr-${Date.now()}`,
      username: editingUser.username,
      password: editingUser.password,
      role: editingUser.role || 'staff',
      permissions: editingUser.role === 'super_admin' 
        ? AVAILABLE_PAGES?.map(p => p.path).concat(['/users']) 
        : (editingUser.permissions || [])
    };

    await DataService.saveUser(newUser);
    setIsModalOpen(false);
    setEditingUser({});
    loadUsers();
  };

  const handleDeleteClick = async (id: string) => {
    if (deleteConfirmId === id) {
        // Confirm delete
        if(id === 'admin1') {
            alert("Impossible de supprimer le super admin principal.");
            setDeleteConfirmId(null);
            return;
        }
        setUsers(prev => prev.filter(u => u.id !== id));
        await DataService.deleteUser(id);
        setDeleteConfirmId(null);
    } else {
        // Request confirm
        setDeleteConfirmId(id);
        setTimeout(() => setDeleteConfirmId(null), 3000);
    }
  };

  const togglePermission = (path: string) => {
      const current = editingUser.permissions || [];
      if (current.includes(path)) {
          setEditingUser({ ...editingUser, permissions: current.filter(p => p !== path) });
      } else {
          setEditingUser({ ...editingUser, permissions: [...current, path] });
      }
  };

  const openModal = (user?: SystemUser) => {
    setDeleteConfirmId(null);
    setEditingUser(user || { role: 'staff', permissions: ['/'] });
    setIsModalOpen(true);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Gestion des Utilisateurs</h2>
        <button 
          onClick={() => openModal()}
          className="bg-green-700 text-white px-4 py-2 rounded-lg hover:bg-green-800 flex items-center shadow-sm"
        >
          <Plus size={20} className="mr-2" />
          Nouvel Utilisateur
        </button>
      </div>

      {/* Driver Access Callout */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex justify-between items-center">
        <div className="flex items-center">
            <div className="bg-blue-100 p-2 rounded-lg mr-3 text-blue-600">
                <Truck size={20} />
            </div>
            <div>
                <h3 className="font-bold text-blue-800 text-sm">Besoin de créer un accès livreur ?</h3>
                <p className="text-xs text-blue-600">Les comptes et mots de passe des livreurs sont gérés directement dans la section "Livreurs".</p>
            </div>
        </div>
        <button 
            onClick={() => navigate('/drivers')}
            className="bg-white text-blue-700 px-4 py-2 rounded-lg font-bold text-xs shadow-sm border border-blue-200 hover:bg-blue-50 transition-colors"
        >
            Gérer les Livreurs
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {users?.map(user => {
            const isConfirming = deleteConfirmId === user.id;
            return (
            <div key={user.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 relative group">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center space-x-3">
                        <div className={`p-3 rounded-lg ${user.role === 'super_admin' ? 'bg-purple-100 text-purple-600' : 'bg-blue-50 text-blue-600'}`}>
                            {user.role === 'super_admin' ? <Shield size={24} /> : <Lock size={24} />}
                        </div>
                        <div>
                            <h3 className="font-bold text-gray-800">{user.username}</h3>
                            <span className="text-xs text-gray-500 uppercase font-semibold">
                                {user.role === 'super_admin' ? 'Super Admin' : 'Staff'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="mb-4">
                    <p className="text-xs font-semibold text-gray-400 mb-2 uppercase">Accès autorisé :</p>
                    <div className="flex flex-wrap gap-2">
                        {user.role === 'super_admin' ? (
                            <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-md font-medium">Accès complet</span>
                        ) : (
                            user.permissions.length > 0 ? (
                                user.permissions?.map(perm => {
                                    const pageName = AVAILABLE_PAGES.find(p => p.path === perm)?.label || perm;
                                    return (
                                        <span key={perm} className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-md border border-gray-200">
                                            {pageName}
                                        </span>
                                    )
                                })
                            ) : (
                                <span className="text-red-400 text-xs italic">Aucun accès</span>
                            )
                        )}
                    </div>
                </div>

                <div className="pt-4 border-t border-gray-50 flex justify-end space-x-2">
                    <button 
                        onClick={() => openModal(user)}
                        className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    >
                        <Edit2 size={18} />
                    </button>
                    {user.id !== 'admin1' && (
                        <button 
                            onClick={() => handleDeleteClick(user.id)}
                            className={`flex items-center justify-center transition-all duration-200 rounded-lg cursor-pointer
                                ${isConfirming 
                                    ? 'bg-red-600 text-white px-3 py-1 text-xs font-bold' 
                                    : 'p-2 text-gray-400 hover:text-red-600 hover:bg-red-50'
                                }
                            `}
                        >
                            {isConfirming ? "Confirmer ?" : <Trash2 size={18} />}
                        </button>
                    )}
                </div>
            </div>
        )})}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold">
                {editingUser.id ? 'Modifier' : 'Créer'} Utilisateur
              </h3>
              <button onClick={() => setIsModalOpen(false)}><X size={24} className="text-gray-400" /></button>
            </div>
            
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom d'utilisateur</label>
                <input 
                  type="text" 
                  className="w-full border rounded-lg px-3 py-2 focus:ring-green-500"
                  value={editingUser.username || ''}
                  onChange={e => setEditingUser({...editingUser, username: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
                <input 
                  type="text" 
                  className="w-full border rounded-lg px-3 py-2 focus:ring-green-500 font-mono"
                  value={editingUser.password || ''}
                  onChange={e => setEditingUser({...editingUser, password: e.target.value})}
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rôle</label>
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <button
                        type="button"
                        onClick={() => setEditingUser({...editingUser, role: 'staff'})}
                        className={`py-2 px-3 rounded-lg border text-sm font-medium flex items-center justify-center ${editingUser.role === 'staff' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}
                    >
                        <Lock size={16} className="mr-2" /> Staff
                    </button>
                    <button
                        type="button"
                        onClick={() => setEditingUser({...editingUser, role: 'super_admin'})}
                        className={`py-2 px-3 rounded-lg border text-sm font-medium flex items-center justify-center ${editingUser.role === 'super_admin' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-white border-gray-200 text-gray-600'}`}
                    >
                        <Shield size={16} className="mr-2" /> Super Admin
                    </button>
                </div>
              </div>

              {editingUser.role !== 'super_admin' && (
                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                      <p className="text-xs font-bold text-gray-500 uppercase mb-3">Permissions d'accès</p>
                      <div className="space-y-2">
                          {AVAILABLE_PAGES?.map(page => {
                              const isChecked = editingUser.permissions?.includes(page.path);
                              return (
                                  <div key={page.path} 
                                       onClick={() => togglePermission(page.path)}
                                       className="flex items-center cursor-pointer hover:bg-white p-1 rounded transition-colors"
                                  >
                                      {isChecked ? <CheckSquare size={18} className="text-green-600 mr-2" /> : <Square size={18} className="text-gray-400 mr-2" />}
                                      <span className={`text-sm ${isChecked ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{page.label}</span>
                                  </div>
                              )
                          })}
                      </div>
                  </div>
              )}
              
              <button 
                type="submit"
                className="w-full bg-green-700 text-white py-2.5 rounded-lg font-medium hover:bg-green-800 flex justify-center items-center mt-6"
              >
                <Save size={18} className="mr-2" />
                Enregistrer le profil
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};