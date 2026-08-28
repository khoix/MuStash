const suiteTrialActions = document.querySelector('.trial-actions');
const suiteArmedPill = document.getElementById('armedPill');
const suiteStartButton = document.getElementById('startButton');
const suiteExportButton = document.getElementById('exportLogButton');
const suiteVolumeUpButton = document.getElementById('volumeUpTrialButton');
const suiteVolumeDownButton = document.getElementById('volumeDownTrialButton');

const SUITE_VERSION = 1;
const SUITE_STEP_SETTLE_MS = 5250;
const SUITE_SENSOR_START_TIMEOUT_MS = 10000;
const SUITE_STEPS = [
  { id: 'volume-up-1', role: 'expected-press', armTestId: 'trial-volume-up', title: 'Volume Up · 1 of 3', instruction: 'When the test window says PRESS VOLUME UP NOW, press Volume Up once.' },
  { id: 'volume-up-2', role: 'expected-press', armTestId: 'trial-volume-up', title: 'Volume Up · 2 of 3', instruction: 'When the test window says PRESS VOLUME UP NOW, press Volume Up once.' },
  { id: 'volume-up-3', role: 'expected-press', armTestId: 'trial-volume-up', title: 'Volume Up · 3 of 3', instruction: 'When the test window says PRESS VOLUME UP NOW, press Volume Up once.' },
  { id: 'volume-down-1', role: 'expected-press', armTestId: 'trial-volume-down', title: 'Volume Down · 1 of 3', instruction: 'When the test window says PRESS VOLUME DOWN NOW, press Volume Down once.' },
  { id: 'volume-down-2', role: 'expected-press', armTestId: 'trial-volume-down', title: 'Volume Down · 2 of 3', instruction: 'When the test window says PRESS VOLUME DOWN NOW, press Volume Down once.' },
  { id: 'volume-down-3', role: 'expected-press', armTestId: 'trial-volume-down', title: 'Volume Down · 3 of 3', instruction: 'When the test window says PRESS VOLUME DOWN NOW, press Volume Down once.' },
  { id: 'no-press-1', role: 'no-press', armTestId: 'control-no-press', title: 'No-press control · 1 of 4', instruction: 'When the test window says NO PRESS — HOLD STILL, do not press anything and keep the phone still.' },
  { id: 'no-press-2', role: 'no-press', armTestId: 'control-no-press', title: 'No-press control · 2 of 4', instruction: 'When the test window says NO PRESS — HOLD STILL, do not press anything and keep the phone still.' },
  { id: 'no-press-3', role: 'no-press', armTestId: 'control-no-press', title: 'No-press control · 3 of 4', instruction: 'When the test window says NO PRESS — HOLD STILL, do not press anything and keep the phone still.' },
  { id: 'no-press-4', role: 'no-press', armTestId: 'control-no-press', title: 'No-press control · 4 of 4', instruction: 'When the test window says NO PRESS — HOLD STILL, do not press anything and keep the phone still.' },
  { id: 'screen-tap-1', role: 'screen-tap', armTestId: 'control-screen-tap', title: 'Screen-tap control · 1 of 2', instruction: 'When the test window says TAP SCREEN NOW, tap the screen once without pressing a volume button.' },
  { id: 'screen-tap-2', role: 'screen-tap', armTestId: 'control-screen-tap', title: 'Screen-tap control · 2 of 2', instruction: 'When the test window says TAP SCREEN NOW, tap the screen once without pressing a volume button.' },
  { id: 'movement-1', role: 'movement', armTestId: 'control-movement', title: 'Movement control · 1 of 2', instruction: 'When the test window says MOVE PHONE NOW, slightly reposition or squeeze the phone once without touching a volume button.' },
  { id: 'movement-2', role: 'movement', armTestId: 'control-movement', title: 'Movement control · 2 of 2', instruction: 'When the test window says MOVE PHONE NOW, slightly reposition or squeeze the phone once without touching a volume button.' }
];

