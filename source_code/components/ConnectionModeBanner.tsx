import React, { useEffect, useState } from 'react';
import { Database, Cloud, RefreshCw } from 'lucide-react';
import {
  getConnectionMode,
  getConnectionModeLabel,
  subscribeConnectionMode,
  forceApiFallback,
  forceFirestoreMode,
} from '../services/dataService';
import { isPgOnlyDeployment } from '../services/connectionMode';
import { getApiBasePath } from '../services/api';

export const ConnectionModeBanner: React.FC = () => {
  const [mode, setMode] = useState(getConnectionMode());

  useEffect(() => {
    return subscribeConnectionMode(({ mode: m }) => setMode(m));
  }, []);

  const isApi = mode === 'api';

  /** colweyz.ddns.net : uniquement PostgreSQL (alimenté par sync Firestore → PG). */
  if (isPgOnlyDeployment()) {
    return (
      <div className="px-4 py-2 text-sm flex flex-wrap items-center justify-center gap-2 border-b bg-slate-50 text-slate-700 border-slate-200">
        <Database size={16} />
        <span>
          Données : <strong>PostgreSQL</strong>
          <span className="text-xs text-slate-500 ml-1">
            (miroir synchronisé depuis Firestore)
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={`px-4 py-2 text-sm flex flex-wrap items-center justify-center gap-3 border-b ${
        isApi
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : 'bg-green-50 text-green-800 border-green-100'
      }`}
    >
      {isApi ? <Database size={16} /> : <Cloud size={16} />}
      <span>
        Données : <strong>{getConnectionModeLabel()}</strong>
        {isApi && ' — Firebase indisponible ou quotas dépassés'}
      </span>
      {isApi && (
        <span className="text-xs font-medium text-amber-800">
          API : {getApiBasePath()}
          {!localStorage.getItem('jwt_token') && ' — reconnectez-vous (JWT requis)'}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          if (isApi) {
            forceFirestoreMode();
            return;
          }
          if (!localStorage.getItem('jwt_token')) {
            const ok = window.confirm(
              'Mode secours PostgreSQL : il faut un token API.\n\nDéconnectez-vous puis reconnectez-vous (mot de passe base PG, ex. admin).\n\nContinuer quand même ?'
            );
            if (!ok) return;
          }
          forceApiFallback('Manuel');
        }}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-current/30 hover:bg-white/60 text-xs font-medium"
      >
        <RefreshCw size={12} />
        {isApi ? 'Réessayer Firestore' : 'Mode secours PG'}
      </button>
    </div>
  );
};
