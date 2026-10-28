import { defineConfig } from 'vite';

// GitHub Pages project-site base path: https://<owner>.github.io/idk3/
export default defineConfig({
  base: '/idk3/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    assetsInlineLimit: 0
  }
});
