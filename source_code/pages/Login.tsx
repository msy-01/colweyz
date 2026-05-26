import React, { useState } from 'react';
import { Truck, Shield } from 'lucide-react';
import {
  DataService,
  getConnectionMode,
  forceApiFallback,
} from '../services/dataService';
import { authService } from '../services/authService';
import { Driver, SystemUser } from '../types';
import { Logo } from '../components/Logo';
import { INITIAL_DRIVERS, INITIAL_USERS } from '../services/mockData';
import { auth } from '../firebase';
import { signInAnonymously } from 'firebase/auth';
import { isFirestoreUnavailableError, isApiSecoursAvailable } from '../services/connectionMode';

interface LoginProps {
  onLogin: (role: 'admin' | 'driver', data?: Driver | SystemUser) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [mode, setMode] = useState<'admin' | 'driver'>('driver');
  const [identifiant, setIdentifiant] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {

    e.preventDefault();
    attemptLogin();
  };

  const loginViaApi = async () => {
    const res = await authService.login(identifiant, password, mode);
    const role = res.role === 'super_admin' || res.role === 'staff' ? 'admin' : 'driver';
    onLogin(role, res.user);
  };

  /** JWT pour le mode secours PG (Firestore ne le fournit pas). */
  const primeApiJwt = async (): Promise<boolean> => {
    try {
      await authService.login(identifiant, password, mode);
      return Boolean(localStorage.getItem('jwt_token'));
    } catch (e) {
      console.warn('[ColWeyz] Token API secours non obtenu:', e);
      return false;
    }
  };

  const attemptLoginFirestore = async () => {
    try {
      await signInAnonymously(auth);
    } catch (authErr: unknown) {
      console.warn('Anonymous auth failed:', authErr);
    }

    if (mode === 'admin') {
      const users = await DataService.getUsers().catch(() => INITIAL_USERS);
      const user = users.find((u) => u.username === identifiant && u.password === password);
      if (user) {
        const hasJwt = await primeApiJwt();
        if (!hasJwt) {
          console.warn(
            '[ColWeyz] Connexion Firestore OK mais API PG refusée — en mode secours, utilisez le mot de passe PostgreSQL (ex. admin).'
          );
        }
        onLogin('admin', user);
        return;
      }
      setError('Identifiant ou mot de passe incorrect');
      return;
    }

    const drivers = await DataService.getDrivers().catch(() => INITIAL_DRIVERS);
    const driver = drivers.find((d) => d.phone === identifiant || d.username === identifiant);
    if (driver) {
      if (driver.password && driver.password !== password) {
        setError('Mot de passe incorrect');
      } else {
        await primeApiJwt();
        onLogin('driver', driver);
      }
      return;
    }
    setError('Identifiant introuvable.');
  };

  const attemptLogin = async () => {
    setError('');

    if (getConnectionMode() === 'api') {
      try {
        await loginViaApi();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erreur de connexion API');
      }
      return;
    }

    try {
      await attemptLoginFirestore();
    } catch (err: unknown) {
      if (isFirestoreUnavailableError(err) && import.meta.env.VITE_API_URL) {
        forceApiFallback(err instanceof Error ? err.message : String(err));
        try {
          await loginViaApi();
          return;
        } catch (apiErr: unknown) {
          setError(apiErr instanceof Error ? apiErr.message : 'Erreur API');
          return;
        }
      }
      console.error('Login error:', err);
      setError('Erreur de connexion. Veuillez réessayer.');
    }
  };

