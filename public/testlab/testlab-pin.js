const mobileQuery = window.matchMedia('(max-width: 760px)');
const testWindow = document.querySelector('[data-testid="test-window"]');
const guardOverlay = document.querySelector('[data-testid="guard-overlay"]');
const armedPill = document.getElementById('armedPill');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const manualGuardButton = document.getElementById('manualGuardButton');
const volumeUpTrialButton = document.getElementById('volumeUpTrialButton');
const volumeDownTrialButton = document.getElementById('volumeDownTrialButton');
const trialState = document.getElementById('trialState');
const trialCopy = document.querySelector('.trial-copy');
const trialActions = document.querySelector('.trial-actions');

const PRESS_CUE_DELAY_MS = 2000;
const PRESS_WINDOW_MS = 700;
const TRIAL_DURATION_MS = 5000;
const NEXT_TEST_PRESET = {
  frequencyInput: 18500,
  toneInput: 15,
  carrierThresholdInput: 30,
  transientThresholdInput: 300,
  motionThresholdInput: 5,
  guardDurationInput: 800
};

let placeholder = null;
let startPending = false;
let manualGuardOverride = false;
let pressWindowActive = false;
let activeGroundTruthTrial = null;
let groundTruthSequence = 0;
let cueTimer = null;
let cueHideTimer = null;
let trialEndTimer = null;
let countdownTimer = null;
const groundTruthTrials = [];
const helperEvents = [];

let nativeMotionRequest = null;
let cachedMotionPermissionPromise = null;
let motionPermissionPatchInstalled = false;
let motionPermissionPrimedFromStartGesture = false;
let motionPermissionResult = null;
let motionPermissionError = null;

const pressCue = createPressCue();
const presetButton = createPresetButton();
installCachedMotionPermission();
installDiagnosticInjection();

if (trialCopy) {
  trialCopy.textContent = 'Arm a trial and wait. After a two-second quiet period, the pinned test window will show PRESS NOW. Press the named physical volume button immediately. Sensor triggers are still logged, but the black guard is suppressed outside the short PRESS NOW window so false positives do not hide the test.';
}

startButton?.addEventListener('click', primeMotionPermissionFromStartGesture, { capture: true });
startButton?.addEventListener('click', () => {
  startPending = true;
  syncPinnedState();
});

stopButton?.addEventListener('click', () => {
  startPending = false;
  pressWindowActive = false;
  finishGroundTruthTrial('sensors-stopped');
  suppressOverlayNow();
  unpinTestWindow();
});

manualGuardButton?.addEventListener('click', () => {
  manualGuardOverride = true;
  window.setTimeout(() => { manualGuardOverride = false; }, 2200);
}, { capture: true });

volumeUpTrialButton?.addEventListener('click', () => beginGroundTruthTrial('volume-up'));
volumeDownTrialButton?.addEventListener('click', () => beginGroundTruthTrial('volume-down'));
presetButton?.addEventListener('click', applyNextTestPreset);

if (armedPill) {
  new MutationObserver(() => {
    if (armedPill.classList.contains('armed')) startPending = false;
    if (armedPill.textContent.trim() === 'No sensors' || armedPill.textContent.trim() === 'Disarmed') startPending = false;
    syncPinnedState();
    enforceGuardGate();
  }).observe(armedPill, { attributes: true, childList: true, characterData: true, subtree: true });
}

if (guardOverlay) {
  new MutationObserver(enforceGuardGate).observe(guardOverlay, { attributes: true, attributeFilter: ['class'] });
}

const handleMediaChange = () => syncPinnedState();
if (typeof mobileQuery.addEventListener === 'function') mobileQuery.addEventListener('change', handleMediaChange);
else mobileQuery.addListener(handleMediaChange);

window.addEventListener('pagehide', () => {
  finishGroundTruthTrial('pagehide');
  unpinTestWindow();
});

