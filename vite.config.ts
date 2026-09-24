import { defineConfig } from 'vitest/config';

// `base: './'` keeps every asset URL relative, so the build works from any
// sub-path (e.g. https://usertrv.dev/projects/rocket-sim/) on a plain static server.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
