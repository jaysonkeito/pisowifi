const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const paymentRoutes = require('./routes/payment');

// Load .env file FIRST - before anything else
dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static('../frontend'));

// API Routes
app.use('/api', paymentRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'online', 
    message: 'PISO WIFI Backend is running',
    time: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 PISO WIFI Backend running on http://localhost:${PORT}`);
  console.log(`🌐 Frontend available at http://localhost:${PORT}`);

  if (process.env.PAYMONGO_SECRET_KEY) {
    console.log('✅ PayMongo Secret Key loaded successfully');
  } else {
    console.error('❌ PAYMONGO_SECRET_KEY is missing after loading .env');
  }
});