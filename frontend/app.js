// ============================================================
// CIT Piso WiFi — Frontend Logic
// Hardware: Orange Pi One + NAEK WifiSoft DIY Kit
//
// COIN SLOT:
//   Real coins → Orange Pi GPIO → gpio-reader.py → POST /api/coin
//   The portal shows the session counter after backend confirms.
//   Simulator buttons (dev) also call POST /api/coin directly.
//
// GCASH QR:
//   User scans QR → pays any amount → enters ref number →
//   Frontend POSTs to POST /api/gcash → backend grants via WifiSoft
//
// SESSION SYNC:
//   Every 5s the portal polls GET /api/session to stay in sync
//   with the backend — so if the page refreshes, the timer
//   picks up where it left off.
// ============================================================

const API = '/api';

// ── Rate map ──────────────────────────────────
const RATES = { 1: 10, 5: 120, 10: 300, 20: 720 };
const pesoToMins = p => RATES[p] ?? Math.floor(p * 10);
const fmtMins = m => {
  if (m < 60) return `${m} min${m !== 1 ? 's' : ''}`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h}h${r ? ' ' + r + 'min' : ''}`;
};

// ── State ─────────────────────────────────────
let freeTimer   = null;
let freeLeft    = 180;
let freeActive  = false;

let sessionTimer    = null;
let sessionSecs     = 0;
let sessionSyncTimer = null;

let gcashAmount  = 0;
let gcashMinutes = 0;
let gcashLabel   = '';

let coinTotal = 0;
let coinLog   = [];

// ── Navigation ─────────────────────────────────
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ══════════════════════════════════════════════
// FREE TIMER  (3 min GCash payment window)
// Persists across back-navigation — only resets
// on expiry or successful payment.
// ══════════════════════════════════════════════
function startFreeTimer() {
  if (freeActive) return;
  freeActive = true;
  freeLeft   = 180;
  _tickFree();
  freeTimer = setInterval(_tickFree, 1000);
}

function _tickFree() {
  freeLeft--;
  const str = `${Math.floor(freeLeft/60)}:${String(freeLeft%60).padStart(2,'0')}`;
  ['freeValGcash', 'overlayFreeVal'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = str;
    el.classList.toggle('urgent', freeLeft <= 30);
  });
  if (freeLeft <= 0) {
    _resetFreeTimer();
    _cancelGcashState();
    goTo('screen-home');
    toast('⏱ Payment window expired. Please try again.');
  }
}

function stopFreeTimer() {
  if (freeTimer) { clearInterval(freeTimer); freeTimer = null; }
  freeActive = false;
}

function _resetFreeTimer() {
  stopFreeTimer();
  freeLeft = 180;
  ['freeValGcash', 'overlayFreeVal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '3:00'; el.classList.remove('urgent'); }
  });
}

function _cancelGcashState() {
  gcashAmount = 0; gcashMinutes = 0; gcashLabel = '';
  document.querySelectorAll('.gcash-rate').forEach(c => c.classList.remove('selected'));
  const inp = document.getElementById('customAmountInput');
  if (inp) inp.value = '';
  const prev = document.getElementById('customAmountPreview');
  if (prev) prev.textContent = '';
  const btn = document.getElementById('openGcashBtn');
  if (btn) { btn.disabled = true; btn.textContent = '📱 Open GCash App to Pay'; }
  const refCard = document.getElementById('gcashStep3');
  if (refCard) refCard.style.display = 'none';
  const refInput = document.getElementById('refInput');
  if (refInput) refInput.value = '';
  _showGcashStep(1);
}

// Navigate home but keep timer running
function cancelGcash() {
  _cancelGcashState();
  goTo('screen-home');
}

// ══════════════════════════════════════════════
// GCASH QR FLOW
// ══════════════════════════════════════════════
function startGcash() {
  _cancelGcashState();
  goTo('screen-gcash');
  startFreeTimer();
}

function _showGcashStep(step) {
  document.getElementById('gcashStep1').style.display = 'block';
  document.getElementById('gcashStep2').style.display = step >= 2 ? 'block' : 'none';
  document.getElementById('gcashStep3').style.display = step >= 3 ? 'block' : 'none';
}

// Rate card selected
function selectGcashRate(card) {
  document.querySelectorAll('.gcash-rate').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  gcashAmount  = parseInt(card.dataset.pesos);
  gcashMinutes = parseInt(card.dataset.minutes);
  gcashLabel   = card.dataset.label;
  // Clear custom input
  const inp = document.getElementById('customAmountInput');
  if (inp) inp.value = '';
  document.getElementById('customAmountPreview').textContent = '';
  _updateOpenBtn();
}

// Custom amount typed
function onCustomAmount() {
  const val = Math.floor(parseFloat(document.getElementById('customAmountInput').value));
  const prev = document.getElementById('customAmountPreview');
  document.querySelectorAll('.gcash-rate').forEach(c => c.classList.remove('selected'));
  if (!val || val < 1) {
    gcashAmount = 0; gcashMinutes = 0; gcashLabel = '';
    prev.textContent = '';
    _updateOpenBtn();
    return;
  }
  gcashAmount  = val;
  gcashMinutes = pesoToMins(val);
  gcashLabel   = fmtMins(gcashMinutes);
  prev.textContent = `₱${val} = ${gcashLabel} of internet access`;
  _updateOpenBtn();
}

function _updateOpenBtn() {
  const btn = document.getElementById('openGcashBtn');
  btn.disabled = gcashAmount < 1;
  btn.textContent = gcashAmount >= 1
    ? `📱 Open GCash App — Pay ₱${gcashAmount}`
    : '📱 Open GCash App to Pay';
}

// "Open GCash App" button
function openGcashApp() {
  if (gcashAmount < 1) return;

  document.getElementById('qrAmountLabel').textContent  = `₱${gcashAmount}`;
  document.getElementById('amountToSend').textContent   = `₱${gcashAmount}`;
  document.getElementById('amountToSendTime').textContent = `${gcashLabel} of internet access`;

  _showGcashStep(2);
  document.getElementById('gcashStep2').scrollIntoView({ behavior: 'smooth' });

  // Deep link — opens GCash app on mobile, silently fails on desktop
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    // Hidden iframe keeps page open while attempting app launch
    const f = document.createElement('iframe');
    f.style.display = 'none';
    document.body.appendChild(f);
    f.src = 'gcash://send';
    setTimeout(() => f.remove(), 2000);
  } else {
    // Desktop: update button to inform user
    const btn = document.getElementById('deepLinkBtn');
    if (btn) {
      btn.style.opacity = '0.6';
      btn.innerHTML = '🖥️ Use your phone to scan the QR';
      btn.removeAttribute('href');
    }
    toast('📱 Use your phone to scan the QR code and pay.');
  }
}

// "I've Sent the Payment" button
function showRefInput() {
  _showGcashStep(3);
  document.getElementById('gcashStep3').scrollIntoView({ behavior: 'smooth' });
}

// Reference number input live validation
function onRefInput() {
  const val = document.getElementById('refInput').value.trim();
  document.getElementById('confirmPayBtn').disabled = val.length < 6;
  if (val.length >= 6) document.getElementById('refError').style.display = 'none';
}

// "Confirm & Connect" button
async function confirmGcashPayment() {
  const ref = document.getElementById('refInput').value.trim().toUpperCase();
  if (ref.length < 6) {
    document.getElementById('refError').style.display = 'block';
    return;
  }

  const btn = document.getElementById('confirmPayBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Connecting…';

  try {
    const res  = await fetch(`${API}/gcash`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount: gcashAmount, refNumber: ref })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Server error');

    _resetFreeTimer();
    _startSession(data.minutes, `₱${gcashAmount} — ${gcashLabel}`, `GCash QR · Ref: ${ref}`);
    _cancelGcashState();

  } catch (err) {
    console.warn('GCash API error — granting locally:', err.message);
    // Fallback: grant locally if backend unreachable
    _resetFreeTimer();
    _startSession(gcashMinutes, `₱${gcashAmount} — ${gcashLabel}`, `GCash QR · Ref: ${ref}`);
    _cancelGcashState();
    toast('⚠️ Granted locally. Contact operator if there are issues.');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Confirm & Connect';
  }
}

// ══════════════════════════════════════════════
// COIN SLOT
// Real coins: gpio-reader.py → POST /api/coin (auto)
// Simulator buttons: POST /api/coin (dev testing)
// ══════════════════════════════════════════════
const VALID = [1, 5, 10, 20];

function insertCoin(amount) {
  document.getElementById('invalidNotice').style.display = 'none';

  if (amount === 'invalid' || !VALID.includes(Number(amount))) {
    _coinAnim(true);
    _ledFlash('#F87171');
    _setScreen('INVALID', '#F87171');
    document.getElementById('invalidNotice').style.display = 'block';
    setTimeout(() => {
      _setScreen(coinTotal > 0 ? `₱${coinTotal}` : 'READY', '#4ADE80');
      document.getElementById('invalidNotice').style.display = 'none';
    }, 2400);
    return;
  }

  const n   = Number(amount);
  coinTotal += n;
  coinLog.push({ amount: n, time: new Date().toLocaleTimeString() });
  _coinAnim(false);
  _ledFlash('#FCD34D');
  _setScreen(`₱${coinTotal}`, '#4ADE80');
  _refreshCoinUI();
}

function _refreshCoinUI() {
  const mins = pesoToMins(coinTotal);
  document.getElementById('coinTotalVal').textContent = `₱${coinTotal}`;
  document.getElementById('coinPreview').innerHTML    = coinTotal > 0
    ? `You will get <b>${fmtMins(mins)}</b> of internet access`
    : 'Insert a coin to start';

  const wrap = document.getElementById('coinConnectWrap');
  if (coinTotal > 0) {
    wrap.style.display = 'block';
    document.getElementById('coinConnectLabel').textContent = fmtMins(mins);
  } else {
    wrap.style.display = 'none';
  }

  const logWrap = document.getElementById('coinLogWrap');
  const logEl   = document.getElementById('coinLog');
  if (!coinLog.length) { logWrap.style.display = 'none'; return; }
  logWrap.style.display = 'block';
  logEl.innerHTML = [...coinLog].reverse().map(e =>
    `<div class="cle"><span>₱${e.amount} coin inserted</span><span class="cle-t">${e.time}</span></div>`
  ).join('');
}

async function connectWithCoin() {
  if (coinTotal < 1) return;

  const btn = document.getElementById('coinConnectBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Connecting…';

  const total = coinTotal;
  const mins  = pesoToMins(total);
  const label = `₱${total} total — ${fmtMins(mins)}`;

  try {
    // POST to backend → Orange Pi → WifiSoft grants access
    const res  = await fetch(`${API}/coin`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount: total })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    _startSession(data.minutes, label, 'Coin Slot');

  } catch (err) {
    console.warn('Coin API error — granting locally:', err.message);
    _startSession(mins, label, 'Coin Slot (local)');
    toast('⚠️ Running in local mode. Check Orange Pi connection.');
  }

  resetCoin(true);
  btn.disabled = false;
  btn.textContent = `🚀 Connect Now · —`;
}

function resetCoin(silent = false) {
  coinTotal = 0;
  coinLog   = [];
  _refreshCoinUI();
  _setScreen('READY', '#4ADE80');
  document.getElementById('invalidNotice').style.display = 'none';
  if (!silent) goTo('screen-home');
}

function _coinAnim(invalid) {
  const m    = document.getElementById('coinMachine');
  const coin = document.createElement('div');
  coin.className = 'coin-anim';
  if (invalid) coin.style.background = 'linear-gradient(135deg,#94A3B8,#64748B)';
  m.appendChild(coin);
  setTimeout(() => coin.remove(), 950);
}

function _ledFlash(color) {
  const led = document.getElementById('machineLed');
  led.style.background = color;
  led.style.boxShadow  = `0 0 14px ${color}`;
  setTimeout(() => { led.style.background = ''; led.style.boxShadow = ''; }, 700);
}

function _setScreen(text, color) {
  const el = document.getElementById('machineScreen');
  el.textContent = text;
  el.style.color = color;
}

// ══════════════════════════════════════════════
// SESSION TIMER
// Stacks time on existing sessions.
// Polls backend every 5s to stay in sync with
// Orange Pi WifiSoft session state.
// ══════════════════════════════════════════════
function _startSession(minutes, label, method) {
  const isAddon = sessionTimer !== null;
  sessionSecs = isAddon ? sessionSecs + minutes * 60 : minutes * 60;

  document.getElementById('connDesc').textContent  =
    isAddon ? `Added ${fmtMins(minutes)}. Keep browsing!` : `Enjoy ${fmtMins(minutes)} of internet!`;
  document.getElementById('sessInfo1').textContent = `Plan: ${label}`;
  document.getElementById('sessInfo2').textContent = `Method: ${method}`;

  _tickSession();
  goTo('screen-connected');

  if (!isAddon) {
    sessionTimer = setInterval(() => {
      sessionSecs--;
      _tickSession();
      if (sessionSecs <= 0) {
        clearInterval(sessionTimer);
        sessionTimer = null;
        if (sessionSyncTimer) { clearInterval(sessionSyncTimer); sessionSyncTimer = null; }
        goTo('screen-home');
        toast('⏱ Session ended. Thank you for using CIT Piso WiFi!');
      }
    }, 1000);

    // Sync with backend every 5s (keeps timer accurate after refresh)
    if (sessionSyncTimer) clearInterval(sessionSyncTimer);
    sessionSyncTimer = setInterval(_syncSession, 5000);
  }
}

function _tickSession() {
  const h = Math.floor(sessionSecs / 3600);
  const m = Math.floor((sessionSecs % 3600) / 60);
  const s = sessionSecs % 60;
  document.getElementById('timerDisplay').textContent = h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

async function _syncSession() {
  try {
    const res  = await fetch(`${API}/session`);
    const data = await res.json();
    if (data.active && data.remainingSecs > 0) {
      // Correct local timer to match backend
      sessionSecs = data.remainingSecs;
    }
  } catch (_) { /* network hiccup — keep local timer */ }
}

// ── Restricted overlay ─────────────────────────
function closeRestricted() {
  document.getElementById('restrictedOverlay').classList.remove('show');
}

// ── Toast ──────────────────────────────────────
function toast(msg) {
  const t = document.createElement('div');
  t.style.cssText = [
    'position:fixed','bottom:20px','left:50%',
    'transform:translateX(-50%)','background:#0A1628',
    'color:white','padding:11px 18px','border-radius:12px',
    'font-size:0.83rem','font-weight:500','z-index:99999',
    'max-width:340px','text-align:center',
    'box-shadow:0 6px 20px rgba(0,0,0,0.3)'
  ].join(';');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ══════════════════════════════════════════════
// SESSION RESTORE ON PAGE LOAD
// If Orange Pi has an active session for this
// device, restore the timer automatically.
// ══════════════════════════════════════════════
async function restoreSession() {
  try {
    const res  = await fetch(`${API}/session`);
    const data = await res.json();
    if (data.active && data.remainingSecs > 0) {
      console.log(`🔄 Restoring session: ${data.remainingSecs}s remaining`);
      sessionSecs = data.remainingSecs;
      document.getElementById('connDesc').textContent  = 'Session restored — keep browsing!';
      document.getElementById('sessInfo1').textContent = `Plan: ${data.pesos ? `₱${data.pesos}` : '—'}`;
      document.getElementById('sessInfo2').textContent = `Method: ${data.method || '—'}`;
      _tickSession();
      goTo('screen-connected');
      sessionTimer = setInterval(() => {
        sessionSecs--;
        _tickSession();
        if (sessionSecs <= 0) {
          clearInterval(sessionTimer); sessionTimer = null;
          if (sessionSyncTimer) { clearInterval(sessionSyncTimer); sessionSyncTimer = null; }
          goTo('screen-home');
          toast('⏱ Session ended. Thank you for using CIT Piso WiFi!');
        }
      }, 1000);
      sessionSyncTimer = setInterval(_syncSession, 5000);
    }
  } catch (_) {
    // Backend unreachable — show home screen normally
  }
}

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ CIT Piso WiFi initialized');

  // Try to restore an existing session on load
  restoreSession();

  // Home buttons
  document.getElementById('gcashBtn')
    ?.addEventListener('click', startGcash);
  document.getElementById('coinBtn')
    ?.addEventListener('click', () => goTo('screen-coin'));

  // GCash back button — keeps free timer running
  document.getElementById('gcashBackBtn')
    ?.addEventListener('click', cancelGcash);

  // GCash rate cards
  document.querySelectorAll('.gcash-rate').forEach(card => {
    card.addEventListener('click', () => selectGcashRate(card));
  });

  // Custom amount input
  document.getElementById('customAmountInput')
    ?.addEventListener('input', onCustomAmount);

  // Open GCash App button
  document.getElementById('openGcashBtn')
    ?.addEventListener('click', openGcashApp);

  // I've Sent button
  document.getElementById('showRefInputBtn')
    ?.addEventListener('click', showRefInput);

  // Ref number input
  document.getElementById('refInput')
    ?.addEventListener('input', onRefInput);

  // Confirm & Connect
  document.getElementById('confirmPayBtn')
    ?.addEventListener('click', confirmGcashPayment);

  // Restricted overlay close
  document.getElementById('backToPaymentBtn')
    ?.addEventListener('click', closeRestricted);
});