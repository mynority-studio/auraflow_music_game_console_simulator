import { defineConfig } from 'vitest/config';

// Exporters that exercise the production generation path need Vite's asset
// transforms (the Dream GM catalog imports a TSV via `?raw`). Keeping them in
// a dedicated config avoids turning artifact writers into the normal test run.
export default defineConfig({
  test: {
    include: ['scripts/*.export.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
  define: {
    __AURA_TEST_DEFAULT_DREAM_PALETTE__: JSON.stringify('full-modern-gm'),
  },
});
