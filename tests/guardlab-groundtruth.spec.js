import { test, expect } from '@playwright/test';

async function exportDiagnostics(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-diagnostics').click();
  const download = await downloadPromise;
  const path = await download.path();
  const fs = await import('node:fs/promises');
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

async function dispatchMotion(page, acceleration, rotationRate) {
  await page.evaluate(({ acceleration, rotationRate }) => {
    const event = new Event('devicemotion');
    Object.defineProperties(event, {
      acceleration: { value: acceleration },
      accelerationIncludingGravity: { value: acceleration },
      rotationRate: { value: rotationRate },
      interval: { value: 16.67 }
    });
    window.dispatchEvent(event);
  }, { acceleration, rotationRate });
}

test('Guard Lab emits an exact PRESS NOW cue and exports its timing window', async ({ page }) => {
  await page.goto('/testlab/');

  const cue = page.getByTestId('press-now-cue');
  await expect(cue).toBeHidden();
  await page.getByTestId('trial-volume-up').click();
  await expect(page.locator('#trialState')).toContainText('get ready');
  await expect(cue).toBeHidden();

  await expect(cue).toBeVisible({ timeout: 2600 });
  await expect(cue).toHaveText('PRESS VOLUME UP NOW');

  const exported = await exportDiagnostics(page);
  const trial = exported.trials[0];

  expect(exported.groundTruthProtocol.version).toBe(1);
  expect(exported.refinement.version).toBe(1);
  expect(exported.groundTruthProtocol.pressCueDelayMs).toBe(2000);
  expect(exported.groundTruthProtocol.pressWindowMs).toBe(700);
  expect(trial.groundTruth.role).toBe('expected-press');
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

  const exported = await exportDiagnostics(page);
  expect(exported.permissions.motion).toBe('granted');
  expect(exported.motion.permissionRequestedFromStartGesture).toBe(true);
  expect(exported.events.some((event) => event.type === 'motion-permission-requested-from-start-gesture')).toBe(true);
});

test('Guard Lab automatically applies the test preset before sensor startup', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new Error('mock mic unavailable')) }
    });
  });
  await page.goto('/testlab/');
  await page.getByTestId('start-lab').click();

  await expect(page.locator('#frequencyInput')).toHaveValue('18500');
  await expect(page.locator('#toneInput')).toHaveValue('15');
  await expect(page.locator('#carrierThresholdInput')).toHaveValue('30');
  await expect(page.locator('#transientThresholdInput')).toHaveValue('300');
  await expect(page.locator('#motionThresholdInput')).toHaveValue('0.5');
  await expect(page.locator('#guardDurationInput')).toHaveValue('800');

  const exported = await exportDiagnostics(page);
  expect(exported.refinement.presetAutoAppliedBeforeStart).toBe(true);
  expect(exported.refinement.events.some((event) => event.type === 'preset-auto-applied')).toBe(true);
});

test('Guard Lab exports explicit control roles and control-specific cues', async ({ page }) => {
  await page.goto('/testlab/');

  await page.getByTestId('control-no-press').click();
  await expect(page.getByTestId('press-now-cue')).toBeVisible({ timeout: 2600 });
  await expect(page.getByTestId('press-now-cue')).toHaveText('NO PRESS — HOLD STILL');

  const exported = await exportDiagnostics(page);
  expect(exported.trials[0].groundTruth.role).toBe('no-press');
  expect(exported.trials[0].groundTruth.expectedPress).toBeNull();
  expect(exported.trials[0].controlRole).toBe('no-press');
});

test('Guard Lab motion-shape filter accepts button-like rotation and rejects tap/movement shapes', async ({ page }) => {
  await page.goto('/testlab/');
  const overlay = page.getByTestId('guard-overlay');

  await page.getByTestId('trial-volume-up').click();
  await expect(page.getByTestId('press-now-cue')).toBeVisible({ timeout: 2600 });
  await dispatchMotion(page, { x: 0, y: 0, z: 0 }, { alpha: 0, beta: 0, gamma: 0 });
  await dispatchMotion(page, { x: 0.7, y: 0, z: 0 }, { alpha: 2, beta: 7, gamma: 7 });
  await expect(overlay).toHaveClass(/active/);

  await page.waitForTimeout(900);
  await page.getByTestId('control-screen-tap').click();
  await expect(page.getByTestId('press-now-cue')).toHaveText('TAP SCREEN NOW', { timeout: 2600 });
  await dispatchMotion(page, { x: 0, y: 0, z: 0 }, { alpha: 0, beta: 0, gamma: 0 });
  await dispatchMotion(page, { x: 0.8, y: 0, z: 0 }, { alpha: 1, beta: 2, gamma: 1 });
  await expect(overlay).not.toHaveClass(/active/);

  await page.waitForTimeout(300);
  await page.getByTestId('control-movement').click();
  await expect(page.getByTestId('press-now-cue')).toHaveText('MOVE PHONE NOW', { timeout: 2600 });
  await dispatchMotion(page, { x: 0, y: 0, z: 0 }, { alpha: 0, beta: 0, gamma: 0 });
  await dispatchMotion(page, { x: 1.2, y: 0, z: 0 }, { alpha: 20, beta: 50, gamma: 50 });
  await expect(overlay).not.toHaveClass(/active/);

  const exported = await exportDiagnostics(page);
  expect(exported.refinement.motionShape.rotationMagnitudeMinDps).toBe(5.5);
  expect(exported.refinement.motionShape.rotationMagnitudeMaxDps).toBe(30);
  expect(exported.refinement.visualPolicy).toContain('button-like motion');
  expect(exported.refinement.events.some((event) => event.type === 'motion-shape-candidate')).toBe(true);
  expect(exported.refinement.events.filter((event) => event.type === 'motion-shape-rejected').length).toBeGreaterThanOrEqual(2);
});
