import { defineConfig } from 'vitest/config';

// The render-mix audit imports the production soundbank catalog, including
// Vite's `?raw` TSV asset. Run it inside Vitest's Vite transform pipeline
// instead of plain Node/tsx so the audit command matches the app build path.
export default defineConfig({
  test: {
    include: [
      'scripts/audit-render-mix.test.ts',
      'scripts/audit-drum-humanity.test.ts',
      'scripts/audit-lofi-hiphop-arrangement.test.ts',
      'scripts/audit-lofi-musical-foundation.test.ts',
      'scripts/audit-lofi-phrase-interaction.test.ts',
    ],
    environment: 'node',
    testTimeout: 120_000,
  },
});
