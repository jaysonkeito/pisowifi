// =============================================
// CIT PISO WIFI — Frontend Logic
// GCash QR (static) + Coin Slot only
// No PayMongo dependency
// =============================================

// ── Rate map: pesos → minutes ────────────────
const RATES = { 1: 10, 5: 120, 10: 300, 20: 720 };

function pesoToMins(p) {
  // Snap to known rates; otherwise proportional (₱1 = 10 min base)
  return RATES[p] !== undefined ? RATES[p] : Math.floor(p * 10);
}

function fmtMins(m) {
  if (m < 60) return `${m} min${m !== 1 ? 's' : ''}`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h}h${r ? ' ' + r + 'min' : ''}`;
}

// ── State ─────────────────────────────────────
let freeTimer   = null;
let freeLeft    = 180;
let freeActive  = false;

let sessionTimer = null;
let sessionSecs  = 0;

// GCash QR state
let gcashAmount  = 0;   // pesos selected/entered
let gcashMinutes = 0;   // computed minutes
let gcashLabel   = '';  // e.g. "2 hrs"

// Coin state
let coinTotal = 0;
let coinLog   = [];

// ══════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ══════════════════════════════════════════════
// FREE 3-MINUTE TIMER
// Starts when user enters GCash screen.
// Keeps running if user goes back to home and
// re-enters — only resets on expiry or payment.
// ══════════════════════════════════════════════
function startFreeTimer() {
  if (freeActive) return; // already ticking
  freeActive = true;
  freeLeft   = 180;
  updateFreeDisplay();
  freeTimer  = setInterval(tickFree, 1000);
}

function tickFree() {
  freeLeft--;
  updateFreeDisplay();
  if (freeLeft <= 0) {
    resetFreeTimer();
    resetGcashFlow();
    goTo('screen-home');
    toast('⏱ Payment window expired. Please try again.');
  }
}

function updateFreeDisplay() {
  const m   = Math.floor(freeLeft / 60);
  const s   = freeLeft % 60;
  const str = `${m}:${s.toString().padStart(2, '0')}`;
  ['freeValGcash', 'overlayFreeVal'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = str;
    el.classList.toggle('urgent', freeLeft <= 30);
  });
}

function stopFreeTimer() {
  if (freeTimer) { clearInterval(freeTimer); freeTimer = null; }
  freeActive = false;
}

function resetFreeTimer() {
  stopFreeTimer();
  freeLeft = 180;
  ['freeValGcash', 'overlayFreeVal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '3:00'; el.classList.remove('urgent'); }
  });
}

// ══════════════════════════════════════════════
// GCASH QR FLOW
// ══════════════════════════════════════════════
function startGcash() {
  resetGcashFlow();
  goTo('screen-gcash');
  startFreeTimer(); // starts fresh OR continues if already counting
}

function cancelGcash() {
  // Go home but keep timer running — user can re-enter within window
  resetGcashFlow();
  goTo('screen-home');
}

function resetGcashFlow() {
  // Reset amount selection
  gcashAmount  = 0;
  gcashMinutes = 0;
  gcashLabel   = '';

  // Deselect rate cards
  document.querySelectorAll('.gcash-rate-card').forEach(c => c.classList.remove('selected'));

  // Clear custom input
  const inp = document.getElementById('customAmountInput');
  if (inp) inp.value = '';
  const preview = document.getElementById('customAmountPreview');
  if (preview) preview.textContent = '';

  // Disable open gcash button
  const openBtn = document.getElementById('openGcashBtn');
  if (openBtn) openBtn.disabled = true;

  // Hide steps 2 & 3, show step 1
  showGcashStep(1);

  // Clear ref input
  const ref = document.getElementById('refInput');
  if (ref) ref.value = '';
  const confirmBtn = document.getElementById('confirmPayBtn');
  if (confirmBtn) confirmBtn.disabled = true;
  const refErr = document.getElementById('refError');
  if (refErr) refErr.style.display = 'none';
}

function showGcashStep(step) {
  document.getElementById('gcashStep1').style.display = step >= 1 ? 'block' : 'none';
  document.getElementById('gcashStep2').style.display = step >= 2 ? 'block' : 'none';
  document.getElementById('gcashStep3').style.display = step >= 3 ? 'block' : 'none';
}

// Called when a rate card is clicked
function selectGcashRate(card) {
  document.querySelectorAll('.gcash-rate-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');

  gcashAmount  = parseInt(card.dataset.pesos);
  gcashMinutes = parseInt(card.dataset.minutes);
  gcashLabel   = card.dataset.label;

  // Clear custom input when rate card is selected
  const inp = document.getElementById('customAmountInput');
  if (inp) inp.value = '';
  document.getElementById('customAmountPreview').textContent = '';

  enableOpenGcash();
}

// Called on custom amount input
function onCustomAmountChange() {
  const inp = document.getElementById('customAmountInput');
  const val = Math.floor(parseFloat(inp.value));
  const preview = document.getElementById('customAmountPreview');

  if (isNaN(val) || val < 1) {
    gcashAmount  = 0;
    gcashMinutes = 0;
    gcashLabel   = '';
    preview.textContent = '';
    document.getElementById('openGcashBtn').disabled = true;

    // Deselect rate cards only if user cleared input
    if (inp.value === '') return;
    return;
  }

  // Deselect rate cards when custom is entered
  document.querySelectorAll('.gcash-rate-card').forEach(c => c.classList.remove('selected'));

  gcashAmount  = val;
  gcashMinutes = pesoToMins(val);
  gcashLabel   = fmtMins(gcashMinutes);

  preview.textContent = `₱${val} = ${fmtMins(gcashMinutes)} of internet access`;
  enableOpenGcash();
}

function enableOpenGcash() {
  const btn = document.getElementById('openGcashBtn');
  btn.disabled = gcashAmount < 1;
  if (gcashAmount >= 1) {
    btn.textContent = `📱 Open GCash App — Pay ₱${gcashAmount}`;
  } else {
    btn.textContent = '📱 Open GCash App to Pay';
  }
}

// User taps "Open GCash App to Pay"
function openGcashApp() {
  if (gcashAmount < 1) return;

  // Update step 2 display
  document.getElementById('qrAmountLabel').textContent   = `₱${gcashAmount}`;
  document.getElementById('amountToSend').textContent    = `₱${gcashAmount}`;
  document.getElementById('amountToSendTime').textContent = `${fmtMins(gcashMinutes)} of internet access`;

  // Show step 2 (QR code)
  showGcashStep(2);
  document.getElementById('gcashStep2').scrollIntoView({ behavior: 'smooth' });

  // Open GCash deep link — this opens the GCash app on mobile
  // The deep link is allowed by the router during the free window
  window.location.href = 'gcash://send';
}

// User taps "I've Sent the Payment" — show ref input
function showRefInput() {
  showGcashStep(3); // shows all 3 steps
  document.getElementById('gcashStep3').scrollIntoView({ behavior: 'smooth' });
}

// Live validation of reference number input
function onRefInput() {
  const val = document.getElementById('refInput').value.trim();
  const btn = document.getElementById('confirmPayBtn');
  const err = document.getElementById('refError');

  if (val.length >= 6) {
    btn.disabled = false;
    err.style.display = 'none';
  } else {
    btn.disabled = true;
  }
}

// User taps "Confirm & Connect"
function confirmGcashPayment() {
  const ref = document.getElementById('refInput').value.trim();
  if (ref.length < 6) {
    document.getElementById('refError').style.display = 'block';
    return;
  }

  // Grant session immediately — operator verifies ref via GCash inbox
  resetFreeTimer();
  startSession(
    gcashMinutes,
    `₱${gcashAmount} — ${gcashLabel}`,
    `GCash QR · Ref: ${ref.toUpperCase()}`
  );
  resetGcashFlow();
}

// ══════════════════════════════════════════════
// COIN SLOT
// ══════════════════════════════════════════════
const VALID_COINS = [1, 5, 10, 20];

function insertCoin(amount) {
  const invalidNotice = document.getElementById('invalidNotice');
  invalidNotice.style.display = 'none';

  if (amount === 'invalid' || !VALID_COINS.includes(Number(amount))) {
    animateCoin(true);
    ledFlash('#F87171');
    setMachineScreen('INVALID', '#F87171');
    invalidNotice.style.display = 'block';
    setTimeout(() => {
      setMachineScreen(coinTotal > 0 ? `₱${coinTotal}` : 'READY', '#4ADE80');
      invalidNotice.style.display = 'none';
    }, 2400);
    return;
  }

  coinTotal += Number(amount);
  coinLog.push({ amount: Number(amount), time: new Date().toLocaleTimeString() });

  animateCoin(false);
  ledFlash('#FCD34D');
  setMachineScreen(`₱${coinTotal}`, '#4ADE80');
  refreshCoinUI();
}

function setMachineScreen(text, color) {
  const el = document.getElementById('machineScreen');
  el.textContent  = text;
  el.style.color  = color;
}

function refreshCoinUI() {
  const mins = pesoToMins(coinTotal);

  document.getElementById('coinTotalVal').textContent  = `₱${coinTotal}`;
  document.getElementById('coinPreview').innerHTML     = coinTotal > 0
    ? `You will get <b>${fmtMins(mins)}</b> of internet access`
    : 'Insert a coin to start';

  const connectWrap = document.getElementById('coinConnectWrap');
  if (coinTotal > 0) {
    connectWrap.style.display = 'block';
    document.getElementById('coinConnectLabel').textContent = fmtMins(mins);
  } else {
    connectWrap.style.display = 'none';
  }

  // Coin log
  const logWrap = document.getElementById('coinLogWrap');
  const logEl   = document.getElementById('coinLog');
  if (coinLog.length === 0) { logWrap.style.display = 'none'; return; }
  logWrap.style.display = 'block';
  logEl.innerHTML = [...coinLog].reverse().map(e =>
    `<div class="cle">
      <span>₱${e.amount} coin inserted</span>
      <span class="cle-t">${e.time}</span>
    </div>`
  ).join('');
}

function connectWithCoin() {
  const mins  = pesoToMins(coinTotal);
  const label = `₱${coinTotal} total — ${fmtMins(mins)}`;
  startSession(mins, label, 'Coin Slot');
  resetCoin(true);
}

function resetCoin(silent = false) {
  coinTotal = 0;
  coinLog   = [];
  refreshCoinUI();
  setMachineScreen('READY', '#4ADE80');
  document.getElementById('invalidNotice').style.display = 'none';
  if (!silent) goTo('screen-home');
}

function animateCoin(invalid) {
  const machine = document.getElementById('coinMachine');
  const coin    = document.createElement('div');
  coin.className = 'coin-anim';
  if (invalid) coin.style.background = 'linear-gradient(135deg,#94A3B8,#64748B)';
  machine.appendChild(coin);
  setTimeout(() => coin.remove(), 950);
}

function ledFlash(color) {
  const led = document.getElementById('machineLed');
  led.style.background = color;
  led.style.boxShadow  = `0 0 14px ${color}`;
  setTimeout(() => { led.style.background = ''; led.style.boxShadow = ''; }, 700);
}

// ══════════════════════════════════════════════
// SESSION TIMER
// Time stacks if session already running
// ══════════════════════════════════════════════
function startSession(minutes, label, method) {
  const isAddOn = sessionTimer !== null;

  if (isAddOn) {
    sessionSecs += minutes * 60;
  } else {
    sessionSecs = minutes * 60;
  }

  document.getElementById('connDesc').textContent =
    isAddOn ? `Added ${fmtMins(minutes)}. Keep browsing!` : `Enjoy ${fmtMins(minutes)} of internet!`;
  document.getElementById('sessInfo1').textContent = `Plan: ${label}`;
  document.getElementById('sessInfo2').textContent = `Method: ${method}`;

  tickSession();
  goTo('screen-connected');

  if (!isAddOn) {
    sessionTimer = setInterval(() => {
      sessionSecs--;
      tickSession();
      if (sessionSecs <= 0) {
        clearInterval(sessionTimer);
        sessionTimer = null;
        goTo('screen-home');
        toast('⏱ Session ended. Thank you for using CIT Piso WiFi!');
      }
    }, 1000);
  }
}

function tickSession() {
  const h = Math.floor(sessionSecs / 3600);
  const m = Math.floor((sessionSecs % 3600) / 60);
  const s = sessionSecs % 60;
  document.getElementById('timerDisplay').textContent = h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ── Restricted overlay ─────────────────────────
function closeRestricted() {
  document.getElementById('restrictedOverlay').classList.remove('show');
}

// ── Toast ──────────────────────────────────────
function toast(msg) {
  const t = document.createElement('div');
  t.style.cssText = [
    'position:fixed', 'bottom:20px', 'left:50%',
    'transform:translateX(-50%)', 'background:#0A1628',
    'color:white', 'padding:11px 18px', 'border-radius:12px',
    'font-size:0.83rem', 'font-weight:500', 'z-index:99999',
    'max-width:340px', 'text-align:center',
    'box-shadow:0 6px 20px rgba(0,0,0,0.3)'
  ].join(';');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ══════════════════════════════════════════════
// INIT — wire all event listeners on DOM ready
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ CIT Piso WiFi initialized');

  // Home → GCash
  document.getElementById('gcashBtn')
    ?.addEventListener('click', startGcash);

  // Home → Coin Slot
  document.getElementById('coinBtn')
    ?.addEventListener('click', () => goTo('screen-coin'));

  // GCash back button — keeps timer running
  document.getElementById('gcashBackBtn')
    ?.addEventListener('click', cancelGcash);

  // GCash rate cards
  document.querySelectorAll('.gcash-rate-card').forEach(card => {
    card.addEventListener('click', () => selectGcashRate(card));
  });

  // Custom amount input
  document.getElementById('customAmountInput')
    ?.addEventListener('input', onCustomAmountChange);

  // Open GCash App button
  document.getElementById('openGcashBtn')
    ?.addEventListener('click', openGcashApp);

  // "I've Sent" button → show ref input
  document.getElementById('showRefInputBtn')
    ?.addEventListener('click', showRefInput);

  // Reference number input live validation
  document.getElementById('refInput')
    ?.addEventListener('input', onRefInput);

  // Confirm & Connect
  document.getElementById('confirmPayBtn')
    ?.addEventListener('click', confirmGcashPayment);

  // Restricted overlay close
  document.getElementById('backToPaymentBtn')
    ?.addEventListener('click', closeRestricted);
});