import { expect, test, chromium, firefox, webkit, type BrowserContext } from '@playwright/test';
import { rm } from 'node:fs/promises';
import {
  authMarkerKey,
  authStoragePrefix,
  localCredentialKey,
} from '../../src/session/authStorageContract';
import { installSessionHttpFixture, signInSynthetic } from '../helpers/browserSession';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.beforeEach(async ({ context }) => installSessionHttpFixture(context));

test('same-browser tabs restore one account and propagate sign-out while discarding private drafts', async ({
  page,
  context,
}) => {
  await signInSynthetic(page);
  const peer = await context.newPage();
  await peer.goto('/family');
  await expect(peer.getByRole('heading', { name: 'Family management', exact: true })).toBeVisible();
  await peer.getByRole('link', { name: 'My profile', exact: true }).click();
  await expect(peer.getByRole('heading', { name: 'Edit my profile' })).toBeFocused();
  await expect(peer.getByLabel('Display name')).toHaveValue('Parent private profile');
  await peer.getByLabel('Display name').fill('Private peer draft');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  for (const tab of [page, peer]) {
    await expect(tab.getByRole('heading', { name: 'Sign in', exact: true })).toBeFocused();
    await expect(tab.getByRole('navigation', { name: 'Application' })).toHaveCount(0);
    await expect(tab.getByLabel('Display name')).toHaveCount(0);
  }
  await peer.goBack();
  await peer.reload();
  await expect(peer.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const persisted = await page.evaluate(() => Object.entries(localStorage));
  expect(
    persisted.filter(([key]) => key.includes('.credentials.') || key.includes('.pending.')),
  ).toEqual([]);
  expect(
    persisted.some(
      ([key, value]) => key.endsWith('.current') && JSON.parse(value).kind === 'signed-out',
    ),
  ).toBe(true);
});

test('a sign-in in one tab is adopted by an already-open signed-out peer', async ({
  page,
  context,
}) => {
  await page.goto('/sign-in');
  const peer = await context.newPage();
  await peer.goto('/sign-in');
  await page.getByLabel('Username').fill('parentone');
  await page.getByLabel('Password').fill('SyntheticPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(peer.getByRole('heading', { name: 'Family management', exact: true })).toBeVisible();
  await expect(peer.getByText('Parent private home')).toBeVisible();
});

test('storage-event fallback converges when BroadcastChannel is unavailable', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true });
  });
  await signInSynthetic(page);
  const peer = await context.newPage();
  await peer.goto('/family');
  await expect(peer.getByText('Parent private home')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(peer.getByRole('heading', { name: 'Sign in', exact: true })).toBeFocused();
});

test('account replacement reauthorizes context and never mixes the prior account’s content', async ({
  page,
  context,
}) => {
  await signInSynthetic(page);
  const peer = await context.newPage();
  await peer.goto('/profile');
  await expect(peer.getByLabel('Display name')).toHaveValue('Parent private profile');
  await peer.getByLabel('Display name').fill('Private old-account draft');
  // Exercise another authorized provider client publishing a different account;
  // this does not introduce an account-switcher surface into the product.
  await page.evaluate(async () => {
    const { createBrowserSessionProvider } = await import('/src/session/browserSessionProvider.ts');
    const { loadAuthConfig } = await import('/src/config/authConfig.ts');
    const result = await createBrowserSessionProvider(loadAuthConfig()).provider.signIn(
      'childtwo',
      'SyntheticPassword123!',
    );
    if (result.kind !== 'success') throw new Error('Synthetic account replacement failed');
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
  });
  for (const tab of [page, peer]) {
    await expect(tab.getByRole('navigation', { name: 'Application' })).toContainText('My Todos');
    await expect(tab.getByText('Parent private home')).toHaveCount(0);
    expect(
      (await tab.getByLabel('Display name').count()) === 0 ||
        (await tab.getByLabel('Display name').inputValue()) !== 'Private old-account draft',
    ).toBe(true);
    await tab.getByRole('link', { name: 'My profile', exact: true }).click();
    await expect(tab.getByLabel('Display name')).toHaveValue('Child private profile');
  }
});

