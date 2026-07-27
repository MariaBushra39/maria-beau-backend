const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path'); // ✅ path import (uploads ke liye)

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Serve static files (uploads folder) — Vercel par bhi kaam karega
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
// 🆕 ORDER ROUTES
// ============================================
const orderRoutes = require('./src/routes/orderRoutes');
app.use('/api/orders', orderRoutes);

// ============================================
// ✅ VERCEL EXPORT (Aur local test ke liye listen)
// ============================================
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;   // ✅ Vercel ke liye zaroori