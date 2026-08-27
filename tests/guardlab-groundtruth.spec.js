import { test, expect } from '@playwright/test';

test('Guard Lab emits an exact PRESS NOW cue and exports its timing window', async ({ page }) => {
  await page.goto('/testlab/');

  const cue = page.getByTestId('press-now-cue');
  await expect(cue).toBeHidden();
  await page.getByTestId('trial-volume-up').click();
  await expect(page.locator('#trialState')).toContainText('get ready');
  await expect(cue).toBeHidden();

  await expect(cue).toBeVisible({ timeout: 2600 });
  await expect(cue).toHaveText('PRESS VOLUME UP NOW');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-diagnostics').click();
  const download = await downloadPromise;
  const path = await download.path();
  const fs = await import('node:fs/promises');
  const exported = JSON.parse(await fs.readFile(path, 'utf8'));
  const trial = exported.trials[0];

  expect(exported.groundTruthProtocol.pressCueDelayMs).toBe(2000);
  expect(exported.groundTruthProtocol.pressWindowMs).toBe(700);
  expect(trial.cueAtMs).toBeGreaterThan(trial.armedAtMs);
  expect(trial.pressWindowStartAtMs).toBe(trial.cueAtMs);
  expect(trial.pressWindowEndAtMs - trial.pressWindowStartAtMs).toBe(700);
  expect(exported.events.some((event) => event.type === 'press-cue' && event.localTrialId === 1)).toBe(true);
});

test('Guard Lab requests iOS-style motion permission from the Start sensors gesture', async ({ page }) => {
  await page.addInitScript(() => {
    class MockDeviceMotionEvent extends Event {}
    MockDeviceMotionEvent.requestPermission = () => {
      window.__motionPermissionCalls = (window.__motionPermissionCalls || 0) + 1;
      return Promise.resolve('granted');
    };
    Object.defineProperty(window, 'DeviceMotionEvent', { configurable: true, value: MockDeviceMotionEvent });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new Error('mock mic unavailable')) }
    });
  });

  await page.goto('/testlab/');
  await page.getByTestId('start-lab').click();
  await expect(page.locator('#motionStatus')).toHaveText('Listening');
  expect(await page.evaluate(() => window.__motionPermissionCalls)).toBe(1);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-diagnostics').click();
  const download = await downloadPromise;
  const path = await download.path();
  const fs = await import('node:fs/promises');
  const exported = JSON.parse(await fs.readFile(path, 'utf8'));
  expect(exported.permissions.motion).toBe('granted');
  expect(exported.motion.permissionRequestedFromStartGesture).toBe(true);
  expect(exported.events.some((event) => event.type === 'motion-permission-requested-from-start-gesture')).toBe(true);
});

test('Guard Lab applies the next-test preset in one tap', async ({ page }) => {
  await page.goto('/testlab/');
  await page.getByTestId('apply-test-preset').click();

  await expect(page.locator('#frequencyInput')).toHaveValue('18500');
  await expect(page.locator('#toneInput')).toHaveValue('15');
  await expect(page.locator('#carrierThresholdInput')).toHaveValue('30');
  await expect(page.locator('#transientThresholdInput')).toHaveValue('300');
  await expect(page.locator('#motionThresholdInput')).toHaveValue('5');
  await expect(page.locator('#guardDurationInput')).toHaveValue('800');
});
