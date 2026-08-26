const secureStatus = document.getElementById('secureStatus');
const micStatus = document.getElementById('micStatus');
const motionStatus = document.getElementById('motionStatus');
const workletStatus = document.getElementById('workletStatus');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const manualGuardButton = document.getElementById('manualGuardButton');
const recalibrateButton = document.getElementById('recalibrateButton');
const clearLogButton = document.getElementById('clearLogButton');
const labStatus = document.getElementById('labStatus');
const armedPill = document.getElementById('armedPill');
const guardOverlay = document.getElementById('guardOverlay');
const eventLog = document.getElementById('eventLog');
const carrierMetric = document.getElementById('carrierMetric');
const carrierDeltaMetric = document.getElementById('carrierDeltaMetric');
const rmsMetric = document.getElementById('rmsMetric');
const rmsDeltaMetric = document.getElementById('rmsDeltaMetric');
const motionMetric = document.getElementById('motionMetric');
const triggerMetric = document.getElementById('triggerMetric');
const lastTriggerMetric = document.getElementById('lastTriggerMetric');

const frequencyInput = document.getElementById('frequencyInput');
const toneInput = document.getElementById('toneInput');
const carrierThresholdInput = document.getElementById('carrierThresholdInput');
const transientThresholdInput = document.getElementById('transientThresholdInput');
const motionThresholdInput = document.getElementById('motionThresholdInput');
const guardDurationInput = document.getElementById('guardDurationInput');

const frequencyValue = document.getElementById('frequencyValue');
const toneValue = document.getElementById('toneValue');
const carrierThresholdValue = document.getElementById('carrierThresholdValue');
const transientThresholdValue = document.getElementById('transientThresholdValue');
const motionThresholdValue = document.getElementById('motionThresholdValue');
const guardDurationValue = document.getElementById('guardDurationValue');

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
let triggerCount = 0;
let lastTriggerAt = -Infinity;
let guardTimer = null;
let motionHandlerAttached = false;

secureStatus.textContent = window.isSecureContext ? 'Yes' : 'No';
workletStatus.textContent = window.AudioWorkletNode ? 'Available' : 'Unavailable';

bindRange(frequencyInput, frequencyValue, (value) => `${(value / 1000).toFixed(1)} kHz`, () => {
  if (oscillator) oscillator.frequency.setValueAtTime(Number(frequencyInput.value), audioContext.currentTime);
  analyzer?.port.postMessage({ type: 'frequency', value: Number(frequencyInput.value) });
});
bindRange(toneInput, toneValue, (value) => `${value}%`, () => {
  if (toneGain) toneGain.gain.setValueAtTime(Number(toneInput.value) / 100, audioContext.currentTime);
});
bindRange(carrierThresholdInput, carrierThresholdValue, (value) => `${value}%`);
bindRange(transientThresholdInput, transientThresholdValue, (value) => `${value}%`);
bindRange(motionThresholdInput, motionThresholdValue, (value) => `${Number(value).toFixed(2)} m/s²`);
bindRange(guardDurationInput, guardDurationValue, (value) => `${value} ms`);

startButton.addEventListener('click', startLab);
stopButton.addEventListener('click', stopLab);
recalibrateButton.addEventListener('click', calibrate);
manualGuardButton.addEventListener('click', () => triggerGuard('manual test'));
clearLogButton.addEventListener('click', () => { eventLog.replaceChildren(); });
window.addEventListener('keydown', handleKeyEvent, true);
window.addEventListener('keyup', handleKeyEvent, true);
window.addEventListener('pagehide', stopLab);

log('Lab loaded. Manual guard is ready.');

async function startLab() {
  if (running) return;
  startButton.disabled = true;
  labStatus.textContent = 'Requesting sensor access…';
  log('Starting sensors.');

  try {
    await startAudioDetector();
  } catch (error) {
    micStatus.textContent = 'Unavailable';
    log(`Microphone/audio detector unavailable: ${error.message}`);
  }

  try {
    await startMotionDetector();
  } catch (error) {
    motionStatus.textContent = 'Unavailable';
    log(`Motion detector unavailable: ${error.message}`);
  }

  running = Boolean(audioContext || motionHandlerAttached);
  startButton.disabled = running;
  stopButton.disabled = !running;
  recalibrateButton.disabled = !audioContext;
  armedPill.textContent = running ? 'Armed' : 'No sensors';
  armedPill.classList.toggle('armed', running);
  labStatus.textContent = running
    ? 'Sensors armed. Press the physical volume buttons and watch the guard/log.'
    : 'No sensor path could be started. Manual guard remains available.';

  if (audioContext) calibrate();
}

