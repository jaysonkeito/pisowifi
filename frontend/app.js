// =============================================
// PISO WIFI - Full Frontend Logic
// =============================================

const API_BASE = '/api';

let selectedRate = null;
let freeTimer = null;
let freeLeft = 180;
let freeActive = false;
let sessionTimer = null;
let sessionSecs = 0;
let linkId = null;
let pollTimer = null;

let coinTotal = 0;
let coinLog = [];

// Rate mapping
const SNAP = {1:10, 5:120, 10:300, 20:720};

function pesoToMins(p) {
  return SNAP[p] !== undefined ? SNAP[p] : Math.floor(p * 10);
}

function fmtMins(m) {
  if (m < 60) return `${m} min${m !== 1 ? 's' : ''}`;
  const h = Math.floor(m/60), r = m%60;
  return `${h}h${r ? ' ' + r + 'min' : ''}`;
}

// Navigation
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// Free 3-min timer
function startFreeTimer() {
  if (freeActive) return;
  freeActive = true;
  freeLeft = 180;
  tickFree();
  freeTimer = setInterval(tickFree, 1000);
}

function tickFree() {
  freeLeft--;
  const m = Math.floor(freeLeft/60), s = freeLeft%60;
  const str = `${m}:${s.toString().padStart(2,'0')}`;
  ['freeVal1','freeVal2','overlayFreeVal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = str;
      el.classList.toggle('urgent', freeLeft <= 30);
    }
  });
  if (freeLeft <= 0) cancelGcash();
}

function stopFreeTimer() {
  if (freeTimer) clearInterval(freeTimer);
  freeActive = false;
}

function cancelGcash() {
  stopFreeTimer();
  if (pollTimer) clearInterval(pollTimer);
  selectedRate = null;
  linkId = null;
  document.querySelectorAll('.rate-card').forEach(c => c.classList.remove('selected'));
  const proceedBtn = document.getElementById('proceedBtn');
  if (proceedBtn) proceedBtn.disabled = true;
  goTo('screen-home');
}

// GCash Flow
function startGcash() {
  goTo('screen-gcash-rates');
  startFreeTimer();
}

async function proceedToPayment() {
  if (!selectedRate) return;
  goTo('screen-gcash-pay');

  document.getElementById('payDesc').textContent = 
    `Pay ₱${selectedRate.pesos} for ${selectedRate.label} of WiFi access.`;

  document.getElementById('payLoading').style.display = 'flex';
  document.getElementById('payReady').style.display = 'none';
  document.getElementById('payError').style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/payment-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: selectedRate.pesos,
        description: `PISO WIFI – ${selectedRate.label}`,
        remarks: `pisowifi-${selectedRate.pesos}p`
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Failed to create payment link');

    linkId = data.linkId;
    document.getElementById('payLoading').style.display = 'none';
    document.getElementById('payReady').style.display = 'block';
    document.getElementById('checkoutLink').href = data.checkoutUrl;
    document.getElementById('readyAmount').textContent = `₱${selectedRate.pesos}`;
    document.getElementById('readyPlan').textContent = `PISO WIFI — ${selectedRate.label}`;

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(autoPoll, 4000);

  } catch (err) {
    console.error(err);
    document.getElementById('payLoading').style.display = 'none';
    document.getElementById('payError').style.display = 'block';
    document.getElementById('payErrorMsg').textContent = err.message;
  }
}

async function autoPoll() {
  if (!linkId) return;
  try {
    const res = await fetch(`${API_BASE}/payment-links/${linkId}`);
    const data = await res.json();
    if (data.success && data.status === 'paid') {
      clearInterval(pollTimer);
      onPaid();
    }
  } catch (_) {}
}

async function manualVerify() {
  if (!linkId) return;
  goTo('screen-verifying');
  try {
    const res = await fetch(`${API_BASE}/payment-links/${linkId}`);
    const data = await res.json();
    if (data.success && data.status === 'paid') {
      onPaid();
    } else {
      goTo('screen-failed');
      document.getElementById('failedMsg').textContent = `Status: ${data.status || 'unknown'}`;
    }
  } catch (e) {
    goTo('screen-failed');
    document.getElementById('failedMsg').textContent = 'Network error. Please try again.';
  }
}

function onPaid() {
  stopFreeTimer();
  if (pollTimer) clearInterval(pollTimer);
  startSession(selectedRate.minutes, `₱${selectedRate.pesos} — ${selectedRate.label}`, 'GCash via PayMongo');
}

// Coin Slot Functions
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
    document.getElementById('coinConnectLabel').textContent = fmtMins(mins);
  } else {
    document.getElementById('coinConnectWrap').style.display = 'none';
  }
}

function connectWithCoin() {
  const mins = pesoToMins(coinTotal);
  const label = `₱${coinTotal} total — ${fmtMins(mins)}`;
  startSession(mins, label, 'Coin Slot');
  resetCoin(true);
}

function resetCoin(silent = false) {
  coinTotal = 0;
  coinLog = [];
  refreshCoinUI();
  document.getElementById('machineScreen').textContent = 'READY';
  document.getElementById('machineScreen').style.color = '#4ADE80';
  document.getElementById('invalidNotice').style.display = 'none';
  if (!silent) goTo('screen-home');
}

function animateCoin(invalid) {
  const m = document.getElementById('coinMachine');
  const coin = document.createElement('div');
  coin.className = 'coin-anim';
  if (invalid) coin.style.background = 'linear-gradient(135deg,#94A3B8,#64748B)';
  m.appendChild(coin);
  setTimeout(() => coin.remove(), 950);
}

function ledFlash(color) {
  const led = document.getElementById('machineLed');
  led.style.background = color;
  led.style.boxShadow = `0 0 14px ${color}`;
  setTimeout(() => {
    led.style.background = '';
    led.style.boxShadow = '';
  }, 700);
}

// Session Timer
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
        toast('⏱ Session ended. Thank you for using PISO WIFI!');
      }
    }, 1000);
  }
}

function tickSession() {
  const h = Math.floor(sessionSecs / 3600);
  const m = Math.floor((sessionSecs % 3600) / 60);
  const s = sessionSecs % 60;
  document.getElementById('timerDisplay').textContent = h > 0 
    ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` 
    : `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

// Toast
function toast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0A1628;color:white;padding:11px 18px;border-radius:12px;font-size:0.83rem;font-weight:500;z-index:99999;max-width:340px;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,0.3)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// Close restricted overlay
function closeRestricted() {
  document.getElementById('restrictedOverlay').classList.remove('show');
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  console.log("✅ PISO WIFI Frontend initialized successfully");

  // Main navigation buttons
  document.getElementById('gcashBtn')?.addEventListener('click', startGcash);
  document.getElementById('coinBtn')?.addEventListener('click', () => goTo('screen-coin'));

  // Rate cards
  document.querySelectorAll('.rate-card').forEach(card => {
    card.addEventListener('click', () => {
      const pesos = parseInt(card.dataset.pesos);
      const minutes = parseInt(card.dataset.minutes);
      const label = card.dataset.label;
      selectRate(card, pesos, minutes, label);
    });
  });

  // Other buttons
  document.getElementById('proceedBtn')?.addEventListener('click', proceedToPayment);
  document.getElementById('backToHomeBtn')?.addEventListener('click', () => goTo('screen-home'));
  document.getElementById('backToPaymentBtn')?.addEventListener('click', closeRestricted);
});

function selectRate(el, pesos, minutes, label) {
  document.querySelectorAll('.rate-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedRate = {pesos, minutes, label};
  document.getElementById('proceedBtn').disabled = false;
}