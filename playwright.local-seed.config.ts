import { defineConfig } from '@playwright/test';
import local from './playwright.local.config';

/** Explicit seeded-household suite. Real credentials never enter trace/video/screenshot artifacts. */
export default defineConfig({
  ...local,
  testDir: './tests/local-seed',
  outputDir: 'test-results/local-seed',
});
