/**
 * Normalisation scheduledAt — aligné sur Dashboard.tsx (estProgrammee).
 * Ancienne app : dateProgrammee, scheduledDate, scheduled_date.
 */

export function pickScheduledAtRaw(data: Record<string, unknown>): unknown {
  return (
    data.scheduledAt ??
    data.dateProgrammee ??
    data.scheduledDate ??
    data.scheduled_date ??
    null
  );
}

/** ISO string ou null si absent / invalide. */
export function normalizeScheduledAtIso(data: Record<string, unknown>): string | null {
  const raw = pickScheduledAtRaw(data);
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isNaN(t) ? null : raw.toISOString();
  }
  const d = new Date(String(raw));
  const t = d.getTime();
  return Number.isNaN(t) ? null : d.toISOString();
}

/** Même règle que pages/Dashboard.tsx — programmée si maintenant < date + 1 min. */
export function estProgrammeeFromIso(
  scheduledAt: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!scheduledAt) return false;
  const sched = new Date(scheduledAt).getTime();
  if (Number.isNaN(sched)) return false;
  return nowMs < sched + 60_000;
}

export type DashboardOrderSlice = {
  status: string;
  driverId: string | null;
  scheduledAt: string | null;
};

export function isDashboardUnassigned(o: DashboardOrderSlice, nowMs?: number): boolean {
  return o.status === 'validé' && !o.driverId && !estProgrammeeFromIso(o.scheduledAt, nowMs);
}

export function isDashboardScheduled(o: { scheduledAt: string | null }, nowMs?: number): boolean {
  return estProgrammeeFromIso(o.scheduledAt, nowMs);
}

/** Firestore n'a que des champs legacy (pas scheduledAt canonique). */
export function hasLegacyScheduleFieldsOnly(data: Record<string, unknown>): boolean {
  const canonical = normalizeScheduledAtIso(data);
  if (!canonical) return false;
  const hasScheduledAt =
    data.scheduledAt !== null && data.scheduledAt !== undefined && data.scheduledAt !== '';
  return !hasScheduledAt;
}
