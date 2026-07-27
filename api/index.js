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
    message: 'Maria B. Collection API is LIVE!',
    endpoints: ['/api/test', '/api/products', '/api/auth', '/api/orders']
  });
});

// ============================================
// TEST ROUTE
// ============================================
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Server is working perfectly!' });
});

// ============================================
// PRODUCTS ROUTE (with DB connection test)
// ============================================
app.get('/api/products', (req, res) => {
  // Check if DATABASE_URL exists
  if (!process.env.DATABASE_URL) {
    return res.json({
      success: false,
      message: 'DATABASE_URL not set in environment variables',
      data: []
    });
  }
  
  res.json({
    success: true,
    message: 'Products route is working! Database URL is set.',
    data: []
  });
});

// ============================================
// AUTH ROUTE
// ============================================
app.get('/api/auth', (req, res) => {
  res.json({ success: true, message: 'Auth route is working!' });
});

// ============================================
// ORDERS ROUTE
// ============================================
app.get('/api/orders', (req, res) => {
  res.json({ success: true, message: 'Orders route is working!' });
});

// ============================================
// 404 HANDLER
// ============================================
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    available: ['/', '/api/test', '/api/products', '/api/auth', '/api/orders']
  });
});

module.exports = app;