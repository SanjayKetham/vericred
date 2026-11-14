/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the VeriCred API, e.g. https://vericred-api.onrender.com. Empty in development. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
