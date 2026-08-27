const $ = (id) => document.getElementById(id);
const secureStatus = $('secureStatus');
const micStatus = $('micStatus');
const motionStatus = $('motionStatus');
const workletStatus = $('workletStatus');
const startButton = $('startButton');
const stopButton = $('stopButton');
const manualGuardButton = $('manualGuardButton');
const recalibrateButton = $('recalibrateButton');
const clearLogButton = $('clearLogButton');
const exportLogButton = $('exportLogButton');
const volumeUpTrialButton = $('volumeUpTrialButton');
const volumeDownTrialButton = $('volumeDownTrialButton');
const falseTriggerButton = $('falseTriggerButton');
const trialState = $('trialState');
const labStatus = $('labStatus');
const armedPill = $('armedPill');
const guardOverlay = $('guardOverlay');
const eventLog = $('eventLog');
const carrierMetric = $('carrierMetric');
const carrierDeltaMetric = $('carrierDeltaMetric');
const rmsMetric = $('rmsMetric');
const rmsDeltaMetric = $('rmsDeltaMetric');
const motionMetric = $('motionMetric');
const triggerMetric = $('triggerMetric');
const lastTriggerMetric = $('lastTriggerMetric');
const frequencyInput = $('frequencyInput');
const toneInput = $('toneInput');
const carrierThresholdInput = $('carrierThresholdInput');
const transientThresholdInput = $('transientThresholdInput');
const motionThresholdInput = $('motionThresholdInput');
const guardDurationInput = $('guardDurationInput');
const frequencyValue = $('frequencyValue');
const toneValue = $('toneValue');
const carrierThresholdValue = $('carrierThresholdValue');
const transientThresholdValue = $('transientThresholdValue');
const motionThresholdValue = $('motionThresholdValue');
const guardDurationValue = $('guardDurationValue');

const sessionStartedPerf = performance.now();
const sessionStartedWall = new Date();
const MAX_TELEMETRY = 60000;
const diagnostics = {
  schemaVersion: 2,
  purpose: 'MuStash Guard Lab volume-button/screenshot-guard tuning',
  sessionId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  sessionStartedAt: sessionStartedWall.toISOString(),
  environment: captureEnvironment(),
  capabilities: {},
  permissions: {},
  settingsInitial: null,
  settingsCurrent: null,
  settingChanges: [],
  audio: { attempts: [], track: null, context: null },
  motion: { available: 'DeviceMotionEvent' in window, permissionApi: typeof window.DeviceMotionEvent?.requestPermission === 'function', intervalsMs: [] },
  calibrations: [],
  trials: [],
  events: [],
  telemetry: [],
  counters: { audioSamples: 0, motionSamples: 0, droppedTelemetry: 0, triggers: 0, suppressedTriggers: 0 },
  final: null
};

let audioContext = null;
let oscillator = null;
let toneGain = null;
let analyzer = null;
let micStream = null;
let silentGain = null;
let running = false;
let calibratingUntil = 0;
let carrierBaseline = null;
let rmsBaseline = null;
let previousMotion = null;
let previousMotionAt = null;
let triggerCount = 0;
let lastTriggerAt = -Infinity;
let guardTimer = null;
let motionHandlerAttached = false;
let activeTrial = null;
let trialTimer = null;
let lastTriggerRecord = null;

secureStatus.textContent = window.isSecureContext ? 'Yes' : 'No';
workletStatus.textContent = window.AudioWorkletNode ? 'Available' : 'Unavailable';
diagnostics.capabilities = {
  secureContext: window.isSecureContext,
  getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
  audioWorklet: Boolean(window.AudioWorkletNode),
  deviceMotion: 'DeviceMotionEvent' in window,
  deviceMotionPermissionApi: typeof window.DeviceMotionEvent?.requestPermission === 'function',
  permissionsApi: Boolean(navigator.permissions?.query)
};

