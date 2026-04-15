/// <reference types="vite/client" />

interface Window {
  __LLM_OJ_API_BASE_URL__?: string;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}
