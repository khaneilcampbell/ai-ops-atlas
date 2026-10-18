import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// The UI builds to ./dist, which the Worker serves after the Access check.
// `npm run dev` proxies /api to `wrangler dev` on port 8787.
export default defineConfig({
  plugins: [preact()],
  build: { outDir: 'dist', assetsInlineLimit: 0, sourcemap: false },
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
