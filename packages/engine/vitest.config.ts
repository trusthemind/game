import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
    environment: 'node',
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text', 'html'] },
  },
});