bindRange('frequency', frequencyInput, frequencyValue, (v) => `${(v / 1000).toFixed(1)} kHz`, () => {
  if (oscillator) oscillator.frequency.setValueAtTime(Number(frequencyInput.value), audioContext.currentTime);
  analyzer?.port.postMessage({ type: 'frequency', value: Number(frequencyInput.value) });
});
bindRange('toneLevel', toneInput, toneValue, (v) => `${v}%`, () => {
  if (toneGain) toneGain.gain.setValueAtTime(Number(toneInput.value) / 100, audioContext.currentTime);
});
bindRange('carrierThreshold', carrierThresholdInput, carrierThresholdValue, (v) => `${v}%`);
bindRange('transientThreshold', transientThresholdInput, transientThresholdValue, (v) => `${v}%`);
bindRange('motionThreshold', motionThresholdInput, motionThresholdValue, (v) => `${Number(v).toFixed(2)} m/s²`);
bindRange('guardDuration', guardDurationInput, guardDurationValue, (v) => `${v} ms`);
diagnostics.settingsInitial = readSettings();
diagnostics.settingsCurrent = readSettings();

startButton.addEventListener('click', startLab);
stopButton.addEventListener('click', stopLab);
recalibrateButton.addEventListener('click', calibrate);
manualGuardButton.addEventListener('click', () => triggerGuard('manual test', { source: 'manual' }));
clearLogButton.addEventListener('click', () => eventLog.replaceChildren());
exportLogButton.addEventListener('click', exportDiagnostics);
volumeUpTrialButton.addEventListener('click', () => armTrial('volume-up'));
volumeDownTrialButton.addEventListener('click', () => armTrial('volume-down'));
falseTriggerButton.addEventListener('click', markLastTriggerFalse);
window.addEventListener('keydown', handleKeyEvent, true);
window.addEventListener('keyup', handleKeyEvent, true);
window.addEventListener('pagehide', stopLab);
document.addEventListener('visibilitychange', () => recordEvent('visibility', { state: document.visibilityState }));
window.addEventListener('orientationchange', () => recordEvent('orientationchange', captureViewport()));
window.addEventListener('resize', () => recordEvent('resize', captureViewport()));

queryPermission('microphone');
log('Lab loaded. Manual guard is ready.');

async function startLab() {
  if (running) return;
  startButton.disabled = true;
  labStatus.textContent = 'Requesting sensor access…';
  recordEvent('sensors-start-requested');
  try { await startAudioDetector(); }
  catch (error) {
    micStatus.textContent = 'Unavailable';
    recordEvent('audio-start-error', { message: error.message });
    log(`Microphone/audio detector unavailable: ${error.message}`);
  }
  try { await startMotionDetector(); }
  catch (error) {
    motionStatus.textContent = 'Unavailable';
    recordEvent('motion-start-error', { message: error.message });
    log(`Motion detector unavailable: ${error.message}`);
  }
  running = Boolean(audioContext || motionHandlerAttached);
  startButton.disabled = running;
  stopButton.disabled = !running;
  recalibrateButton.disabled = !audioContext;
  armedPill.textContent = running ? 'Armed' : 'No sensors';
  armedPill.classList.toggle('armed', running);
  labStatus.textContent = running ? 'Sensors armed. Label a trial, press the physical volume button, then export diagnostics.' : 'No sensor path could be started. Manual guard remains available.';
  recordEvent('sensors-started', { running, audio: Boolean(audioContext), motion: motionHandlerAttached });
  if (audioContext) calibrate();
}

