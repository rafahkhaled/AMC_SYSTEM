/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apiProxy = {
  '/api': {
    target: process.env.API_URL ?? 'http://localhost:3000',
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react()],
  // The built application is served the same way, so the service worker and
  // the installed shell can be exercised against a real API before deploying.
  preview: { port: 5174, proxy: apiProxy },
  server: {
    port: 5173,
    /**
     * The API is proxied rather than called across origins. The session cookie
     * is SameSite=Strict, so a browser would never send it to a different
     * origin; development has to look like production, where Caddy serves the
     * application and routes /api to the same place.
     */
    proxy: apiProxy,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