  const quickLogin = async (role: 'admin' | 'driver', id: string, pass?: string) => {
    setMode(role);
    setIdentifiant(id);
    setPassword(pass || '');

    if (getConnectionMode() === 'api' && isApiSecoursAvailable()) {
      try {
        const res = await authService.login(id, pass || '123', role);
        const loginRole = res.role === 'super_admin' || res.role === 'staff' ? 'admin' : 'driver';
        onLogin(loginRole, res.user);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Connexion rapide API échouée');
      }
      return;
    }

    await new Promise((r) => setTimeout(r, 100));
    await attemptLogin();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      
      <div className="mb-8 origin-center scale-150">
        <Logo variant="color" />
      </div>

      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border-b-4 border-yellow-400">
        <div className="bg-green-50 p-4 flex justify-center space-x-4 border-b border-green-100">
          <button 
            onClick={() => { setMode('driver'); setIdentifiant(''); setPassword(''); setError(''); }}
            className={`flex items-center px-4 py-2 rounded-lg transition-colors ${mode === 'driver' ? 'bg-white shadow text-green-700 font-bold border border-green-100' : 'text-gray-500 hover:bg-green-100/50'}`}
          >
            <Truck size={18} className="mr-2" />
            Livreur
          </button>
          <button 
            onClick={() => { setMode('admin'); setIdentifiant(''); setPassword(''); setError(''); }}
             className={`flex items-center px-4 py-2 rounded-lg transition-colors ${mode === 'admin' ? 'bg-white shadow text-green-700 font-bold border border-green-100' : 'text-gray-500 hover:bg-green-100/50'}`}
          >
            <Shield size={18} className="mr-2" />
            Admin
          </button>
        </div>

        <div className="p-8">
          <div className="text-center mb-8">
             <h2 className="text-2xl font-bold text-gray-800">
                {mode === 'driver' ? 'Connexion Livreur' : 'Espace Administration'}
             </h2>
             <p className="text-gray-500 text-sm mt-1">
               {mode === 'driver' ? 'Entrez vos identifiants de connexion' : 'Identifiez-vous pour gérer le système'}
             </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {mode === 'driver' ? 'Identifiant ou Téléphone' : 'Nom d\'utilisateur'}
              </label>
              <input 
                type="text" 
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all bg-white text-gray-900"
                placeholder={mode === 'driver' ? 'Ex: 770000001 ou mamadou' : 'admin'}
                value={identifiant}
                onChange={(e) => setIdentifiant(e.target.value)}
              />
            </div>

            <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
                Mot de passe
            </label>
            <input 
                type="password" 
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all bg-white text-gray-900"
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'driver' && (
                <p className="text-xs text-gray-400 mt-1 italic">
                    (Laisser vide si aucun mot de passe n'a été créé)
                </p>
            )}
            </div>

            {error && (
              <div className="text-red-600 text-sm bg-red-50 p-3 rounded-lg text-center font-medium border border-red-100">
                {error}
              </div>
            )}

            <button 
              type="submit"
              className="w-full bg-green-700 text-white py-3 rounded-xl font-bold text-lg hover:bg-green-800 transition-colors shadow-lg shadow-green-200 flex justify-center items-center gap-2"
            >
              <span>Se connecter</span>
              <span className="bg-yellow-400 h-2 w-2 rounded-full"></span>
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider text-center mb-4">Accès Rapide (Démo)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <button 
                    onClick={() => quickLogin('admin', 'admin', 'admin')}
                    className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-xl hover:bg-green-50 hover:border-green-200 transition-all group"
                >
                    <Shield size={20} className="text-gray-400 group-hover:text-green-600 mb-1" />
                    <span className="text-xs font-medium text-gray-600 group-hover:text-green-700">Admin</span>
                </button>
                <button 
                    onClick={() => quickLogin('driver', 'abdoulaye', '123')}
                    className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-xl hover:bg-green-50 hover:border-green-200 transition-all group"
                >
                    <Truck size={20} className="text-gray-400 group-hover:text-green-600 mb-1" />
                    <span className="text-xs font-medium text-gray-600 group-hover:text-green-700">Abdoulaye</span>
                </button>
                <button 
                    onClick={() => quickLogin('driver', 'lune', '123')}
                    className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-xl hover:bg-green-50 hover:border-green-200 transition-all group"
                >
                    <Truck size={20} className="text-gray-400 group-hover:text-green-600 mb-1" />
                    <span className="text-xs font-medium text-gray-600 group-hover:text-green-700">Lune</span>
                </button>
                <button 
                    onClick={() => quickLogin('driver', 'lahad', '123')}
                    className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-xl hover:bg-green-50 hover:border-green-200 transition-all group"
                >
                    <Truck size={20} className="text-gray-400 group-hover:text-green-600 mb-1" />
                    <span className="text-xs font-medium text-gray-600 group-hover:text-green-700">Lahad</span>
                </button>
                <button 
                    onClick={() => quickLogin('driver', 'mouhamed', '123')}
                    className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-xl hover:bg-green-50 hover:border-green-200 transition-all group"
                >
                    <Truck size={20} className="text-gray-400 group-hover:text-green-600 mb-1" />
                    <span className="text-xs font-medium text-gray-600 group-hover:text-green-700">Mouhamed</span>
                </button>
                <button 
                    onClick={() => quickLogin('driver', 'aliou', '123')}
                    className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-xl hover:bg-green-50 hover:border-green-200 transition-all group"
                >
                    <Truck size={20} className="text-gray-400 group-hover:text-green-600 mb-1" />
                    <span className="text-xs font-medium text-gray-600 group-hover:text-green-700">Aliou</span>
                </button>
                <button 
                    onClick={() => quickLogin('driver', 'cheikh', '123')}
                    className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-xl hover:bg-green-50 hover:border-green-200 transition-all group"
                >
                    <Truck size={20} className="text-gray-400 group-hover:text-green-600 mb-1" />
                    <span className="text-xs font-medium text-gray-600 group-hover:text-green-700">Cheikh</span>
                </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};