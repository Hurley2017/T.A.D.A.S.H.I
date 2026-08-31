import type { TadashiApi } from '../preload';

declare global {
  interface Window {
    tadashi: TadashiApi;
  }
}

export {};
