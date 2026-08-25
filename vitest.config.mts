import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // .tsx too, so components can have real render tests. A component test opts into
    // a DOM with `// @vitest-environment jsdom` at the top of the file; everything else
    // stays in the faster node environment.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
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
