const guardOverlay = document.querySelector('[data-testid="guard-overlay"]');
const startButton = document.getElementById('startButton');
const manualGuardButton = document.getElementById('manualGuardButton');
const volumeUpTrialButton = document.getElementById('volumeUpTrialButton');
const volumeDownTrialButton = document.getElementById('volumeDownTrialButton');
const trialActions = document.querySelector('.trial-actions');
let pressCue = null;
const triggerMetric = document.getElementById('triggerMetric');
const lastTriggerMetric = document.getElementById('lastTriggerMetric');
const workletStatus = document.getElementById('workletStatus');
const motionThresholdInput = document.getElementById('motionThresholdInput');
const frequencyInput = document.getElementById('frequencyInput');

const PRESET = {
  frequencyInput: 18500,
  toneInput: 15,
  carrierThresholdInput: 30,
  transientThresholdInput: 300,
  motionThresholdInput: 0.5,
  guardDurationInput: 800
};
const REQUESTED_AUDIO_SAMPLE_RATE = 48000;
const MOTION_ROTATION_MIN_DPS = 5.5;
const MOTION_ROTATION_MAX_DPS = 30;
const MOTION_QUIET_REARM_MS = 250;
const CARRIER_NYQUIST_MARGIN = 0.45;

const refineEvents = [];
const trialRoles = [];
let pendingRole = null;
let cuePerf = null;
let previousMotion = null;
let motionBurstLatched = false;
let motionQuietTimer = null;
let refineHoldUntil = -Infinity;
let manualOverride = false;
let audioPatchInstalled = false;
let requestedSampleRate = null;
let actualSampleRate = null;
let audioPatchError = null;
let lastRefinedMotionPerf = -Infinity;
let lastRefineTriggerId = 0;

installAudioContextPatch();
installDiagnosticPatch();
queueMicrotask(initializeAfterBase);
window.addEventListener('devicemotion', observeMotion, { passive: true });

startButton?.addEventListener('click', () => {
  applyPreset();
  previousMotion = null;
  motionBurstLatched = false;
  record('preset-auto-applied', { preset: PRESET });
}, { capture: true });

manualGuardButton?.addEventListener('click', () => {
  manualOverride = true;
  setTimeout(() => { manualOverride = false; }, 2200);
}, { capture: true });

volumeUpTrialButton?.addEventListener('click', () => registerTrial('volume-up'));
volumeDownTrialButton?.addEventListener('click', () => registerTrial('volume-down'));

if (guardOverlay) {
  new MutationObserver(() => {
    if (!guardOverlay.classList.contains('active')) return;
    if (manualOverride) return;
    if (performance.now() < refineHoldUntil) return;
    queueMicrotask(() => guardOverlay.classList.remove('active'));
  }).observe(guardOverlay, { attributes: true, attributeFilter: ['class'] });
}

if (workletStatus) {
  new MutationObserver(updateSampleRateFromUi).observe(workletStatus, { childList: true, characterData: true, subtree: true });
}

