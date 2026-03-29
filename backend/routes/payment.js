const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const PM_BASE = 'https://api.paymongo.com/v1';
const SECRET = process.env.PAYMONGO_SECRET_KEY;

// Only show warning if truly missing (after server fully starts)
if (!SECRET) {
  console.warn('⚠️ PAYMONGO_SECRET_KEY is missing');
} else if (!SECRET.startsWith('sk_test_') && !SECRET.startsWith('sk_live_')) {
  console.warn('⚠️ PAYMONGO_SECRET_KEY format looks incorrect');
} else {
  console.log('✅ PayMongo Secret Key is ready for use');
}

const headers = {
  'Content-Type': 'application/json',
  'Authorization': 'Basic ' + Buffer.from(SECRET + ':').toString('base64')
};

// Create Payment Link
router.post('/payment-links', async (req, res) => {
  const { amount, description, remarks } = req.body;

  if (!amount || amount < 1) {
    return res.status(400).json({ success: false, message: 'Amount must be at least ₱1' });
  }

  try {
    const response = await fetch(`${PM_BASE}/links`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: {
          attributes: {
            amount: Math.round(amount * 100), // in centavos
            description: description || 'CIT Piso WiFi Access',
            remarks: remarks || 'cit-pisowifi'
          }
        }
      })
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json.errors?.[0]?.detail || 'Failed to create payment link');
    }

    res.json({
      success: true,
      linkId: json.data.id,
      checkoutUrl: json.data.attributes.checkout_url
    });
  } catch (err) {
    console.error('PayMongo Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Check Payment Link Status
router.get('/payment-links/:linkId', async (req, res) => {
  const { linkId } = req.params;

  try {
    const response = await fetch(`${PM_BASE}/links/${linkId}`, { headers });
    const json = await response.json();

    res.json({
      success: true,
      status: json.data?.attributes?.status || 'unknown'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;