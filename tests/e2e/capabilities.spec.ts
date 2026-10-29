import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Capability } from '../../shared/authorizationCapabilities';
import { installSessionHttpFixture, signInSynthetic } from '../helpers/browserSession';
import {
  childAllowedActions,
  parentCapabilities,
  profileAllowedActions,
} from '../helpers/capabilityFixtures';
const child = {
  memberId: 'child-target',
  username: 'child',
  displayName: 'Moss',
  role: 'child',
  activationState: 'ACTIVE',
  color: 'MOSS',
};
async function capture(page: Page, path: string) {
  const viewport = page.viewportSize()!;
  const zoom = await page.evaluate(() => document.documentElement.style.zoom);
  await page.screenshot({ path, fullPage: true });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.screenshot({ path: path.replace('.png', '-reflow-320.png'), fullPage: true });
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await page.screenshot({ path: path.replace('.png', '-zoom-200.png'), fullPage: true });
  await page.setViewportSize(viewport);
  await page.evaluate((value) => {
    document.documentElement.style.zoom = value;
  }, zoom);
}

test('navigation follows returned capabilities even when role says parent; unknown additions do not grant actions', async ({
  page,
  context,
}) => {
  await installSessionHttpFixture(context);
  await context.route('**/api/v1/memberships/current', (route) =>
    route.fulfill({
      json: {
        membership: {
          memberId: 'parent-member',
          username: 'parentone',
          role: 'parent',
          household: { householdId: 'home', name: 'Home', timezone: 'UTC' },
          capabilities: [Capability.householdRead, Capability.profileSelfRead, 'future.unknown'],
        },
      },
    }),
  );
  await page.goto('/sign-in');
  await page.getByLabel('Username').fill('parentone');
  await page.getByLabel('Password').fill('SyntheticPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todos', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Application' });
  await expect(nav.getByRole('link', { name: 'Family', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Security', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'My profile', exact: true })).toBeVisible();
  await page.goto('/family/children/new');
  await expect(page).toHaveURL(/\/todos$/);
});

test('a stale displayed child action refreshes target actions, announces recovery and focuses the current heading', async ({
  page,
  context,
}, info) => {
  await installSessionHttpFixture(context);
  let denied = false,
    writes = 0;
  await context.route('**/api/v1/family-members', (route) =>
    route.fulfill({
      json: {
        members: [{ ...child, allowedActions: denied ? ['future.unknown'] : childAllowedActions }],
      },
    }),
  );
  await context.route('**/api/v1/family-members/child-target', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ confirmation: true });
    writes++;
    denied = true;
    await route.fulfill({
      status: 403,
      json: { error: { code: 'TARGET_NOT_MANAGEABLE', message: 'That action is unavailable.' } },
    });
  });
  await signInSynthetic(page);
  await capture(page, info.outputPath('capabilities-allowed.png'));
  await page.getByRole('button', { name: 'Remove child account', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove child account', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('link', { name: 'Reset child password', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('status')).toContainText('Available actions have been refreshed');
  await expect(page.getByRole('heading', { name: 'Family management', exact: true })).toBeFocused();
  expect(writes).toBe(1);
  await capture(page, info.outputPath('capabilities-stale-refreshed.png'));
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove child account', exact: true })).toHaveCount(
    0,
  );
});

test('profile denial preserves safe draft, removes stale authority and announces recovery', async ({
  page,
  context,
}, info) => {
  await installSessionHttpFixture(context);
  let denied = false,
    writes = 0;
  await context.route('**/api/v1/profiles/me', async (route) => {
    if (route.request().method() === 'PUT') {
      expect(route.request().postDataJSON()).toEqual({
        displayName: 'Safe unsaved name',
        color: 'PINE',
        version: 1,
      });
      writes++;
      denied = true;
      await route.fulfill({
        status: 403,
        json: { error: { code: 'TARGET_NOT_MANAGEABLE', message: 'That action is unavailable.' } },
      });
      return;
    }
    await route.fulfill({
      json: {
        profile: {
          memberId: 'parent-member',
          displayName: 'Parent private profile',
          color: 'PINE',
          version: 1,
        },
        allowedActions: denied ? [] : profileAllowedActions,
      },
    });
  });
  await signInSynthetic(page);
  await page.getByRole('navigation').getByRole('link', { name: 'My profile', exact: true }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Safe unsaved name');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Safe unsaved name');
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('Available actions have been refreshed');
  await expect(page.getByRole('heading', { name: 'Edit my profile', exact: true })).toBeFocused();
  expect(writes).toBe(1);
  await capture(page, info.outputPath('profile-denied-safe-draft.png'));
});

test('capability resolving, unavailable, refreshed and session-loss states reflow without overflow', async ({
  page,
  context,
}, info) => {
  const originalViewport = page.viewportSize()!;
  await installSessionHttpFixture(context);
  let resolveMembership!: () => void;
  const resolving = new Promise<void>((resolve) => {
    resolveMembership = resolve;
  });
  await context.route('**/api/v1/memberships/current', async (route) => {
    await resolving;
    await route.fulfill({
      json: {
        membership: {
          memberId: 'parent-member',
          username: 'parentone',
          role: 'parent',
          household: { householdId: 'home', name: 'Home', timezone: 'UTC' },
          capabilities: parentCapabilities,
        },
      },
    });
  });
  await context.route('**/api/v1/family-members', (route) =>
    route.fulfill({ json: { members: [{ ...child, allowedActions: [] }] } }),
  );
  await page.goto('/sign-in');
  await page.getByLabel('Username').fill('parentone');
  await page.getByLabel('Password').fill('SyntheticPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Application' })).toHaveCount(0);
  await capture(page, info.outputPath('capabilities-resolving.png'));
  resolveMembership();
  await expect(page.getByRole('heading', { name: 'Family management', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove child account', exact: true })).toHaveCount(
    0,
  );
  await capture(page, info.outputPath('capabilities-unavailable.png'));
  await page.setViewportSize({ width: 320, height: 800 });
  await capture(page, info.outputPath('capabilities-reflow-320.png'));
  // 200% zoom at 640 physical pixels preserves the documented 320 CSS-pixel minimum.
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await capture(page, info.outputPath('capabilities-zoom-200.png'));
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await page.setViewportSize(originalViewport);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Application' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await capture(page, info.outputPath('capabilities-session-loss.png'));
});

test('a denial followed by refresh failure disables stale actions until explicit Retry', async ({
  page,
  context,
}) => {
  await installSessionHttpFixture(context);
  let denied = false,
    failedRefresh = false,
    writes = 0;
  await context.route('**/api/v1/memberships/current', async (route) => {
    if (denied && !failedRefresh) {
      failedRefresh = true;
      await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR' } } });
      return;
    }
    await route.fallback();
  });
  await context.route('**/api/v1/profiles/me', async (route) => {
    if (route.request().method() === 'PUT') {
      denied = true;
      writes++;
      await route.fulfill({ status: 403, json: { error: { code: 'TARGET_NOT_MANAGEABLE' } } });
      return;
    }
    await route.fulfill({
      json: {
        profile: {
          memberId: 'parent-member',
          displayName: 'Parent private profile',
          color: 'PINE',
          version: 1,
        },
        allowedActions: denied ? [] : profileAllowedActions,
      },
    });
  });
  await signInSynthetic(page);
  await page.getByRole('navigation').getByRole('link', { name: 'My profile', exact: true }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Preserved through failed refresh');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue(
    'Preserved through failed refresh',
  );
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('main [role="status"]')).toContainText(
    'Available actions have been refreshed',
  );
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Edit my profile', exact: true })).toBeFocused();
  expect(writes).toBe(1);
});
