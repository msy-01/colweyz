/** Champs autorisés pour Prisma — évite les 500 sur champs Firestore/frontend inconnus. */

import { paymentMethodFromRequestBody } from './payment-method.js';

export function sanitizeDriverBody(body: Record<string, unknown>, id: string) {
  return {
    id,
    name: String(body.name ?? ''),
    phone: String(body.phone ?? ''),
    username: body.username ? String(body.username) : null,
    initialBalance: Number(body.initialBalance) || 0,
    status: String(body.status ?? 'disponible'),
    color: body.color ? String(body.color) : null,
    uid: body.uid ? String(body.uid) : null,
  };
}

export function sanitizeZoneBody(body: Record<string, unknown>, id: string) {
  return {
    id,
    name: String(body.name ?? ''),
    rate: Number(body.rate) || 0,
    type: String(body.type ?? 'local'),
  };
}

const nullStr = (v: unknown): string | null =>
  v === '' || v === undefined || v === null ? null : String(v);

const nullInt = (v: unknown): number | null =>
  v === '' || v === undefined || v === null ? null : Number(v);

export function sanitizeOrderBody(body: Record<string, unknown>, id: string) {
  return {
    id,
    date: String(body.date ?? new Date().toISOString()),
    clientName: String(body.clientName ?? ''),
    clientPhone: nullStr(body.clientPhone),
    address: String(body.address ?? 'Non précisée'),
    productDetails: nullStr(body.productDetails),
    productId: nullStr(body.productId),
    amount: Number(body.amount) || 0,
    deliveryCost: nullInt(body.deliveryCost),
    status: String(body.status ?? 'validé'),
    remuneration: nullInt(body.remuneration),
    paymentMethod: paymentMethodFromRequestBody(body.paymentMethod, body.modePaiement),
    cancelReason: nullStr(body.cancelReason),
    shippingFee: nullInt(body.shippingFee),
    isPrePaid: body.isPrePaid != null ? Boolean(body.isPrePaid) : null,
    regionalPaymentStatus: nullStr(body.regionalPaymentStatus),
    assignedAt: nullStr(body.assignedAt),
    deliveredAt: nullStr(body.deliveredAt),
    postponedAt: nullStr(body.postponedAt),
    scheduledAt: nullStr(body.scheduledAt),
    importedAt: nullStr(body.importedAt),
    refusedBy: nullStr(body.refusedBy),
    purchaseCost: nullInt(body.purchaseCost),
    remarks: nullStr(body.remarks),
    shippingRemarks: nullStr(body.shippingRemarks),
    assignmentRemarks: nullStr(body.assignmentRemarks),
    isDepotDelivery: body.isDepotDelivery != null ? Boolean(body.isDepotDelivery) : null,
    sortieDepotLogged: body.sortieDepotLogged != null ? Boolean(body.sortieDepotLogged) : null,
    livraisonDepotConfirmee:
      body.livraisonDepotConfirmee != null ? Boolean(body.livraisonDepotConfirmee) : null,
    linkedOrderIds: Array.isArray(body.linkedOrderIds) ? body.linkedOrderIds.map(String) : [],
    zoneId: nullStr(body.zoneId),
    driverId: nullStr(body.driverId),
    products: Array.isArray(body.products) ? body.products : [],
    logs: Array.isArray(body.logs) ? body.logs : [],
  };
}

export function sanitizePurchaseOrderBody(body: Record<string, unknown>) {
  return {
    number: String(body.number ?? ''),
    date: String(body.date ?? new Date().toISOString()),
    totalAmount: Number(body.totalAmount) || 0,
    transportFees: body.transportFees != null ? Number(body.transportFees) : null,
    status: String(body.status ?? 'draft'),
    source: body.source ? String(body.source) : null,
    supplierName: body.supplierName ? String(body.supplierName) : null,
    firestoreCreatedAt: body.firestoreCreatedAt
      ? String(body.firestoreCreatedAt)
      : body.createdAt
        ? String(body.createdAt)
        : null,
    validatedAt: body.validatedAt ? String(body.validatedAt) : null,
    paidAt: body.paidAt ? String(body.paidAt) : null,
    deliveredAt: body.deliveredAt ? String(body.deliveredAt) : null,
    linkedOrderIds: Array.isArray(body.linkedOrderIds) ? body.linkedOrderIds.map(String) : [],
    ponctuelStockUpdated: Boolean(body.ponctuelStockUpdated),
    fournisseur: body.fournisseur ?? undefined,
  };
}
