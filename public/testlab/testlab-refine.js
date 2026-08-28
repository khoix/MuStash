const guardOverlay = document.querySelector('[data-testid="guard-overlay"]');
const startButton = document.getElementById('startButton');
const manualGuardButton = document.getElementById('manualGuardButton');
const volumeUpTrialButton = document.getElementById('volumeUpTrialButton');
const volumeDownTrialButton = document.getElementById('volumeDownTrialButton');
const trialActions = document.querySelector('.trial-actions');
const trialCopy = document.querySelector('.trial-copy');
const workletStatus = document.getElementById('workletStatus');
const frequencyInput = document.getElementById('frequencyInput');

const STUDY_PRESET = {
  frequencyInput: 18500,
  toneInput: 15,
  carrierThresholdInput: 40,
  transientThresholdInput: 300,
  motionThresholdInput: 5,
  guardDurationInput: 800
};
const REQUESTED_AUDIO_SAMPLE_RATE = 48000;
const CARRIER_NYQUIST_MARGIN = 0.45;
const ANALYSIS_WINDOW_AFTER_CUE_MS = 1500;

const studyEvents = [];
const trialRoles = [];
let pendingTrialMeta = null;
let pressCue = null;
let cuePerf = null;
let researchMode = false;
let manualOverride = false;
let audioPatchInstalled = false;
let requestedSampleRate = null;
let actualSampleRate = null;
let audioPatchError = null;

installAudioContextPatch();
installDiagnosticPatch();
rewriteLabForScreenshotStudy();
queueMicrotask(initializeAfterBase);

startButton?.addEventListener('click', () => {
  applyStudyPreset();
  record('study-preset-auto-applied', { preset: STUDY_PRESET });
}, { capture: true });

manualGuardButton?.addEventListener('click', () => {
  manualOverride = true;
  setTimeout(() => { manualOverride = false; }, 2200);
}, { capture: true });

volumeUpTrialButton?.addEventListener('click', () => registerTrial('volume-up'));
volumeDownTrialButton?.addEventListener('click', () => registerTrial('volume-down'));

window.addEventListener('guardlab:arm-role', (event) => {
  const detail = event.detail || {};
  pendingTrialMeta = {
    role: detail.role || 'manual-volume-button',
    expectedAction: detail.expectedAction || detail.role || 'manual-volume-button',
    volumeCondition: detail.volumeCondition || null,
    suiteStepId: detail.suiteStepId || null
  };
});

window.addEventListener('guardlab:research-mode', (event) => {
  setResearchMode(Boolean(event.detail?.enabled), event.detail?.reason || null);
});

document.addEventListener('pointerdown', (event) => {
  if (!researchMode) return;
  record('pointerdown', {
    relativeToCueMs: cuePerf == null ? null : performance.now() - cuePerf,
    trial: currentTrial(),
    pointerType: event.pointerType || null,
    x: Number.isFinite(event.clientX) ? event.clientX : null,
    y: Number.isFinite(event.clientY) ? event.clientY : null,
    target: describeTarget(event.target)
  });
}, { capture: true, passive: true });

if (guardOverlay) {
  new MutationObserver(() => {
    if (!researchMode || !guardOverlay.classList.contains('active')) return;
    if (manualOverride) return;
    queueMicrotask(() => guardOverlay.classList.remove('active'));
  }).observe(guardOverlay, { attributes: true, attributeFilter: ['class'] });
}

if (workletStatus) {
  new MutationObserver(updateSampleRateFromUi).observe(workletStatus, {
    childList: true,
    characterData: true,
    subtree: true
  });
}

function initializeAfterBase() {
  pressCue = document.querySelector('[data-testid="press-now-cue"]');
  createManualStudyButtons();

  const legacyPreset = document.querySelector('[data-testid="apply-test-preset"]');
  if (legacyPreset) legacyPreset.remove();

  if (!pressCue) return;
  new MutationObserver(() => {
    if (!pressCue.hidden) {
      cuePerf = performance.now();
      rewriteStudyCue();
      record('study-cue-visible', {
        trial: currentTrial(),
        text: pressCue.textContent
      });
    } else {
      cuePerf = null;
    }
  }).observe(pressCue, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true
  });
}

