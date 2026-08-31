import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: { outDir: resolve(projectRoot, 'dist-electron/main'), rollupOptions: { input: resolve(projectRoot, 'apps/desktop/src/main.ts'), output: { entryFileNames: 'index.js' } } },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: { outDir: resolve(projectRoot, 'dist-electron/preload'), rollupOptions: { input: resolve(projectRoot, 'apps/desktop/src/preload.ts'), output: { entryFileNames: 'index.js' } } },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(projectRoot, 'apps/desktop/src/renderer'),
    build: { outDir: resolve(projectRoot, 'dist'), rollupOptions: { input: resolve(projectRoot, 'apps/desktop/src/renderer/index.html') } },
    resolve: {
      alias: {
        '@contracts': resolve(projectRoot, 'packages/contracts/src'),
      },
    },
    plugins: [react()],
  },
});
