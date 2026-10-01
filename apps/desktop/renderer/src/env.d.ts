/// <reference types="vite/client" />

import type { DesktopAPI } from "../../../../packages/contracts/src/desktop.js";

declare global {
  interface Window {
    materialsx: DesktopAPI;
  }
}

export {};
