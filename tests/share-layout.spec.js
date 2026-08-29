import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL8AAAAASUVORK5CYII=', 'base64');

async function createProtectedPreviewOnlyShare(page) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'layout-check.png',
    mimeType: 'image/png',
    buffer: png
  });
  await page.getByTestId('ttl-input').fill('1');
  await page.getByTestId('allow-download').uncheck();
  await page.getByTestId('password-input').fill('layout-check-password');
  await page.getByTestId('stash-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();
  return page.getByTestId('share-url').inputValue();
}

test('share filename uses eyebrow header while tags stay top-right and metadata stays below preview', async ({ page }) => {
  const shareUrl = await createProtectedPreviewOnlyShare(page);
  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();
  await expect(page.getByTestId('preview-only-pill')).toBeVisible();
  await expect(page.locator('#protectedPill')).toBeVisible();

  const heading = page.locator('.media-heading');
  const fileName = page.locator('#fileName');
  const tags = page.getByTestId('share-tags');
  const frame = page.locator('#mediaFrame');
  const metadata = page.getByTestId('media-meta-line');
  const fileSize = page.locator('#fileSize');
  const expiryLine = page.locator('#expiryLine');

  await expect(fileName).toHaveText('layout-check.png');
  await expect(fileName).toHaveClass(/\beyebrow\b/);
  await expect(metadata.locator('#fileName')).toHaveCount(0);
  await expect(fileSize).toHaveText(/^[\d.]+ (?:B|KB|MB|GB)$/);
  await expect(expiryLine).toHaveText(/^Expiry: \d{4}-\d{2}-\d{2}, \d{2}:\d{2}:\d{2} [ap]$/);

  const [headingBox, fileNameBox, tagsBox, frameBox, metadataBox] = await Promise.all([
    heading.boundingBox(), fileName.boundingBox(), tags.boundingBox(), frame.boundingBox(), metadata.boundingBox()
  ]);
  expect(headingBox && fileNameBox && tagsBox && frameBox && metadataBox).toBeTruthy();
  expect(tagsBox.x).toBeGreaterThan(fileNameBox.x);
  expect(tagsBox.x + tagsBox.width).toBeLessThanOrEqual(headingBox.x + headingBox.width + 1);
  expect(tagsBox.y).toBeLessThan(frameBox.y);
  expect(fileNameBox.y).toBeLessThan(frameBox.y);
  expect(metadataBox.y).toBeGreaterThanOrEqual(frameBox.y + frameBox.height - 1);

  const styles = await page.evaluate(() => {
    const file = getComputedStyle(document.getElementById('fileName'));
    const row = getComputedStyle(document.querySelector('[data-testid="media-meta-line"]'));
    const size = getComputedStyle(document.getElementById('fileSize'));
    const expiry = getComputedStyle(document.getElementById('expiryLine'));
    return {
      textTransform: file.textTransform,
      letterSpacing: file.letterSpacing,
      fontWeight: file.fontWeight,
      display: row.display,
      justifyContent: row.justifyContent,
      sizeAlign: size.textAlign,
      expiryAlign: expiry.textAlign,
      whiteSpace: row.whiteSpace
    };
  });

  expect(styles.textTransform).toBe('uppercase');
  expect(styles.letterSpacing).not.toBe('normal');
  expect(Number(styles.fontWeight)).toBeGreaterThanOrEqual(700);
  expect(styles.display).toBe('flex');
  expect(styles.justifyContent).toBe('space-between');
  expect(styles.sizeAlign).toBe('left');
  expect(styles.expiryAlign).toBe('right');
  expect(styles.whiteSpace).toBe('nowrap');
});