const suiteRuns = [];
const suiteEvents = [];
let suiteRunSequence = 0;
let activeSuiteRun = null;
let activeSuiteStep = null;
let suiteStepTimer = null;
let suiteStartWaitTimer = null;
let observedTrialCount = 0;
let suiteButton = null;
let suiteStatus = null;
let suiteDialog = null;
let suiteDialogKicker = null;
let suiteDialogTitle = null;
let suiteDialogBody = null;
let suiteDialogConfirm = null;
let suiteDialogCancel = null;
let suiteDialogExport = null;

suiteVolumeUpButton?.addEventListener('click', () => { observedTrialCount += 1; }, { capture: true });
suiteVolumeDownButton?.addEventListener('click', () => { observedTrialCount += 1; }, { capture: true });
installSuiteDiagnosticPatch();
queueMicrotask(initializeSuiteUi);

function initializeSuiteUi() {
  if (!suiteTrialActions) return;
  if (!document.querySelector('[data-testid="control-no-press"]')) {
    setTimeout(initializeSuiteUi, 0);
    return;
  }
  if (document.querySelector('[data-testid="run-full-test-suite"]')) return;

  suiteButton = document.createElement('button');
  suiteButton.type = 'button';
  suiteButton.className = 'primary-button suite-launch';
  suiteButton.dataset.testid = 'run-full-test-suite';
  suiteButton.textContent = 'Run full test suite';
  suiteButton.addEventListener('click', launchFullSuite);

  suiteStatus = document.createElement('div');
  suiteStatus.className = 'suite-status';
  suiteStatus.dataset.testid = 'full-suite-status';
  suiteStatus.textContent = `${SUITE_STEPS.length} guided steps · about 70 seconds plus prompts`;

  suiteTrialActions.prepend(suiteStatus);
  suiteTrialActions.prepend(suiteButton);
  createSuiteDialog();
}

function launchFullSuite() {
  if (activeSuiteRun && (activeSuiteRun.status === 'running' || activeSuiteRun.status === 'starting-sensors')) return;
  suiteButton.disabled = true;
  suiteButton.textContent = 'Test suite running…';

  if (suiteArmedPill?.classList.contains('armed')) {
    beginSuiteRun();
    return;
  }

  setSuiteStatus('Starting sensors…');
  showWaitingDialog(
    'Starting sensors',
    'Grant any microphone or motion permission prompts. The first guided test will appear when the sensors are armed.'
  );
  recordSuiteEvent('suite-sensor-start-requested');
  suiteStartButton?.click();
  waitForSensorsArmed().then(beginSuiteRun, (error) => {
    suiteButton.disabled = false;
    suiteButton.textContent = 'Run full test suite';
    setSuiteStatus('Suite not started');
    showErrorDialog('Could not start sensors', `${error.message} Tap Start sensors manually, then run the suite again.`);
    recordSuiteEvent('suite-sensor-start-failed', { message: error.message });
  });
}

function waitForSensorsArmed() {
  return new Promise((resolve, reject) => {
    if (suiteArmedPill?.classList.contains('armed')) {
      resolve();
      return;
    }
    let settled = false;
    const observer = new MutationObserver(check);
    observer.observe(suiteArmedPill, { attributes: true, childList: true, characterData: true, subtree: true });
    suiteStartWaitTimer = setTimeout(() => finish(false), SUITE_SENSOR_START_TIMEOUT_MS);

    function check() {
      if (suiteArmedPill?.classList.contains('armed')) finish(true);
    }
    function finish(success) {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (suiteStartWaitTimer) clearTimeout(suiteStartWaitTimer);
      suiteStartWaitTimer = null;
      if (success) resolve();
      else reject(new Error('Sensor startup did not reach Armed state.'));
    }
  });
}

function beginSuiteRun() {
  const run = {
    id: ++suiteRunSequence,
    status: 'running',
    startedWallTime: new Date().toISOString(),
    startedPerfMs: performance.now(),
    completedWallTime: null,
    completedPerfMs: null,
    steps: []
  };
  suiteRuns.push(run);
  activeSuiteRun = run;
  activeSuiteStep = null;
  recordSuiteEvent('suite-started', { runId: run.id, stepCount: SUITE_STEPS.length });
  promptSuiteStep(0);
}

