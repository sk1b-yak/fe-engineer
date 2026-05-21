import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite builds the React chat client from client/ → public/.
// The public/ directory is served by the Worker's ASSETS binding.
export default defineConfig({
  root: './client',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In dev, proxy API + agent routes to wrangler dev (port 8787).
      '/agents': { target: 'http://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787' },
      '/_selftest': { target: 'http://localhost:8787' },
    },
  },
});
