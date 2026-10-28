import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installSessionHttpFixture, signInSynthetic } from '../helpers/browserSession';
test('parent creation preserves canonical history and keeps email outside URL/history with accessible fields', async ({
  page,
  context,
}, testInfo) => {
  await installSessionHttpFixture(context);
  await signInSynthetic(page);
  let count = 0;
  await page.route('**/api/v1/family-members/parents', async (route) => {
    const input = route.request().postDataJSON();
    count++;
    expect(input).toEqual({
      username: 'new-parent',
      email: 'new@example.test',
    });
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    await route.fulfill({
      status: 201,
      json: {
        member: {
          memberId: 'new-parent',
          username: 'new-parent',
          role: 'parent',
          activationState: 'PENDING_ACTIVATION',
        },
      },
    });
  });
  await page.getByRole('link', { name: 'Add a parent', exact: true }).click();
  await expect(page).toHaveURL(/\/family\/parents\/new$/);
  await page.getByLabel('Username', { exact: true }).fill('New-Parent');
  await expect(page.getByLabel('Display name', { exact: true })).toHaveCount(0);
  await page.getByLabel('Recovery email', { exact: true }).fill('new@example.test');
  await expect(page.getByLabel('Profile color', { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const shot = testInfo.outputPath('create-parent.png');
  await page.screenshot({ path: shot, fullPage: true });
  expect(JSON.stringify(await page.evaluate(() => history.state))).not.toContain(
    'new@example.test',
  );
  expect(page.url()).not.toContain('new@example.test');
  await page.getByRole('button', { name: 'Send welcome email', exact: true }).click();
  await expect(page).toHaveURL(/\/family$/);
  expect(count).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/family\/parents\/new$/);
  await expect(page.getByLabel('Recovery email', { exact: true })).toHaveValue('');
  expect(count).toBe(1);
});
test('pending setup opens email verification and refuses unsupported emulator proof without activation', async ({
  page,
  context,
}) => {
  await installSessionHttpFixture(context);
  await context.route('**/api/v1/memberships/current', (route) =>
    route.fulfill({ status: 403, json: { error: { code: 'MEMBERSHIP_PENDING_ACTIVATION' } } }),
  );
  let activationCalls = 0;
  await context.route('**/api/v1/parent-activations', (route) => {
    activationCalls++;
    return route.fulfill({ status: 403, json: { error: { code: 'EMAIL_VERIFICATION_REQUIRED' } } });
  });
  await page.goto('/sign-in');
  await page.getByLabel('Username', { exact: true }).fill('parentone');
  await page.getByLabel('Password', { exact: true }).fill('SyntheticPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/activate-parent$/);
  await expect(
    page.getByRole('heading', { name: 'Verify your recovery email', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Local activation cannot verify email ownership',
  );
  expect(activationCalls).toBe(1); // Entry proof check only; unsupported native verification never activates.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(page.getByLabel('Email-verification code', { exact: true })).toHaveValue('');
});
test('pending account dialog cancels without a mutation and confirms resend with accessible feedback', async ({
  page,
  context,
}) => {
  await installSessionHttpFixture(context);
  await context.route('**/api/v1/family-members', (route) =>
    route.fulfill({
      json: {
        members: [
          {
            memberId: 'pending-member',
            username: 'new-parent',
            role: 'parent',
            activationState: 'PENDING_ACTIVATION',
            allowedActions: ['RESEND_WELCOME', 'CHANGE_EMAIL_AND_RESEND', 'CANCEL_PENDING_ACCOUNT'],
          },
        ],
      },
    }),
  );
  let calls = 0;
  await context.route('**/welcome-email-resends', (route) => {
    calls++;
    return route.fulfill({ status: 204 });
  });
  await signInSynthetic(page);
  await page.getByRole('button', { name: 'Resend welcome email', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Resend welcome email', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(calls).toBe(1);
});
test('recovery email remains private and unchanged while replacement waits for verification', async ({
  page,
  context,
}) => {
  await installSessionHttpFixture(context);
  let stages = 0;
  await context.route('**/api/v1/security/recovery-email', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        headers: { 'cache-control': 'no-store' },
        json: { email: 'owner@example.test' },
      });
    expect(route.request().postDataJSON()).toEqual({ email: 'replacement@example.test' });
    stages++;
    return route.fulfill({ status: 202, json: {} });
  });
  await signInSynthetic(page);
  await page.getByRole('link', { name: 'Security settings', exact: true }).click();
  await expect(page).toHaveURL(/\/security$/);
  await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();
  await page.getByLabel('Recovery email', { exact: true }).fill('replacement@example.test');
  await page
    .getByRole('button', { name: 'Send replacement verification code', exact: true })
    .click();
  await expect.poll(() => stages).toBe(1);
  await expect(page.getByLabel('Email-verification code', { exact: true })).toBeVisible();
  await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(page.url()).not.toContain('example.test');
  await page.goBack();
  await page.goForward();
  await expect(page.getByLabel('Recovery email', { exact: true })).toHaveValue('');
});
test('child removal confirmation cancels safely and removes only after server success', async ({
  page,
  context,
}, testInfo) => {
  await installSessionHttpFixture(context);
  let removed = false,
    calls = 0;
  await context.route('**/api/v1/family-members', (route) =>
    route.fulfill({
      json: {
        members: removed
          ? []
          : [
              {
                memberId: 'child-to-remove',
                username: 'childremove',
                displayName: 'Child to remove',
                role: 'child',
                activationState: 'ACTIVE',
                color: 'PINE',
                allowedActions: [],
              },
            ],
      },
    }),
  );
  let finishRemoval!: () => void;
  const deletionGate = new Promise<void>((resolve) => {
    finishRemoval = resolve;
  });
  await context.route('**/api/v1/family-members/child-to-remove', async (route) => {
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().postDataJSON()).toEqual({ confirmation: true });
    calls++;
    await deletionGate;
    removed = true;
    return route.fulfill({ status: 204 });
  });
  await signInSynthetic(page);
  const resetBox = await page
    .getByRole('link', { name: 'Reset child password', exact: true })
    .boundingBox();
  const removeBox = await page
    .getByRole('button', { name: 'Remove child account', exact: true })
    .boundingBox();
  if (page.viewportSize()!.width >= 640) {
    expect(resetBox).toBeTruthy();
    expect(removeBox).toBeTruthy();
    expect(
      Math.abs(resetBox!.y + resetBox!.height / 2 - removeBox!.y - removeBox!.height / 2),
    ).toBeLessThan(1);
    expect(Math.abs(resetBox!.height - removeBox!.height)).toBeLessThan(1);
  }
  await page.screenshot({ path: testInfo.outputPath('child-actions.png'), fullPage: true });
  await page.getByRole('button', { name: 'Remove child account', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('permanently deletes');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('remove-child-confirmation.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(calls).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Remove child account', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove child account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  finishRemoval();
  await expect(page.getByRole('button', { name: 'Remove child account', exact: true })).toHaveCount(
    0,
  );
  expect(calls).toBe(1);
});
test('parent form supports keyboard validation, 320px reflow and reduced motion', async ({
  page,
  context,
}) => {
  await installSessionHttpFixture(context);
  await signInSynthetic(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('link', { name: 'Add a parent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a parent', exact: true })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Family', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Username', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Send welcome email', exact: true }).click();
  await expect(page.getByLabel('Username', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
