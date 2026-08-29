import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=', 'base64');

test('camera action is offered only on mobile and requests the rear camera', async ({ page }, testInfo) => {
  await page.goto('/');

  const mobile = /mobile/i.test(testInfo.project.name);
  const action = page.getByTestId('take-photo');
  if (mobile) await expect(action).toBeVisible();
  else await expect(action).toBeHidden();

  const cameraInput = page.getByTestId('camera-photo-input');
  await expect(cameraInput).toHaveAttribute('accept', 'image/*');
  await expect(cameraInput).toHaveAttribute('capture', 'environment');
  await expect(page.getByText('Capture with your device camera')).toHaveCount(0);
});

test('a mobile camera photo follows the normal preview and upload flow', async ({ page }, testInfo) => {
  test.skip(!/mobile/i.test(testInfo.project.name), 'Camera capture UI is mobile-only.');
  await page.goto('/');

  await page.getByTestId('camera-photo-input').setInputFiles({
    name: 'camera.jpg',
    mimeType: 'image/jpeg',
    buffer: png
  });

  await expect(page.locator('#localPreview img')).toBeVisible();
  await expect(page.locator('#localPreview .preview-meta strong')).toHaveText('camera.jpg');
  await expect(page.getByTestId('remove-selected-file')).toBeVisible();
  await page.getByTestId('ttl-input').fill('1');
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  await expect(page.getByTestId('share-url')).not.toHaveValue('');
});

test('selected file can be removed before it is stashed', async ({ page }) => {
  await page.goto('/');

  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles({ name: 'remove-me.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#localPreview')).toBeVisible();
  await expect(page.getByTestId('remove-selected-file')).toBeVisible();

  await page.getByTestId('remove-selected-file').click();
  await expect(page.locator('#localPreview')).toBeHidden();
  expect(await fileInput.inputValue()).toBe('');

  await page.getByTestId('stash-button').click();
  await expect(page.locator('#status')).toContainText('Choose or capture a file first');
  await expect(page.getByTestId('result-card')).toBeHidden();
});