function beginGroundTruthTrial(label) {
  finishGroundTruthTrial('replaced');
  clearGroundTruthTimers();
  suppressOverlayNow();

  const trial = {
    localId: ++groundTruthSequence,
    label,
    armedPerf: performance.now(),
    armedWallTime: new Date().toISOString(),
    cuePerf: null,
    cueWallTime: null,
    completedPerf: null,
    completionReason: null
  };
  groundTruthTrials.push(trial);
  activeGroundTruthTrial = trial;
  pressWindowActive = false;
  setTrialState(`${displayLabel(label)} · get ready… 2`, true);
  pushHelperEvent('ground-truth-trial-armed', { localTrialId: trial.localId, label });

  countdownTimer = window.setTimeout(() => {
    if (activeGroundTruthTrial === trial) setTrialState(`${displayLabel(label)} · get ready… 1`, true);
  }, 1000);

  cueTimer = window.setTimeout(() => showPressCue(trial), PRESS_CUE_DELAY_MS);
  trialEndTimer = window.setTimeout(() => {
    if (activeGroundTruthTrial === trial) finishGroundTruthTrial('completed');
  }, TRIAL_DURATION_MS);
}

function showPressCue(trial) {
  if (activeGroundTruthTrial !== trial) return;
  trial.cuePerf = performance.now();
  trial.cueWallTime = new Date().toISOString();
  pressWindowActive = true;
  suppressOverlayNow();
  const text = `PRESS ${trial.label === 'volume-up' ? 'VOLUME UP' : 'VOLUME DOWN'} NOW`;
  pressCue.textContent = text;
  pressCue.hidden = false;
  setTrialState(text, true);
  pushHelperEvent('press-cue', { localTrialId: trial.localId, label: trial.label });

  cueHideTimer = window.setTimeout(() => {
    if (activeGroundTruthTrial !== trial) return;
    pressWindowActive = false;
    pressCue.hidden = true;
    suppressOverlayNow();
    setTrialState(`${displayLabel(trial.label)} · recording tail…`, true);
    pushHelperEvent('press-window-ended', { localTrialId: trial.localId, label: trial.label });
  }, PRESS_WINDOW_MS);
}

function finishGroundTruthTrial(reason) {
  if (!activeGroundTruthTrial) return;
  activeGroundTruthTrial.completedPerf = performance.now();
  activeGroundTruthTrial.completionReason = reason;
  activeGroundTruthTrial = null;
  pressWindowActive = false;
  pressCue.hidden = true;
  suppressOverlayNow();
  clearGroundTruthTimers();
}

function clearGroundTruthTimers() {
  if (cueTimer) clearTimeout(cueTimer);
  if (cueHideTimer) clearTimeout(cueHideTimer);
  if (trialEndTimer) clearTimeout(trialEndTimer);
  if (countdownTimer) clearTimeout(countdownTimer);
  cueTimer = cueHideTimer = trialEndTimer = countdownTimer = null;
}

function enforceGuardGate() {
  if (!guardOverlay?.classList.contains('active')) return;
  const sensorsActive = startPending || Boolean(armedPill?.classList.contains('armed'));
  if (!sensorsActive) return;
  if (manualGuardOverride || pressWindowActive) return;
  guardOverlay.classList.remove('active');
}

function suppressOverlayNow() {
  if (!manualGuardOverride) guardOverlay?.classList.remove('active');
}

function installCachedMotionPermission() {
  const ctor = window.DeviceMotionEvent;
  if (!ctor || typeof ctor.requestPermission !== 'function') return;
  nativeMotionRequest = ctor.requestPermission.bind(ctor);

  const cachedRequest = () => {
    if (cachedMotionPermissionPromise) return cachedMotionPermissionPromise;
    try {
      cachedMotionPermissionPromise = Promise.resolve(nativeMotionRequest());
    } catch (error) {
      cachedMotionPermissionPromise = Promise.reject(error);
    }
    cachedMotionPermissionPromise.then(
      (result) => { motionPermissionResult = result; },
      (error) => { motionPermissionError = error?.message || String(error); }
    );
    return cachedMotionPermissionPromise;
  };

  try {
    Object.defineProperty(ctor, 'requestPermission', {
      configurable: true,
      writable: true,
      value: cachedRequest
    });
    motionPermissionPatchInstalled = ctor.requestPermission === cachedRequest;
  } catch {
    try {
      ctor.requestPermission = cachedRequest;
      motionPermissionPatchInstalled = ctor.requestPermission === cachedRequest;
    } catch {
      motionPermissionPatchInstalled = false;
    }
  }
}

