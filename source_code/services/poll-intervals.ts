/** Intervalles de polling (nouvelle app) — surchargeables via .env (VITE_POLL_*_MS). Min 400 ms. */
const MIN_POLL_MS = 400;

function ms(envKey: string, fallback: number): number {
  const raw = import.meta.env[envKey as keyof ImportMetaEnv];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= MIN_POLL_MS ? n : fallback;
}

/** commandes, stock ops — sync Firestore→PG la plus visible */
export const POLL_MS = {
  critical: ms('VITE_POLL_CRITICAL_MS', 800),
  standard: ms('VITE_POLL_STANDARD_MS', 1500),
  calm: ms('VITE_POLL_CALM_MS', 4000),
  config: ms('VITE_POLL_CONFIG_MS', 15000),
} as const;
