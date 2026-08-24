import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Lets server-only modules be imported under vitest without throwing.
      'server-only': path.resolve(import.meta.dirname, './src/test-stubs/empty.ts'),
    },
  },
});
