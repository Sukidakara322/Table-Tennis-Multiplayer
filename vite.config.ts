import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [cloudflare()],
  build: {
    // three.js alone is ~550 kB minified (~150 kB gzipped); that's expected for a 3D game.
    chunkSizeWarningLimit: 800,
  },
});
