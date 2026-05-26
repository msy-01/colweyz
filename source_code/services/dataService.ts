/**
 * DataService hybride : Firestore (normal) → API / PostgreSQL (secours quotas).
 */
import { FirestoreDataService } from './dataService.firestore';
import { ApiDataService } from './dataService.api';
import {
  getConnectionMode,
  setConnectionMode,
  isFirestoreUnavailableError,
} from './connectionMode';

export { auth, db } from './dataService.firestore';
export { DEPOT_ID } from './dataService.api';

type Service = typeof FirestoreDataService;

function activeService(): Service {
  return getConnectionMode() === 'api'
    ? (ApiDataService as unknown as Service)
    : FirestoreDataService;
}

function isSyncMethod(method: string): boolean {
  return (
    method.startsWith('subscribe') ||
    method === 'updateOrderDeliveredLocally' ||
    method === 'updateOrderStatusLocally' ||
    method === 'approveFundRequestLocally'
  );
}

function wrapMethod<K extends keyof Service>(method: K): Service[K] {
  const firestoreFn = FirestoreDataService[method];
  if (typeof firestoreFn !== 'function') {
    return firestoreFn;
  }

  const run = (...args: unknown[]) => {
    const apiFn = ApiDataService[method as keyof typeof ApiDataService];
    const fn = getConnectionMode() === 'api' ? apiFn : firestoreFn;
    if (typeof fn !== 'function') {
      throw new Error(
        `[ColWeyz] Mode ${getConnectionMode()} : « ${String(method)} » indisponible.`
      );
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
  };

  const fallback = (error: unknown, ...args: unknown[]) => {
    const apiFn = ApiDataService[method as keyof typeof ApiDataService];
    if (!isFirestoreUnavailableError(error) || typeof apiFn !== 'function') {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[ColWeyz] Firestore → API : ${String(method)} (${reason})`);
    setConnectionMode('api', reason);
    return (apiFn as (...a: unknown[]) => unknown)(...args);
  };

  if (isSyncMethod(String(method))) {
    return ((...args: unknown[]) => {
      let unsub: (() => void) | undefined;
      const attach = () => {
        unsub?.();
        try {
          unsub = run(...args) as () => void;
        } catch (error) {
          unsub = fallback(error, ...args) as () => void;
        }
      };
      attach();
      const onMode = () => attach();
      window.addEventListener('colweyz-connection-mode', onMode);
      return () => {
        window.removeEventListener('colweyz-connection-mode', onMode);
        unsub?.();
      };
    }) as Service[K];
  }

  return (async (...args: unknown[]) => {
    try {
      return await run(...args);
    } catch (error) {
      return fallback(error, ...args);
    }
  }) as Service[K];
}

export const DataService = new Proxy(FirestoreDataService, {
  get(_target, prop: string | symbol) {
    if (typeof prop !== 'string') return undefined;
    if (!(prop in FirestoreDataService)) {
      return ApiDataService[prop as keyof typeof ApiDataService];
    }
    const value = FirestoreDataService[prop as keyof Service];
    if (typeof value === 'function') {
      return wrapMethod(prop as keyof Service);
    }
    return value;
  },
}) as Service;

export function forceApiFallback(reason = 'Manuel') {
  setConnectionMode('api', reason);
}

export function forceFirestoreMode() {
  setConnectionMode('firestore', 'Manuel');
}

export {
  getConnectionMode,
  getConnectionModeLabel,
  subscribeConnectionMode,
} from './connectionMode';
