import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const issuedAt = Math.floor(Date.now() / 1000);
function jwt(use: 'id' | 'access', verified: boolean) {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub: 'synthetic-pending', 'cognito:username': 'pending', token_use: use, iat: issuedAt, exp: issuedAt + 3600, email: 'pending@example.test', email_verified: verified })}.synthetic`;
}
for (const recovery of ['success', 'conflict', 'network', 'reload'] as const) {
  test(`${recovery}: native SRP password setup, email verification, renewal and self activation keep secrets out of history/storage`, async ({
    page,
    context,
  }, testInfo) => {
    let verified = false,
      active = false,
      setup = false,
      activations = 0,
      verificationRequests = 0,
      verificationSubmissions = 0,
      rejectedActivation = false;
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === 'http://localhost:3003' ||
        url.hostname === 'cognito-idp.us-east-1.amazonaws.com'
      )
        return route.continue();
      return route.abort();
    });
    await context.route('https://cognito-idp.us-east-1.amazonaws.com/**', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'POST,OPTIONS',
          },
        });
      const input = route.request().postDataJSON(),
        operation = route.request().headers()['x-amz-target']?.split('.').at(-1);
      const headers = {
        'access-control-allow-origin': '*',
        'content-type': 'application/x-amz-json-1.1',
      };
      if (operation === 'GetUserAttributeVerificationCode') {
        verificationRequests++;
        expect(input.AttributeName).toBe('email');
        return route.fulfill({
          headers,
          json: {
            CodeDeliveryDetails: {
              AttributeName: 'email',
              DeliveryMedium: 'EMAIL',
              Destination: 'p***',
            },
          },
        });
      }
      if (operation === 'VerifyUserAttribute') {
        verificationSubmissions++;
        expect(verified).toBe(false); // A consumed code must never be replayed.
        expect(input.AccessToken).toBe(jwt('access', false));
        if (input.Code !== 'SyntheticVerificationCode')
          return route.fulfill({
            status: 400,
            headers,
            json: { __type: 'CodeMismatchException', message: 'synthetic mismatch' },
          });
        verified = true;
        return route.fulfill({ headers, json: {} });
      }
      if (operation === 'InitiateAuth' && input.AuthFlow !== 'REFRESH_TOKEN_AUTH')
        return route.fulfill({
          headers,
          json: {
            ChallengeName: 'PASSWORD_VERIFIER',
            Session: 'synthetic-srp',
            ChallengeParameters: {
              USER_ID_FOR_SRP: 'pending',
              SRP_B: '2',
              SALT: 'ab',
              SECRET_BLOCK: Buffer.from('synthetic').toString('base64'),
            },
          },
        });
      if (operation === 'RespondToAuthChallenge' && input.ChallengeName === 'PASSWORD_VERIFIER')
        return route.fulfill({
          headers,
          json: {
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            Session: 'synthetic-setup',
            ChallengeParameters: { userAttributes: '{}', requiredAttributes: '[]' },
          },
        });
      if (operation === 'RespondToAuthChallenge') {
        expect(input.Session).toBe('synthetic-setup');
        expect(input.ChallengeResponses).toEqual({
          USERNAME: 'pending',
          NEW_PASSWORD: 'SyntheticChosenPassword1!',
        });
        setup = true;
      }
      return route.fulfill({
        headers,
        json: {
          AuthenticationResult: {
            IdToken: jwt('id', verified),
            AccessToken: jwt('access', verified),
            RefreshToken: 'synthetic-refresh',
            ExpiresIn: 3600,
          },
        },
      });
    });
    const membership = {
      memberId: 'synthetic-member',
      username: 'pending',
      role: 'parent',
      household: { householdId: 'synthetic-home', name: 'Home', timezone: 'America/Chicago' },
    };
    let profile: { memberId: string; displayName: string; color: string; version: number } | null =
      null;
    const chosenProfile = {
      memberId: membership.memberId,
      displayName: 'New parent',
      color: 'PINE',
      version: 1,
    };
    await context.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname,
        headers = { 'cache-control': 'no-store' };
      if (path.endsWith('/memberships/current'))
        return active
          ? route.fulfill({ headers, json: { membership } })
          : route.fulfill({
              status: 403,
              headers,
              json: { error: { code: 'MEMBERSHIP_PENDING_ACTIVATION' } },
            });
      if (path.endsWith('/parent-activations')) {
        if (!verified)
          return route.fulfill({
            status: 403,
            headers,
            json: { error: { code: 'EMAIL_VERIFICATION_REQUIRED' } },
          });
        if (recovery !== 'success' && !rejectedActivation) {
          rejectedActivation = true;
          if (recovery === 'network') return route.abort();
          return route.fulfill({
            status: 409,
            headers,
            json: {
              error: {
                code: 'PENDING_ACCOUNT_CONFLICT',
                message: 'Activation is busy. Try again.',
              },
            },
          });
        }
        const bearer = route.request().headers().authorization.split(' ')[1];
        const claims = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString());
        expect(claims.email_verified).toBe(true);
        expect(route.request().postData()).toBeNull();
        active = true;
        activations++;
        return route.fulfill({ headers, json: { membership } });
      }
      if (path.endsWith('/profiles/me')) {
        if (route.request().method() === 'PUT') {
          expect(route.request().postDataJSON()).toEqual({
            displayName: 'My chosen name',
            color: 'LAKE',
            version: 0,
          });
          profile = { ...chosenProfile, displayName: 'My chosen name', color: 'LAKE' };
          return route.fulfill({ status: 201, headers, json: { profile } });
        }
        return route.fulfill({ headers, json: { profile } });
      }
      if (path.endsWith('/family-members'))
        return route.fulfill({
          headers,
          json: {
            members: [
              {
                ...profile,
                username: 'pending',
                role: 'parent',
                activationState: 'ACTIVE',
                allowedActions: [],
              },
            ],
          },
        });
      return route.fulfill({
        status: 403,
        headers,
        json: { error: { code: 'MEMBER_ACCESS_UNAVAILABLE' } },
      });
    });
    await page.goto('/activate-parent');
    await page.getByLabel('Username', { exact: true }).fill('pending');
    await page.getByLabel('One-time setup code', { exact: true }).fill('SyntheticSetupPassword1!');
    await page.getByLabel('Password', { exact: true }).fill('SyntheticChosenPassword1!');
    await page.getByRole('button', { name: 'Choose password', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Verify your recovery email', exact: true }),
    ).toBeVisible();
    expect(setup).toBe(true);
    expect(active).toBe(false);
    await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Verification code requested');
    expect(verificationRequests).toBe(1);
    await page.getByLabel('Email-verification code', { exact: true }).fill('WrongSyntheticCode');
    await page.getByRole('button', { name: 'Verify email and activate', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('invalid or expired');
    expect(activations).toBe(0);
    await expect(page.getByLabel('Email-verification code', { exact: true })).toHaveValue('');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath('activation-verification.png'),
      fullPage: true,
    });
    await page
      .getByLabel('Email-verification code', { exact: true })
      .fill('SyntheticVerificationCode');
    await page.getByRole('button', { name: 'Verify email and activate', exact: true }).click();
    if (recovery !== 'success') {
      await expect(
        page.getByRole('button', { name: 'Retry activation', exact: true }),
      ).toBeEnabled();
      expect(verificationSubmissions).toBe(2); // Wrong code, then one successful verification.
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('activation-retry.png'), fullPage: true });
      if (recovery === 'reload') await page.reload();
      else await page.getByRole('button', { name: 'Retry activation', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/profile\/setup$/);
    expect(profile).toBeNull();
    await page.goto('/family');
    await expect(page).toHaveURL(/\/profile\/setup$/);
    await page.reload();
    await expect(page).toHaveURL(/\/profile\/setup$/);
    await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('');
    await page.getByLabel('Display name', { exact: true }).fill('My chosen name');
    await page.getByLabel('Lake', { exact: true }).check();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath('parent-first-login-profile.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Continue to family management', exact: true }).click();
    await expect(page).toHaveURL(/\/family$/);
    await expect(
      page.getByRole('heading', { name: 'Family management', exact: true }),
    ).toBeVisible();
    expect(activations).toBe(1);
    const history = JSON.stringify(await page.evaluate(() => globalThis.history.state));
    const storage = await page.evaluate(() =>
      JSON.stringify(Object.fromEntries(Object.entries(localStorage))),
    );
    for (const secret of [
      'SyntheticSetupPassword1!',
      'SyntheticChosenPassword1!',
      'SyntheticVerificationCode',
      'WrongSyntheticCode',
    ]) {
      expect(history + page.url() + storage).not.toContain(secret);
    }
    await page.goBack();
    expect(activations).toBe(1);
  });
}
