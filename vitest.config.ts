import { defineConfig } from 'vitest/config';

// newEngine TDD 用 vitest。只收 *.test.ts(不碰 improCore 的 tsx __harness__ 脚本)。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
