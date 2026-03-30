const express = require('express');
const fetch   = require('node-fetch');
const router  = express.Router();

const PM_BASE = 'https://api.paymongo.com/v1';

// Read key at request time (not module load time) so dotenv.config() runs first
function getSecret() {
  return process.env.PAYMONGO_SECRET_KEY;
}

function getHeaders() {
  return {
    'Content-Type':  'application/json',
    'Authorization': 'Basic ' + Buffer.from(getSecret() + ':').toString('base64')
  };
}

function validateKey(res) {
  const secret = getSecret();
  if (!secret) {
    res.status(500).json({ success: false, message: 'PAYMONGO_SECRET_KEY is not set in .env' });
    return false;
  }
  if (!secret.startsWith('sk_test_') && !secret.startsWith('sk_live_')) {
    res.status(500).json({ success: false, message: 'PAYMONGO_SECRET_KEY must start with sk_test_ or sk_live_' });
    return false;
  }
  return true;
}

// ─── POST /api/payment-links ──────────────────────────
//
// WHY checkout_sessions instead of /v1/links:
//   /v1/links enforces a minimum of Php 100.00 on ALL environments.
//   /v1/checkout_sessions has no Php 100 floor in test mode,
//   supports GCash, and also returns a checkout_url — same interface.
//
router.post('/payment-links', async (req, res) => {
  if (!validateKey(res)) return;

  const { amount, description, remarks } = req.body;

  if (!amount || Number(amount) < 1) {
    return res.status(400).json({ success: false, message: 'Amount must be at least 1' });
  }

  const amountInCentavos = Math.round(Number(amount) * 100); // e.g. 5 pesos = 500 centavos

  const host       = req.get('host');
  const protocol   = req.headers['x-forwarded-proto'] || req.protocol;
  const successUrl = `${protocol}://${host}/?payment=success`;
  const cancelUrl  = `${protocol}://${host}/?payment=cancelled`;

  try {
    const response = await fetch(`${PM_BASE}/checkout_sessions`, {
      method:  'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        data: {
          attributes: {
            description:          description || 'CIT Piso WiFi Access',
            payment_method_types: ['gcash', 'card'],
            success_url:          successUrl,
            cancel_url:           cancelUrl,
            line_items: [
              {
                currency:    'PHP',
                amount:      amountInCentavos,
                name:        description || 'CIT Piso WiFi Access',
                quantity:    1,
                description: remarks || 'cit-pisowifi'
              }
            ],
            billing: {
              name:  'WiFi User',
              email: 'user@cit-pisowifi.local',
              phone: '09000000000'
            }
          }
        }
      })
    });

    const json = await response.json();

    if (!response.ok) {
      const errDetail = json.errors?.[0]?.detail || JSON.stringify(json);
      throw new Error(errDetail);
    }

    res.json({
      success:     true,
      linkId:      json.data.id,
      checkoutUrl: json.data.attributes.checkout_url
    });

  } catch (err) {
    console.error('PayMongo Error (create checkout session):', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/payment-links/:linkId ──────────────────
// Poll checkout session status.
// PayMongo session statuses: active | expired | completed
// payment_intent status:     awaiting_payment_method | succeeded
// We return 'paid' when either = completed/succeeded.
router.get('/payment-links/:linkId', async (req, res) => {
  if (!validateKey(res)) return;

  const { linkId } = req.params;

  try {
    const response = await fetch(`${PM_BASE}/checkout_sessions/${linkId}`, {
      headers: getHeaders()
    });

    const json = await response.json();

    if (!response.ok) {
      const errDetail = json.errors?.[0]?.detail || JSON.stringify(json);
      throw new Error(errDetail);
    }

    const sessionStatus = json.data?.attributes?.status;
    const intentStatus  = json.data?.attributes?.payment_intent?.attributes?.status;
    const isPaid        = sessionStatus === 'completed' || intentStatus === 'succeeded';

    res.json({
      success:     true,
      status:      isPaid ? 'paid' : (sessionStatus || 'unknown'),
      amount:      json.data?.attributes?.line_items?.[0]?.amount,
      description: json.data?.attributes?.description
    });

  } catch (err) {
    console.error('PayMongo Error (check session):', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;