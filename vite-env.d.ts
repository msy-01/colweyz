/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_POLL_CRITICAL_MS?: string;
  readonly VITE_POLL_STANDARD_MS?: string;
  readonly VITE_POLL_CALM_MS?: string;
  readonly VITE_POLL_CONFIG_MS?: string;
  /** true = boutons accès rapide sur la page login (prod VPS, usage solo) */
  readonly VITE_ENABLE_DEMO_LOGIN?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
