import { test, expect } from '@playwright/test';

async function exportDiagnostics(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-diagnostics').click();
  const download = await downloadPromise;
  const path = await download.path();
  const fs = await import('node:fs/promises');
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

test('Guard Lab labels a real screenshot-attempt cue and exports a wider analysis window', async ({ page }) => {
  await page.goto('/testlab/');

  await page.getByTestId('arm-screenshot-attempt').click();
  const cue = page.getByTestId('press-now-cue');
  await expect(cue).toBeVisible({ timeout: 2600 });
  await expect(cue).toHaveText('TAKE SCREENSHOT NOW');

  const exported = await exportDiagnostics(page);
  const trial = exported.trials[0];

  expect(exported.groundTruthProtocol.version).toBe(1);
  expect(exported.screenshotViabilityStudy.version).toBe(1);
  expect(exported.screenshotViabilityStudy.decisionMode).toBe('raw-telemetry-only');
  expect(exported.screenshotViabilityStudy.analysisWindowAfterCueMs).toBe(1500);
  expect(trial.groundTruth.role).toBe('screenshot-attempt');
  expect(trial.groundTruth.expectedPress).toBeNull();
  expect(trial.screenshotStudy.expectedAction).toBe('screenshot-attempt');
  expect(trial.screenshotStudy.analysisWindowStartAtMs).toBe(trial.cueAtMs);
  expect(trial.screenshotStudy.analysisWindowEndAtMs - trial.cueAtMs).toBe(1500);
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

test('Guard Lab automatically applies the measurement preset before sensor startup', async ({ page }) => {
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
  await expect(page.locator('#carrierThresholdInput')).toHaveValue('40');
  await expect(page.locator('#transientThresholdInput')).toHaveValue('300');
  await expect(page.locator('#motionThresholdInput')).toHaveValue('5');
  await expect(page.locator('#guardDurationInput')).toHaveValue('800');

  const exported = await exportDiagnostics(page);
  expect(exported.screenshotViabilityStudy.presetAutoAppliedBeforeStart).toBe(true);
  expect(exported.screenshotViabilityStudy.measurementPreset.carrierTriggerPercent).toBe(40);
  expect(exported.screenshotViabilityStudy.measurementPreset.motionTriggerMps2).toBe(5);
  expect(exported.screenshotViabilityStudy.events.some((event) => event.type === 'study-preset-auto-applied')).toBe(true);
});

test('Guard Lab exports explicit no-action controls with control-specific cues', async ({ page }) => {
  await page.goto('/testlab/');

  await page.getByTestId('control-no-action').click();
  await expect(page.getByTestId('press-now-cue')).toBeVisible({ timeout: 2600 });
  await expect(page.getByTestId('press-now-cue')).toHaveText('DO NOTHING — HOLD STILL');

  const exported = await exportDiagnostics(page);
  expect(exported.trials[0].groundTruth.role).toBe('no-action');
  expect(exported.trials[0].groundTruth.expectedPress).toBeNull();
  expect(exported.trials[0].controlRole).toBe('no-action');
});

test('Guard Lab research mode prevents raw detector presentation from blacking the test window', async ({ page }) => {
  await page.goto('/testlab/');
  const overlay = page.getByTestId('guard-overlay');

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('guardlab:research-mode', {
      detail: { enabled: true, reason: 'e2e' }
    }));
    document.querySelector('[data-testid="guard-overlay"]').classList.add('active');
  });

  await expect(overlay).not.toHaveClass(/active/);
  expect(await overlay.evaluate((element) => getComputedStyle(element).visibility)).toBe('hidden');

  const exported = await exportDiagnostics(page);
  expect(exported.screenshotViabilityStudy.automaticBlackingDisabledDuringGuidedSuite).toBe(true);
  expect(exported.screenshotViabilityStudy.events.some((event) =>
    event.type === 'research-mode-changed' && event.enabled === true
  )).toBe(true);
});
