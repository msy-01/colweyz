/** Bascule Firestore ↔ API PostgreSQL (secours quotas Firebase). */

export type ConnectionMode = 'firestore' | 'api';

let mode: ConnectionMode;
let lastSwitchReason: string | null = null;

/** true = démarrer en API si VITE_API_URL défini (secours prêt avant panne). */
function initialMode(): ConnectionMode {
  const url = import.meta.env.VITE_API_URL?.trim();
  const forceApi = import.meta.env.VITE_FORCE_API_MODE === 'true';
  if (forceApi && url) return 'api';
  if (url) return 'firestore'; // Firestore d'abord, bascule auto si erreur
  return 'firestore';
}

mode = initialMode();

export function getConnectionMode(): ConnectionMode {
  return mode;
}

export function getConnectionModeLabel(): string {
  return mode === 'api' ? 'PostgreSQL (secours)' : 'Firestore';
}

export function getLastSwitchReason(): string | null {
  return lastSwitchReason;
}

export function setConnectionMode(next: ConnectionMode, reason?: string): void {
  if (mode === next) return;
  mode = next;
  lastSwitchReason = reason ?? null;
  window.dispatchEvent(
    new CustomEvent('colweyz-connection-mode', { detail: { mode, reason } })
  );
}

export function subscribeConnectionMode(
  listener: (detail: { mode: ConnectionMode; reason: string | null }) => void
): () => void {
  const handler = (e: Event) => {
    const ce = e as CustomEvent<{ mode: ConnectionMode; reason: string | null }>;
    listener(ce.detail);
  };
  window.addEventListener('colweyz-connection-mode', handler);
  return () => window.removeEventListener('colweyz-connection-mode', handler);
}

/** API secours utilisable (proxy Netlify `/api` ou URL VPS explicite). */
export function isApiSecoursAvailable(): boolean {
  // BASE_PATH = `${VITE_API_URL}/api` → '' donne `/api` (même origine, proxy Netlify)
  if (typeof window !== 'undefined') return true;
  return Boolean(import.meta.env.VITE_API_URL?.trim());
}

export function isFirestoreUnavailableError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const code = (error as { code?: string })?.code?.toLowerCase() ?? '';
  return (
    /resource-exhausted|quota|unavailable|deadline-exceeded|permission-denied|network|failed-precondition/.test(
      msg
    ) ||
    /resource-exhausted|unavailable|deadline-exceeded|permission-denied/.test(code) ||
    msg.includes('quota') ||
    msg.includes('firebase')
  );
}
