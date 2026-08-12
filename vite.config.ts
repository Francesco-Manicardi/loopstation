import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5505, open: false },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
  worker: { format: 'es' },
});