test('conflicting legacy tabs are cleared without selecting or promoting either account', async ({
  page,
  context,
}) => {
  await page.addInitScript(
    (key) => sessionStorage.setItem(key, 'legacy-private-one'),
    localCredentialKey('test-client'),
  );
  await page.goto('/sign-in');
  await expect(
    page.getByText('Sign in once more after this update.', { exact: false }),
  ).toBeVisible();
  const peer = await context.newPage();
  await peer.addInitScript(
    (key) => sessionStorage.setItem(key, 'legacy-private-two'),
    localCredentialKey('test-client'),
  );
  await peer.goto('/sign-in');
  await expect(peer.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  for (const tab of [page, peer])
    expect(await tab.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.values(localStorage).join(''))).not.toContain(
    'legacy-private',
  );
  await page.getByLabel('Username').fill('parentone');
  await page.getByLabel('Password').fill('SyntheticPassword123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(peer.getByRole('heading', { name: 'Family management', exact: true })).toBeVisible();
});

test('blocked or corrupt storage has explicit recovery and preserves unrelated origin values', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.evaluate(
    ({ markerKey }) => {
      localStorage.setItem(markerKey, '{malformed');
      localStorage.setItem('unrelated-session-test', 'keep');
    },
    { markerKey: authMarkerKey('test-client') },
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'We couldn’t access your saved session' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('unrelated-session-test'))).toBe('keep');
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith('todone.auth.v1.'))
        throw new DOMException('synthetic auth-storage denial', 'SecurityError');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('todone.auth.v1.'))
        throw new DOMException('synthetic auth-storage denial', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'We couldn’t access your saved session' }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByText('Your private information has been cleared from this page.', { exact: false }),
  ).toBeVisible();
});

