import { defineConfig } from 'vitest/config';

/**
 * The normal suite keeps the wide GM world available for legacy coverage.
 * This focused suite compiles the exact palette that the browser currently
 * uses, so its assertions exercise the real acoustic release boundary.
 */
export default defineConfig({
  test: {
    include: ['src/core/generation/musicGeneration/acousticPaletteConsumption.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
  define: {
    __AURA_TEST_DEFAULT_DREAM_PALETTE__: JSON.stringify('acoustic-debug'),
  },
});
