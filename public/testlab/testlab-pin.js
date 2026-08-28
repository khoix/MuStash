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
const triggerMetric = document.getElementById('triggerMetric');
const lastTriggerMetric = document.getElementById('lastTriggerMetric');
const guardDurationInput = document.getElementById('guardDurationInput');

const PRESS_CUE_DELAY_MS = 2000;
const PRESS_WINDOW_MS = 700;
const TRIAL_DURATION_MS = 5000;
const FUSION_WINDOW_MS = 700;
const CARRIER_QUIET_REARM_MS = 450;
const MOTION_QUIET_REARM_MS = 250;
const NEXT_TEST_PRESET = {
  frequencyInput: 18500,
  toneInput: 15,
  carrierThresholdInput: 30,
  transientThresholdInput: 300,
  motionThresholdInput: 0.5,
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

let lastObservedTriggerId = 0;
let carrierPresentationLatched = false;
let motionPresentationLatched = false;
let carrierQuietTimer = null;
let motionQuietTimer = null;
let lastCarrierEdgePerf = -Infinity;
let lastMotionEdgePerf = -Infinity;
let carrierEdgeSequence = 0;
let motionEdgeSequence = 0;
let lastFusionKey = null;
let presentationHoldUntil = -Infinity;
let presentationReleaseTimer = null;

const pressCue = createPressCue();
const presetButton = createPresetButton();
installCachedMotionPermission();
installDiagnosticInjection();

if (trialCopy) {
  trialCopy.textContent = 'Arm a trial and wait. After a two-second quiet period, the pinned test window will show PRESS NOW. Press the named physical volume button immediately. For a control trial, arm it normally but do not press the button. Raw detector activity is still exported, while visible guard presentation is limited to the short PRESS NOW window.';
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
  resetPresentationState();
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

const triggerObserver = new MutationObserver(() => {
  processAcceptedTrigger();
  enforceGuardGate();
});
if (guardOverlay) triggerObserver.observe(guardOverlay, { attributes: true, attributeFilter: ['class'] });
if (triggerMetric) triggerObserver.observe(triggerMetric, { childList: true, characterData: true, subtree: true });
if (lastTriggerMetric) triggerObserver.observe(lastTriggerMetric, { childList: true, characterData: true, subtree: true });

const handleMediaChange = () => syncPinnedState();
if (typeof mobileQuery.addEventListener === 'function') mobileQuery.addEventListener('change', handleMediaChange);
else mobileQuery.addListener(handleMediaChange);

window.addEventListener('pagehide', () => {
  finishGroundTruthTrial('pagehide');
  resetPresentationState();
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
    presentationHoldUntil = -Infinity;
    if (presentationReleaseTimer) clearTimeout(presentationReleaseTimer);
    presentationReleaseTimer = null;
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
  presentationHoldUntil = -Infinity;
  if (presentationReleaseTimer) clearTimeout(presentationReleaseTimer);
  presentationReleaseTimer = null;
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

function processAcceptedTrigger() {
  const triggerId = Number(triggerMetric?.textContent);
  if (!Number.isFinite(triggerId) || triggerId <= lastObservedTriggerId) return;
  lastObservedTriggerId = triggerId;

  const reason = lastTriggerMetric?.textContent?.trim() || '';
  const source = triggerSource(reason);
  const now = performance.now();
  const trialData = activeGroundTruthTrial
    ? { localTrialId: activeGroundTruthTrial.localId, label: activeGroundTruthTrial.label }
    : {};

  let allowPresentation = true;
  let fusedWith = null;
  let fusionDeltaMs = null;

  if (source === 'carrier') {
    scheduleCarrierRearm();
    if (carrierPresentationLatched) {
      allowPresentation = false;
      pushHelperEvent('presentation-repeat-suppressed', { ...trialData, triggerId, source, reason });
    } else {
      carrierPresentationLatched = true;
      carrierEdgeSequence += 1;
      const motionAge = now - lastMotionEdgePerf;
      lastCarrierEdgePerf = now;
      pushHelperEvent('presentation-edge', { ...trialData, triggerId, source, reason, edgeSequence: carrierEdgeSequence });
      if (motionAge >= 0 && motionAge <= FUSION_WINDOW_MS) {
        fusedWith = 'motion';
        fusionDeltaMs = motionAge;
        allowPresentation = false;
        recordFusion('motion', 'carrier', motionAge, trialData);
      }
    }
  } else if (source === 'motion') {
    scheduleMotionRearm();
    if (motionPresentationLatched) {
      allowPresentation = false;
      pushHelperEvent('presentation-repeat-suppressed', { ...trialData, triggerId, source, reason });
    } else {
      motionPresentationLatched = true;
      motionEdgeSequence += 1;
      const carrierAge = now - lastCarrierEdgePerf;
      lastMotionEdgePerf = now;
      pushHelperEvent('presentation-edge', { ...trialData, triggerId, source, reason, edgeSequence: motionEdgeSequence });
      if (carrierAge >= 0 && carrierAge <= FUSION_WINDOW_MS) {
        fusedWith = 'carrier';
        fusionDeltaMs = carrierAge;
        allowPresentation = false;
        recordFusion('carrier', 'motion', carrierAge, trialData);
      }
    }
  }

  if (source === 'carrier' || source === 'motion') {
    pushHelperEvent('presentation-decision', {
      ...trialData,
      triggerId,
      source,
      reason,
      allowPresentation,
      fusedWith,
      fusionDeltaMs,
      pressWindowActive
    });

    if (!pressWindowActive || !allowPresentation) {
      suppressCurrentPresentation();
      return;
    }
    startPresentationHold(now, triggerId, source, reason, trialData);
  }
}

function triggerSource(reason) {
  if (reason.startsWith('carrier change')) return 'carrier';
  if (reason.startsWith('motion impulse')) return 'motion';
  if (reason.startsWith('microphone transient')) return 'microphone-transient';
  if (reason.startsWith('browser ')) return 'browser-key';
  if (reason === 'manual test') return 'manual';
  return 'other';
}

function scheduleCarrierRearm() {
  if (carrierQuietTimer) clearTimeout(carrierQuietTimer);
  carrierQuietTimer = window.setTimeout(() => {
    carrierPresentationLatched = false;
    carrierQuietTimer = null;
    pushHelperEvent('presentation-rearmed', { source: 'carrier' });
  }, CARRIER_QUIET_REARM_MS);
}

function scheduleMotionRearm() {
  if (motionQuietTimer) clearTimeout(motionQuietTimer);
  motionQuietTimer = window.setTimeout(() => {
    motionPresentationLatched = false;
    motionQuietTimer = null;
    pushHelperEvent('presentation-rearmed', { source: 'motion' });
  }, MOTION_QUIET_REARM_MS);
}

function recordFusion(leadSource, lagSource, deltaMs, trialData) {
  const key = `${motionEdgeSequence}:${carrierEdgeSequence}`;
  if (key === lastFusionKey) return;
  lastFusionKey = key;
  pushHelperEvent('sensor-fusion-confirmed', {
    ...trialData,
    leadSource,
    lagSource,
    deltaMs,
    fusionWindowMs: FUSION_WINDOW_MS
  });
}

function startPresentationHold(now, triggerId, source, reason, trialData) {
  if (now < presentationHoldUntil) return;
  const duration = Number(guardDurationInput?.value) || 800;
  presentationHoldUntil = now + duration;
  pushHelperEvent('presentation-started', { ...trialData, triggerId, source, reason, durationMs: duration });
  if (presentationReleaseTimer) clearTimeout(presentationReleaseTimer);
  presentationReleaseTimer = window.setTimeout(() => {
    presentationHoldUntil = -Infinity;
    presentationReleaseTimer = null;
    if (!manualGuardOverride) guardOverlay?.classList.remove('active');
    pushHelperEvent('presentation-released', { ...trialData, triggerId, source });
  }, duration);
}

function suppressCurrentPresentation() {
  queueMicrotask(() => {
    if (manualGuardOverride) return;
    if (performance.now() < presentationHoldUntil) return;
    guardOverlay?.classList.remove('active');
  });
}

function enforceGuardGate() {
  if (!guardOverlay?.classList.contains('active')) return;
  const sensorsActive = startPending || Boolean(armedPill?.classList.contains('armed'));
  if (!sensorsActive) return;
  if (manualGuardOverride) return;
  if (!pressWindowActive) {
    guardOverlay.classList.remove('active');
    return;
  }
  if (performance.now() >= presentationHoldUntil && presentationHoldUntil !== -Infinity) {
    guardOverlay.classList.remove('active');
  }
}

function suppressOverlayNow() {
  if (!manualGuardOverride) guardOverlay?.classList.remove('active');
}

function resetPresentationState() {
  carrierPresentationLatched = false;
  motionPresentationLatched = false;
  lastCarrierEdgePerf = -Infinity;
  lastMotionEdgePerf = -Infinity;
  carrierEdgeSequence = 0;
  motionEdgeSequence = 0;
  lastFusionKey = null;
  presentationHoldUntil = -Infinity;
  if (carrierQuietTimer) clearTimeout(carrierQuietTimer);
  if (motionQuietTimer) clearTimeout(motionQuietTimer);
  if (presentationReleaseTimer) clearTimeout(presentationReleaseTimer);
  carrierQuietTimer = motionQuietTimer = presentationReleaseTimer = null;
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
  payload.detectorPresentation = {
    version: 1,
    rawDetectorEventsPreserved: true,
    carrierQuietRearmMs: CARRIER_QUIET_REARM_MS,
    motionQuietRearmMs: MOTION_QUIET_REARM_MS,
    fusionWindowMs: FUSION_WINDOW_MS,
    behavior: 'motion and carrier bursts are presented once; the first signal blacks immediately and a second signal within the fusion window confirms without restarting the guard'
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
