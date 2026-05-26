/** Extrait YYYY-MM-DD depuis dateEffet (clé PG ou chemin Firestore). */
export function parseDateEffet(raw: string | undefined | null): string {
  if (!raw) return '';
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(raw).slice(0, 10);
}

/** Date d'effet pour filtres rentabilité : jour calendaire, pas la clé technique complète. */
export function configEffectDate(c: { dateEffet?: string; updatedAt?: string | Date }): string {
  const fromEffet = parseDateEffet(c.dateEffet);
  if (fromEffet) return fromEffet;
  if (!c.updatedAt) return '';
  const s =
    typeof c.updatedAt === 'string' ? c.updatedAt : new Date(c.updatedAt).toISOString();
  return s.slice(0, 10);
}
