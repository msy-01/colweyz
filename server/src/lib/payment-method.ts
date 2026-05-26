/** Aligne paymentMethod (PG) avec modePaiement (Firestore / ancienne app). */

export function paymentMethodFromFirestore(data: Record<string, unknown>): string | null {
  const raw = data.paymentMethod;
  if (raw != null && raw !== '') {
    const pm = String(raw).toLowerCase();
    if (pm === 'wave' || pm === 'om' || pm === 'cash') return pm;
    if (pm === 'espèces' || pm === 'especes') return 'cash';
    return String(raw);
  }

  const mp = data.modePaiement != null && data.modePaiement !== '' ? String(data.modePaiement) : null;
  if (mp === 'Wave') return 'wave';
  if (mp === 'OM') return 'om';
  if (mp === 'Espèces') return 'cash';
  if (mp === 'Dépôt Expédition') return 'depot';

  return null;
}

export function modePaiementFromPaymentMethod(paymentMethod: string | null | undefined): string | undefined {
  if (paymentMethod === 'wave') return 'Wave';
  if (paymentMethod === 'om') return 'OM';
  if (paymentMethod === 'cash') return 'Espèces';
  if (paymentMethod === 'depot') return 'Dépôt Expédition';
  return undefined;
}

export function paymentMethodFromRequestBody(
  paymentMethod: unknown,
  modePaiement: unknown,
): string | null {
  return paymentMethodFromFirestore({
    paymentMethod: paymentMethod ?? undefined,
    modePaiement: modePaiement ?? undefined,
  });
}
