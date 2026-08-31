import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: { command: 'npm run dev:web', url: 'http://127.0.0.1:5173', reuseExistingServer: true, cwd: process.cwd() },
  use: { baseURL: 'http://127.0.0.1:5173' },
});