function rewriteLabForScreenshotStudy() {
  const heroTitle = document.querySelector('.lab-hero h1');
  const heroLede = document.querySelector('.lab-hero .lede');
  const testStrong = document.querySelector('[data-testid="test-window"] strong');
  const testSpan = document.querySelector('[data-testid="test-window"] span');
  const trialTitle = document.querySelector('.trial-card h2');
  const triggerLabel = document.querySelector('.metric-card:last-child span');

  if (heroTitle) heroTitle.textContent = 'Can Safari reveal an actual screenshot attempt?';
  if (heroLede) heroLede.textContent = 'Run controlled, real screenshot attempts and compare their raw browser-visible audio and motion signatures with no-action and ordinary-use controls. This is a go/no-go experiment, not a detector demo.';
  if (testStrong) testStrong.textContent = 'During the guided screenshot study, automatic blacking is disabled.';
  if (testSpan) testSpan.textContent = 'The lab records raw sensor telemetry around exact action cues so the experiment itself cannot be distorted by guard triggers.';
  if (trialTitle) trialTitle.textContent = 'Screenshot viability study';
  if (trialCopy) trialCopy.textContent = 'Use Run screenshot viability suite for the decisive test. It will walk through real screenshot attempts at low, medium, and maximum media volume, plus matched controls. The browser cannot read system volume, so you will set each level when prompted.';
  if (triggerLabel) triggerLabel.textContent = 'Raw detector triggers';
}

function applyStudyPreset() {
  Object.entries(STUDY_PRESET).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function createManualStudyButtons() {
  if (!trialActions) return;
  const controls = [
    ['screenshot-attempt', 'arm-screenshot-attempt', 'Arm screenshot attempt'],
    ['no-action', 'control-no-action', 'Arm no-action control'],
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
      pendingTrialMeta = {
        role,
        expectedAction: role,
        volumeCondition: null,
        suiteStepId: null
      };
      volumeDownTrialButton?.click();
    });
    trialActions.append(button);
  }
}

function registerTrial(label) {
  const meta = pendingTrialMeta || {
    role: 'manual-volume-button',
    expectedAction: label,
    volumeCondition: null,
    suiteStepId: null
  };
  trialRoles.push({ label, ...meta });
  pendingTrialMeta = null;
}

function currentTrial() {
  return trialRoles.length ? trialRoles[trialRoles.length - 1] : null;
}

function rewriteStudyCue() {
  const trial = currentTrial();
  if (!trial || !pressCue) return;

  const cues = {
    'screenshot-attempt': 'TAKE SCREENSHOT NOW',
    'no-action': 'DO NOTHING — HOLD STILL',
    'screen-tap': 'TAP SCREEN NOW',
    'movement': 'MOVE PHONE NOW'
  };
  const text = cues[trial.role];
  if (text && pressCue.textContent !== text) pressCue.textContent = text;
}

function setResearchMode(enabled, reason) {
  researchMode = enabled;
  document.body.classList.toggle('screenshot-study-running', enabled);

  if (guardOverlay) {
    if (enabled) {
      guardOverlay.classList.remove('active');
      guardOverlay.style.setProperty('opacity', '0', 'important');
      guardOverlay.style.setProperty('visibility', 'hidden', 'important');
      guardOverlay.style.pointerEvents = 'none';
    } else {
      guardOverlay.style.removeProperty('opacity');
      guardOverlay.style.removeProperty('visibility');
      guardOverlay.style.removeProperty('pointer-events');
    }
  }

  record('research-mode-changed', {
    enabled,
    reason,
    automaticBlackingDisabled: enabled
  });
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
  return Number.isFinite(rate)
    && Number.isFinite(frequency)
    && frequency <= rate * CARRIER_NYQUIST_MARGIN;
}

