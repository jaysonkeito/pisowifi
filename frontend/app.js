// =============================================
// CIT PISO WIFI - Frontend Logic
// =============================================

const API_BASE = '/api';

// ── State ─────────────────────────────────────
let selectedRate = null;
let freeTimer    = null;
let freeLeft     = 180;
let freeActive   = false;
let sessionTimer = null;
let sessionSecs  = 0;
let linkId       = null;
let pollTimer    = null;

let coinTotal = 0;
let coinLog   = [];

// GCash QR state
let qrSelectedRate = null;  // rate card selected on the QR screen

// ── Rate mapping (pesos → minutes) ────────────
// Used by coin slot and GCash QR (small amounts)
const SNAP = { 1: 10, 5: 120, 10: 300, 20: 720 };

function pesoToMins(p) {
  return SNAP[p] !== undefined ? SNAP[p] : Math.floor(p * 10);
}

function fmtMins(m) {
  if (m < 60) return `${m} min${m !== 1 ? 's' : ''}`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h}h${r ? ' ' + r + 'min' : ''}`;
}

// ── Navigation ─────────────────────────────────
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ══════════════════════════════════════════════
// FREE 3-MINUTE TIMER
// Shared by both GCash QR and PayMongo flows.
// Timer keeps running when user navigates back —
// only resets on expiry or successful payment.
// ══════════════════════════════════════════════
function startFreeTimer() {
  if (freeActive) return; // already ticking — don't reset
  freeActive = true;
  freeLeft   = 180;
  tickFree();
  freeTimer = setInterval(tickFree, 1000);
}

function tickFree() {
  freeLeft--;
  const m   = Math.floor(freeLeft / 60);
  const s   = freeLeft % 60;
  const str = `${m}:${s.toString().padStart(2, '0')}`;

  // Update all free-timer displays across all screens
  ['freeVal1', 'freeVal2', 'freeValQr', 'overlayFreeVal'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = str;
    el.classList.toggle('urgent', freeLeft <= 30);
  });

  if (freeLeft <= 0) {
    resetFreeTimer();
    // Clean up both flows
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    selectedRate   = null;
    qrSelectedRate = null;
    linkId         = null;
    document.querySelectorAll('.rate-card').forEach(c => c.classList.remove('selected'));
    const btn = document.getElementById('proceedBtn');
    if (btn) btn.disabled = true;
    const qrBtn = document.getElementById('qrConnectBtn');
    if (qrBtn) qrBtn.disabled = true;
    // Hide ref card
    const refCard = document.getElementById('qrRefCard');
    if (refCard) refCard.style.display = 'none';
    goTo('screen-home');
    toast('⏱ Payment window expired. Please try again.');
  }
}

function stopFreeTimer() {
  if (freeTimer) { clearInterval(freeTimer); freeTimer = null; }
  freeActive = false;
}

// Full reset — only called on expiry or successful payment
function resetFreeTimer() {
  stopFreeTimer();
  freeLeft = 180;
  ['freeVal1', 'freeVal2', 'freeValQr', 'overlayFreeVal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '3:00'; el.classList.remove('urgent'); }
  });
}

// Navigate away without killing timer
function cancelGcash() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  selectedRate = null;
  linkId       = null;
  document.querySelectorAll('.rate-card').forEach(c => c.classList.remove('selected'));
  const btn = document.getElementById('proceedBtn');
  if (btn) btn.disabled = true;
  goTo('screen-home');
}

function cancelQr() {
  qrSelectedRate = null;
  document.querySelectorAll('.qr-rate-card').forEach(c => c.classList.remove('selected'));
  const refCard = document.getElementById('qrRefCard');
  if (refCard) refCard.style.display = 'none';
  const input = document.getElementById('refNumberInput');
  if (input) input.value = '';
  const qrBtn = document.getElementById('qrConnectBtn');
  if (qrBtn) qrBtn.disabled = true;
  // Free timer keeps running
  goTo('screen-home');
}

// ══════════════════════════════════════════════
// GCASH QR FLOW (Static QR + Reference Number)
// ══════════════════════════════════════════════
function startGcashQr() {
  goTo('screen-gcashqr');
  startFreeTimer();
}

function selectQrRate(el) {
  document.querySelectorAll('.qr-rate-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');

  const pesos   = parseInt(el.dataset.pesos);
  const minutes = parseInt(el.dataset.minutes);
  const label   = el.dataset.label;
  qrSelectedRate = { pesos, minutes, label };

  // Show reference number input card
  const refCard = document.getElementById('qrRefCard');
  refCard.style.display = 'block';
  refCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Reset input
  document.getElementById('refNumberInput').value = '';
  document.getElementById('refError').style.display = 'none';
  document.getElementById('qrConnectBtn').disabled = true;
}

function onRefInput() {
  const val = document.getElementById('refNumberInput').value.trim();
  const btn = document.getElementById('qrConnectBtn');
  const err = document.getElementById('refError');

  if (val.length >= 6) {
    btn.disabled = false;
    err.style.display = 'none';
  } else {
    btn.disabled = true;
  }
}

function confirmQrPayment() {
  if (!qrSelectedRate) return;

  const refNumber = document.getElementById('refNumberInput').value.trim();
  if (refNumber.length < 6) {
    document.getElementById('refError').style.display = 'block';
    return;
  }

  // Grant session — operator verifies ref number manually via GCash inbox
  resetFreeTimer();
  startSession(
    qrSelectedRate.minutes,
    `₱${qrSelectedRate.pesos} — ${qrSelectedRate.label}`,
    `GCash QR · Ref: ${refNumber}`
  );

  // Reset QR state
  qrSelectedRate = null;
  document.querySelectorAll('.qr-rate-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('qrRefCard').style.display = 'none';
  document.getElementById('refNumberInput').value = '';
}

// ══════════════════════════════════════════════
// PAYMONGO GCASH FLOW (Automated, min ₱100)
// ══════════════════════════════════════════════
function startGcash() {
  goTo('screen-gcash-rates');
  startFreeTimer();
}

function selectRate(el, pesos, minutes, label) {
  document.querySelectorAll('#screen-gcash-rates .rate-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedRate = { pesos, minutes, label };
  document.getElementById('proceedBtn').disabled = false;
}

async function proceedToPayment() {
  if (!selectedRate) return;
  goTo('screen-gcash-pay');

  document.getElementById('payDesc').textContent =
    `Pay ₱${selectedRate.pesos} for ${selectedRate.label} of WiFi access.`;

  document.getElementById('payLoading').style.display = 'flex';
  document.getElementById('payReady').style.display   = 'none';
  document.getElementById('payError').style.display   = 'none';

  try {
    const res = await fetch(`${API_BASE}/payment-links`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount:      selectedRate.pesos,
        description: `CIT Piso WiFi – ${selectedRate.label}`,
        remarks:     `cit-pisowifi-${selectedRate.pesos}p`
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to create payment link');

    linkId = data.linkId;

    document.getElementById('payLoading').style.display  = 'none';
    document.getElementById('payReady').style.display    = 'block';
    document.getElementById('checkoutLink').href         = data.checkoutUrl;
    document.getElementById('readyAmount').textContent   = `₱${selectedRate.pesos}`;
    document.getElementById('readyPlan').textContent     = `CIT Piso WiFi — ${selectedRate.label}`;

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(autoPoll, 4000);

  } catch (err) {
    console.error('Payment error:', err);
    document.getElementById('payLoading').style.display = 'none';
    document.getElementById('payError').style.display   = 'block';
    document.getElementById('payErrorMsg').textContent  = err.message;
  }
}

async function autoPoll() {
  if (!linkId) return;
  try {
    const res  = await fetch(`${API_BASE}/payment-links/${linkId}`);
    const data = await res.json();
    if (data.success && data.status === 'paid') {
      clearInterval(pollTimer);
      pollTimer = null;
      onPaid();
    }
  } catch (_) {}
}

async function manualVerify() {
  if (!linkId) return;
  goTo('screen-verifying');
  try {
    const res  = await fetch(`${API_BASE}/payment-links/${linkId}`);
    const data = await res.json();
    if (data.success && data.status === 'paid') {
      onPaid();
    } else {
      goTo('screen-failed');
      document.getElementById('failedMsg').textContent =
        `Payment status: "${data.status || 'unknown'}". Please complete GCash payment and verify again.`;
    }
  } catch (e) {
    goTo('screen-failed');
    document.getElementById('failedMsg').textContent = 'Network error. Check your connection.';
  }
}

function onPaid() {
  resetFreeTimer();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  startSession(
    selectedRate.minutes,
    `₱${selectedRate.pesos} — ${selectedRate.label}`,
    'GCash via PayMongo'
  );
}

// ══════════════════════════════════════════════
// COIN SLOT
// ══════════════════════════════════════════════
const VALID_COINS = [1, 5, 10, 20];

function insertCoin(amount) {
  document.getElementById('invalidNotice').style.display = 'none';

  if (amount === 'invalid' || !VALID_COINS.includes(Number(amount))) {
    animateCoin(true);
    ledFlash('#F87171');
    document.getElementById('machineScreen').textContent = 'INVALID';
    document.getElementById('machineScreen').style.color = '#F87171';
    document.getElementById('invalidNotice').style.display = 'block';
    setTimeout(() => {
      document.getElementById('machineScreen').textContent = coinTotal > 0 ? `₱${coinTotal}` : 'READY';
      document.getElementById('machineScreen').style.color = '#4ADE80';
      document.getElementById('invalidNotice').style.display = 'none';
    }, 2400);
    return;
  }

  coinTotal += Number(amount);
  coinLog.push({ amount: Number(amount), time: new Date().toLocaleTimeString() });

  animateCoin(false);
  ledFlash('#FCD34D');
  document.getElementById('machineScreen').textContent = `₱${coinTotal}`;
  document.getElementById('machineScreen').style.color = '#4ADE80';

  refreshCoinUI();
}

function refreshCoinUI() {
  const mins = pesoToMins(coinTotal);

  document.getElementById('coinTotalVal').textContent = `₱${coinTotal}`;
  document.getElementById('coinPreview').innerHTML = coinTotal > 0
    ? `You will get <b>${fmtMins(mins)}</b> of internet access`
    : 'Insert a coin to start';

  if (coinTotal > 0) {
    document.getElementById('coinConnectWrap').style.display = 'block';
    document.getElementById('coinConnectLabel').textContent  = fmtMins(mins);
  } else {
    document.getElementById('coinConnectWrap').style.display = 'none';
  }

  const logWrap = document.getElementById('coinLogWrap');
  const logEl   = document.getElementById('coinLog');
  if (coinLog.length === 0) { logWrap.style.display = 'none'; return; }
  logWrap.style.display = 'block';
  logEl.innerHTML = [...coinLog].reverse().map(e =>
    `<div class="cle"><span>₱${e.amount} coin inserted</span><span class="cle-t">${e.time}</span></div>`
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
  document.getElementById('machineScreen').textContent = 'READY';
  document.getElementById('machineScreen').style.color = '#4ADE80';
  document.getElementById('invalidNotice').style.display = 'none';
  if (!silent) goTo('screen-home');
}

function animateCoin(invalid) {
  const m    = document.getElementById('coinMachine');
  const coin = document.createElement('div');
  coin.className = 'coin-anim';
  if (invalid) coin.style.background = 'linear-gradient(135deg,#94A3B8,#64748B)';
  m.appendChild(coin);
  setTimeout(() => coin.remove(), 950);
}

function ledFlash(color) {
  const led = document.getElementById('machineLed');
  led.style.background = color;
  led.style.boxShadow  = `0 0 14px ${color}`;
  setTimeout(() => { led.style.background = ''; led.style.boxShadow = ''; }, 700);
}

// ══════════════════════════════════════════════
// SESSION TIMER (stacks on existing session)
// ══════════════════════════════════════════════
function startSession(minutes, label, method) {
  const isAddOn = sessionTimer !== null;
  if (isAddOn) {
    sessionSecs += minutes * 60;
  } else {
    sessionSecs = minutes * 60;
  }

  document.getElementById('connDesc').textContent =
    isAddOn ? `Added ${fmtMins(minutes)} to your session.` : `Enjoy ${fmtMins(minutes)} of internet!`;
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
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0A1628;color:white;padding:11px 18px;border-radius:12px;font-size:0.83rem;font-weight:500;z-index:99999;max-width:340px;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,0.3)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── Wire up all event listeners ────────────────
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ CIT Piso WiFi frontend initialized');

  // Home screen — 3 payment method buttons
  document.getElementById('gcashQrBtn')?.addEventListener('click', startGcashQr);
  document.getElementById('gcashBtn')?.addEventListener('click', startGcash);
  document.getElementById('coinBtn')?.addEventListener('click', () => goTo('screen-coin'));

  // GCash QR — back button
  document.getElementById('qrBackBtn')?.addEventListener('click', cancelQr);

  // GCash QR — rate cards
  document.querySelectorAll('.qr-rate-card').forEach(card => {
    card.addEventListener('click', () => selectQrRate(card));
  });

  // GCash QR — reference number input live validation
  document.getElementById('refNumberInput')?.addEventListener('input', onRefInput);

  // GCash QR — confirm & connect button
  document.getElementById('qrConnectBtn')?.addEventListener('click', confirmQrPayment);

  // PayMongo — rate cards (only those inside #screen-gcash-rates)
  document.querySelectorAll('#screen-gcash-rates .rate-card').forEach(card => {
    card.addEventListener('click', () => {
      const pesos   = parseInt(card.dataset.pesos);
      const minutes = parseInt(card.dataset.minutes);
      const label   = card.dataset.label;
      selectRate(card, pesos, minutes, label);
    });
  });

  // PayMongo — proceed button
  document.getElementById('proceedBtn')?.addEventListener('click', proceedToPayment);

  // PayMongo — back button (keeps free timer running)
  document.getElementById('backToHomeBtn')?.addEventListener('click', cancelGcash);

  // Restricted overlay close
  document.getElementById('backToPaymentBtn')?.addEventListener('click', closeRestricted);
});