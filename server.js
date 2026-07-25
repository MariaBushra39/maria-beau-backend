const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Serve static files (uploads folder)
app.use('/uploads', express.static('uploads'));

// Test Route
app.get('/', (req, res) => {
    res.send('Welcome to Maria B. Collection API!');
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
// 🆕 ORDER ROUTES (Naya)
// ============================================
const orderRoutes = require('./src/routes/orderRoutes');
app.use('/api/orders', orderRoutes);

// ============================================
// SERVER START
// ============================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});