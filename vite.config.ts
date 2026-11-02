import { defineConfig } from 'vite';

// Z3's threads need SharedArrayBuffer, which needs a cross-origin isolated page.
// The dev server sends the headers itself; on GitHub Pages coi-serviceworker adds them.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
