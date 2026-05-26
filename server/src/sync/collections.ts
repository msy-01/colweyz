/**
 * Collections Firestore écoutées par le sync worker.
 * Clé = nom de la collection Firestore (ou alias logique).
 */
export const collectionsContext = {
  priorities: {
    orders: 0,
    stock_operations: 0,
    stockLivreurs: 0,
    drivers: 1,
    fund_requests: 1,
    financial_configs: 1,
    products: 2,
    purchase_orders: 2,
    zones: 2,
    users: 2,
    daily_entries: 3,
    daily_finance: 3,
    accounting_entries: 3,
    settings: 3,
    config: 3,
    claude_analysis: 3,
  } as Record<string, number>,

  /** true = utiliser collectionGroup('configs') au lieu de collection(name). */
  usesCollectionGroup(name: string): boolean {
    return name === 'financial_configs';
  },

  /** Nom de collection Firestore réel. */
  firestoreCollectionName(name: string): string {
    if (name === 'financial_configs') return 'configs';
    return name;
  },
};
