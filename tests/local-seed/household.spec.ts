import { test, expect, type Page } from '@playwright/test';
import { localFixtureAccounts } from '../../local-dev/fixtures';

/** Run db:reset:local, then dev:full. Every request uses real local-emulator authentication. */
test('both seeded parents share a household, preserve self-only profiles and cannot manage the peer parent', async ({
  page,
  browser,
  request,
}) => {
  const signIn = async (target: Page, account: (typeof localFixtureAccounts)[number]) => {
    await target.goto('/sign-in');
    await target.getByLabel('Username', { exact: true }).fill(account.username);
    await target.getByLabel('Password', { exact: true }).fill(account.password);
    const membershipRequest = target.waitForRequest(
      (r) => new URL(r.url()).pathname === '/api/v1/memberships/current',
    );
    await target.getByRole('button', { name: 'Sign in', exact: true }).click();
    const authorization = (await membershipRequest).headers().authorization;
    if (!authorization) throw new Error('Authenticated local request missing');
    return { authorization };
  };
  const firstHeaders = await signIn(page, localFixtureAccounts[0]);
  await expect(page).toHaveURL(/\/family$/);
  await expect(page.getByRole('list', { name: 'Household members' })).toContainText(
    '@localparent2',
  );
  const secondContext = await browser.newContext();
  const childContext = await browser.newContext();
  try {
    const peer = await secondContext.newPage();
    const secondHeaders = await signIn(peer, localFixtureAccounts[1]);
    await expect(peer).toHaveURL(/\/profile\/setup$/);
    await expect(peer.getByLabel('Display name', { exact: true })).toHaveValue('');
    await peer.goto('/family');
    await expect(peer).toHaveURL(/\/profile\/setup$/);
    await peer
      .getByLabel('Display name', { exact: true })
      .fill(localFixtureAccounts[1].displayName);
    await peer.getByLabel('Lake', { exact: true }).check();
    await peer.getByRole('button', { name: 'Continue to family management', exact: true }).click();
    await expect(peer).toHaveURL(/\/family$/);
    await expect(peer.getByRole('link', { name: 'Add a parent', exact: true })).toBeVisible();
    const firstRead = await request.get('/api/v1/memberships/current', { headers: firstHeaders });
    const secondRead = await request.get('/api/v1/memberships/current', { headers: secondHeaders });
    expect(firstRead.status()).toBe(200);
    expect(secondRead.status()).toBe(200);
    const first = (await firstRead.json()).membership,
      second = (await secondRead.json()).membership;
    expect(first.household).toEqual(second.household);
    expect(second.role).toBe('parent');
    expect(first.memberId).not.toBe(second.memberId);
    const directory = await request.get('/api/v1/family-members', { headers: secondHeaders });
    expect(directory.status()).toBe(200);
    const family = await directory.json();
    for (const username of ['localdev', 'localparent2', 'localchild'])
      expect(family.members.some((m: { username: string }) => m.username === username)).toBe(true);
    expect(JSON.stringify(family)).not.toContain('@example.test');
    const profile = (
      await (await request.get('/api/v1/profiles/me', { headers: secondHeaders })).json()
    ).profile;
    const invalidWrite = await request.put('/api/v1/profiles/me', {
      headers: secondHeaders,
      data: {
        displayName: 'Peer overwrite',
        color: 'LAKE',
        version: profile.version,
        memberId: first.memberId,
      },
    });
    expect(invalidWrite.status()).toBe(422);
    await peer.getByRole('link', { name: 'My profile', exact: true }).click();
    await peer.getByLabel('Display name', { exact: true }).fill('Second Parent Reviewed');
    await peer.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(peer).toHaveURL(/\/family$/);
    const own = (
      await (await request.get('/api/v1/profiles/me', { headers: secondHeaders })).json()
    ).profile;
    expect(own.displayName).toBe('Second Parent Reviewed');
    const firstProfile = (
      await (await request.get('/api/v1/profiles/me', { headers: firstHeaders })).json()
    ).profile;
    expect(firstProfile.displayName).toBe('Local Parent');
    const removal = await request.delete(`/api/v1/family-members/${first.memberId}`, {
      headers: { ...secondHeaders, 'idempotency-key': 'seed-peer-denial' },
      data: { confirmation: true },
    });
    expect(removal.status()).toBe(403);
    const reset = await request.put(`/api/v1/family-members/${first.memberId}/password`, {
      headers: secondHeaders,
      data: { password: 'LocalPeerChange123!' },
    });
    expect(reset.status()).toBe(403);
    const recovery = await request.get('/api/v1/security/recovery-email', {
      headers: secondHeaders,
    });
    expect(recovery.status()).toBe(200);
    expect((await recovery.json()).email).toBe('localparent2@example.test');
    const unsupported = await request.put('/api/v1/security/recovery-email', {
      headers: secondHeaders,
      data: { email: 'replacement@example.test' },
    });
    expect(unsupported.status()).toBe(503);
    const restore = await request.put('/api/v1/profiles/me', {
      headers: secondHeaders,
      data: { displayName: profile.displayName, color: profile.color, version: own.version },
    });
    expect(restore.status()).toBe(200);
    const child = await childContext.newPage();
    const childHeaders = await signIn(child, localFixtureAccounts[2]);
    await expect(child).toHaveURL(/\/todos$/);
    expect((await request.get('/api/v1/family-members', { headers: childHeaders })).status()).toBe(
      200,
    );
    await child.goto('/security');
    await expect(child).toHaveURL(/\/todos$/);
    expect(
      (
        await request.put('/api/v1/security/recovery-email', {
          headers: childHeaders,
          data: { email: 'child@example.test' },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await secondContext.close();
    await childContext.close();
  }
});
