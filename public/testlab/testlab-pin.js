const mobileQuery = window.matchMedia('(max-width: 760px)');
const testWindow = document.querySelector('[data-testid="test-window"]');
const armedPill = document.getElementById('armedPill');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');

let placeholder = null;
let startPending = false;

startButton?.addEventListener('click', () => {
  startPending = true;
  syncPinnedState();
});

stopButton?.addEventListener('click', () => {
  startPending = false;
  unpinTestWindow();
});

if (armedPill) {
  new MutationObserver(() => {
    if (armedPill.classList.contains('armed')) startPending = false;
    if (armedPill.textContent.trim() === 'No sensors' || armedPill.textContent.trim() === 'Disarmed') startPending = false;
    syncPinnedState();
  }).observe(armedPill, { attributes: true, childList: true, characterData: true, subtree: true });
}

const handleMediaChange = () => syncPinnedState();
if (typeof mobileQuery.addEventListener === 'function') mobileQuery.addEventListener('change', handleMediaChange);
else mobileQuery.addListener(handleMediaChange);

window.addEventListener('pagehide', unpinTestWindow);

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
