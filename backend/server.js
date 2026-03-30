// ============================================================
// CIT Piso WiFi — Backend Server
// Hardware: Orange Pi One + NAEK WifiSoft DIY Kit
// ============================================================
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Serve frontend files
app.use(express.static('../frontend'));

// Routes
app.use('/api', require('./routes/coin'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status:   'online',
    hardware: 'Orange Pi One · NAEK WifiSoft',
    time:     new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 CIT Piso WiFi  →  http://localhost:${PORT}`);
  console.log(`🔧 WifiSoft admin →  http://${process.env.WIFISOFT_HOST || '10.0.0.1'}/admin`);
  console.log(`🪙 Coin endpoint  →  POST /api/coin`);
  console.log(`💚 GCash endpoint →  POST /api/gcash`);
});