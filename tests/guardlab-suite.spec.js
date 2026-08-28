import { test, expect } from '@playwright/test';

async function exportDiagnostics(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-diagnostics').click();
  const download = await downloadPromise;
  const path = await download.path();
  const fs = await import('node:fs/promises');
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

test('Guard Lab full test suite prompts and advances one guided step at a time', async ({ page }) => {
  await page.goto('/testlab/');
  await page.evaluate(() => {
    const pill = document.getElementById('armedPill');
    pill.textContent = 'Armed';
    pill.classList.add('armed');
  });

  await page.getByTestId('run-full-test-suite').click();
  const dialog = page.getByTestId('full-suite-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('full-suite-step-label')).toHaveText('Step 1 of 14');
  await expect(page.getByTestId('full-suite-step-instruction')).toContainText('press Volume Up once');

  await page.getByTestId('full-suite-run-step').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#trialState')).toContainText('get ready');
  await expect(page.getByTestId('press-now-cue')).toHaveText('PRESS VOLUME UP NOW', { timeout: 2600 });

  await expect(dialog).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId('full-suite-step-label')).toHaveText('Step 2 of 14');

  // The suite dialog is intentionally modal while paused between steps. Exit it
  // through its own control before exercising the page-level export button.
  await page.getByTestId('full-suite-cancel').click();
  await expect(dialog).toBeHidden();

  const exported = await exportDiagnostics(page);
  expect(exported.testSuite.version).toBe(1);
  expect(exported.testSuite.definition).toHaveLength(14);
  expect(exported.testSuite.definition.filter((step) => step.role === 'expected-press')).toHaveLength(6);
  expect(exported.testSuite.definition.filter((step) => step.role === 'no-press')).toHaveLength(4);
  expect(exported.testSuite.definition.filter((step) => step.role === 'screen-tap')).toHaveLength(2);
  expect(exported.testSuite.definition.filter((step) => step.role === 'movement')).toHaveLength(2);

  const run = exported.testSuite.runs.at(-1);
  expect(run.status).toBe('cancelled');
  expect(run.steps[0].status).toBe('completed');
  expect(run.steps[1].status).toBe('cancelled');
  expect(exported.trials[0].suite.stepId).toBe('volume-up-1');
  expect(exported.trials[0].suite.stepIndex).toBe(1);
});
