import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.cosmoplat.cn', '.cosmoplat.com', '.cosmoplat.net'],
    proxy: {}
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['.cosmoplat.cn', '.cosmoplat.com', '.cosmoplat.net']
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000
  }
});
