/** Horodatage ISO pour aligner PG ↔ Firestore (anti-boucle + stale check). */
export function firestoreSyncTimestamp(): string {
  return new Date().toISOString();
}

/** Événement renvoyé par le reverse worker — ne pas réimporter en PG. */
export function isPostgresSyncEcho(data: Record<string, unknown> | null | undefined): boolean {
  return data?._syncSource === 'postgres';
}
