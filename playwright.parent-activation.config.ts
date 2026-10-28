import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testDir: './tests/parent-activation',
  outputDir: 'test-results/parent-activation',
  use: { ...base.use, baseURL: 'http://localhost:3003', trace: 'off', video: 'off' },
  webServer: {
    command:
      'VITE_COGNITO_USER_POOL_ID=us-east-1_synthetic VITE_COGNITO_CLIENT_ID=test-client VITE_COGNITO_REGISTRATION_CLIENT_ID=test-registration VITE_COGNITO_REGION=us-east-1 VITE_COGNITO_LOCAL_ENDPOINT= npm run dev -- --port 3003 --strictPort',
    url: 'http://localhost:3003',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