function promptSuiteStep(index) {
  if (!activeSuiteRun || activeSuiteRun.status !== 'running') return;
  if (index >= SUITE_STEPS.length) {
    completeSuiteRun();
    return;
  }

  const definition = SUITE_STEPS[index];
  const step = {
    index: index + 1,
    id: definition.id,
    role: definition.role,
    armTestId: definition.armTestId,
    title: definition.title,
    instruction: definition.instruction,
    status: 'prompted',
    promptedWallTime: new Date().toISOString(),
    promptedPerfMs: performance.now(),
    startedWallTime: null,
    startedPerfMs: null,
    completedWallTime: null,
    completedPerfMs: null,
    trialOrdinal: null
  };
  activeSuiteRun.steps.push(step);
  activeSuiteStep = step;
  setSuiteStatus(`Paused for step ${step.index} of ${SUITE_STEPS.length}`);
  showStepDialog(step);
  recordSuiteEvent('suite-step-prompted', { runId: activeSuiteRun.id, stepIndex: step.index, stepId: step.id, role: step.role });
}

function runCurrentSuiteStep() {
  if (!activeSuiteRun || !activeSuiteStep || activeSuiteStep.status !== 'prompted') return;
  const target = document.querySelector(`[data-testid="${activeSuiteStep.armTestId}"]`);
  if (!(target instanceof HTMLButtonElement)) {
    failSuiteRun(`Missing test control: ${activeSuiteStep.armTestId}`);
    return;
  }

  activeSuiteStep.status = 'running';
  activeSuiteStep.startedWallTime = new Date().toISOString();
  activeSuiteStep.startedPerfMs = performance.now();
  hideSuiteDialog();
  setSuiteStatus(`Running step ${activeSuiteStep.index} of ${SUITE_STEPS.length}: ${activeSuiteStep.title}`);
  recordSuiteEvent('suite-step-started', {
    runId: activeSuiteRun.id,
    stepIndex: activeSuiteStep.index,
    stepId: activeSuiteStep.id,
    role: activeSuiteStep.role
  });

  target.click();
  activeSuiteStep.trialOrdinal = observedTrialCount;

  const step = activeSuiteStep;
  suiteStepTimer = setTimeout(() => {
    if (!activeSuiteRun || activeSuiteRun.status !== 'running' || activeSuiteStep !== step) return;
    step.status = 'completed';
    step.completedWallTime = new Date().toISOString();
    step.completedPerfMs = performance.now();
    recordSuiteEvent('suite-step-completed', {
      runId: activeSuiteRun.id,
      stepIndex: step.index,
      stepId: step.id,
      role: step.role,
      trialOrdinal: step.trialOrdinal
    });
    suiteStepTimer = null;
    activeSuiteStep = null;
    promptSuiteStep(step.index);
  }, SUITE_STEP_SETTLE_MS);
}

function completeSuiteRun() {
  if (!activeSuiteRun) return;
  activeSuiteRun.status = 'completed';
  activeSuiteRun.completedWallTime = new Date().toISOString();
  activeSuiteRun.completedPerfMs = performance.now();
  recordSuiteEvent('suite-completed', { runId: activeSuiteRun.id, completedSteps: activeSuiteRun.steps.length });
  setSuiteStatus(`Suite complete · ${activeSuiteRun.steps.length}/${SUITE_STEPS.length} steps`);
  suiteButton.disabled = false;
  suiteButton.textContent = 'Run full test suite again';
  showCompletionDialog(activeSuiteRun);
  activeSuiteRun = null;
  activeSuiteStep = null;
}

