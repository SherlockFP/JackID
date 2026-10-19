/// <reference types="vite/client" />

/** Injected by vite.config.ts `define` from package.json "version". */
declare const __APP_VERSION__: string;
/** Build id (git short hash, else build time) baked by vite.config.ts; the same value is in dist/version.json. */
declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  /** Optional lobby WebSocket URL for split deployments, e.g. wss://lobby.example.com/lobby */
  readonly VITE_LOBBY_URL?: string;
}
