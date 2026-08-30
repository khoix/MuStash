import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=', 'base64');

async function createStash(page, name) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name, mimeType: 'image/png', buffer: png });
  await page.getByTestId('ttl-input').fill('1');
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  const shareUrl = await page.getByTestId('share-url').inputValue();
  return shareUrl.split('/s/')[1].split(/[?#]/)[0];
}

async function loginAdmin(page) {
  await page.goto('/mustash/admin/');
  await expect(page.getByTestId('admin-password')).toBeVisible();
  await page.getByTestId('admin-password').fill('e2e-admin-password');
  await page.getByTestId('admin-login').click();
  await expect(page.getByTestId('admin-stash-list')).toBeVisible();
}

test('admin portal authenticates and manages active stashes', async ({ page }) => {
  const filename = `admin-${Date.now()}.png`;
  const stashId = await createStash(page, filename);

  await loginAdmin(page);
  await page.getByTestId('admin-search').fill(stashId);
  const card = page.locator(`[data-stash-id="${stashId}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(filename);

  await card.getByTestId('admin-stash-name').fill('Renamed by admin');
  await card.getByTestId('admin-allow-download').uncheck();
  await card.getByTestId('admin-save-stash').click();
  await expect(page.locator(`[data-stash-id="${stashId}"]`)).toContainText('Renamed by admin');
  await expect(page.locator(`[data-stash-id="${stashId}"]`)).toContainText('Preview only');

  const meta = await page.request.get(`/mustash/api/shares/${stashId}`);
  expect(meta.status()).toBe(200);
  const payload = await meta.json();
  expect(payload.name).toBe('Renamed by admin');
  expect(payload.allowDownload).toBe(false);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator(`[data-stash-id="${stashId}"]`).getByTestId('admin-delete-stash').click();
  await expect(page.locator(`[data-stash-id="${stashId}"]`)).toHaveCount(0);

  const deleted = await page.request.get(`/mustash/api/shares/${stashId}`);
  expect(deleted.status()).toBe(404);
});

test('admin batch actions apply to selected visible stashes', async ({ page }) => {
  const token = `batch-${Date.now()}`;
  const firstId = await createStash(page, `${token}-a.png`);
  const secondId = await createStash(page, `${token}-b.png`);

  await loginAdmin(page);
  await page.getByTestId('admin-search').fill(token);
  await expect(page.getByTestId('admin-stash-card')).toHaveCount(2);

  await page.getByTestId('admin-select-visible').check();
  await expect(page.getByTestId('admin-batch-bar')).toBeVisible();
  await expect(page.getByTestId('admin-batch-bar')).toContainText('2 selected');
  await expect(page.getByTestId('admin-select-stash').first()).toBeChecked();
  await expect(page.getByTestId('admin-select-stash').last()).toBeChecked();

  await page.getByTestId('batch-preview-only').click();
  await expect(page.locator('#adminStatus')).toContainText('Updated 2 stashes');
  await expect(page.getByTestId('admin-stash-card').first()).toContainText('Preview only');
  await expect(page.getByTestId('admin-stash-card').last()).toContainText('Preview only');

  for (const id of [firstId, secondId]) {
    const meta = await page.request.get(`/mustash/api/shares/${id}`);
    expect(meta.status()).toBe(200);
    expect((await meta.json()).allowDownload).toBe(false);
  }

  const expiryValue = await page.evaluate(() => {
    const date = new Date(Date.now() + 30 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  });
  await page.getByTestId('batch-expiry').fill(expiryValue);
  await page.getByTestId('batch-set-expiry').click();
  await expect(page.locator('#adminStatus')).toContainText('Updated 2 stashes');

  const expectedExpiry = new Date(expiryValue).getTime();
  for (const id of [firstId, secondId]) {
    const meta = await page.request.get(`/mustash/api/shares/${id}`);
    const payload = await meta.json();
    expect(Math.abs(Date.parse(payload.expiresAt) - expectedExpiry)).toBeLessThan(1_000);
  }

  await page.getByTestId('batch-allow-downloads').click();
  await expect(page.locator('#adminStatus')).toContainText('Updated 2 stashes');
  for (const id of [firstId, secondId]) {
    const meta = await page.request.get(`/mustash/api/shares/${id}`);
    expect((await meta.json()).allowDownload).toBe(true);
  }

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('batch-delete').click();
  await expect(page.locator('#adminStatus')).toContainText('Deleted 2 stashes');
  await expect(page.getByTestId('admin-stash-card')).toHaveCount(0);
  await expect(page.getByTestId('admin-batch-bar')).toBeHidden();

  for (const id of [firstId, secondId]) {
    expect((await page.request.get(`/mustash/api/shares/${id}`)).status()).toBe(404);
  }
});

test('admin mobile layout stays contained and compact', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stashId = await createStash(page, `mobile-layout-${Date.now()}.png`);

  await loginAdmin(page);
  await page.getByTestId('admin-search').fill(stashId);
  const card = page.locator(`[data-stash-id="${stashId}"]`);
  await expect(card).toBeVisible();
  await card.getByTestId('admin-select-stash').check();
  await expect(page.getByTestId('admin-batch-bar')).toBeVisible();

  const layout = await page.evaluate((id) => {
    const rect = (element) => element.getBoundingClientRect();
    const card = document.querySelector(`[data-stash-id="${id}"]`);
    const cardRect = rect(card);
    const expiryRect = rect(card.querySelector('[data-testid="admin-stash-expiry"]'));
    const batchRect = rect(document.querySelector('[data-testid="admin-batch-bar"]'));
    const batchExpiryRect = rect(document.querySelector('[data-testid="batch-expiry"]'));
    const setExpiryRect = rect(document.querySelector('[data-testid="batch-set-expiry"]'));
    const actionRects = [
      card.querySelector('[data-testid="admin-save-stash"]'),
      card.querySelector('.stash-actions a'),
      card.querySelector('[data-testid="admin-delete-stash"]')
    ].map(rect);

    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      expiryRight: expiryRect.right,
      batchHeight: batchRect.height,
      batchExpiryRight: batchExpiryRect.right,
      setExpiryLeft: setExpiryRect.left,
      actionTops: actionRects.map((item) => item.top)
    };
  }, stashId);

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.cardLeft).toBeGreaterThanOrEqual(6);
  expect(layout.cardRight).toBeLessThanOrEqual(layout.viewportWidth - 6);
  expect(layout.expiryRight).toBeLessThanOrEqual(layout.cardRight);
  expect(layout.batchExpiryRight).toBeLessThanOrEqual(layout.setExpiryLeft);
  expect(layout.batchHeight).toBeLessThan(215);
  expect(Math.max(...layout.actionTops) - Math.min(...layout.actionTops)).toBeLessThan(3);
});

test('admin API rejects unauthenticated access', async ({ request }) => {
  const response = await request.get('/mustash/api/admin/stashes');
  expect(response.status()).toBe(401);
});
