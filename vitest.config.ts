import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: { NODE_ENV: 'test', TEST_MODE: 'true' },
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60_000,
  },
});
