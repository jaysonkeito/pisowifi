// ============================================================
// routes/session.js — Session management
// ============================================================
const express  = require('express');
const router   = express.Router();

// Reference to shared session store from coin.js
// (In production use Redis or SQLite)
let sessionStore = null;

function getStore() {
  if (!sessionStore) {
    sessionStore = require('./coin').sessions;
  }
  return sessionStore;
}

// ── DELETE /api/session/:ip ───────────────────────────────────
// Manually expire a session (admin use)
// ─────────────────────────────────────────────────────────────
router.delete('/session/:ip', (req, res) => {
  const sessions = getStore();
  const ip = req.params.ip;

  if (sessions[ip]) {
    delete sessions[ip];
    console.log(`🗑️  Session manually ended for ${ip}`);
    res.json({ success: true, message: `Session for ${ip} ended` });
  } else {
    res.status(404).json({ success: false, message: 'No active session for this IP' });
  }
});

module.exports = router;