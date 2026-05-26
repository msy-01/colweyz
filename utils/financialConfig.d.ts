/** Extrait YYYY-MM-DD depuis dateEffet (clé PG ou chemin Firestore). */
export declare function parseDateEffet(raw: string | undefined | null): string;
/** Date d'effet pour filtres rentabilité : jour calendaire, pas la clé technique complète. */
export declare function configEffectDate(c: {
    dateEffet?: string;
    updatedAt?: string | Date;
}): string;