function initializeAfterBase() {
  pressCue = document.querySelector('[data-testid="press-now-cue"]');
  createControlButtons();
  if (pressCue) {
    new MutationObserver(() => {
      if (!pressCue.hidden) {
        cuePerf = performance.now();
        rewriteControlCue();
      }
    }).observe(pressCue, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  const observer = new MutationObserver(observeAcceptedBaseTrigger);
  if (triggerMetric) observer.observe(triggerMetric, { childList: true, characterData: true, subtree: true });
  if (lastTriggerMetric) observer.observe(lastTriggerMetric, { childList: true, characterData: true, subtree: true });
}

function observeAcceptedBaseTrigger() {
  const id = Number(triggerMetric?.textContent);
  if (!Number.isFinite(id) || id <= lastRefineTriggerId) return;
  lastRefineTriggerId = id;
  const reason = lastTriggerMetric?.textContent?.trim() || '';
  if (!reason.startsWith('carrier change')) return;
  const age = performance.now() - lastRefinedMotionPerf;
  if (age >= 0 && age <= 700 && carrierUsable()) {
    record('refine-carrier-confirmed', { triggerId: id, reason, deltaMs: age, trial: currentTrial() });
  }
}

function applyPreset() {
  Object.entries(PRESET).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function createControlButtons() {
  if (!trialActions) return;
  const controls = [
    ['no-press', 'control-no-press', 'Arm no-press control'],
    ['screen-tap', 'control-screen-tap', 'Arm screen-tap control'],
    ['movement', 'control-movement', 'Arm movement control']
  ];
  for (const [role, testid, text] of controls) {
    if (trialActions.querySelector(`[data-testid="${testid}"]`)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.dataset.testid = testid;
    button.textContent = text;
    button.addEventListener('click', () => {
      pendingRole = role;
      volumeDownTrialButton?.click();
    });
    trialActions.append(button);
  }
}

function registerTrial(label) {
  trialRoles.push({ label, role: pendingRole || 'expected-press' });
  pendingRole = null;
}

function currentTrial() {
  return trialRoles.length ? trialRoles[trialRoles.length - 1] : null;
}

function rewriteControlCue() {
  const trial = currentTrial();
  if (!trial || !pressCue) return;
  let text = null;
  if (trial.role === 'no-press') text = 'NO PRESS — HOLD STILL';
  if (trial.role === 'screen-tap') text = 'TAP SCREEN NOW';
  if (trial.role === 'movement') text = 'MOVE PHONE NOW';
  if (text && pressCue.textContent !== text) pressCue.textContent = text;
}

function observeMotion(event) {
  const a = event.acceleration || event.accelerationIncludingGravity;
  if (!a) return;
  const current = { x: Number(a.x) || 0, y: Number(a.y) || 0, z: Number(a.z) || 0 };
  if (!previousMotion) {
    previousMotion = current;
    return;
  }
  const impulse = Math.hypot(current.x - previousMotion.x, current.y - previousMotion.y, current.z - previousMotion.z);
  previousMotion = current;
  const threshold = Number(motionThresholdInput?.value) || 0.5;
  if (impulse < threshold) return;

  if (motionQuietTimer) clearTimeout(motionQuietTimer);
  motionQuietTimer = setTimeout(() => {
    motionBurstLatched = false;
    motionQuietTimer = null;
  }, MOTION_QUIET_REARM_MS);

  const rotation = Math.hypot(
    Number(event.rotationRate?.alpha) || 0,
    Number(event.rotationRate?.beta) || 0,
    Number(event.rotationRate?.gamma) || 0
  );
  const trial = currentTrial();
  const relativeToCueMs = cuePerf == null ? null : performance.now() - cuePerf;

  if (motionBurstLatched) {
    record('motion-shape-repeat-suppressed', { impulse, rotation, relativeToCueMs, trial });
    return;
  }
  motionBurstLatched = true;

  const accepted = rotation >= MOTION_ROTATION_MIN_DPS && rotation <= MOTION_ROTATION_MAX_DPS;
  record(accepted ? 'motion-shape-candidate' : 'motion-shape-rejected', {
    impulse,
    rotation,
    relativeToCueMs,
    trial,
    threshold,
    minRotationDps: MOTION_ROTATION_MIN_DPS,
    maxRotationDps: MOTION_ROTATION_MAX_DPS
  });
  if (!accepted || !pressCue || pressCue.hidden) return;

  lastRefinedMotionPerf = performance.now();
  refineHoldUntil = lastRefinedMotionPerf + (Number(document.getElementById('guardDurationInput')?.value) || 800);
  guardOverlay?.classList.add('active');
  record('refined-presentation-started', { impulse, rotation, relativeToCueMs, trial });
}

function installAudioContextPatch() {
  const Native = window.AudioContext || window.webkitAudioContext;
  if (typeof Native !== 'function') return;
  function GuardLabAudioContext(options = {}) {
    requestedSampleRate = REQUESTED_AUDIO_SAMPLE_RATE;
    try {
      const context = new Native({ ...options, sampleRate: REQUESTED_AUDIO_SAMPLE_RATE });
      actualSampleRate = context.sampleRate;
      return context;
    } catch (error) {
      audioPatchError = error?.message || String(error);
      const context = new Native(options);
      actualSampleRate = context.sampleRate;
      return context;
    }
  }
  try {
    GuardLabAudioContext.prototype = Native.prototype;
    Object.setPrototypeOf(GuardLabAudioContext, Native);
    window.AudioContext = GuardLabAudioContext;
    if (window.webkitAudioContext === Native) window.webkitAudioContext = GuardLabAudioContext;
    audioPatchInstalled = window.AudioContext === GuardLabAudioContext;
  } catch (error) {
    audioPatchError = error?.message || String(error);
  }
}

function updateSampleRateFromUi() {
  const match = (workletStatus?.textContent || '').match(/Running\s*@\s*([\d.]+)\s*kHz/i);
  if (match) actualSampleRate = Number(match[1]) * 1000;
}

function carrierUsable() {
  updateSampleRateFromUi();
  const rate = Number(actualSampleRate);
  const frequency = Number(frequencyInput?.value);
  return Number.isFinite(rate) && Number.isFinite(frequency) && frequency <= rate * CARRIER_NYQUIST_MARGIN;
}

function installDiagnosticPatch() {
  const BaseBlob = window.Blob;
  if (typeof BaseBlob !== 'function') return;
  class RefinedBlob extends BaseBlob {
    constructor(parts = [], options = {}) {
      let nextParts = parts;
      if (options?.type === 'application/json' && parts.length === 1 && typeof parts[0] === 'string') {
        try {
          const payload = JSON.parse(parts[0]);
          if (payload?.purpose === 'MuStash Guard Lab volume-button/screenshot-guard tuning') {
            payload.refinement = {
              version: 1,
              presetAutoAppliedBeforeStart: true,
              motionShape: {
                impulseThresholdMps2: Number(motionThresholdInput?.value) || 0.5,
                rotationMagnitudeMinDps: MOTION_ROTATION_MIN_DPS,
                rotationMagnitudeMaxDps: MOTION_ROTATION_MAX_DPS,
                quietRearmMs: MOTION_QUIET_REARM_MS
              },
              audioContext: {
                requestedSampleRate,
                actualSampleRate: actualSampleRate ?? payload.audio?.context?.sampleRate ?? null,
                patchInstalled: audioPatchInstalled,
                patchError: audioPatchError,
                carrierFrequencyHz: Number(frequencyInput?.value) || null,
                carrierUsable: carrierUsable()
              },
              visualPolicy: 'only button-like motion may black; base carrier/raw-motion/mic activations are suppressed; a usable carrier edge within 700 ms is logged as confirmation',
              events: refineEvents
            };
            (payload.trials || []).forEach((trial, index) => {
              const role = trialRoles[index]?.role || 'expected-press';
              trial.refinement = { role };
              if (trial.groundTruth) {
                trial.groundTruth.role = role;
                trial.groundTruth.expectedPress = role === 'expected-press' ? trialRoles[index]?.label || trial.label : null;
                trial.groundTruth.expectedAction = role;
              }
              trial.controlRole = role === 'expected-press' ? null : role;
            });
            nextParts = [JSON.stringify(payload, null, 2)];
          }
        } catch {}
      }
      super(nextParts, options);
    }
  }
  try { window.Blob = RefinedBlob; } catch {}
}

function record(type, data = {}) {
  refineEvents.push({
    type,
    wallTime: new Date().toISOString(),
    perfMs: performance.now(),
    ...data
  });
}
