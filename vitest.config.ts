import { defineConfig } from 'vitest/config';

// newEngine TDD 用 vitest。只收 *.test.ts(不碰 improCore 的 tsx __harness__ 脚本)。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  define: {
    __AURA_TEST_DEFAULT_DREAM_PALETTE__: JSON.stringify('full-modern-gm'),
  },
});
