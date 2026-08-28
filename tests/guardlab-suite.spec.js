import { test, expect } from '@playwright/test';

async function exportDiagnostics(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-diagnostics').click();
  const download = await downloadPromise;
  const path = await download.path();
  const fs = await import('node:fs/promises');
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

test('Guard Lab screenshot viability suite walks through volume setup, real screenshots, and controls', async ({ page }) => {
  await page.goto('/testlab/');
  await page.evaluate(() => {
    const pill = document.getElementById('armedPill');
    pill.textContent = 'Armed';
    pill.classList.add('armed');
    document.getElementById('workletStatus').textContent = 'Running @ 48.0 kHz';
    document.getElementById('recalibrateButton').disabled = false;
  });

  await page.getByTestId('run-full-test-suite').click();
  const dialog = page.getByTestId('full-suite-dialog');

  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('full-suite-step-label')).toHaveText('Step 1 of 19');
  await expect(page.getByTestId('full-suite-step-instruction')).toContainText('roughly 25%');
  await expect(page.getByTestId('full-suite-run-step')).toHaveText('Continue + recalibrate');

  // Research mode must suppress visible blacking while the study is running.
  await page.evaluate(() => document.querySelector('[data-testid="guard-overlay"]').classList.add('active'));
  await expect(page.getByTestId('guard-overlay')).not.toHaveClass(/active/);

  await page.getByTestId('full-suite-run-step').click();
  await expect(dialog).toBeHidden();
  await expect(dialog).toBeVisible({ timeout: 2800 });
  await expect(page.getByTestId('full-suite-step-label')).toHaveText('Step 2 of 19');
  await expect(page.getByTestId('full-suite-step-instruction')).toContainText('normal iPhone screenshot');

  await page.getByTestId('full-suite-run-step').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('press-now-cue')).toHaveText('TAKE SCREENSHOT NOW', { timeout: 2600 });

  await expect(dialog).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId('full-suite-step-label')).toHaveText('Step 3 of 19');

  await page.getByTestId('full-suite-cancel').click();
  await expect(dialog).toBeHidden();

  const exported = await exportDiagnostics(page);
  expect(exported.testSuite.version).toBe(2);
  expect(exported.testSuite.stepSet).toBe('screenshot-viability-v1');
  expect(exported.testSuite.automaticBlackingDisabled).toBe(true);
  expect(exported.testSuite.analysisWindowAfterCueMs).toBe(1500);
  expect(exported.testSuite.definition).toHaveLength(19);
  expect(exported.testSuite.definition.filter((step) => step.role === 'volume-setup')).toHaveLength(3);
  expect(exported.testSuite.definition.filter((step) => step.role === 'screenshot-attempt')).toHaveLength(9);
  expect(exported.testSuite.definition.filter((step) => step.role === 'no-action')).toHaveLength(3);
  expect(exported.testSuite.definition.filter((step) => step.role === 'screen-tap')).toHaveLength(2);
  expect(exported.testSuite.definition.filter((step) => step.role === 'movement')).toHaveLength(2);

  const run = exported.testSuite.runs.at(-1);
  expect(run.status).toBe('cancelled');
  expect(run.steps[0].status).toBe('completed');
  expect(run.steps[1].status).toBe('completed');
  expect(run.steps[2].status).toBe('cancelled');

  expect(exported.trials[0].suite.stepId).toBe('screenshot-low-1');
  expect(exported.trials[0].suite.volumeCondition).toBe('low');
  expect(exported.trials[0].screenshotStudy.role).toBe('screenshot-attempt');
  expect(exported.trials[0].screenshotStudy.volumeCondition).toBe('low');
});

test('Guard Lab screenshot suite includes the maximum-volume edge case explicitly', async ({ page }) => {
  await page.goto('/testlab/');

  const exported = await exportDiagnostics(page);
  const maximumSetup = exported.testSuite.definition.find((step) => step.id === 'setup-maximum');

  expect(maximumSetup.volumeCondition).toBe('maximum');
  expect(maximumSetup.instruction).toContain('critical edge case');
  expect(exported.testSuite.systemVolume.browserVerified).toBe(false);
});
