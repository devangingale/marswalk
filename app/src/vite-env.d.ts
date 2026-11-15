// Written with AI assistance, directed and reviewed by the team.
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_TOKEN?: string;
  readonly VITE_GLOBE_BASE?: string;
}

declare var CESIUM_BASE_URL: string | undefined;
