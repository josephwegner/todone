import { expect, test, type Page } from '@playwright/test';

/** Run after setup:local-cognito and dev:full. No mocked auth or API responses. */
test('creates a usable child and refuses an unsupported local reset before changing its password', async ({
  page,
  context,
}) => {
  const childUsername = `child-${Date.now().toString(36)}`;
  const childPassword = `LocalChild${Date.now()}!`;
  await signInLocalParent(page);
  await page.getByRole('link', { name: 'Create child account' }).click();
  await page.getByLabel('Username', { exact: true }).fill(childUsername);
  await page.getByLabel('Child display name', { exact: true }).fill('Local Child');
  await page.getByLabel('Lake', { exact: true }).check();
  await page.getByLabel('Child password', { exact: true }).fill(childPassword);
  await page.getByRole('button', { name: 'Create child account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Family management' })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: `@${childUsername}` });
  await row.getByRole('link', { name: 'Reset child password' }).click();
  await page.getByLabel('New password', { exact: true }).fill(`Changed${Date.now()}!`);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No password was changed.');
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(childUsername);
  await page.getByLabel('Password', { exact: true }).fill(childPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/todos$/);
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
  const peer = await context.newPage();
  await peer.goto('/profile');
  await expect(peer.getByLabel('Display name', { exact: true })).toHaveValue('Local Child');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(peer.getByRole('heading', { name: 'Sign in', exact: true })).toBeFocused();
});

async function signInLocalParent(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('localdev');
  await page.getByLabel('Password', { exact: true }).fill('LocalDevPass123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    /Create your household|Set up your profile|Family management/,
  );
  if (await page.getByRole('heading', { name: 'Create your household' }).isVisible()) {
    await page.getByLabel('Household name', { exact: true }).fill('Local Test Household');
    await page.getByLabel('Household timezone').selectOption('America/Chicago');
    await page.getByRole('button', { name: 'Create household', exact: true }).click();
  }
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    /Set up your profile|Family management/,
  );
  if (await page.getByRole('heading', { name: 'Set up your profile' }).isVisible()) {
    await page.getByLabel('Display name', { exact: true }).fill('Local Parent');
    await page.getByLabel('Pine', { exact: true }).check();
    await page.getByRole('button', { name: 'Continue to family management', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Family management' })).toBeVisible();
}

test('renews through the real emulator and shares the return visit and sign-out across tabs', async ({
  page,
  context,
}) => {
  await signInLocalParent(page);
  let renewals = 0;
  page.on('request', (request) => {
    if (
      request.headers()['x-amz-target']?.endsWith('.InitiateAuth') &&
      request.postDataJSON()?.AuthFlow === 'REFRESH_TOKEN_AUTH'
    )
      renewals++;
  });
  // Expire only the cached SDK expiry metadata, never a token claim or server
  // authorization gate, so restoration must call the actual refresh API.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (key) =>
        key.startsWith('todone.auth.v1.') &&
        key.includes('.credentials.') &&
        key.endsWith('.localSession'),
    );
    if (!key) throw new Error('Local SDK credential scope missing');
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.expiresAt = new Date(Date.now() - 1000).toISOString();
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Family management', exact: true })).toBeVisible();
  expect(renewals).toBe(1);
  const peer = await context.newPage();
  await peer.goto('/profile');
  await expect(peer.getByRole('heading', { name: 'Edit my profile' })).toBeFocused();
  await expect(peer.getByLabel('Display name', { exact: true })).toHaveValue('Local Parent');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(peer.getByRole('heading', { name: 'Sign in', exact: true })).toBeFocused();
  await expect(peer.getByLabel('Display name')).toHaveCount(0);
});
