// ============================================================
// routes/coin.js — All payment + session API routes
//
// COIN SLOT FLOW (Orange Pi One / NAEK WifiSoft):
//
//   1. User drops coin into universal coin acceptor
//   2. Acceptor sends PULSES to NAEK board GPIO pin (S1 = PA7)
//      ₱1=1 pulse  ₱5=5 pulses  ₱10=10 pulses  ₱20=20 pulses
//   3. gpio-reader.py (runs on Orange Pi) reads pulses → POSTs here
//   4. This route records the session + calls WifiSoft to grant access
//   5. WifiSoft opens internet for the user's MAC/IP
//
// GCASH QR FLOW:
//   1. User scans QR, pays any amount, gets reference number
//   2. User enters ref number in portal
//   3. Frontend POSTs to /api/gcash
//   4. This route records session + calls WifiSoft to grant access
// ============================================================

const express = require('express');
const router  = express.Router();
const fetch   = require('node-fetch');

// Coin rate: pesos → minutes
const RATES = { 1: 10, 5: 120, 10: 300, 20: 720 };
const pesoToMins = p => RATES[p] ?? Math.floor(p * 10);

// WifiSoft config from .env
const WS_HOST = () => process.env.WIFISOFT_HOST || '10.0.0.1';
const WS_USER = () => process.env.WIFISOFT_USER || 'admin';
const WS_PASS = () => process.env.WIFISOFT_PASS || 'admin';

// In-memory sessions  { ip: { pesos, minutes, method, ref, expiresAt } }
const sessions = {};

// ── Helper: clean expired sessions ───────────────────────────
function cleanSessions() {
  const now = Date.now();
  for (const ip of Object.keys(sessions)) {
    if (sessions[ip].expiresAt <= now) delete sessions[ip];
  }
}

// ── Helper: add/extend a session ─────────────────────────────
function addSession(ip, pesos, minutes, method, ref = null) {
  cleanSessions();
  const now = Date.now();
  if (sessions[ip]) {
    sessions[ip].minutes   += minutes;
    sessions[ip].pesos     += pesos;
    sessions[ip].expiresAt += minutes * 60 * 1000;
    if (ref) sessions[ip].ref = ref;
  } else {
    sessions[ip] = {
      pesos, minutes, method, ref,
      startedAt: new Date().toISOString(),
      expiresAt: now + minutes * 60 * 1000
    };
  }
  return sessions[ip];
}

// ── Helper: grant internet via WifiSoft API ───────────────────
// WifiSoft runs at 10.0.0.1 and exposes a vendo load endpoint.
// This is the same action as WifiSoft receiving a coin pulse
// directly — we just trigger it programmatically over HTTP.
async function grantWifiSoft(clientIp, minutes, pesos) {
  try {
    const url  = `http://${WS_HOST()}/vendo/load`;
    const body = new URLSearchParams({
      username: WS_USER(),
      password: WS_PASS(),
      ip:       clientIp,
      minutes:  String(minutes),
      amount:   String(pesos)
    });
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
      timeout: 3000
    });
    const text = await res.text();
    console.log(`📡 WifiSoft ${res.status}: ${text.slice(0, 80)}`);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    // WifiSoft unreachable in dev — not fatal
    console.warn(`⚠️  WifiSoft unreachable: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ════════════════════════════════════════════════════════════
// POST /api/coin
// Called by gpio-reader.py on the Orange Pi when a real coin
// is inserted, AND by the frontend simulator buttons.
//
// Body: { amount: 5 }
// ════════════════════════════════════════════════════════════
router.post('/coin', async (req, res) => {
  const pesos = Number(req.body.amount);
  if (!pesos || pesos < 1) {
    return res.status(400).json({ success: false, message: 'Invalid coin amount' });
  }

  const minutes   = pesoToMins(pesos);
  const clientIp  = req.body.clientIp || req.ip;
  const session   = addSession(clientIp, pesos, minutes, 'Coin Slot');
  const wifisoft  = await grantWifiSoft(clientIp, minutes, pesos);

  console.log(`🪙  ₱${pesos} coin → ${minutes} min → ${clientIp}`);

  res.json({
    success: true,
    amount:  pesos,
    minutes,
    message: `₱${pesos} accepted — ${minutes} minutes granted`,
    session,
    wifisoft
  });
});

// ════════════════════════════════════════════════════════════
// POST /api/gcash
// Called by the frontend after user enters GCash ref number.
//
// Body: { amount: 10, refNumber: "GC2024XXXXXXX" }
// ════════════════════════════════════════════════════════════
router.post('/gcash', async (req, res) => {
  const pesos     = Number(req.body.amount);
  const refNumber = String(req.body.refNumber || '').trim().toUpperCase();

  if (!pesos || pesos < 1) {
    return res.status(400).json({ success: false, message: 'Invalid amount' });
  }
  if (refNumber.length < 6) {
    return res.status(400).json({ success: false, message: 'Invalid reference number' });
  }

  const minutes  = pesoToMins(pesos);
  const clientIp = req.body.clientIp || req.ip;
  const session  = addSession(clientIp, pesos, minutes, 'GCash QR', refNumber);
  const wifisoft = await grantWifiSoft(clientIp, minutes, pesos);

  console.log(`💚  GCash ₱${pesos} ref:${refNumber} → ${minutes} min → ${clientIp}`);

  res.json({
    success: true,
    amount:  pesos,
    minutes,
    refNumber,
    message: `GCash ₱${pesos} confirmed — ${minutes} minutes granted`,
    session,
    wifisoft
  });
});

// ════════════════════════════════════════════════════════════
// GET /api/session
// Frontend polls this every 5s to sync remaining time.
// Keeps the portal timer accurate even after page refresh.
// ════════════════════════════════════════════════════════════
router.get('/session', (req, res) => {
  cleanSessions();
  const ip      = req.query.ip || req.ip;
  const session = sessions[ip];

  if (!session) return res.json({ active: false });

  const remainingSecs = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  if (remainingSecs === 0) {
    delete sessions[ip];
    return res.json({ active: false });
  }

  res.json({ active: true, remainingSecs, ...session });
});

// ════════════════════════════════════════════════════════════
// GET /api/sessions  (admin — view all active sessions)
// ════════════════════════════════════════════════════════════
router.get('/sessions', (req, res) => {
  cleanSessions();
  const now    = Date.now();
  const active = {};
  for (const [ip, s] of Object.entries(sessions)) {
    active[ip] = { ...s, remainingSecs: Math.floor((s.expiresAt - now) / 1000) };
  }
  res.json({ count: Object.keys(active).length, sessions: active });
});

module.exports = router;