function cancelSuiteRun() {
  if (!activeSuiteRun) {
    hideSuiteDialog();
    return;
  }
  if (suiteStepTimer) clearTimeout(suiteStepTimer);
  suiteStepTimer = null;
  if (activeSuiteStep && activeSuiteStep.status === 'prompted') activeSuiteStep.status = 'cancelled';
  activeSuiteRun.status = 'cancelled';
  activeSuiteRun.completedWallTime = new Date().toISOString();
  activeSuiteRun.completedPerfMs = performance.now();
  recordSuiteEvent('suite-cancelled', { runId: activeSuiteRun.id, completedSteps: activeSuiteRun.steps.filter((step) => step.status === 'completed').length });
  setSuiteStatus('Suite cancelled');
  suiteButton.disabled = false;
  suiteButton.textContent = 'Run full test suite';
  activeSuiteRun = null;
  activeSuiteStep = null;
  hideSuiteDialog();
}

function failSuiteRun(message) {
  if (activeSuiteRun) {
    activeSuiteRun.status = 'failed';
    activeSuiteRun.completedWallTime = new Date().toISOString();
    activeSuiteRun.completedPerfMs = performance.now();
    activeSuiteRun.error = message;
    recordSuiteEvent('suite-failed', { runId: activeSuiteRun.id, message });
  }
  if (suiteStepTimer) clearTimeout(suiteStepTimer);
  suiteStepTimer = null;
  suiteButton.disabled = false;
  suiteButton.textContent = 'Run full test suite';
  setSuiteStatus('Suite stopped');
  showErrorDialog('Test suite stopped', message);
  activeSuiteRun = null;
  activeSuiteStep = null;
}

function createSuiteDialog() {
  suiteDialog = document.createElement('div');
  suiteDialog.className = 'suite-dialog-backdrop';
  suiteDialog.dataset.testid = 'full-suite-dialog';
  suiteDialog.hidden = true;

  const card = document.createElement('section');
  card.className = 'suite-dialog';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'suiteDialogTitle');

  suiteDialogKicker = document.createElement('div');
  suiteDialogKicker.className = 'suite-dialog-kicker';
  suiteDialogKicker.dataset.testid = 'full-suite-step-label';

  suiteDialogTitle = document.createElement('h3');
  suiteDialogTitle.id = 'suiteDialogTitle';

  suiteDialogBody = document.createElement('p');
  suiteDialogBody.className = 'suite-dialog-copy';
  suiteDialogBody.dataset.testid = 'full-suite-step-instruction';

  const actions = document.createElement('div');
  actions.className = 'suite-dialog-actions';

  suiteDialogConfirm = document.createElement('button');
  suiteDialogConfirm.type = 'button';
  suiteDialogConfirm.className = 'primary-button';
  suiteDialogConfirm.dataset.testid = 'full-suite-run-step';
  suiteDialogConfirm.addEventListener('click', runCurrentSuiteStep);

  suiteDialogExport = document.createElement('button');
  suiteDialogExport.type = 'button';
  suiteDialogExport.className = 'primary-button';
  suiteDialogExport.dataset.testid = 'full-suite-export';
  suiteDialogExport.textContent = 'Export diagnostics';
  suiteDialogExport.hidden = true;
  suiteDialogExport.addEventListener('click', () => suiteExportButton?.click());

  suiteDialogCancel = document.createElement('button');
  suiteDialogCancel.type = 'button';
  suiteDialogCancel.className = 'secondary-button';
  suiteDialogCancel.dataset.testid = 'full-suite-cancel';
  suiteDialogCancel.textContent = 'Cancel suite';
  suiteDialogCancel.addEventListener('click', cancelSuiteRun);

  actions.append(suiteDialogConfirm, suiteDialogExport, suiteDialogCancel);
  card.append(suiteDialogKicker, suiteDialogTitle, suiteDialogBody, actions);
  suiteDialog.append(card);
  document.body.append(suiteDialog);
}

function showStepDialog(step) {
  suiteDialogKicker.textContent = `Step ${step.index} of ${SUITE_STEPS.length}`;
  suiteDialogTitle.textContent = step.title;
  suiteDialogBody.textContent = `${step.instruction} The trial will run for five seconds, then the suite will pause before the next step.`;
  suiteDialogConfirm.textContent = `Run step ${step.index}`;
  suiteDialogConfirm.hidden = false;
  suiteDialogExport.hidden = true;
  suiteDialogCancel.hidden = false;
  suiteDialogCancel.textContent = 'Cancel suite';
  suiteDialog.hidden = false;
  suiteDialogConfirm.focus();
}

