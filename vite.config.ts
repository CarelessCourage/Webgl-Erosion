import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser',
  },
  server: {
    port: 3000,
    open: true,
  },
  // Treat .wgsl files as assets so ?raw works
  assetsInclude: ['**/*.wgsl'],
});
