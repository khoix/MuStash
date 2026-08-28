import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=', 'base64');

async function uploadPng(page, password = '', allowDownload = true) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#localPreview img')).toBeVisible();
  await page.getByTestId('ttl-input').fill('1');
  await expect(page.getByTestId('allow-download')).toBeChecked();
  if (!allowDownload) await page.getByTestId('allow-download').uncheck();
  if (password) await page.getByTestId('password-input').fill(password);
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  await expect(page.getByTestId('share-url')).not.toHaveValue('');
  return page.getByTestId('share-url').inputValue();
}

test('uploads, previews, and downloads an unrestricted image', async ({ page }) => {
  const shareUrl = await uploadPng(page);
  expect(shareUrl).not.toContain('#k=');
  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();
  const preview = page.locator('[data-testid="media-preview"]');
  await expect(preview).toHaveAttribute('src', /\/api\/shares\/.+\/content/);
  await expect(page.getByTestId('download-button')).toBeVisible();
  await expect(page.getByTestId('preview-only-pill')).toBeHidden();

  const contentUrl = await preview.getAttribute('src');
  const downloadResponse = await page.request.get(new URL(`${contentUrl}?download=1`, page.url()).href);
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()['content-disposition']).toContain('attachment');
});

test('preview-only share hides download and rejects attachment requests', async ({ page }) => {
  const shareUrl = await uploadPng(page, '', false);
  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();
  await expect(page.getByTestId('download-button')).toBeHidden();
  await expect(page.getByTestId('preview-only-pill')).toBeVisible();
  await expect(page.locator('#mediaFrame')).toHaveClass(/preview-only/);

  const preview = page.locator('[data-testid="media-preview"]');
  expect(await preview.evaluate((element) => element.draggable)).toBe(false);
  const contextMenuPrevented = await preview.evaluate((element) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(contextMenuPrevented).toBe(true);

  const contentUrl = await preview.getAttribute('src');
  const previewResponse = await page.request.get(new URL(contentUrl, page.url()).href);
  expect(previewResponse.status()).toBe(200);
  expect(previewResponse.headers()['content-disposition']).toBe('inline');
  expect(previewResponse.headers()['cache-control']).toContain('no-store');

  const downloadResponse = await page.request.get(new URL(`${contentUrl}?download=1`, page.url()).href);
  expect(downloadResponse.status()).toBe(403);
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

test('ttl steppers adjust hours beside the input-suffix field', async ({ page }) => {
  await page.goto('/');
  const ttl = page.getByTestId('ttl-input');
  await ttl.fill('2');
  await page.getByRole('button', { name: 'Increase hours' }).click();
  await expect(ttl).toHaveValue('2.25');
  await page.getByRole('button', { name: 'Decrease hours' }).click();
  await expect(ttl).toHaveValue('2');
  await expect(page.locator('.number-steppers')).toBeVisible();
  await expect(page.locator('.ttl-control .input-suffix')).toBeVisible();
});

test('settings grid places ttl, password, and download controls', async ({ page }, testInfo) => {
  await page.goto('/');
  const grid = page.locator('.settings-grid');
  await expect(grid.locator('.settings-ttl')).toBeVisible();
  await expect(grid.locator('.settings-password')).toBeVisible();
  await expect(grid.locator('.settings-download')).toBeVisible();
  await expect(grid.getByTestId('allow-download')).toBeChecked();
  await expect(grid.locator('.download-option-copy strong')).toHaveText('Allow Download');
  await expect(grid.locator('.download-option-copy small')).toHaveCount(0);

  const areas = (await grid.evaluate((el) => getComputedStyle(el).gridTemplateAreas))
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const mobile = /mobile|pixel/i.test(testInfo.project.name);
  if (mobile) {
    expect(areas).toContain('ttl download');
    expect(areas).toContain('password password');
  } else {
    expect(areas).toBe('ttl password download');
  }
});

test('ttl input selects its value on focus', async ({ page }) => {
  await page.goto('/');
  const ttl = page.getByTestId('ttl-input');
  await ttl.fill('12');
  await ttl.blur();
  const selectedOnFocus = await ttl.evaluate((el) => {
    let called = false;
    const original = el.select.bind(el);
    el.select = () => {
      called = true;
      original();
    };
    el.dispatchEvent(new FocusEvent('focus'));
    return called;
  });
  expect(selectedOnFocus).toBe(true);
});

test('password field shows a right-aligned lock icon', async ({ page }) => {
  await page.goto('/');
  const wrap = page.locator('.input-with-icon');
  await expect(wrap.getByTestId('password-input')).toBeVisible();
  await expect(wrap.locator('.field-icon svg')).toBeVisible();
});