async function startAudioDetector() {
  const attempt = { atMs: elapsed(), requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };
  diagnostics.audio.attempts.push(attempt);
  if (!window.isSecureContext) throw new Error('Microphone access requires HTTPS or localhost.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not available.');
  if (!window.AudioWorkletNode) throw new Error('AudioWorklet is not available.');
  micStream = await navigator.mediaDevices.getUserMedia({ audio: attempt.requested, video: false });
  micStatus.textContent = 'Granted';
  attempt.grantedAtMs = elapsed();
  diagnostics.permissions.microphone = 'granted';
  const track = micStream.getAudioTracks()[0];
  diagnostics.audio.track = {
    label: track?.label || '',
    settings: safeCall(() => track.getSettings()),
    constraints: safeCall(() => track.getConstraints()),
    capabilities: safeCall(() => track.getCapabilities?.())
  };
  audioContext = new AudioContext({ latencyHint: 'interactive' });
  await audioContext.audioWorklet.addModule('analyzer-worklet.js');
  await audioContext.resume();
  diagnostics.audio.context = {
    sampleRate: audioContext.sampleRate,
    baseLatency: audioContext.baseLatency ?? null,
    outputLatency: audioContext.outputLatency ?? null,
    state: audioContext.state
  };
  oscillator = new OscillatorNode(audioContext, { type: 'sine', frequency: Number(frequencyInput.value) });
  toneGain = new GainNode(audioContext, { gain: Number(toneInput.value) / 100 });
  oscillator.connect(toneGain).connect(audioContext.destination);
  oscillator.start();
  const micSource = new MediaStreamAudioSourceNode(audioContext, { mediaStream: micStream });
  analyzer = new AudioWorkletNode(audioContext, 'guard-analyzer', { processorOptions: { targetFrequency: Number(frequencyInput.value) } });
  silentGain = new GainNode(audioContext, { gain: 0 });
  micSource.connect(analyzer).connect(silentGain).connect(audioContext.destination);
  analyzer.port.onmessage = handleAudioSample;
  workletStatus.textContent = `Running @ ${(audioContext.sampleRate / 1000).toFixed(1)} kHz`;
  recordEvent('audio-running', diagnostics.audio.context);
  log(`Audio detector running at ${audioContext.sampleRate} Hz sample rate.`);
}

async function startMotionDetector() {
  if (!('DeviceMotionEvent' in window)) throw new Error('DeviceMotionEvent is not available.');
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    const permission = await DeviceMotionEvent.requestPermission();
    diagnostics.permissions.motion = permission;
    if (permission !== 'granted') throw new Error('Motion permission was not granted.');
  } else diagnostics.permissions.motion = 'not-required-or-unknown';
  window.addEventListener('devicemotion', handleMotion, { passive: true });
  motionHandlerAttached = true;
  motionStatus.textContent = 'Listening';
  recordEvent('motion-listening');
  log('Device-motion detector listening.');
}

function handleAudioSample(event) {
  const { carrier, rms, at, blockSize } = event.data || {};
  if (!Number.isFinite(carrier) || !Number.isFinite(rms)) return;
  diagnostics.counters.audioSamples += 1;
  carrierMetric.textContent = carrier.toExponential(2);
  rmsMetric.textContent = rms.toExponential(2);
  const now = performance.now();
  const calibrating = now < calibratingUntil || carrierBaseline === null || rmsBaseline === null;
  if (calibrating) {
    carrierBaseline = smooth(carrierBaseline, carrier, 0.12);
    rmsBaseline = smooth(rmsBaseline, rms, 0.12);
    carrierDeltaMetric.textContent = 'calibrating';
    rmsDeltaMetric.textContent = 'calibrating';
    pushTelemetry({ type: 'audio', atMs: elapsed(), workletAtSec: finiteOrNull(at), blockSize: finiteOrNull(blockSize), carrier, rms, carrierBaseline, rmsBaseline, calibrating: true, trial: trialLabel() });
    return;
  }
  const carrierDelta = relativeDelta(carrier, carrierBaseline);
  const rmsRise = rmsBaseline > 1e-7 ? Math.max(0, (rms - rmsBaseline) / rmsBaseline) : 0;
  const carrierThreshold = Number(carrierThresholdInput.value) / 100;
  const transientThreshold = Number(transientThresholdInput.value) / 100;
  carrierDeltaMetric.textContent = `Δ ${(carrierDelta * 100).toFixed(1)}%`;
  rmsDeltaMetric.textContent = `rise ${(rmsRise * 100).toFixed(1)}%`;
  const sample = { type: 'audio', atMs: elapsed(), workletAtSec: finiteOrNull(at), blockSize: finiteOrNull(blockSize), carrier, rms, carrierBaseline, rmsBaseline, carrierDelta, rmsRise, carrierThreshold, transientThreshold, calibrating: false, trial: trialLabel() };
  pushTelemetry(sample);
  if (carrierBaseline > 1e-7 && carrierDelta >= carrierThreshold) triggerGuard(`carrier change ${(carrierDelta * 100).toFixed(1)}%`, { source: 'carrier', sample });
  else if (rmsBaseline > 1e-7 && rmsRise >= transientThreshold) triggerGuard(`microphone transient ${(rmsRise * 100).toFixed(1)}%`, { source: 'microphone-transient', sample });
  carrierBaseline = smooth(carrierBaseline, carrier, 0.006);
  rmsBaseline = smooth(rmsBaseline, rms, 0.006);
}

