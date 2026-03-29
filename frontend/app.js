// PISO WIFI - Frontend Logic
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
const SNAP = {1: 10, 5: 120, 10: 300, 20: 720};
function pesoToMins(p) {
  return SNAP[p] !== undefined ? SNAP[p] : Math.floor(p * 10);
}
function fmtMins(m) {
  if (m < 60) return `${m} min${m !== 1 ? 's' : ''}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h${r ? ' ' + r + 'min' : ''}`;
}

// Navigation
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// Free 3-minute payment window timer
function startFreeTimer() {
  if (freeActive) return;
  freeActive = true;
  freeLeft = 180;
  tickFree();
  freeTimer = setInterval(tickFree, 1000);
}

function tickFree() {
  freeLeft--;
  const m = Math.floor(freeLeft / 60);
  const s = freeLeft % 60;
  const str = `${m}:${s.toString().padStart(2, '0')}`;
  ['freeVal1', 'freeVal2', 'overlayFreeVal'].forEach(id => {
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
  document.getElementById('proceedBtn').disabled = true;
  goTo('screen-home');
}

// GCash Flow
function startGcash() {
  goTo('screen-gcash-rates');
  startFreeTimer();
}

function selectRate(el, pesos, minutes, label) {
  document.querySelectorAll('.rate-card').forEach(c => c.classList.remove('selected'));
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
  document.getElementById('payReady').style.display = 'none';
  document.getElementById('payError').style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/payment-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: selectedRate.pesos,
        description: `PISO WIFI – ${selectedRate.label}`,
        remarks: `cit-wifi-${selectedRate.pesos}p`
      })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    linkId = data.linkId;
    document.getElementById('payLoading').style.display = 'none';
    document.getElementById('payReady').style.display = 'block';
    document.getElementById('checkoutLink').href = data.checkoutUrl;
    document.getElementById('readyAmount').textContent = `₱${selectedRate.pesos}`;
    document.getElementById('readyPlan').textContent = `PISO WIFI — ${selectedRate.label}`;

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(autoPoll, 4000);
  } catch (err) {
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
      document.getElementById('failedMsg').textContent = `Payment status: ${data.status || 'unknown'}`;
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

// Coin Slot Logic (unchanged from your original - copy the full coin functions)
const VALID_COINS = [1, 5, 10, 20];

function insertCoin(amount) { /* paste your original insertCoin function here */ }
function refreshCoinUI() { /* paste your original */ }
function connectWithCoin() { /* paste */ }
function resetCoin(silent) { /* paste */ }
function animateCoin(invalid) { /* paste */ }
function ledFlash(color) { /* paste */ }

// Session Timer (paste your original startSession and tickSession)
function startSession(minutes, label, method) { /* paste your original */ }
function tickSession() { /* paste */ }

// Toast function
function toast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0A1628;color:white;padding:11px 18px;border-radius:12px;font-size:0.83rem;font-weight:500;z-index:99999;max-width:340px;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,0.3)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ PISO WIFI Frontend initialized');
  // You can add any additional init logic here
});