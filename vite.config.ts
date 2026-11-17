import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/crypto-lab-exposure-notification/',
  test: {
    // Playwright specs live in e2e/ and must not be collected as unit tests.
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