function handleMotion(event) {
  const a = event.acceleration || event.accelerationIncludingGravity;
  if (!a) return;
  const now = performance.now();
  const current = { x: Number(a.x) || 0, y: Number(a.y) || 0, z: Number(a.z) || 0 };
  if (!previousMotion) { previousMotion = current; previousMotionAt = now; return; }
  const impulse = Math.hypot(current.x - previousMotion.x, current.y - previousMotion.y, current.z - previousMotion.z);
  const intervalMs = previousMotionAt === null ? null : now - previousMotionAt;
  previousMotion = current;
  previousMotionAt = now;
  diagnostics.counters.motionSamples += 1;
  if (Number.isFinite(intervalMs) && diagnostics.motion.intervalsMs.length < 2000) diagnostics.motion.intervalsMs.push(intervalMs);
  motionMetric.textContent = `${impulse.toFixed(2)} m/s²`;
  const sample = {
    type: 'motion', atMs: elapsed(), x: current.x, y: current.y, z: current.z,
    rotationRate: event.rotationRate ? { alpha: event.rotationRate.alpha, beta: event.rotationRate.beta, gamma: event.rotationRate.gamma } : null,
    intervalReportedMs: Number.isFinite(event.interval) ? event.interval : null,
    intervalObservedMs: intervalMs,
    impulse,
    threshold: Number(motionThresholdInput.value),
    calibrating: now < calibratingUntil,
    trial: trialLabel()
  };
  pushTelemetry(sample);
  if (now >= calibratingUntil && impulse >= sample.threshold) triggerGuard(`motion impulse ${impulse.toFixed(2)} m/s²`, { source: 'motion', sample });
}

function handleKeyEvent(event) {
  const volumeKeys = new Set(['AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown']);
  if (!volumeKeys.has(event.key)) return;
  recordEvent('browser-volume-key', { eventType: event.type, key: event.key, code: event.code, repeat: event.repeat, trial: trialLabel() });
  log(`Browser key event observed: ${event.type} ${event.key}`);
  if (event.type === 'keydown') triggerGuard(`browser ${event.key}`, { source: 'browser-key' });
}

function calibrate() {
  carrierBaseline = null;
  rmsBaseline = null;
  previousMotion = null;
  previousMotionAt = null;
  const calibration = { startedAtMs: elapsed(), durationMs: 1800, settings: readSettings() };
  diagnostics.calibrations.push(calibration);
  calibratingUntil = performance.now() + 1800;
  labStatus.textContent = 'Calibrating for 1.8 seconds. Hold the phone normally and avoid pressing buttons.';
  recordEvent('calibration-start', { index: diagnostics.calibrations.length - 1 });
  log('Calibration started (1.8 s).');
  setTimeout(() => {
    calibration.completedAtMs = elapsed();
    calibration.carrierBaseline = carrierBaseline;
    calibration.rmsBaseline = rmsBaseline;
    if (!running) return;
    labStatus.textContent = 'Calibrated. Arm a labeled trial, then press Volume Up/Down.';
    recordEvent('calibration-complete', { carrierBaseline, rmsBaseline });
    log(`Calibration complete. Carrier baseline ${formatNumber(carrierBaseline)}, RMS baseline ${formatNumber(rmsBaseline)}.`);
  }, 1850);
}

