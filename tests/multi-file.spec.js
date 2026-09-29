import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=', 'base64');

async function createMultiStash(page, name = 'Weekend files') {
  await page.goto('/');
  const fileInput = page.getByTestId('file-input');
  await expect(fileInput).toHaveAttribute('multiple', '');
  await fileInput.setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: png },
    { name: 'two.png', mimeType: 'image/png', buffer: png }
  ]);
  await expect(page.getByTestId('selected-file-item')).toHaveCount(2);
  await expect(page.getByTestId('selection-summary')).toContainText('2 files');
  await page.getByTestId('stash-name-input').fill(name);
  await page.getByTestId('ttl-input').fill('1');
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  return page.getByTestId('share-url').inputValue();
}

test('multiple files share one named stash and can be previewed individually', async ({ page }) => {
  const shareUrl = await createMultiStash(page, 'Weekend photos');
  await page.goto(shareUrl);

  await expect(page.getByTestId('media-state')).toBeVisible();
  await expect(page.locator('#fileName')).toHaveText('Weekend photos');
  await expect(page.getByTestId('stash-file-list')).toBeVisible();
  await expect(page.getByTestId('stash-file-row')).toHaveCount(2);
  await expect(page.locator('#fileSize')).toContainText('2 files');

  const rows = page.getByTestId('stash-file-row');
  await expect(rows.nth(0)).toContainText('one.png');
  await expect(rows.nth(1)).toContainText('two.png');
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveClass(/active/);
  await expect(page.getByTestId('media-preview')).toBeVisible();
});

test('download picker supports one file or a compressed multi-file ZIP', async ({ page }) => {
  const shareUrl = await createMultiStash(page);
  await page.goto(shareUrl);

  const downloadButton = page.getByTestId('download-button');
  await downloadButton.click();
  await expect(page.getByTestId('download-panel')).toBeVisible();
  const checkboxes = page.getByTestId('download-file-checkbox');
  await expect(checkboxes).toHaveCount(2);
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).toBeChecked();
  await expect(page.getByTestId('download-selected')).toHaveText('Download 2 files');

  const shareId = new URL(shareUrl).pathname.split('/').filter(Boolean).at(-1);
  const metaUrl = new URL(`../api/shares/${shareId}`, shareUrl).href;
  const metaResponse = await page.request.get(metaUrl);
  expect(metaResponse.status()).toBe(200);
  const meta = await metaResponse.json();
  expect(meta.files).toHaveLength(2);

  const zipResponse = await page.request.post(new URL(`../api/shares/${shareId}/download`, shareUrl).href, {
    data: { fileIds: meta.files.map((file) => file.id) }
  });
  expect(zipResponse.status()).toBe(200);
  expect(zipResponse.headers()['content-type']).toContain('application/zip');
  expect(zipResponse.headers()['content-disposition']).toMatch(/mustash-\d{12}\.zip/);
  const zipBytes = await zipResponse.body();
  expect(zipBytes.subarray(0, 2).toString('ascii')).toBe('PK');

  await checkboxes.nth(1).uncheck();
  await expect(page.getByTestId('download-selected')).toHaveText('Download file');
});

test('mobile reuses a recent ZIP from CacheStorage', async ({ page }, testInfo) => {
  test.skip(!/mobile/i.test(testInfo.project.name), 'mobile CacheStorage behavior');
  const shareUrl = await createMultiStash(page, 'Cached files');
  await page.goto(shareUrl);

  let zipPosts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/shares\/.+\/download$/.test(new URL(request.url()).pathname)) zipPosts += 1;
  });

  const firstDownload = page.waitForEvent('download');
  await page.getByTestId('download-button').click();
  await page.getByTestId('download-selected').click();
  await firstDownload;
  expect(zipPosts).toBe(1);

  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('mustash-zips-v1');
    return (await cache.keys()).length;
  }), { timeout: 10_000 }).toBeGreaterThan(0);

  const secondDownload = page.waitForEvent('download');
  await page.getByTestId('download-button').click();
  await page.getByTestId('download-selected').click();
  await secondDownload;
  expect(zipPosts).toBe(1);
});
