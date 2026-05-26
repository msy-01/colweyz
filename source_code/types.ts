
export type OrderStatus = 
  | 'validé' 
  | 'attribué' 
  | 'en_cours' 
  | 'livré' 
  | 'terminé' 
  | 'annulé' 
  | 'refusé' 
  | 'attente_paiement' 
  | 'injoignable' 
  | 'reporté' 
  | 'expedition_en_cours' // Expédié
  | 'expedition_livree'   // Livré (Région)
  | 'regional_en_attente' // En attente (Delta) - NOUVEAU
  | 'regional_contacte'   // Contacté
  | 'regional_prete'      // Prête
  | 'regional_relance'    // Relancé
  | 'regional_injoignable'// Injoignable
  | 'regional_injoignable_x2'
  | 'regional_injoignable_x3'
  | 'regional_reporte'    // Reporté
  | 'regional_annule';    // Annulé

export type ZoneType = 'local' | 'regional';

export interface Zone {
  id: string;
  name: string;
  rate: number; // Tarif course (pour livreur) OU Tarif transport (pour client régional)
  type: ZoneType; // 'local' (Dakar) ou 'regional' (Delta Transport)
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  initialBalance: number; // Solde initial (ex: dette ou avance)
  status: 'disponible' | 'occupé';
  uid?: string; // Firebase Auth UID
  username?: string; // Identifiant de connexion personnalisé
  password?: string; // Mot de passe
  stock?: Record<string, number>; // Map of ProductID -> Quantity
  gains?: number; // Total cumulative gains
  balance?: number; // Current balance
  color?: string; // Driver color code (hex)
}

export interface OrderLog {
  id: string;
  text: string;
  author: string;
  createdAt: string;
}

export interface Order {
  id: string;
  date: string; // ISO string
  updatedAt?: string; // ISO string for last modification
  clientName: string;
  clientPhone?: string; 
  address: string;
  productDetails?: string; 
  productId?: string; // ID of the matched Shopify product
  quantity?: number; // Added for backward compatibility/single product orders
  products?: { 
    name: string; 
    quantity: number;
    sku?: string | null;
    prixUnitaire?: number;
    ponctuel?: boolean;
  }[]; // New field for multi-product support
  amount: number; // Montant du produit (F CFA)
  deliveryCost?: number; // Frais de livraison (F CFA)
  status: OrderStatus;
  zoneId?: string | null;
  driverId?: string | null; 
  driverName?: string | null; // Nom du livreur attribué
  remuneration?: number | null; 
  assignedAt?: string | null;
  deliveredAt?: string | null;
  postponedAt?: string | null; 
  scheduledAt?: string | null; // Date de livraison programmée
  refusedBy?: string | null; 
  paymentMethod?: 'Espèces' | 'Wave' | 'OM' | 'cash' | 'wave' | 'om'; 
  modePaiement?: 'Espèces' | 'Wave' | 'OM' | 'Dépôt Expédition';
  cancelReason?: string | null;
  
  // Nouveaux champs pour Delta / Régions
  shippingFee?: number; // Frais de transport (payables à l'arrivée)
  isPrePaid?: boolean; // Deprecated but kept for backward compatibility
  regionalPaymentStatus?: 'unpaid' | 'requested' | 'paid'; // NOUVEAU: 3 états
  logs?: OrderLog[]; // Historique des remarques
  importedAt?: string; // Date d'importation sur l'application
  purchaseCost?: number; // Coût d'achat unitaire au moment de la validation (Snapshot)
  linkedOrderIds?: string[]; // IDs des commandes liées (ex: pour expédition groupée)
  isDepotDelivery?: boolean; // Indique s'il s'agit d'une livraison au dépôt Delta Transport
  sortieDepotLogged?: boolean; // Indique si la sortie de stock du dépôt a été enregistrée
  livraisonDepotConfirmee?: boolean; // Indique si la livraison au dépôt a été confirmée et le stock déduit
  remarks?: string; // Remarques importées depuis la fiche Excel (Colonne J)
  shippingRemarks?: string; // Remarques d'expédition pour les commandes région
  assignmentRemarks?: string; // Remarques d'attribution (prérémplies depuis Excel ou saisies manuellement)
}

export interface ProductImage {
  id: string;
  src: string;
  alt?: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  title: string;
  sku: string;
  price: number;
  inventoryQuantity: number;
  weight?: number;
  weightUnit?: string;
}

export interface StockInfo {
  si: number;
  entrees: number;
  sorties: number;
  sf: number;
  ajustementManuel?: number;
  motifDernierAjustement?: string;
  dateDernierAjustement?: string;
  ajustePar?: string;
}

export interface StockLivreurEntry {
  id?: string; // Optional Firestore ID
  livreurId: string;
  produitId: string;
  produitNom: string;
  SI: number;
  entrees: number;
  sorties: number;
  SF: number;
  ajustementManuel?: number;
  motifDernierAjustement?: string;
  dateDernierAjustement?: string;
  ajustePar?: string;
}