function primeMotionPermissionFromStartGesture() {
  if (!nativeMotionRequest) return;
  motionPermissionPrimedFromStartGesture = true;
  pushHelperEvent('motion-permission-requested-from-start-gesture', {
    patchInstalled: motionPermissionPatchInstalled
  });

  try {
    const request = window.DeviceMotionEvent?.requestPermission;
    const promise = motionPermissionPatchInstalled && typeof request === 'function'
      ? request.call(window.DeviceMotionEvent)
      : Promise.resolve(nativeMotionRequest());
    cachedMotionPermissionPromise = Promise.resolve(promise);
    cachedMotionPermissionPromise.then(
      (result) => {
        motionPermissionResult = result;
        pushHelperEvent('motion-permission-result-from-start-gesture', { result });
      },
      (error) => {
        motionPermissionError = error?.message || String(error);
        pushHelperEvent('motion-permission-error-from-start-gesture', { message: motionPermissionError });
      }
    );
  } catch (error) {
    motionPermissionError = error?.message || String(error);
    cachedMotionPermissionPromise = Promise.reject(error);
    cachedMotionPermissionPromise.catch(() => {});
  }
}

function installDiagnosticInjection() {
  const NativeBlob = window.Blob;
  if (typeof NativeBlob !== 'function') return;

  class GuardLabBlob extends NativeBlob {
    constructor(parts = [], options = {}) {
      let nextParts = parts;
      if (options?.type === 'application/json' && parts.length === 1 && typeof parts[0] === 'string') {
        try {
          const payload = JSON.parse(parts[0]);
          if (payload?.purpose === 'MuStash Guard Lab volume-button/screenshot-guard tuning') {
            injectGroundTruthDiagnostics(payload);
            nextParts = [JSON.stringify(payload, null, 2)];
          }
        } catch {}
      }
      super(nextParts, options);
    }
  }

  try { window.Blob = GuardLabBlob; } catch {}
}

function injectGroundTruthDiagnostics(payload) {
  payload.groundTruthProtocol = {
    version: 1,
    trialDurationMs: TRIAL_DURATION_MS,
    pressCueDelayMs: PRESS_CUE_DELAY_MS,
    pressWindowMs: PRESS_WINDOW_MS,
    guardGate: 'sensor-driven black guard is visible only during PRESS NOW windows; manual guard remains unrestricted'
  };

  payload.motion = payload.motion || {};
  payload.motion.permissionRequestedFromStartGesture = motionPermissionPrimedFromStartGesture;
  payload.motion.permissionRequestPatchInstalled = motionPermissionPatchInstalled;
  payload.motion.primedPermissionResult = motionPermissionResult;
  payload.motion.primedPermissionError = motionPermissionError;

  const trials = Array.isArray(payload.trials) ? payload.trials : [];
  groundTruthTrials.forEach((localTrial, index) => {
    const exportedTrial = trials[index];
    if (!exportedTrial) return;
    const cueOffset = localTrial.cuePerf === null ? null : localTrial.cuePerf - localTrial.armedPerf;
    const completedOffset = localTrial.completedPerf === null ? null : localTrial.completedPerf - localTrial.armedPerf;
    const cueAtMs = cueOffset === null ? null : exportedTrial.armedAtMs + cueOffset;
    exportedTrial.groundTruth = {
      protocolVersion: 1,
      cueAtMs,
      pressWindowStartAtMs: cueAtMs,
      pressWindowEndAtMs: cueAtMs === null ? null : cueAtMs + PRESS_WINDOW_MS,
      cueOffsetFromArmMs: cueOffset,
      expectedPress: localTrial.label,
      completionReason: localTrial.completionReason,
      completedAtMs: completedOffset === null ? exportedTrial.completedAtMs ?? null : exportedTrial.armedAtMs + completedOffset
    };
    // Duplicate the key timestamps at trial top level for simple analysis scripts.
    exportedTrial.cueAtMs = cueAtMs;
    exportedTrial.pressWindowStartAtMs = cueAtMs;
    exportedTrial.pressWindowEndAtMs = cueAtMs === null ? null : cueAtMs + PRESS_WINDOW_MS;
  });

  payload.events = Array.isArray(payload.events) ? payload.events : [];
  helperEvents.forEach((helper) => {
    const trial = helper.localTrialId ? trials[helper.localTrialId - 1] : null;
    let atMs = null;
    if (trial && helper.perf !== null) {
      const localTrial = groundTruthTrials[helper.localTrialId - 1];
      atMs = trial.armedAtMs + (helper.perf - localTrial.armedPerf);
    } else {
      const startEvent = payload.events.find((event) => event.type === 'sensors-start-requested');
      if (startEvent && helper.type.startsWith('motion-permission-')) atMs = startEvent.atMs;
    }
    payload.events.push({
      atMs: atMs ?? null,
      wallTime: helper.wallTime,
      type: helper.type,
      source: 'ground-truth-helper',
      localTrialId: helper.localTrialId ?? null,
      label: helper.label ?? null,
      ...helper.data
    });
  });
}

