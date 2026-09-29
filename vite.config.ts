import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The sandbox serves the dev server through an https proxy host
    // (https://{port}-{sandboxId}.e2b.app), so every host must be allowed.
    allowedHosts: true,
    cors: true,
    hmr: {
      clientPort: 443,
      protocol: 'wss',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