async function startAudioDetector() {
  if (!window.isSecureContext) throw new Error('Microphone access requires HTTPS or localhost.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not available.');
  if (!window.AudioWorkletNode) throw new Error('AudioWorklet is not available.');

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1
    },
    video: false
  });
  micStatus.textContent = 'Granted';

  audioContext = new AudioContext({ latencyHint: 'interactive' });
  await audioContext.audioWorklet.addModule('analyzer-worklet.js');
  await audioContext.resume();

  oscillator = new OscillatorNode(audioContext, {
    type: 'sine',
    frequency: Number(frequencyInput.value)
  });
  toneGain = new GainNode(audioContext, { gain: Number(toneInput.value) / 100 });
  oscillator.connect(toneGain).connect(audioContext.destination);
  oscillator.start();

  const micSource = new MediaStreamAudioSourceNode(audioContext, { mediaStream: micStream });
  analyzer = new AudioWorkletNode(audioContext, 'guard-analyzer', {
    processorOptions: { targetFrequency: Number(frequencyInput.value) }
  });
  silentGain = new GainNode(audioContext, { gain: 0 });
  micSource.connect(analyzer).connect(silentGain).connect(audioContext.destination);
  analyzer.port.onmessage = handleAudioSample;
  workletStatus.textContent = `Running @ ${(audioContext.sampleRate / 1000).toFixed(1)} kHz`;
  log(`Audio detector running at ${audioContext.sampleRate} Hz sample rate.`);
}

async function startMotionDetector() {
  if (!('DeviceMotionEvent' in window)) throw new Error('DeviceMotionEvent is not available.');
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    const permission = await DeviceMotionEvent.requestPermission();
    if (permission !== 'granted') throw new Error('Motion permission was not granted.');
  }
  window.addEventListener('devicemotion', handleMotion, { passive: true });
  motionHandlerAttached = true;
  motionStatus.textContent = 'Listening';
  log('Device-motion detector listening.');
}

function handleAudioSample(event) {
  const { carrier, rms } = event.data || {};
  if (!Number.isFinite(carrier) || !Number.isFinite(rms)) return;

  carrierMetric.textContent = carrier.toExponential(2);
  rmsMetric.textContent = rms.toExponential(2);

  if (performance.now() < calibratingUntil || carrierBaseline === null || rmsBaseline === null) {
    carrierBaseline = smooth(carrierBaseline, carrier, 0.12);
    rmsBaseline = smooth(rmsBaseline, rms, 0.12);
    carrierDeltaMetric.textContent = 'calibrating';
    rmsDeltaMetric.textContent = 'calibrating';
    return;
  }

  const carrierDelta = relativeDelta(carrier, carrierBaseline);
  const rmsRise = rmsBaseline > 1e-7 ? Math.max(0, (rms - rmsBaseline) / rmsBaseline) : 0;
  carrierDeltaMetric.textContent = `Δ ${(carrierDelta * 100).toFixed(1)}%`;
  rmsDeltaMetric.textContent = `rise ${(rmsRise * 100).toFixed(1)}%`;

  const carrierThreshold = Number(carrierThresholdInput.value) / 100;
  const transientThreshold = Number(transientThresholdInput.value) / 100;

  if (carrierBaseline > 1e-7 && carrierDelta >= carrierThreshold) {
    triggerGuard(`carrier change ${(carrierDelta * 100).toFixed(1)}%`);
  } else if (rmsBaseline > 1e-7 && rmsRise >= transientThreshold) {
    triggerGuard(`microphone transient ${(rmsRise * 100).toFixed(1)}%`);
  }

  // Adapt slowly so ordinary environmental drift does not permanently bias the detector.
  carrierBaseline = smooth(carrierBaseline, carrier, 0.006);
  rmsBaseline = smooth(rmsBaseline, rms, 0.006);
}

