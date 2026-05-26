/**
 * Abonnement par polling (remplace Firebase onSnapshot côté nouvelle app).
 * Rafraîchit aussi au retour sur l'onglet (focus / visibility).
 */
export function createPollingSubscription<T>(
  fetchData: () => Promise<T>,
  callback: (data: T) => void,
  intervalMs: number,
  label = 'data'
): () => void {
  let isMounted = true;
  let isFetching = false;
  let lastErrorLogged = 0;

  const tick = async () => {
    if (!isMounted || isFetching) return;
    if (!localStorage.getItem('jwt_token')) {
      const now = Date.now();
      if (now - lastErrorLogged > 15000) {
        console.warn(`[Polling:${label}] Pas de JWT — déconnectez-vous et reconnectez-vous.`);
        lastErrorLogged = now;
      }
      return;
    }
    isFetching = true;
    try {
      const data = await fetchData();
      if (isMounted && data !== undefined && data !== null) {
        callback(data);
      }
    } catch (e) {
      const now = Date.now();
      if (now - lastErrorLogged > 5000) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[Polling:${label}]`, msg);
        lastErrorLogged = now;
      }
    } finally {
      isFetching = false;
    }
  };

  tick();

  const intervalId = setInterval(tick, intervalMs);

  const onVisibility = () => {
    if (document.visibilityState === 'visible') tick();
  };
  const onFocus = () => tick();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);

  return () => {
    isMounted = false;
    clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
  };
};
