import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.db.test.ts', 'test/db/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
