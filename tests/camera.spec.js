import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=', 'base64');

test('camera action requests the rear camera for image capture', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('take-photo')).toBeVisible();
  const cameraInput = page.getByTestId('camera-photo-input');
  await expect(cameraInput).toHaveAttribute('accept', 'image/*');
  await expect(cameraInput).toHaveAttribute('capture', 'environment');
});

test('a captured photo follows the normal preview and upload flow', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('camera-photo-input').setInputFiles({
    name: 'camera.jpg',
    mimeType: 'image/jpeg',
    buffer: png
  });

  await expect(page.locator('#localPreview img')).toBeVisible();
  await expect(page.locator('#localPreview .preview-meta strong')).toHaveText('camera.jpg');
  await page.getByTestId('ttl-input').fill('1');
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  await expect(page.getByTestId('share-url')).not.toHaveValue('');
});
