import { defineConfig } from 'vite';

/**
 * When this runs inside an e2b sandbox the dev server is reached through an
 * https proxy (https://{port}-{sandboxId}.e2b.app), so the HMR client has to be
 * told to connect over wss on 443 rather than inferring the raw dev port.
 *
 * Outside that environment we leave HMR completely alone, so a plain
 * `npm run dev` on a laptop behaves exactly like stock Vite.
 */
const behindHttpsProxy = process.env.E2B_SANDBOX === 'true' || process.env.VITE_HTTPS_PROXY === '1';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The sandbox proxy forwards an arbitrary *.e2b.app hostname.
    allowedHosts: true,
    cors: true,
    ...(behindHttpsProxy ? { hmr: { clientPort: 443, protocol: 'wss' as const } } : {}),
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
