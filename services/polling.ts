/**
 * Abonnement par polling (remplace Firebase onSnapshot côté nouvelle app).
 * Rafraîchit aussi au retour sur l'onglet (focus / visibility).
 */
export function createPollingSubscription<T>(
  fetchData: () => Promise<T>,
  callback: (data: T) => void,
  intervalMs: number
): () => void {
  let isMounted = true;
  let isFetching = false;

  const tick = async () => {
    if (!isMounted || isFetching) return;
    isFetching = true;
    try {
      const data = await fetchData();
      if (isMounted && data !== undefined && data !== null) {
        callback(data);
      }
    } catch (e) {
      console.error('[Polling] Erreur réseau:', e);
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
