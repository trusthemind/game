/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Each model's content hash, appended to its URL (assets.ts): /models/ is served with a week's HTTP cache and
// gear.glb keeps its name across builds, so without it a browser kept wearing last week's gear.
const MODELS = fileURLToPath(new URL('./public/models', import.meta.url));
function modelRevisions(dir = MODELS, out: Record<string, string> = {}): Record<string, string> {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) modelRevisions(p, out);
    else if (f.endsWith('.glb')) out[relative(MODELS, p)] = createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 8);
  }
  return out;
}

export default defineConfig({
  // Which build is running, shown in the menu and the pause screen (Vercel passes the commit).
  define: {
    'import.meta.env.VITE_BUILD': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev'),
    __MODEL_REV__: JSON.stringify(modelRevisions()),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    // Service worker: precaches the hashed bundle so the game boots instantly and works offline.
    // On macOS the game can be installed as a standalone app (Safari: File → Add to Dock, Chrome: Install).
    VitePWA({
      // A new build waits until the player is out of a raid (main.tsx): taking over at once reloaded the tab
      // mid-raid, and a raid that's closed takes your gear with it.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Ashfall: Extraction',
        short_name: 'Ashfall',
        description: 'Top-down extraction looter & survival exploration.',
        theme_color: '#0b0d0c',
        background_color: '#0b0d0c',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,glb,mp3,json,webp,png}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Models are fetched as name.glb?v=<hash>: still the precached copy (whose revision is that same content).
        ignoreURLParametersMatching: [/^v$/, /^utm_/, /^fbclid$/],
        runtimeCaching: [
          {
            // 3D models: cache-first, survive SW updates (separate cache from the precache manifest).
            urlPattern: ({ url }) => url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'models', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Long-term cacheable vendor chunks: game code changes don't bust the three.js cache.
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules/postprocessing')) return 'three';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: { proxy: { '/api': 'http://localhost:8080' } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