function pushHelperEvent(type, data = {}) {
  helperEvents.push({
    type,
    perf: performance.now(),
    wallTime: new Date().toISOString(),
    localTrialId: data.localTrialId ?? null,
    label: data.label ?? null,
    data
  });
}

function createPressCue() {
  const cue = document.createElement('div');
  cue.id = 'pressNowCue';
  cue.dataset.testid = 'press-now-cue';
  cue.className = 'trial-state active';
  cue.setAttribute('role', 'alert');
  cue.setAttribute('aria-live', 'assertive');
  cue.hidden = true;
  cue.textContent = 'PRESS NOW';
  guardOverlay?.after(cue);
  return cue;
}

function createPresetButton() {
  const button = document.createElement('button');
  button.id = 'testPresetButton';
  button.type = 'button';
  button.className = 'secondary-button';
  button.dataset.testid = 'apply-test-preset';
  button.textContent = 'Apply next-test preset';
  trialActions?.prepend(button);
  return button;
}

function applyNextTestPreset() {
  Object.entries(NEXT_TEST_PRESET).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setTrialState(text, active) {
  if (!trialState) return;
  trialState.textContent = text;
  trialState.classList.toggle('active', Boolean(active));
}

function displayLabel(label) {
  return label === 'volume-up' ? 'Volume Up' : 'Volume Down';
}

function syncPinnedState() {
  const sensorsArmed = Boolean(armedPill?.classList.contains('armed'));
  const shouldPin = mobileQuery.matches && (startPending || sensorsArmed);
  if (shouldPin) pinTestWindow();
  else unpinTestWindow();
}

function pinTestWindow() {
  if (!testWindow || testWindow.classList.contains('sensor-pinned')) return;

  placeholder = document.createElement('div');
  placeholder.className = 'test-window-placeholder';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.style.height = `${testWindow.getBoundingClientRect().height}px`;
  testWindow.before(placeholder);

  // Move the actual test window out of the card before fixing it to the viewport.
  // The card uses compositing effects that can otherwise establish a containing block
  // and make position: fixed behave like a positioned element inside the card.
  document.body.appendChild(testWindow);
  testWindow.classList.add('sensor-pinned');
  document.body.classList.add('guard-lab-sensors-pinned');
}

function unpinTestWindow() {
  if (!testWindow?.classList.contains('sensor-pinned')) return;

  testWindow.classList.remove('sensor-pinned');
  document.body.classList.remove('guard-lab-sensors-pinned');

  if (placeholder?.parentNode) placeholder.replaceWith(testWindow);
  placeholder = null;
}
