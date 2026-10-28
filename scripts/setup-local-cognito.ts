#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { setupLocalCognito, DEFAULT_USERNAME, DEFAULT_PASSWORD } from '../local-dev/cognitoSetup';
const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
const [username = DEFAULT_USERNAME, password] = process.argv.slice(2);
setupLocalCognito(rootDirectory, { username, password: password ?? DEFAULT_PASSWORD })
  .then(({ client }) => {
    client.destroy();
    console.log('Local Cognito is ready; .env.local has been updated.');
    console.log('See docs/testing/local-database.md for disposable accounts and startup commands.');
  })
  .catch(() => {
    console.error(
      'Local Cognito setup failed. Check the loopback configuration and start npm run dev:cognito.',
    );
    process.exitCode = 1;
  });
