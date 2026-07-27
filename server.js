const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs'); // File system check ke liye

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Uploads folder ko SAFE tareeqay se serve karo (agar exist kare)
const uploadsPath = path.join(__dirname, 'uploads');
if (fs.existsSync(uploadsPath)) {
  app.use('/uploads', express.static(uploadsPath));
} else {
  console.log('⚠️ Uploads folder not found, skipping static serve.');
}

// ============================================
// TEST ROUTE (Check ke server chal raha hai)
// ============================================
app.get('/', (req, res) => {
  res.send('✅ Welcome to Maria B. Collection API! (Vercel Live)');
});

// ============================================
// AUTH ROUTES
// ============================================
const authRoutes = require('./src/routes/AuthRoutes');
app.use('/api/auth', authRoutes);

// ============================================
// PRODUCT ROUTES
// ============================================
const productRoutes = require('./src/routes/productRoutes');
app.use('/api/products', productRoutes);

// ============================================
// ORDER ROUTES
// ============================================
const orderRoutes = require('./src/routes/orderRoutes');
app.use('/api/orders', orderRoutes);

// ============================================
// ✅ VERCEL EXPORT (Yeh line sab se zaroori hai)
// ============================================
module.exports = app;