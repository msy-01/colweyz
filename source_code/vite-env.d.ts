/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_FORCE_API_MODE?: string;
  readonly VITE_POLL_CRITICAL_MS?: string;
  readonly VITE_POLL_STANDARD_MS?: string;
  readonly VITE_POLL_CALM_MS?: string;
  readonly VITE_POLL_CONFIG_MS?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
