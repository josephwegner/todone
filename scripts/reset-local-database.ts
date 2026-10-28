#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resetLocalDatabase } from '../local-dev/resetDatabase';

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  if (process.argv.length > 2) throw new Error('Local reset accepts no target arguments.');
  await resetLocalDatabase(fileURLToPath(new URL('../', import.meta.url)), controller.signal);
  console.log('Local data was wiped and seeded. The temporary emulator is stopped.');
  console.log(
    'Start npm run dev:full. Accounts and reset behavior: docs/testing/local-database.md',
  );
} catch (error) {
  // Preflight errors are authored local diagnostics; never print raw SDK identity/password errors.
  if (
    error instanceof Error &&
    /^(Local reset|Local Cognito|Local fixtures|Port \d+ is in use)/.test(error.message)
  )
    console.error(error.message);
  else
    console.error(
      'Local reset did not complete. Check configuration and retry with services stopped; failures after wiping do not publish a seed manifest.',
    );
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
