const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ============================================
// ROOT ROUTE
// ============================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Maria B. Collection API is LIVE on Vercel!',
    endpoints: {
      test: '/api/test',
      products: '/api/products',
      auth: '/api/auth',
      orders: '/api/orders'
    }
  });
});

// ============================================
// TEST ROUTE
// ============================================
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Server is working perfectly!' });
});

// ============================================
// 🚀 PRODUCTS ROUTE (Inline — no external file)
// ============================================
app.get('/api/products', (req, res) => {
  res.json({
    success: true,
    message: 'Products route is working!',
    data: []
  });
});

// ============================================
// 🚀 AUTH ROUTE (Inline)
// ============================================
app.get('/api/auth', (req, res) => {
  res.json({ success: true, message: 'Auth route is working!' });
});

// ============================================
// 🚀 ORDERS ROUTE (Inline)
// ============================================
app.get('/api/orders', (req, res) => {
  res.json({ success: true, message: 'Orders route is working!' });
});

// ============================================
// 404 Handler (for any other route)
// ============================================
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    availableEndpoints: ['/', '/api/test', '/api/products', '/api/auth', '/api/orders']
  });
});

module.exports = app;