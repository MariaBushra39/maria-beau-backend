const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Root route
app.get('/', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Maria B. Collection API is LIVE!',
    endpoints: {
      products: '/api/products',
      auth: '/api/auth',
      orders: '/api/orders',
      test: '/api/test'
    }
  });
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Server is working perfectly!' });
});

// Try loading product routes (with fallback)
try {
  const productRoutes = require('../src/routes/productRoutes');
  app.use('/api/products', productRoutes);
  console.log('✅ Products routes loaded');
} catch (err) {
  console.log('⚠️ Products routes not found, using fallback');
  app.get('/api/products', (req, res) => {
    res.json({ success: true, message: 'Products route is coming soon!' });
  });
}

// Try loading auth routes (with fallback)
try {
  const authRoutes = require('../src/routes/AuthRoutes');
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes loaded');
} catch (err) {
  console.log('⚠️ Auth routes not found, using fallback');
  app.get('/api/auth', (req, res) => {
    res.json({ success: true, message: 'Auth route is coming soon!' });
  });
}

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    available: ['/api/test', '/api/products', '/api/auth', '/api/orders']
  });
});

module.exports = app;