function installDiagnosticPatch() {
  const BaseBlob = window.Blob;
  if (typeof BaseBlob !== 'function') return;

  class ScreenshotStudyBlob extends BaseBlob {
    constructor(parts = [], options = {}) {
      let nextParts = parts;
      if (options?.type === 'application/json' && parts.length === 1 && typeof parts[0] === 'string') {
        try {
          const payload = JSON.parse(parts[0]);
          if (payload?.purpose === 'MuStash Guard Lab volume-button/screenshot-guard tuning') {
            payload.screenshotViabilityStudy = {
              version: 1,
              question: 'Does an actual screenshot attempt produce a repeatable browser-visible signature that is absent from matched controls?',
              decisionMode: 'raw-telemetry-only',
              automaticBlackingDisabledDuringGuidedSuite: true,
              analysisWindowAfterCueMs: ANALYSIS_WINDOW_AFTER_CUE_MS,
              volumeConditions: {
                operatorSet: true,
                browserVerified: false,
                levels: ['low', 'medium', 'maximum']
              },
              presetAutoAppliedBeforeStart: true,
              measurementPreset: {
                carrierFrequencyHz: STUDY_PRESET.frequencyInput,
                toneGainPercent: STUDY_PRESET.toneInput,
                carrierTriggerPercent: STUDY_PRESET.carrierThresholdInput,
                microphoneTriggerPercent: STUDY_PRESET.transientThresholdInput,
                motionTriggerMps2: STUDY_PRESET.motionThresholdInput
              },
              audioContext: {
                requestedSampleRate,
                actualSampleRate: actualSampleRate ?? payload.audio?.context?.sampleRate ?? null,
                patchInstalled: audioPatchInstalled,
                patchError: audioPatchError,
                carrierFrequencyHz: Number(frequencyInput?.value) || null,
                carrierUsable: carrierUsable()
              },
              events: studyEvents
            };

            (payload.trials || []).forEach((trial, index) => {
              const meta = trialRoles[index] || null;
              if (!meta) return;

              trial.screenshotStudy = {
                role: meta.role,
                expectedAction: meta.expectedAction,
                volumeCondition: meta.volumeCondition,
                volumeConditionBrowserVerified: false,
                suiteStepId: meta.suiteStepId,
                cueAtMs: trial.cueAtMs ?? trial.groundTruth?.cueAtMs ?? null,
                analysisWindowStartAtMs: trial.cueAtMs ?? trial.groundTruth?.cueAtMs ?? null,
                analysisWindowEndAtMs: Number.isFinite(trial.cueAtMs ?? trial.groundTruth?.cueAtMs)
                  ? (trial.cueAtMs ?? trial.groundTruth?.cueAtMs) + ANALYSIS_WINDOW_AFTER_CUE_MS
                  : null
              };

              if (trial.groundTruth) {
                trial.groundTruth.role = meta.role;
                trial.groundTruth.expectedAction = meta.expectedAction;
                trial.groundTruth.expectedPress = meta.role === 'manual-volume-button' ? meta.label : null;
              }
              trial.controlRole = ['no-action', 'screen-tap', 'movement'].includes(meta.role)
                ? meta.role
                : null;
            });

            nextParts = [JSON.stringify(payload, null, 2)];
          }
        } catch {}
      }
      super(nextParts, options);
    }
  }

  try { window.Blob = ScreenshotStudyBlob; } catch {}
}

function describeTarget(target) {
  if (!(target instanceof Element)) return null;
  return {
    tag: target.tagName.toLowerCase(),
    id: target.id || null,
    testid: target.getAttribute('data-testid'),
    role: target.getAttribute('role')
  };
}

function record(type, data = {}) {
  studyEvents.push({
    type,
    wallTime: new Date().toISOString(),
    perfMs: performance.now(),
    ...data
  });
}
