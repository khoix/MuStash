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

test('admin portal authenticates and manages active stashes', async ({ page }) => {
  const filename = `admin-${Date.now()}.png`;
  const stashId = await createStash(page, filename);

  await page.goto('/mustash/admin/');
  await expect(page.getByTestId('admin-password')).toBeVisible();
  await page.getByTestId('admin-password').fill('e2e-admin-password');
  await page.getByTestId('admin-login').click();
  await expect(page.getByTestId('admin-stash-list')).toBeVisible();

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

test('admin API rejects unauthenticated access', async ({ request }) => {
  const response = await request.get('/mustash/api/admin/stashes');
  expect(response.status()).toBe(401);
});
