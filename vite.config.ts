import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: projectRoot,
  resolve: {
    alias: {
      '@contracts': resolve(projectRoot, 'packages/contracts/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
