import { defineConfig, devices } from '@playwright/test'

/**
 * E2E runs against the production build served by `vite preview`, so what
 * passes here is what ships.
 *
 *   - a11y.spec.ts   — the axe WCAG gate, Chromium only (a deterministic gate).
 *   - claims.spec.ts — what the page SAYS, which does not vary by browser.
 *
 * Port 4306 is this lab's, unique across the fleet in both the committed
 * configs and tools/playwright-ports.json, and never the Vite default 4173:
 * a shared port means `reuseExistingServer` can silently scan a DIFFERENT
 * lab's preview, or — during a mutation check — an unmutated checkout still
 * running from a previous run, which reads as "the mutation was not caught".
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4306/crypto-lab-exposure-notification/',
  },
  projects: [
    {
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    { name: 'claims', testMatch: /claims\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Build before serving. `vite preview` serves whatever is already in dist/,
    // so without the build in front a failing build leaves the previous good
    // bundle in place and the whole suite passes green against source that no
    // longer compiles — which silently invalidates mutation checking, the only
    // thing that proves these tests have teeth.
    command: 'npm run build && npm run preview -- --port 4306 --strictPort',
    url: 'http://localhost:4306/crypto-lab-exposure-notification/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
