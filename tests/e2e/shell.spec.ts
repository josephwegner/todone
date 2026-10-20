import { expect, test } from '@playwright/test';
import { ProfileColor } from '../../shared/profilePalette';

test.describe('Application shell', () => {
  test('loads, shows exactly one h1, a working skip link, and production sign in', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Todone' })).toBeVisible();

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();

    await expect(page.getByRole('heading', { level: 2, name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Temporary sign-in')).toHaveCount(0);
  });

  test('respects prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Todone' })).toBeVisible();

    // Proves the global `prefers-reduced-motion: reduce` rule
    // (src/assets/main.css) actually applies its near-zero override to
    // computed styles, not just that the page renders.
    const transitionDuration = await page.evaluate(
      () => getComputedStyle(document.body).transitionDuration,
    );
    expect(Number.parseFloat(transitionDuration)).toBeCloseTo(0.000001, 6);
  });
});

// Exercise the authored tokens in the browser so inheritance and Tailwind aliases are included.
test('profile tones retain readable contrast and stable semantic colors', async ({ page }) => {
  await page.goto('/');
  const palettes = await page.evaluate((colors) => {
    const luminance = (value: string) => {
      const channels = value
        .trim()
        .split(/\s+/)
        .map(Number)
        .map((channel) => {
          const s = channel / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    return colors.map((color) => {
      document.documentElement.dataset.profileColor = color;
      const style = getComputedStyle(document.documentElement);
      const token = (name: string) => style.getPropertyValue(`--td-${name}`);
      const contrast = (a: string, b: string) => {
        const values = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x);
        return (values[0]! + 0.05) / (values[1]! + 0.05);
      };
      return {
        color,
        deep: token('profile-deep'),
        contrast: contrast('profile-on-color', 'profile-deep'),
        bodyContrast: contrast('bark', 'profile-light'),
        action: getComputedStyle(document.querySelector('button.primary')!).backgroundColor,
      };
    });
  }, Object.values(ProfileColor));
  expect(new Set(palettes.map(({ deep }) => deep)).size).toBe(8);
  expect(new Set(palettes.map(({ action }) => action)).size).toBe(1);
  for (const palette of palettes) {
    expect(palette.contrast, palette.color).toBeGreaterThanOrEqual(4.5);
    expect(palette.bodyContrast, palette.color).toBeGreaterThanOrEqual(4.5);
  }
});

for (const route of [
  '/sign-in',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
]) {
  test(`${route} reflows at 320px and enlarged text with keyboard focus`, async ({
    page,
  }, testInfo) => {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 2 })).toBeFocused();
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.screenshot({ path: testInfo.outputPath('reflow-320.png'), fullPage: true });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.screenshot({ path: testInfo.outputPath('text-200-percent.png'), fullPage: true });
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Username')).toBeFocused();
  });
}

test('forced colors preserves visible native field focus', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  await page.getByLabel('Username').focus();
  await expect(page.getByLabel('Username')).toBeFocused();
  const outline = await page.getByLabel('Username').evaluate((field) => {
    const style = getComputedStyle(field);
    return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(outline.style).toBe('solid');
});

test('keyboard focus rings contrast with the surrounding paper surface', async ({ page }) => {
  await page.goto('/');
  for (const target of [
    page.getByLabel('Username'),
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ]) {
    await target.focus();
    const contrast = await target.evaluate((element) => {
      const style = getComputedStyle(element);
      const paper = getComputedStyle(document.documentElement)
        .getPropertyValue('--td-paper')
        .trim()
        .split(/\s+/)
        .map(Number);
      const outline = style.outlineColor.match(/[\d.]+/g)!.map(Number);
      const alpha = outline[3] ?? 1;
      const luminance = (rgb: number[]) => {
        const channels = rgb.map((channel) => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const ring = luminance(
        outline.slice(0, 3).map((channel, i) => channel * alpha + paper[i]! * (1 - alpha)),
      );
      const background = luminance(paper);
      return (Math.max(ring, background) + 0.05) / (Math.min(ring, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(3);
  }
});