function handleMotion(event) {
  const a = event.acceleration || event.accelerationIncludingGravity;
  if (!a) return;
  const current = {
    x: Number(a.x) || 0,
    y: Number(a.y) || 0,
    z: Number(a.z) || 0
  };

  if (!previousMotion) {
    previousMotion = current;
    return;
  }

  const impulse = Math.hypot(
    current.x - previousMotion.x,
    current.y - previousMotion.y,
    current.z - previousMotion.z
  );
  previousMotion = current;
  motionMetric.textContent = `${impulse.toFixed(2)} m/s²`;

  if (performance.now() >= calibratingUntil && impulse >= Number(motionThresholdInput.value)) {
    triggerGuard(`motion impulse ${impulse.toFixed(2)} m/s²`);
  }
}

function handleKeyEvent(event) {
  const volumeKeys = new Set(['AudioVolumeUp', 'AudioVolumeDown', 'VolumeUp', 'VolumeDown']);
  if (!volumeKeys.has(event.key)) return;
  log(`Browser key event observed: ${event.type} ${event.key}`);
  if (event.type === 'keydown') triggerGuard(`browser ${event.key}`);
}

function calibrate() {
  carrierBaseline = null;
  rmsBaseline = null;
  previousMotion = null;
  calibratingUntil = performance.now() + 1800;
  labStatus.textContent = 'Calibrating for 1.8 seconds. Hold the phone normally and avoid pressing buttons.';
  log('Calibration started (1.8 s).');
  setTimeout(() => {
    if (!running) return;
    labStatus.textContent = 'Calibrated. Press Volume Up/Down and watch the guard/log.';
    log(`Calibration complete. Carrier baseline ${formatNumber(carrierBaseline)}, RMS baseline ${formatNumber(rmsBaseline)}.`);
  }, 1850);
}

function triggerGuard(reason) {
  const now = performance.now();
  if (now - lastTriggerAt < 120) return;
  lastTriggerAt = now;
  triggerCount += 1;
  triggerMetric.textContent = String(triggerCount);
  lastTriggerMetric.textContent = reason;

  if (guardTimer) clearTimeout(guardTimer);
  guardOverlay.classList.add('active');
  const activatedAt = performance.now();
  log(`GUARD: ${reason} · class applied +${(activatedAt - now).toFixed(2)} ms`);

  requestAnimationFrame(() => {
    log(`GUARD: next animation frame +${(performance.now() - now).toFixed(2)} ms`);
  });

  guardTimer = setTimeout(() => {
    guardOverlay.classList.remove('active');
  }, Number(guardDurationInput.value));
}

async function stopLab() {
  running = false;
  if (motionHandlerAttached) {
    window.removeEventListener('devicemotion', handleMotion);
    motionHandlerAttached = false;
  }
  if (oscillator) {
    try { oscillator.stop(); } catch {}
  }
  micStream?.getTracks().forEach((track) => track.stop());
  if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});

  audioContext = null;
  oscillator = null;
  toneGain = null;
  analyzer = null;
  silentGain = null;
  micStream = null;
  carrierBaseline = null;
  rmsBaseline = null;
  previousMotion = null;
  micStatus.textContent = 'Stopped';
  motionStatus.textContent = 'Stopped';
  workletStatus.textContent = window.AudioWorkletNode ? 'Available' : 'Unavailable';
  armedPill.textContent = 'Disarmed';
  armedPill.classList.remove('armed');
  startButton.disabled = false;
  stopButton.disabled = true;
  recalibrateButton.disabled = true;
  labStatus.textContent = 'Sensors stopped. Manual guard remains available.';
  log('Sensors stopped.');
}

function bindRange(input, output, formatter, onInput) {
  const render = () => {
    output.value = formatter(Number(input.value));
    onInput?.();
  };
  input.addEventListener('input', render);
  render();
}

function smooth(current, next, alpha) {
  return current === null ? next : current + alpha * (next - current);
}

function relativeDelta(value, baseline) {
  if (!baseline || baseline < 1e-9) return 0;
  return Math.abs(value - baseline) / baseline;
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toExponential(2) : 'n/a';
}

function log(message) {
  const row = document.createElement('div');
  row.className = 'log-entry';
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = `${performance.now().toFixed(1)} ms`;
  const text = document.createElement('span');
  text.textContent = message;
  row.append(time, text);
  eventLog.prepend(row);
  while (eventLog.children.length > 120) eventLog.lastElementChild?.remove();
}
