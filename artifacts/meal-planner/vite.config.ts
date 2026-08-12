import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

// Vite does not put .env into process.env, so load the repo-root file explicitly. Without
// this the dev server and the API server read their settings from different places, which is
// how you end up proxying to a port nothing is listening on.
const env = { ...loadEnv('development', path.resolve(import.meta.dirname, '..', '..'), ''), ...process.env };

// WEB_PORT, not PORT: PORT belongs to the API server, and .env is now shared between them.
const port = Number(env.WEB_PORT ?? 5173);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid WEB_PORT value: "${env.WEB_PORT}"`);
}

const basePath = env.BASE_PATH ?? '/';

// Replit's `router = "application"` used to mount the API at /api and this app at /.
// Nothing replaces it off-Replit, so the dev server proxies /api to the API server itself.
// The generated client's baseUrl is /api (set in orval.config.ts), so no client change needed.
const apiTarget = env.API_PROXY_TARGET ?? `http://localhost:${env.PORT ?? 3000}`;

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