function armTrial(label) {
  if (trialTimer) clearTimeout(trialTimer);
  const trial = { id: diagnostics.trials.length + 1, label, armedAtMs: elapsed(), expiresAtMs: elapsed() + 5000, settings: readSettings(), triggers: [] };
  diagnostics.trials.push(trial);
  activeTrial = trial;
  trialState.textContent = `${label === 'volume-up' ? 'Volume Up' : 'Volume Down'} armed · 5 s`;
  trialState.classList.add('active');
  recordEvent('trial-armed', { trialId: trial.id, label });
  log(`TRIAL ${trial.id}: ${label} armed for 5 seconds.`);
  trialTimer = setTimeout(() => {
    if (activeTrial !== trial) return;
    trial.completedAtMs = elapsed();
    activeTrial = null;
    trialState.textContent = 'No trial armed';
    trialState.classList.remove('active');
    recordEvent('trial-ended', { trialId: trial.id, label });
  }, 5000);
}

function markLastTriggerFalse() {
  if (!lastTriggerRecord) {
    log('No trigger is available to mark false.');
    return;
  }
  lastTriggerRecord.userLabel = 'false-positive';
  lastTriggerRecord.userLabelAtMs = elapsed();
  recordEvent('trigger-user-label', { triggerId: lastTriggerRecord.id, label: 'false-positive' });
  log(`Trigger ${lastTriggerRecord.id} marked false-positive.`);
}

function triggerGuard(reason, detail = {}) {
  const now = performance.now();
  if (now - lastTriggerAt < 120) {
    diagnostics.counters.suppressedTriggers += 1;
    recordEvent('trigger-suppressed', { reason, source: detail.source || null, sincePreviousMs: now - lastTriggerAt, trial: trialLabel() });
    return;
  }
  lastTriggerAt = now;
  triggerCount += 1;
  diagnostics.counters.triggers = triggerCount;
  triggerMetric.textContent = String(triggerCount);
  lastTriggerMetric.textContent = reason;
  const trigger = {
    id: triggerCount, atMs: elapsed(), reason, source: detail.source || null,
    trial: activeTrial ? { id: activeTrial.id, label: activeTrial.label } : null,
    settings: readSettings(), baselines: { carrier: carrierBaseline, rms: rmsBaseline },
    sample: detail.sample || null
  };
  lastTriggerRecord = trigger;
  if (activeTrial) activeTrial.triggers.push(trigger.id);
  recordEvent('guard-trigger', trigger);
  if (guardTimer) clearTimeout(guardTimer);
  guardOverlay.classList.add('active');
  const activatedAt = performance.now();
  trigger.classAppliedAtMs = elapsed();
  trigger.classApplyLatencyMs = activatedAt - now;
  log(`GUARD: ${reason} · class applied +${trigger.classApplyLatencyMs.toFixed(2)} ms`);
  requestAnimationFrame(() => {
    trigger.nextAnimationFrameAtMs = elapsed();
    trigger.nextAnimationFrameLatencyMs = performance.now() - now;
    recordEvent('guard-next-animation-frame', { triggerId: trigger.id, latencyMs: trigger.nextAnimationFrameLatencyMs });
    log(`GUARD: next animation frame +${trigger.nextAnimationFrameLatencyMs.toFixed(2)} ms`);
  });
  guardTimer = setTimeout(() => {
    guardOverlay.classList.remove('active');
    trigger.guardReleasedAtMs = elapsed();
  }, Number(guardDurationInput.value));
}

async function stopLab() {
  running = false;
  if (motionHandlerAttached) { window.removeEventListener('devicemotion', handleMotion); motionHandlerAttached = false; }
  if (oscillator) { try { oscillator.stop(); } catch {} }
  micStream?.getTracks().forEach((track) => track.stop());
  if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
  audioContext = oscillator = toneGain = analyzer = silentGain = micStream = null;
  carrierBaseline = rmsBaseline = previousMotion = previousMotionAt = null;
  micStatus.textContent = 'Stopped';
  motionStatus.textContent = 'Stopped';
  workletStatus.textContent = window.AudioWorkletNode ? 'Available' : 'Unavailable';
  armedPill.textContent = 'Disarmed';
  armedPill.classList.remove('armed');
  startButton.disabled = false;
  stopButton.disabled = true;
  recalibrateButton.disabled = true;
  labStatus.textContent = 'Sensors stopped. Manual guard remains available.';
  recordEvent('sensors-stopped');
  log('Sensors stopped.');
}

