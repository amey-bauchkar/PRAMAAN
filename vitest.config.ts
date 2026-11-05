import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@pramaan/contracts': path.resolve(__dirname, './packages/contracts/src/index.ts'),
      '@pramaan/domain': path.resolve(__dirname, './packages/domain/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 10000,
  },
});
