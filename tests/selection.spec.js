import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=', 'base64');

test('selected file can be removed before it is stashed', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('take-photo')).toHaveCount(0);
  await expect(page.getByTestId('camera-photo-input')).toHaveCount(0);

  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles({ name: 'remove-me.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#localPreview')).toBeVisible();
  await expect(page.getByTestId('remove-selected-file')).toBeVisible();

  await page.getByTestId('remove-selected-file').click();
  await expect(page.locator('#localPreview')).toBeHidden();
  expect(await fileInput.inputValue()).toBe('');

  await page.getByTestId('stash-button').click();
  await expect(page.locator('#status')).toContainText('Choose a file first');
  await expect(page.getByTestId('result-card')).toBeHidden();
});

test('stash name is prompted only when multiple files are queued', async ({ page }) => {
  await page.goto('/');

  const fileInput = page.getByTestId('file-input');
  const stashNameField = page.getByTestId('stash-name-field');
  const stashNameInput = page.getByTestId('stash-name-input');

  await expect(stashNameField).toBeHidden();

  await fileInput.setInputFiles({ name: 'one.png', mimeType: 'image/png', buffer: png });
  await expect(stashNameField).toBeHidden();

  await fileInput.setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: png });
  await expect(stashNameField).toBeVisible();
  await stashNameInput.fill('Two-file stash');

  await page.getByRole('button', { name: 'Remove two.png' }).click();
  await expect(stashNameField).toBeHidden();
  await expect(stashNameInput).toHaveValue('');
});