export interface Product {
  id: string; // Shopify ID or internal ID
  title: string;
  description?: string;
  vendor?: string;
  productType?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  variants: ProductVariant[];
  images: ProductImage[];
  status: 'active' | 'archived' | 'draft' | 'actif';
  totalInventory?: number; // Helper for display
  mainStock?: number; // Stock initial (Entrepôt principal)
  sellingPrice?: number; // Prix de vente (F CFA) - NOUVEAU
  purchasePrice?: number; // Prix d'achat (F CFA) - NOUVEAU
  source?: 'shopify' | 'ponctuel'; // NOUVEAU
  stockGlobal?: StockInfo;
  stockDepot?: StockInfo;
  stockLivreurs?: {
    [livreurId: string]: StockInfo;
  };
}

export interface DailyBalance {
  date: string;
  driverId: string;
  totalCollected: number; 
  totalRemuneration: number; 
  netBalance: number; 
}

export interface FundRequest {
  id: string;
  driverId: string;
  amount: number;
  type?: 'collect' | 'payout'; 
  status: 'pending' | 'paid_by_driver' | 'confirmed' | 'declined';
  createdAt: string;
  confirmedAt?: string;
  paymentMethod?: 'wave' | 'om' | 'cash'; 
}

export interface SystemUser {
  id: string;
  username: string;
  password?: string; 
  role: 'super_admin' | 'staff' | 'responsable'; 
  permissions: string[]; 
}

export interface AppSettings {
  adminPhone: string; 
  logoUrl?: string; 
  shopifyDomain?: string;
  shopifyAccessToken?: string;
  ignoredShopifyIds?: string[]; // NOUVEAU
}

export interface ProductFinancialConfig {
  productId: string;
  cau: number; // Prix de vente unitaire (F CFA)
  appro: number; // Coût d'achat unitaire (F CFA)
  dailyBudgetUsd: number; // Budget pub quotidien (USD)
  isCampaignActive?: boolean; // Campagne active ou non
  updatedAt: string; // Date de dernière modification
  dateEffet?: string; // Date d'entrée en vigueur (YYYY-MM-DD)
}

export interface DailyFinancialEntry {
  date: string; // YYYY-MM-DD
  exchangeRate: number; // Taux USD -> CFA
  entries: Record<string, { // Key: ProductID
      soldQty: number;
      spendUsd: number;
  }>;
  productOrder?: string[]; // Array of Product IDs in sorted order
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface StockOperation {
  id: string;
  date: string; // ISO string
  productId: string;
  productName: string;
  type: 'entree' | 'sortie' | 'vente' | 'retour' | 'si_ajustement' | 'transfert_global_to_driver' | 'transfert_driver_to_global' | 'transfert_global_to_depot' | 'transfert_depot_to_global' | 'transfert_driver_to_depot' | 'transfert_depot_to_driver' | 'transfert_driver_to_driver';
  quantity: number;
  livreurId?: string; // If applicable
  entiteType?: 'depot' | 'livreur' | 'global';
  entiteId?: string;
  source?: string;
  commandeId?: string;
  referenceId?: string; // PO ID or Order ID
  notes?: string;
  createdAt: string;
  annule?: boolean;
  annuleLe?: string;
  annuleMotif?: string;
}

export interface DailyFinanceData {
  date: string; // YYYY-MM-DD
  otherRevenues: { id: string; label: string; amount: number }[];
  otherExpenses: { id: string; label: string; amount: number }[];
}

export interface AdHocProduct {
  id: string;
  name: string;
  purchasePrice: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountingEntryLine {
  accountId: string;
  label: string;
  debit: number;
  credit: number;
}

export interface AccountingEntry {
  id: string;
  date: string; // YYYY-MM-DD
  pieceNumber: string;
  label: string;
  lines: AccountingEntryLine[];
  isManual: boolean;
  origine?: 'finance' | 'approvisionnement' | 'manuel';
  modifiable?: boolean;
  attachmentUrl?: string;
  createdAt: string;
}

export interface PurchaseOrderItem {
  productId: string; // Can be from Stock (Shopify) or AdHoc
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  source: 'stock' | 'ponctuel' | 'adhoc';
}

export interface PurchaseOrderDocument {
  id: string;
  name: string;
  type: string;
  data: string; // Base64
  label: string;
  date: string;
}

export interface Fournisseur {
  societe: string;
  telephone: string;
  adresse?: string;
  email?: string;
}

export interface PurchaseOrder {
  id: string;
  number: string; // Auto-generated (e.g., PO-20231027-001)
  date: string; // ISO string (Creation date / Edited)
  items: PurchaseOrderItem[];
  totalAmount: number;
  transportFees?: number; // New field
  status: 'draft' | 'validated' | 'paid' | 'delivered'; // Updated status
  createdAt: string;
  validatedAt?: string;
  paidAt?: string;
  deliveredAt?: string;
  documents?: PurchaseOrderDocument[];
  source?: string; // e.g., "Expéditions Delta Transport - Auto"
  linkedOrderIds?: string[]; // IDs of orders linked to this PO
  fournisseur?: Fournisseur; // NOUVEAU
  ponctuelStockUpdated?: boolean;
}
