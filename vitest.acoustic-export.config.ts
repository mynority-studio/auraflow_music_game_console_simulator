import { defineConfig } from 'vitest/config';

/**
 * P2-7 步e：acoustic-debug 侧 instrumentation golden 采集专用（设计 §7.2 冻结）。
 * 只收该 exporter；palette 由构建默认下发，exporter 内 fail-closed 断言侧别。
 */
export default defineConfig({
  test: {
    include: ['scripts/export-afe-instrumentation.export.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
  define: {
    __AURA_TEST_DEFAULT_DREAM_PALETTE__: JSON.stringify('acoustic-debug'),
  },
});
