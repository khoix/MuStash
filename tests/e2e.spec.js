import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=', 'base64');

async function uploadPng(page, password = '') {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#localPreview img')).toBeVisible();
  await page.getByTestId('ttl-input').fill('1');
  if (password) await page.getByTestId('password-input').fill(password);
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  await expect(page.getByTestId('share-url')).not.toHaveValue('');
  return page.getByTestId('share-url').inputValue();
}

test('uploads and previews an unprotected image', async ({ page }) => {
  const shareUrl = await uploadPng(page);
  expect(shareUrl).not.toContain('#k=');
  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();
  await expect(page.locator('[data-testid="media-preview"]')).toHaveAttribute('src', /\/api\/shares\/.+\/content/);
});

test('password share uses a derived fragment key and can also be unlocked manually', async ({ browser, page }) => {
  const password = 'correct horse battery staple';
  const shareUrl = await uploadPng(page, password);
  expect(shareUrl).toContain('#k=');
  expect(shareUrl).not.toContain(encodeURIComponent(password));

  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();

  const stripped = shareUrl.split('#')[0];
  const context = await browser.newContext();
  const manual = await context.newPage();
  await manual.goto(stripped);
  await expect(manual.getByTestId('unlock-password')).toBeVisible();
  await manual.getByTestId('unlock-password').fill(password);
  await manual.getByTestId('unlock-button').click();
  await expect(manual.getByTestId('media-state')).toBeVisible();
  await context.close();
});

test('rejects unsupported files server-side', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'payload.txt', mimeType: 'text/plain', buffer: Buffer.from('<script>alert(1)</script>') });
  await page.getByTestId('stash-button').click();
  await expect(page.locator('#status')).toContainText('Unsupported media type');
  await expect(page.getByTestId('result-card')).toBeHidden();
});

test('drag and drop is offered only on desktop', async ({ page }, testInfo) => {
  await page.goto('/');
  const desktop = testInfo.project.name === 'chromium';
  const dropzone = page.locator('#dropzone');
  const dropHint = page.getByTestId('drop-hint');

  await expect(dropzone).toHaveAttribute('data-drag-enabled', String(desktop));
  if (desktop) await expect(dropHint).toBeVisible();
  else await expect(dropHint).toBeHidden();
});

test('hamburger menu exposes theme toggle and future settings', async ({ page }) => {
  await page.goto('/');
  const menuToggle = page.getByTestId('menu-toggle');
  const menu = page.locator('#appMenu');

  await expect(menu).toBeHidden();
  await menuToggle.click();
  await expect(menu).toBeVisible();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('theme-toggle')).toBeVisible();
  await expect(page.getByTestId('settings-item')).toBeDisabled();
  await expect(page.getByTestId('settings-item')).toContainText('Soon');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
});

test('theme preference persists from menu toggle', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('menu-toggle').click();
  const toggle = page.getByTestId('theme-toggle');
  const initialPressed = await toggle.getAttribute('aria-pressed');
  await toggle.click();

  const theme = await page.locator('html').getAttribute('data-theme');
  expect(['light', 'dark']).toContain(theme);
  await expect(toggle).toHaveAttribute('aria-pressed', initialPressed === 'true' ? 'false' : 'true');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.getByTestId('menu-toggle').click();
  await expect(page.getByTestId('theme-toggle')).toHaveAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
});
