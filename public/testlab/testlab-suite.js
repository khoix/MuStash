const suiteTrialActions = document.querySelector('.trial-actions');
const suiteArmedPill = document.getElementById('armedPill');
const suiteStartButton = document.getElementById('startButton');
const suiteStopButton = document.getElementById('stopButton');
const suiteExportButton = document.getElementById('exportLogButton');
const suiteRecalibrateButton = document.getElementById('recalibrateButton');
const suiteWorkletStatus = document.getElementById('workletStatus');
const suiteVolumeDownButton = document.getElementById('volumeDownTrialButton');

const SUITE_VERSION = 2;
const SUITE_STEP_SET = 'screenshot-viability-v1';
const SUITE_TRIAL_SETTLE_MS = 5250;
const SUITE_RECALIBRATE_SETTLE_MS = 2100;
const SUITE_SENSOR_START_TIMEOUT_MS = 12000;
const ANALYSIS_WINDOW_AFTER_CUE_MS = 1500;

const SUITE_STEPS = [
  setupStep('setup-low', 'low', 'Set media volume · LOW (~25%)',
    'Use the physical volume buttons to set media volume to roughly 25%. Do not take a screenshot yet. When ready, the lab will recalibrate at this level.'),
  trialStep('screenshot-low-1', 'screenshot-attempt', 'low', 'Screenshot attempt · LOW · 1 of 3',
    'When the test window says TAKE SCREENSHOT NOW, take one normal iPhone screenshot using the physical screenshot button combination. Do not tap the screen.'),
  trialStep('screenshot-low-2', 'screenshot-attempt', 'low', 'Screenshot attempt · LOW · 2 of 3',
    'Take one normal iPhone screenshot exactly when TAKE SCREENSHOT NOW appears.'),
  trialStep('screenshot-low-3', 'screenshot-attempt', 'low', 'Screenshot attempt · LOW · 3 of 3',
    'Take one normal iPhone screenshot exactly when TAKE SCREENSHOT NOW appears.'),
  trialStep('no-action-low', 'no-action', 'low', 'No-action control · LOW',
    'When DO NOTHING — HOLD STILL appears, do nothing until the trial ends.'),

  setupStep('setup-medium', 'medium', 'Set media volume · MEDIUM (~50%)',
    'Use the physical volume buttons to set media volume to roughly 50%. Do not take a screenshot yet. The lab will recalibrate after you confirm.'),
  trialStep('screenshot-medium-1', 'screenshot-attempt', 'medium', 'Screenshot attempt · MEDIUM · 1 of 3',
    'Take one normal iPhone screenshot exactly when TAKE SCREENSHOT NOW appears.'),
  trialStep('screenshot-medium-2', 'screenshot-attempt', 'medium', 'Screenshot attempt · MEDIUM · 2 of 3',
    'Take one normal iPhone screenshot exactly when TAKE SCREENSHOT NOW appears.'),
  trialStep('screenshot-medium-3', 'screenshot-attempt', 'medium', 'Screenshot attempt · MEDIUM · 3 of 3',
    'Take one normal iPhone screenshot exactly when TAKE SCREENSHOT NOW appears.'),
  trialStep('no-action-medium', 'no-action', 'medium', 'No-action control · MEDIUM',
    'When DO NOTHING — HOLD STILL appears, do nothing until the trial ends.'),

  setupStep('setup-maximum', 'maximum', 'Set media volume · MAXIMUM',
    'Set media volume all the way to maximum using the physical volume buttons. Keep the phone away from your ears; the lab is emitting a high-frequency test tone. This is the critical edge case because Volume Up cannot raise the level any further.'),
  trialStep('screenshot-maximum-1', 'screenshot-attempt', 'maximum', 'Screenshot attempt · MAXIMUM · 1 of 3',
    'Take one normal iPhone screenshot exactly when TAKE SCREENSHOT NOW appears.'),
  trialStep('screenshot-maximum-2', 'screenshot-attempt', 'maximum', 'Screenshot attempt · MAXIMUM · 2 of 3',
    'Take one normal iPhone screenshot exactly when TAKE SCREENSHOT NOW appears.'),
  trialStep('screenshot-maximum-3', 'screenshot-attempt', 'maximum', 'Screenshot attempt · MAXIMUM · 3 of 3',
    'Take one normal iPhone screenshot exactly when TAKE SCREENSHOT NOW appears.'),
  trialStep('no-action-maximum', 'no-action', 'maximum', 'No-action control · MAXIMUM',
    'When DO NOTHING — HOLD STILL appears, do nothing until the trial ends.'),

  trialStep('screen-tap-1', 'screen-tap', 'maximum', 'Ordinary-use control · screen tap · 1 of 2',
    'When TAP SCREEN NOW appears, tap the center of the test window once. Do not press any hardware buttons.'),
  trialStep('screen-tap-2', 'screen-tap', 'maximum', 'Ordinary-use control · screen tap · 2 of 2',
    'When TAP SCREEN NOW appears, tap the center of the test window once. Do not press any hardware buttons.'),
  trialStep('movement-1', 'movement', 'maximum', 'Ordinary-use control · phone movement · 1 of 2',
    'When MOVE PHONE NOW appears, slightly reposition or squeeze the phone once without touching any hardware buttons.'),
  trialStep('movement-2', 'movement', 'maximum', 'Ordinary-use control · phone movement · 2 of 2',
    'When MOVE PHONE NOW appears, slightly reposition or squeeze the phone once without touching any hardware buttons.')
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
let completedRunPendingExport = null;

suiteVolumeDownButton?.addEventListener('click', () => { observedTrialCount += 1; }, { capture: true });
installSuiteDiagnosticPatch();
queueMicrotask(initializeSuiteUi);

function setupStep(id, volumeCondition, title, instruction) {
  return { kind: 'setup', id, role: 'volume-setup', volumeCondition, title, instruction };
}

function trialStep(id, role, volumeCondition, title, instruction) {
  return { kind: 'trial', id, role, volumeCondition, title, instruction };
}

function initializeSuiteUi() {
  if (!suiteTrialActions) return;
  if (document.querySelector('[data-testid="run-full-test-suite"]')) return;

  suiteButton = document.createElement('button');
  suiteButton.type = 'button';
  suiteButton.className = 'primary-button suite-launch';
  suiteButton.dataset.testid = 'run-full-test-suite';
  suiteButton.textContent = 'Run screenshot viability suite';
  suiteButton.addEventListener('click', launchFullSuite);

  suiteStatus = document.createElement('div');
  suiteStatus.className = 'suite-status';
  suiteStatus.dataset.testid = 'full-suite-status';
  suiteStatus.textContent = `${SUITE_STEPS.length} guided steps · actual screenshots + controls · automatic blacking disabled`;

  suiteTrialActions.prepend(suiteStatus);
  suiteTrialActions.prepend(suiteButton);
  createSuiteDialog();
}

function launchFullSuite() {
  if (activeSuiteRun) return;
  completedRunPendingExport = null;
  setResearchMode(true, 'guided-suite-start');
  suiteButton.disabled = true;
  suiteButton.textContent = 'Screenshot study running…';

  if (sensorsReadyForStudy()) {
    beginSuiteRun();
    return;
  }

  setSuiteStatus('Starting audio instrumentation…');
  showWaitingDialog(
    'Starting sensors',
    'Grant microphone access if prompted. Motion is useful secondary telemetry but is not required for this go/no-go test. The study requires the audio path to be running.'
  );
  recordSuiteEvent('suite-sensor-start-requested');
  suiteStartButton?.click();
  waitForStudySensors().then(beginSuiteRun, (error) => {
    setResearchMode(false, 'suite-start-failed');
    suiteButton.disabled = false;
    suiteButton.textContent = 'Run screenshot viability suite';
    setSuiteStatus('Suite not started');
    showErrorDialog('Could not start screenshot study', error.message);
    recordSuiteEvent('suite-sensor-start-failed', { message: error.message });
  });
}

function sensorsReadyForStudy() {
  return Boolean(suiteArmedPill?.classList.contains('armed'))
    && /Running\s*@/i.test(suiteWorkletStatus?.textContent || '');
}

function waitForStudySensors() {
  return new Promise((resolve, reject) => {
    if (sensorsReadyForStudy()) {
      resolve();
      return;
    }

    let settled = false;
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    suiteStartWaitTimer = setTimeout(() => finish(false), SUITE_SENSOR_START_TIMEOUT_MS);

    function check() {
      if (sensorsReadyForStudy()) finish(true);
      else if (suiteArmedPill?.textContent?.trim() === 'No sensors') finish(false);
    }

    function finish(success) {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (suiteStartWaitTimer) clearTimeout(suiteStartWaitTimer);
      suiteStartWaitTimer = null;

      if (success) resolve();
      else reject(new Error('The screenshot viability suite requires the microphone/AudioWorklet path. Start sensors again and grant microphone access.'));
    }
  });
}

function beginSuiteRun() {
  const run = {
    id: ++suiteRunSequence,
    status: 'running',
    stepSet: SUITE_STEP_SET,
    startedWallTime: new Date().toISOString(),
    startedPerfMs: performance.now(),
    completedWallTime: null,
    completedPerfMs: null,
    error: null,
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
    kind: definition.kind,
    id: definition.id,
    role: definition.role,
    volumeCondition: definition.volumeCondition,
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
  recordSuiteEvent('suite-step-prompted', eventStepData(step));
}

function runCurrentSuiteStep() {
  if (!activeSuiteRun || !activeSuiteStep || activeSuiteStep.status !== 'prompted') return;
  const step = activeSuiteStep;
  step.status = 'running';
  step.startedWallTime = new Date().toISOString();
  step.startedPerfMs = performance.now();
  hideSuiteDialog();
  recordSuiteEvent('suite-step-started', eventStepData(step));

  if (step.kind === 'setup') {
    runSetupStep(step);
  } else {
    runTrialStep(step);
  }
}

function runSetupStep(step) {
  if (!(suiteRecalibrateButton instanceof HTMLButtonElement) || suiteRecalibrateButton.disabled) {
    failSuiteRun('Audio recalibration is unavailable. The screenshot study cannot continue without a running audio path.');
    return;
  }

  setSuiteStatus(`Recalibrating at ${step.volumeCondition} media volume…`);
  recordSuiteEvent('suite-volume-condition-set', {
    ...eventStepData(step),
    volumeConditionBrowserVerified: false
  });
  suiteRecalibrateButton.click();

  suiteStepTimer = setTimeout(() => {
    if (!isCurrentRunningStep(step)) return;
    completeCurrentStep(step);
  }, SUITE_RECALIBRATE_SETTLE_MS);
}

function runTrialStep(step) {
  if (!(suiteVolumeDownButton instanceof HTMLButtonElement)) {
    failSuiteRun('The underlying trial control is unavailable.');
    return;
  }

  setSuiteStatus(`Running step ${step.index} of ${SUITE_STEPS.length}: ${step.title}`);
  window.dispatchEvent(new CustomEvent('guardlab:arm-role', {
    detail: {
      role: step.role,
      expectedAction: step.role,
      volumeCondition: step.volumeCondition,
      suiteStepId: step.id
    }
  }));
  suiteVolumeDownButton.click();
  step.trialOrdinal = observedTrialCount;

  suiteStepTimer = setTimeout(() => {
    if (!isCurrentRunningStep(step)) return;
    completeCurrentStep(step);
  }, SUITE_TRIAL_SETTLE_MS);
}

function completeCurrentStep(step) {
  step.status = 'completed';
  step.completedWallTime = new Date().toISOString();
  step.completedPerfMs = performance.now();
  recordSuiteEvent('suite-step-completed', {
    ...eventStepData(step),
    trialOrdinal: step.trialOrdinal
  });
  suiteStepTimer = null;
  activeSuiteStep = null;
  promptSuiteStep(step.index);
}

function isCurrentRunningStep(step) {
  return Boolean(
    activeSuiteRun
    && activeSuiteRun.status === 'running'
    && activeSuiteStep === step
    && step.status === 'running'
  );
}

function completeSuiteRun() {
  if (!activeSuiteRun) return;
  activeSuiteRun.status = 'completed';
  activeSuiteRun.completedWallTime = new Date().toISOString();
  activeSuiteRun.completedPerfMs = performance.now();
  recordSuiteEvent('suite-completed', {
    runId: activeSuiteRun.id,
    completedSteps: activeSuiteRun.steps.length
  });

  completedRunPendingExport = activeSuiteRun;
  setSuiteStatus(`Study complete · ${activeSuiteRun.steps.length}/${SUITE_STEPS.length} steps · export diagnostics`);
  suiteButton.disabled = false;
  suiteButton.textContent = 'Run screenshot viability suite again';
  showCompletionDialog(activeSuiteRun);
  activeSuiteRun = null;
  activeSuiteStep = null;
}

function cancelSuiteRun() {
  if (!activeSuiteRun) {
    hideSuiteDialog();
    if (completedRunPendingExport) {
      setResearchMode(false, 'completed-suite-dismissed');
      completedRunPendingExport = null;
    }
    return;
  }

  if (suiteStepTimer) clearTimeout(suiteStepTimer);
  suiteStepTimer = null;

  if (activeSuiteStep && activeSuiteStep.status === 'prompted') activeSuiteStep.status = 'cancelled';
  else if (activeSuiteStep && activeSuiteStep.status === 'running') activeSuiteStep.status = 'cancelled';

  activeSuiteRun.status = 'cancelled';
  activeSuiteRun.completedWallTime = new Date().toISOString();
  activeSuiteRun.completedPerfMs = performance.now();
  recordSuiteEvent('suite-cancelled', {
    runId: activeSuiteRun.id,
    completedSteps: activeSuiteRun.steps.filter((step) => step.status === 'completed').length
  });

  setResearchMode(false, 'suite-cancelled');
  setSuiteStatus('Screenshot study cancelled');
  suiteButton.disabled = false;
  suiteButton.textContent = 'Run screenshot viability suite';
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
  setResearchMode(false, 'suite-failed');
  suiteButton.disabled = false;
  suiteButton.textContent = 'Run screenshot viability suite';
  setSuiteStatus('Screenshot study stopped');
  showErrorDialog('Screenshot study stopped', message);
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
  suiteDialogExport.addEventListener('click', () => {
    suiteExportButton?.click();
    setTimeout(() => {
      setResearchMode(false, 'suite-exported');
      completedRunPendingExport = null;
    }, 100);
  });

  suiteDialogCancel = document.createElement('button');
  suiteDialogCancel.type = 'button';
  suiteDialogCancel.className = 'secondary-button';
  suiteDialogCancel.dataset.testid = 'full-suite-cancel';
  suiteDialogCancel.textContent = 'Cancel study';
  suiteDialogCancel.addEventListener('click', cancelSuiteRun);

  actions.append(suiteDialogConfirm, suiteDialogExport, suiteDialogCancel);
  card.append(suiteDialogKicker, suiteDialogTitle, suiteDialogBody, actions);
  suiteDialog.append(card);
  document.body.append(suiteDialog);
}

function showStepDialog(step) {
  suiteDialogKicker.textContent = `Step ${step.index} of ${SUITE_STEPS.length}`;
  suiteDialogTitle.textContent = step.title;

  const tail = step.kind === 'setup'
    ? ' Tap Continue only after the requested media volume is set. The lab will recalibrate automatically.'
    : ' The trial records for five seconds. Act only when the test window gives the cue, then do not touch the phone until the next prompt.';

  suiteDialogBody.textContent = `${step.instruction}${tail}`;
  suiteDialogConfirm.textContent = step.kind === 'setup'
    ? 'Continue + recalibrate'
    : `Run step ${step.index}`;
  suiteDialogConfirm.hidden = false;
  suiteDialogExport.hidden = true;
  suiteDialogCancel.textContent = 'Cancel study';
  suiteDialogCancel.hidden = false;
  suiteDialog.hidden = false;
}

function showWaitingDialog(title, body) {
  suiteDialogKicker.textContent = 'Preparing study';
  suiteDialogTitle.textContent = title;
  suiteDialogBody.textContent = body;
  suiteDialogConfirm.hidden = true;
  suiteDialogExport.hidden = true;
  suiteDialogCancel.textContent = 'Cancel study';
  suiteDialogCancel.hidden = false;
  suiteDialog.hidden = false;
}

function showCompletionDialog(run) {
  suiteDialogKicker.textContent = 'Study complete';
  suiteDialogTitle.textContent = 'Export this run';
  suiteDialogBody.textContent = `${run.steps.length} guided steps completed. Automatic blacking stayed disabled throughout the study. Export the JSON and attach it in chat so the actual screenshot attempts can be compared with matched controls.`;
  suiteDialogConfirm.hidden = true;
  suiteDialogExport.hidden = false;
  suiteDialogCancel.textContent = 'Close without export';
  suiteDialogCancel.hidden = false;
  suiteDialog.hidden = false;
}

function showErrorDialog(title, body) {
  suiteDialogKicker.textContent = 'Study unavailable';
  suiteDialogTitle.textContent = title;
  suiteDialogBody.textContent = body;
  suiteDialogConfirm.hidden = true;
  suiteDialogExport.hidden = true;
  suiteDialogCancel.textContent = 'Close';
  suiteDialogCancel.hidden = false;
  suiteDialog.hidden = false;
}

function hideSuiteDialog() {
  if (suiteDialog) suiteDialog.hidden = true;
}

function setSuiteStatus(text) {
  if (suiteStatus) suiteStatus.textContent = text;
}

function setResearchMode(enabled, reason) {
  window.dispatchEvent(new CustomEvent('guardlab:research-mode', {
    detail: { enabled, reason }
  }));
}

function eventStepData(step) {
  return {
    runId: activeSuiteRun?.id ?? null,
    stepIndex: step.index,
    stepId: step.id,
    kind: step.kind,
    role: step.role,
    volumeCondition: step.volumeCondition
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
              stepSet: SUITE_STEP_SET,
              purpose: 'go/no-go test for browser-visible signatures of actual screenshot attempts',
              automaticBlackingDisabled: true,
              analysisWindowAfterCueMs: ANALYSIS_WINDOW_AFTER_CUE_MS,
              systemVolume: {
                operatorSet: true,
                browserVerified: false
              },
              definition: SUITE_STEPS.map((step, index) => ({
                index: index + 1,
                kind: step.kind,
                id: step.id,
                role: step.role,
                volumeCondition: step.volumeCondition,
                title: step.title,
                instruction: step.instruction
              })),
              runs: suiteRuns.map(cloneRun),
              events: suiteEvents
            };

            const trials = Array.isArray(payload.trials) ? payload.trials : [];
            for (const run of suiteRuns) {
              for (const step of run.steps) {
                if (!step.trialOrdinal) continue;
                const trial = trials[step.trialOrdinal - 1];
                if (!trial) continue;
                trial.suite = {
                  runId: run.id,
                  stepIndex: step.index,
                  stepId: step.id,
                  role: step.role,
                  volumeCondition: step.volumeCondition,
                  title: step.title
                };
              }
            }

            nextParts = [JSON.stringify(payload, null, 2)];
          }
        } catch {}
      }
      super(nextParts, options);
    }
  }

  try { window.Blob = SuiteBlob; } catch {}
}

function cloneRun(run) {
  return {
    id: run.id,
    status: run.status,
    stepSet: run.stepSet,
    startedWallTime: run.startedWallTime,
    startedPerfMs: run.startedPerfMs,
    completedWallTime: run.completedWallTime,
    completedPerfMs: run.completedPerfMs,
    error: run.error,
    steps: run.steps.map((step) => ({ ...step }))
  };
}

suiteStopButton?.addEventListener('click', () => {
  if (activeSuiteRun) cancelSuiteRun();
  else if (completedRunPendingExport) {
    setResearchMode(false, 'sensors-stopped');
    completedRunPendingExport = null;
  }
}, { capture: true });
