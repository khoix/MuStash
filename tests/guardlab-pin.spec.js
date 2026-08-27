import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('Guard Lab test window stays fixed to the viewport while sensors are active', async ({ page }) => {
  await page.goto('/testlab/');
  const testWindow = page.getByTestId('test-window');
  const armedPill = page.locator('#armedPill');

  await expect(testWindow).not.toHaveClass(/sensor-pinned/);

  // Simulate the exact state transition produced by a successful Start sensors flow.
  await page.evaluate(() => {
    const pill = document.getElementById('armedPill');
    pill.textContent = 'Armed';
    pill.classList.add('armed');
  });

  await expect(testWindow).toHaveClass(/sensor-pinned/);
  expect(await testWindow.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  expect(await testWindow.evaluate((el) => el.parentElement === document.body)).toBe(true);

  const topBefore = await testWindow.evaluate((el) => el.getBoundingClientRect().top);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(50);
  const topAfter = await testWindow.evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(topAfter - topBefore)).toBeLessThanOrEqual(1);

  // Stop returns the actual test window to its original card in document flow.
  await page.evaluate(() => {
    const pill = document.getElementById('armedPill');
    pill.textContent = 'Disarmed';
    pill.classList.remove('armed');
  });
  await expect(testWindow).not.toHaveClass(/sensor-pinned/);
  expect(await testWindow.evaluate((el) => el.closest('.demo-card') !== null)).toBe(true);
});
