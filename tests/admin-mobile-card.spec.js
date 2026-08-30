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

test('mobile stash card keeps status, metadata, and expiry control aligned', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stashId = await createStash(page, `mobile-card-${Date.now()}.png`);

  await loginAdmin(page);
  await page.getByTestId('admin-search').fill(stashId);
  let card = page.locator(`[data-stash-id="${stashId}"]`);
  await expect(card).toBeVisible();

  await card.getByTestId('admin-allow-download').uncheck();
  await card.getByTestId('admin-save-stash').click();
  card = page.locator(`[data-stash-id="${stashId}"]`);
  await expect(card).toContainText('Preview only');

  const layout = await page.evaluate((id) => {
    const card = document.querySelector(`[data-stash-id="${id}"]`);
    const cardRect = card.getBoundingClientRect();
    const pillRect = card.querySelector('.admin-pill-row').getBoundingClientRect();
    const titleRect = card.querySelector('.stash-title').getBoundingClientRect();
    const expiry = card.querySelector('[data-testid="admin-stash-expiry"]');
    const expiryRect = expiry.getBoundingClientRect();
    const expiryStyle = getComputedStyle(expiry);

    const visibleMeta = [...card.querySelectorAll('.stash-meta > span')]
      .filter((span) => getComputedStyle(span).display !== 'none')
      .map((span) => ({
        text: span.textContent,
        left: span.getBoundingClientRect().left,
        right: span.getBoundingClientRect().right,
        top: span.getBoundingClientRect().top
      }))
      .sort((a, b) => a.left - b.left);

    return {
      cardRight: cardRect.right,
      pillRight: pillRect.right,
      pillTop: pillRect.top,
      titleTop: titleRect.top,
      visibleMeta,
      expiryHeight: expiryRect.height,
      expiryLineHeight: Number.parseFloat(expiryStyle.lineHeight)
    };
  }, stashId);

  expect(layout.pillRight).toBeLessThanOrEqual(layout.cardRight - 8);
  expect(Math.abs(layout.pillTop - layout.titleTop)).toBeLessThan(4);

  expect(layout.visibleMeta).toHaveLength(2);
  expect(layout.visibleMeta[0].text).toMatch(/^Created /);
  expect(layout.visibleMeta[1].text).toMatch(/\b(?:B|KB|MB|GB)$/);
  expect(Math.abs(layout.visibleMeta[0].top - layout.visibleMeta[1].top)).toBeLessThan(2);
  expect(layout.visibleMeta[0].text).not.toContain('files');
  expect(layout.visibleMeta[1].text).not.toContain('Expiry');

  expect(layout.expiryLineHeight).toBeGreaterThanOrEqual(layout.expiryHeight - 3);
});