function exportDiagnostics() {
  diagnostics.settingsCurrent = readSettings();
  diagnostics.final = {
    exportedAt: new Date().toISOString(), elapsedMs: elapsed(), running,
    triggerCount, carrierBaseline, rmsBaseline, viewport: captureViewport(),
    telemetryCount: diagnostics.telemetry.length
  };
  const payload = JSON.stringify(diagnostics, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `mustash-guardlab-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log(`Diagnostics exported (${diagnostics.telemetry.length} telemetry samples, ${diagnostics.events.length} events).`);
}

function bindRange(name, input, output, formatter, onInput) {
  const render = () => {
    output.value = formatter(Number(input.value));
    onInput?.();
    if (diagnostics.settingsInitial) {
      diagnostics.settingChanges.push({ atMs: elapsed(), name, value: Number(input.value) });
      diagnostics.settingsCurrent = readSettings();
    }
  };
  input.addEventListener('input', render);
  output.value = formatter(Number(input.value));
  onInput?.();
}

function readSettings() {
  return {
    carrierFrequencyHz: Number(frequencyInput.value), toneGainPercent: Number(toneInput.value),
    carrierChangeThresholdPercent: Number(carrierThresholdInput.value), transientRiseThresholdPercent: Number(transientThresholdInput.value),
    motionImpulseThresholdMps2: Number(motionThresholdInput.value), guardDurationMs: Number(guardDurationInput.value), triggerCooldownMs: 120, calibrationMs: 1800
  };
}

function pushTelemetry(sample) {
  if (diagnostics.telemetry.length >= MAX_TELEMETRY) {
    diagnostics.telemetry.shift();
    diagnostics.counters.droppedTelemetry += 1;
  }
  diagnostics.telemetry.push(sample);
}

function recordEvent(type, data = {}) {
  diagnostics.events.push({ atMs: elapsed(), wallTime: new Date().toISOString(), type, ...data });
}

function trialLabel() {
  return activeTrial ? { id: activeTrial.id, label: activeTrial.label } : null;
}

async function queryPermission(name) {
  if (!navigator.permissions?.query) return;
  try {
    const result = await navigator.permissions.query({ name });
    diagnostics.permissions[name] = result.state;
    result.addEventListener('change', () => {
      diagnostics.permissions[name] = result.state;
      recordEvent('permission-change', { name, state: result.state });
    });
  } catch { diagnostics.permissions[name] = diagnostics.permissions[name] || 'query-unsupported'; }
}

function captureEnvironment() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: [...(navigator.languages || [])],
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGb: navigator.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints ?? null,
    cookieEnabled: navigator.cookieEnabled,
    webdriver: navigator.webdriver,
    screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth, orientation: screen.orientation ? { type: screen.orientation.type, angle: screen.orientation.angle } : null },
    viewport: captureViewport(),
    connection: navigator.connection ? { effectiveType: navigator.connection.effectiveType, downlink: navigator.connection.downlink, rtt: navigator.connection.rtt, saveData: navigator.connection.saveData } : null
  };
}

function captureViewport() {
  return { innerWidth: innerWidth, innerHeight: innerHeight, devicePixelRatio: devicePixelRatio, visualViewport: window.visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale, offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop } : null };
}

function smooth(current, next, alpha) { return current === null ? next : current + alpha * (next - current); }
function relativeDelta(value, baseline) { return !baseline || baseline < 1e-9 ? 0 : Math.abs(value - baseline) / baseline; }
function formatNumber(value) { return Number.isFinite(value) ? value.toExponential(2) : 'n/a'; }
function finiteOrNull(value) { return Number.isFinite(value) ? value : null; }
function elapsed() { return performance.now() - sessionStartedPerf; }
function safeCall(fn) { try { return fn() ?? null; } catch (error) { return { error: error.message }; } }
function log(message) {
  recordEvent('ui-log', { message });
  const row = document.createElement('div');
  row.className = 'log-entry';
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = `${elapsed().toFixed(1)} ms`;
  const text = document.createElement('span');
  text.textContent = message;
  row.append(time, text);
  eventLog.prepend(row);
  while (eventLog.children.length > 120) eventLog.lastElementChild?.remove();
}
