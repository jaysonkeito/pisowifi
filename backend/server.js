const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const paymentRoutes = require('./routes/payment');

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Serve the frontend statically
app.use(express.static('../frontend'));

// API Routes
app.use('/api', paymentRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'online', 
    message: 'CIT Piso WiFi Backend is running',
    time: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 PISO WIFI Backend running on http://localhost:${PORT}`);
  console.log(`🌐 Frontend available at http://localhost:${PORT}`);
});