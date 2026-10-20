import { defineConfig, devices } from '@playwright/test';

const compact = { viewport: { width: 390, height: 844 } };
const medium = { viewport: { width: 820, height: 1180 } };
const wide = { viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'VITE_COGNITO_USER_POOL_ID=local_test VITE_COGNITO_CLIENT_ID=test-client VITE_COGNITO_REGISTRATION_CLIENT_ID=test-registration-client VITE_COGNITO_REGION=local VITE_COGNITO_LOCAL_ENDPOINT=http://localhost:9229 npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium-compact', use: { ...devices['Desktop Chrome'], ...compact } },
    { name: 'chromium-medium', use: { ...devices['Desktop Chrome'], ...medium } },
    { name: 'chromium-wide', use: { ...devices['Desktop Chrome'], ...wide } },
    { name: 'firefox-wide', use: { ...devices['Desktop Firefox'], ...wide } },
    { name: 'webkit-wide', use: { ...devices['Desktop Safari'], ...wide } },
  ],
});
