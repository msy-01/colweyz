import { api } from './api';
import { Driver, SystemUser } from '../types';

interface LoginResponse {
  token: string;
  role: 'driver' | 'admin' | 'super_admin' | 'staff';
  user: any;
}

export const authService = {
  /**
   * Tente une connexion (admin ou driver) via l'API.
   * En cas de succès, le token est stocké dans le localStorage.
   */
  async login(username: string, password: string, mode: 'admin' | 'driver'): Promise<LoginResponse> {
    const res = await api.post<LoginResponse>('/auth/login', { username, password, mode });
    if (res.token) {
      localStorage.setItem('jwt_token', res.token);
      localStorage.setItem('user_role', res.role);
    }
    return res;
  },

  /**
   * Vérifie le token actuel et renvoie le profil complet (pour le rechargement de page).
   */
  async me(): Promise<{ role: string; user: Driver | SystemUser } | null> {
    const token = localStorage.getItem('jwt_token');
    if (!token) return null;

    try {
      const res = await api.get<{ role: string; user: Driver | SystemUser }>('/auth/me');
      return res;
    } catch (e) {
      // 401 sera géré par api.ts qui videra le localstorage
      return null;
    }
  },

  /**
   * Déconnexion complète côté client.
   */
  logout() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_role');
    // Facultatif : faire un reset d'état React ou forcer un reload
    window.location.href = '/';
  },

  /**
   * Utilisé pour la migration du dev "Accès Rapide" si jamais il faut passer outre les mots de passe.
   * L'API ne permet pas de se connecter sans mot de passe, mais si vous utilisez un super mot de passe, on le passe ici.
   */
  async quickLoginDev(username: string, mode: 'admin' | 'driver', defaultPassword = '123') {
    const enabled =
      import.meta.env.DEV ||
      import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true';
    if (!enabled) {
      throw new Error('Accès rapide désactivé');
    }
    return this.login(username, defaultPassword, mode);
  }
};