test('separate browser profiles remain signed out and auth storage contains no private app values', async ({
  page,
  browser,
}) => {
  await signInSynthetic(page);
  const values = await page.evaluate(() => Object.values(localStorage).join(''));
  for (const privateValue of [
    'Parent private home',
    'Parent private profile',
    'SyntheticPassword123!',
  ])
    expect(values).not.toContain(privateValue);
  const isolated = await browser.newContext();
  await installSessionHttpFixture(isolated);
  try {
    const separatePage = await isolated.newPage();
    await separatePage.goto('http://localhost:3000/family');
    await expect(separatePage.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  } finally {
    await isolated.close();
  }
});

test('a reopened persistent browser context restores the renewable account', async ({
  browserName,
}, testInfo) => {
  const directory = testInfo.outputPath('synthetic-returning-profile');
  const browserType = { chromium, firefox, webkit }[browserName];
  let context: BrowserContext | undefined;
  try {
    context = await browserType.launchPersistentContext(directory, {
      baseURL: 'http://localhost:3000',
      headless: true,
    });
    await installSessionHttpFixture(context);
    const first = await context.newPage();
    await signInSynthetic(first);
    await context.close();
    context = undefined;
    context = await browserType.launchPersistentContext(directory, {
      baseURL: 'http://localhost:3000',
      headless: true,
    });
    await installSessionHttpFixture(context);
    const returning = await context.newPage();
    await returning.goto('/profile');
    await expect(returning.getByLabel('Display name')).toHaveValue('Parent private profile');
    const ownedKeys = await returning.evaluate(
      (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
      authStoragePrefix('test-client'),
    );
    expect(ownedKeys.some((key) => key.includes('.credentials.'))).toBe(true);
  } finally {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('simultaneous tab sign-ins converge on one published browser account', async ({
  page,
  context,
}) => {
  await page.goto('/sign-in');
  const peer = await context.newPage();
  await peer.goto('/sign-in');
  await page.getByLabel('Username').fill('parentone');
  await page.getByLabel('Password').fill('SyntheticPassword123!');
  await peer.getByLabel('Username').fill('childtwo');
  await peer.getByLabel('Password').fill('SyntheticPassword123!');
  let requests = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('http://localhost:9229/**', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().AuthFlow === 'USER_PASSWORD_AUTH'
    ) {
      requests++;
      if (requests === 2) release();
      await barrier;
    }
    await route.fallback();
  });
  await Promise.all([
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
    peer.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  await expect.poll(() => requests).toBe(2);
  for (const tab of [page, peer]) {
    await expect(tab.getByRole('navigation', { name: 'Application' })).toBeVisible();
    await tab.getByRole('link', { name: 'My profile', exact: true }).click();
  }
  const current = await page.getByLabel('Display name').inputValue();
  expect(['Parent private profile', 'Child private profile']).toContain(current);
  await expect(peer.getByLabel('Display name')).toHaveValue(current);
});

test('duplicate and reordered hints cannot change identity or refetch ready context', async ({
  page,
  context,
}) => {
  await signInSynthetic(page);
  const peer = await context.newPage();
  await peer.goto('/profile');
  await expect(peer.getByLabel('Display name')).toHaveValue('Parent private profile');
  let prerequisites = 0;
  peer.on('request', (request) => {
    if (/\/api\/v1\/(memberships\/current|profiles\/me)$/.test(request.url())) prerequisites++;
  });
  await peer.evaluate(
    async ({ markerKey, channelName }) => {
      for (const generation of ['older-generation', 'duplicate-generation', 'older-generation'])
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: markerKey,
            newValue: JSON.stringify({ kind: 'signed-out', generation }),
          }),
        );
      const monitor = new BroadcastChannel(channelName);
      const sender = new BroadcastChannel(channelName);
      let delivered = 0;
      const completed = new Promise<void>((resolve) => {
        monitor.onmessage = () => {
          delivered++;
          if (delivered === 3) resolve();
        };
      });
      for (const generation of ['older-generation', 'duplicate-generation', 'older-generation'])
        sender.postMessage({ kind: 'changed', generation });
      await completed;
      monitor.close();
      sender.close();
    },
    { markerKey: authMarkerKey('test-client'), channelName: 'todone.auth.v1.test-client.changes' },
  );
  await expect(peer.getByLabel('Display name')).toHaveValue('Parent private profile');
  expect(prerequisites).toBe(0);
});

test('a suspended page reconciles a missed sign-out before private presentation on resume', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true });
    Reflect.set(window, 'pauseAuthSignals', false);
    const types = new Set(['storage', 'pageshow', 'pagehide', 'visibilitychange', 'focus']);
    const wrappers = new WeakMap<EventListenerOrEventListenerObject, EventListener>();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (!listener || !types.has(type)) return add.call(this, type, listener, options);
      let wrapped = wrappers.get(listener);
      if (!wrapped) {
        wrapped = function (event) {
          if (Reflect.get(window, 'pauseAuthSignals')) return;
          if (typeof listener === 'function') listener.call(this, event);
          else listener.handleEvent(event);
        };
        wrappers.set(listener, wrapped);
      }
      return add.call(this, type, wrapped, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      return remove.call(
        this,
        type,
        listener ? (wrappers.get(listener) ?? listener) : listener,
        options,
      );
    };
  });
  await signInSynthetic(page);
  const peer = await context.newPage();
  await peer.goto('/profile');
  await peer.getByLabel('Display name').fill('Suspended private draft');
  await peer.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    Reflect.set(window, 'pauseAuthSignals', true);
  });
  await expect(peer.getByLabel('Display name')).toBeHidden();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  // Local UI clears before the asynchronous shared tombstone publication. Resume
  // only after logout is durable, so this checks a genuinely missed invalidation.
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).kind,
        authMarkerKey('test-client'),
      ),
    )
    .toBe('signed-out');
  await peer.evaluate(() => {
    const flashes: string[] = [];
    Reflect.set(window, 'resumedPrivateFlashes', flashes);
    new MutationObserver(() => {
      const input = document.querySelector<HTMLInputElement>('input[autocomplete="nickname"]');
      if (
        input?.value === 'Suspended private draft' &&
        getComputedStyle(input).visibility !== 'hidden'
      )
        flashes.push('private');
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
    Reflect.set(window, 'pauseAuthSignals', false);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(peer.getByRole('heading', { name: 'Sign in', exact: true })).toBeFocused();
  await expect(peer.getByLabel('Display name')).toHaveCount(0);
  expect(await peer.evaluate(() => Reflect.get(window, 'resumedPrivateFlashes'))).toEqual([]);
});
