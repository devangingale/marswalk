// Written with AI assistance, directed and reviewed by the team.
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_TOKEN?: string;
  readonly VITE_GLOBE_BASE?: string;
  /** Public URL of the production Cloudflare R2 bucket, no trailing slash. */
  readonly VITE_R2_BASE_URL?: string;
  readonly VITE_TILES_BASE?: string;
  /** Overrides where panoramas.json is fetched from (any environment). */
  readonly VITE_PANORAMAS_URL?: string;
}

declare var CESIUM_BASE_URL: string | undefined;
