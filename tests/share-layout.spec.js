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

test('share tags stay top-right and file metadata sits below preview on one line', async ({ page }) => {
  const shareUrl = await createProtectedPreviewOnlyShare(page);
  await page.goto(shareUrl);
  await expect(page.getByTestId('media-state')).toBeVisible();
  await expect(page.getByTestId('preview-only-pill')).toBeVisible();
  await expect(page.locator('#protectedPill')).toBeVisible();

  const heading = page.locator('.media-heading');
  const eyebrow = heading.locator('.eyebrow');
  const tags = page.getByTestId('share-tags');
  const frame = page.locator('#mediaFrame');
  const metadata = page.getByTestId('media-meta-line');

  const [headingBox, eyebrowBox, tagsBox, frameBox, metadataBox] = await Promise.all([
    heading.boundingBox(), eyebrow.boundingBox(), tags.boundingBox(), frame.boundingBox(), metadata.boundingBox()
  ]);
  expect(headingBox && eyebrowBox && tagsBox && frameBox && metadataBox).toBeTruthy();
  expect(tagsBox.x).toBeGreaterThan(eyebrowBox.x);
  expect(tagsBox.x + tagsBox.width).toBeLessThanOrEqual(headingBox.x + headingBox.width + 1);
  expect(tagsBox.y).toBeLessThan(frameBox.y);
  expect(metadataBox.y).toBeGreaterThanOrEqual(frameBox.y + frameBox.height - 1);

  await expect(page.locator('#fileName')).toHaveText('layout-check.png');
  await expect(page.locator('#metaLine')).toContainText('expires');

  const styles = await page.evaluate(() => {
    const file = getComputedStyle(document.getElementById('fileName'));
    const meta = getComputedStyle(document.getElementById('metaLine'));
    const row = getComputedStyle(document.querySelector('[data-testid="media-meta-line"]'));
    return {
      fileSize: file.fontSize,
      metaSize: meta.fontSize,
      fileWeight: file.fontWeight,
      metaWeight: meta.fontWeight,
      fileColor: file.color,
      metaColor: meta.color,
      whiteSpace: row.whiteSpace
    };
  });

  expect(styles.fileSize).toBe(styles.metaSize);
  expect(styles.fileWeight).toBe(styles.metaWeight);
  expect(styles.fileColor).toBe(styles.metaColor);
  expect(styles.whiteSpace).toBe('nowrap');
});
