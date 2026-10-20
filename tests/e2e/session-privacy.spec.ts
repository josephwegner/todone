import { expect, test } from '@playwright/test';
import { authChangeChannel } from '../../src/session/authStorageContract';
import { installSessionHttpFixture } from '../helpers/browserSession';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('credentials and private context stay out of URLs, history, logs, messages and caches', async ({
  page,
  context,
}) => {
  await installSessionHttpFixture(context);
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  const navigationUrls: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigationUrls.push(frame.url());
  });
  await page.goto('/sign-in');
  await page.evaluate((name) => {
    const messages: unknown[] = [];
    Reflect.set(window, 'observedAuthHints', messages);
    const channel = new BroadcastChannel(name);
    channel.onmessage = (event) => messages.push(event.data);
    Reflect.set(window, 'authHintMonitor', channel);
  }, authChangeChannel('test-client'));
  await page.getByLabel('Username').fill('parentone');
  await page.getByLabel('Password').fill('SyntheticPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Family management', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'My profile', exact: true }).click();
  await page.getByLabel('Display name').fill('Private draft canary');
  const credentials = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.includes('.credentials.'))
      .map(([, value]) => value),
  );
  const historyState = await page.evaluate(() => JSON.stringify(history.state));
  await page.getByRole('link', { name: 'Family', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'observedAuthHints').length as number))
    .toBeGreaterThanOrEqual(2);
  const hints = await page.evaluate(
    () => Reflect.get(window, 'observedAuthHints') as Record<string, unknown>[],
  );
  expect(hints.length).toBeGreaterThanOrEqual(2);
  for (const hint of hints) expect(Object.keys(hint).sort()).toEqual(['generation', 'kind']);
  const output = JSON.stringify({ logs, navigationUrls, historyState, hints });
  for (const forbidden of [
    'SyntheticPassword123!',
    'synthetic-refresh-parentone',
    'parentone',
    'Parent private',
    'Private draft canary',
    ...credentials,
  ])
    expect(output).not.toContain(forbidden);
  expect(
    await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name)),
  ).toEqual([]);
  const cached = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).map((request) => request.url),
        ),
      )
    ).flat(),
  );
  expect(cached.filter((url) => /\/api\/|cognito|token|parentone/.test(url))).toEqual([]);
});
