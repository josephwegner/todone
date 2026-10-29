import { Capability } from '../../shared/authorizationCapabilities';
import { parentCapabilities, childCapabilities, profileAllowedActions } from './capabilityFixtures';
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test';

export const syntheticAccounts = {
  parentone: {
    memberId: 'parent-member',
    username: 'parentone',
    role: 'parent',
    household: {
      householdId: 'parent-house',
      name: 'Parent private home',
      timezone: 'America/Chicago',
    },
    displayName: 'Parent private profile',
    color: 'PINE',
  },
  childtwo: {
    memberId: 'child-member',
    username: 'childtwo',
    role: 'child',
    household: {
      householdId: 'child-house',
      name: 'Child private home',
      timezone: 'America/Chicago',
    },
    displayName: 'Child private profile',
    color: 'MOSS',
  },
} as const;
export type SyntheticAccount = keyof typeof syntheticAccounts;
function token(username: SyntheticAccount, tokenUse: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', kid: 'synthetic' })}.${encode({ sub: `synthetic-${username}`, 'cognito:username': username, token_use: tokenUse, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), aud: 'test-client', iss: 'https://example.invalid/test' })}.synthetic-signature`;
}
/** Synthetic HTTP boundary only. Unknown principals fail; real server authorization has separate negative integration coverage. */
export async function installSessionHttpFixture(context: BrowserContext) {
  const cognito = async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST,OPTIONS',
        },
      });
      return;
    }
    const body = route.request().postDataJSON();
    const username =
      body.AuthFlow === 'REFRESH_TOKEN_AUTH'
        ? body.AuthParameters?.REFRESH_TOKEN?.replace('synthetic-refresh-', '')
        : body.AuthParameters?.USERNAME;
    if (!(username in syntheticAccounts)) {
      await route.fulfill({ status: 400, json: { __type: 'NotAuthorizedException' } });
      return;
    }
    await route.fulfill({
      json: {
        AuthenticationResult: {
          IdToken: token(username, 'id'),
          AccessToken: token(username, 'access'),
          RefreshToken: `synthetic-refresh-${username}`,
          ExpiresIn: 3600,
        },
      },
    });
  };
  await context.route('http://localhost:9229/**', cognito);
  await context.route('https://cognito-idp.local.amazonaws.com/**', cognito);
  await context.route('**/api/v1/**', async (route) => {
    let username: string | undefined;
    try {
      const bearer = route.request().headers().authorization?.split(' ')[1];
      username = JSON.parse(Buffer.from(bearer?.split('.')[1] ?? '', 'base64url').toString())[
        'cognito:username'
      ];
    } catch {
      /* Unknown caller is denied below. */
    }
    if (!username || !(username in syntheticAccounts)) {
      await route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED' } } });
      return;
    }
    const account = syntheticAccounts[username as SyntheticAccount];
    const path = new URL(route.request().url()).pathname;
    const headers = { 'cache-control': 'no-store' };
    const membership = {
      memberId: account.memberId,
      username: account.username,
      role: account.role,
      capabilities: account.role === 'parent' ? parentCapabilities : childCapabilities,
      household: account.household,
    };
    const profile = {
      memberId: account.memberId,
      displayName: account.displayName,
      color: account.color,
      version: 1,
    };
    if (path.endsWith('/memberships/current')) {
      await route.fulfill({ headers, json: { membership } });
      return;
    }
    if (path.endsWith('/profiles/me')) {
      await route.fulfill({ headers, json: { profile, allowedActions: profileAllowedActions } });
      return;
    }
    if (path.endsWith('/family-members') && account.role === 'parent') {
      await route.fulfill({
        headers,
        json: {
          members: [
            {
              ...profile,
              username: account.username,
              role: account.role,
              activationState: 'ACTIVE',
              allowedActions: [Capability.profileUpdate],
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({
      status: 403,
      headers,
      json: { error: { code: 'TARGET_NOT_MANAGEABLE' } },
    });
  });
}
export async function signInSynthetic(page: Page, username: SyntheticAccount = 'parentone') {
  await page.goto('/sign-in');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('SyntheticPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: username === 'parentone' ? 'Family management' : 'Todos',
      exact: true,
    }),
  ).toBeVisible();
}