function showWaitingDialog(title, body) {
  suiteDialogKicker.textContent = 'Full test suite';
  suiteDialogTitle.textContent = title;
  suiteDialogBody.textContent = body;
  suiteDialogConfirm.hidden = true;
  suiteDialogExport.hidden = true;
  suiteDialogCancel.hidden = true;
  suiteDialog.hidden = false;
}

function showCompletionDialog(run) {
  suiteDialogKicker.textContent = 'Complete';
  suiteDialogTitle.textContent = 'Full test suite finished';
  suiteDialogBody.textContent = `${run.steps.length} guided tests are complete. Export diagnostics now so the suite labels are included with the sensor data.`;
  suiteDialogConfirm.hidden = true;
  suiteDialogExport.hidden = false;
  suiteDialogCancel.hidden = false;
  suiteDialogCancel.textContent = 'Close';
  suiteDialog.hidden = false;
  suiteDialogExport.focus();
}

function showErrorDialog(title, body) {
  suiteDialogKicker.textContent = 'Full test suite';
  suiteDialogTitle.textContent = title;
  suiteDialogBody.textContent = body;
  suiteDialogConfirm.hidden = true;
  suiteDialogExport.hidden = true;
  suiteDialogCancel.hidden = false;
  suiteDialogCancel.textContent = 'Close';
  suiteDialog.hidden = false;
  suiteDialogCancel.focus();
}

function hideSuiteDialog() {
  if (suiteDialog) suiteDialog.hidden = true;
}

function setSuiteStatus(text) {
  if (suiteStatus) suiteStatus.textContent = text;
}

function installSuiteDiagnosticPatch() {
  const BaseBlob = window.Blob;
  if (typeof BaseBlob !== 'function') return;

  class SuiteBlob extends BaseBlob {
    constructor(parts = [], options = {}) {
      let nextParts = parts;
      if (options?.type === 'application/json' && parts.length === 1 && typeof parts[0] === 'string') {
        try {
          const payload = JSON.parse(parts[0]);
          if (payload?.purpose === 'MuStash Guard Lab volume-button/screenshot-guard tuning') {
            payload.testSuite = {
              version: SUITE_VERSION,
              stepSet: 'guided-volume-button-controls-v1',
              stepSettleMs: SUITE_STEP_SETTLE_MS,
              definition: SUITE_STEPS.map((step, index) => ({
                index: index + 1,
                id: step.id,
                role: step.role,
                armTestId: step.armTestId,
                title: step.title,
                instruction: step.instruction
              })),
              runs: suiteRuns.map(serializeSuiteRun),
              events: suiteEvents
            };
            annotateSuiteTrials(payload);
            nextParts = [JSON.stringify(payload, null, 2)];
          }
        } catch {}
      }
      super(nextParts, options);
    }
  }

  try { window.Blob = SuiteBlob; } catch {}
}

function annotateSuiteTrials(payload) {
  const trials = Array.isArray(payload.trials) ? payload.trials : [];
  for (const run of suiteRuns) {
    for (const step of run.steps) {
      if (!Number.isInteger(step.trialOrdinal) || step.trialOrdinal < 1) continue;
      const trial = trials[step.trialOrdinal - 1];
      if (!trial) continue;
      trial.suite = {
        runId: run.id,
        stepIndex: step.index,
        stepId: step.id,
        role: step.role,
        title: step.title
      };
    }
  }
}

function serializeSuiteRun(run) {
  return {
    id: run.id,
    status: run.status,
    startedWallTime: run.startedWallTime,
    startedPerfMs: run.startedPerfMs,
    completedWallTime: run.completedWallTime,
    completedPerfMs: run.completedPerfMs,
    error: run.error || null,
    steps: run.steps.map((step) => ({ ...step }))
  };
}

function recordSuiteEvent(type, data = {}) {
  suiteEvents.push({
    type,
    wallTime: new Date().toISOString(),
    perfMs: performance.now(),
    ...data
  });
}
