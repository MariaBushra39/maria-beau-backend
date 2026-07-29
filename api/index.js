const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// DATABASE CONNECTION
// ============================================
let db;
const connectDB = async () => {
  if (!db) {
    const connectionConfig = process.env.DATABASE_URL
      ? { uri: process.env.DATABASE_URL }
      : {
          host: process.env.DB_HOST || 'localhost',
          user: process.env.DB_USER || 'root',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'maria_b_db'
        };
    db = await mysql.createConnection(connectionConfig);
    console.log('✅ Database connected');
  }
  return db;
};

// ============================================
// ROOT ROUTE
// ============================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Maria B. API is LIVE on Vercel!',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// TEST ROUTE
// ============================================
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Server is working perfectly!' });
});

// ============================================
// PRODUCTS ROUTE
// ============================================
app.get('/api/products', async (req, res) => {
  try {
    const connection = await connectDB();
    const [rows] = await connection.query('SELECT * FROM products ORDER BY created_at DESC');
    
    const products = rows.map(p => ({
      ...p,
      images: p.images ? (() => {
        try {
          const parsed = JSON.parse(p.images);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          return [p.images];
        }
      })() : []
    }));

    res.json({ success: true, data: products });
  } catch (error) {
    console.error('❌ Products error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching products', error: error.message });
  }
});

// ============================================
// SINGLE PRODUCT ROUTE
// ============================================
app.get('/api/products/:id', async (req, res) => {
  try {
    const connection = await connectDB();
    const [rows] = await connection.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    const product = {
      ...rows[0],
      images: rows[0].images ? (() => {
        try {
          const parsed = JSON.parse(rows[0].images);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          return [rows[0].images];
        }
      })() : []
    };
    
    res.json({ success: true, data: product });
  } catch (error) {
    console.error('❌ Product error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching product' });
  }
});

// ============================================
// AUTH ROUTES (Import from external file)
// ============================================
try {
  const authRoutes = require('../src/routes/AuthRoutes');
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes loaded');
} catch (error) {
  console.error('❌ Auth routes not found:', error.message);
  app.use('/api/auth', (req, res) => {
    res.status(404).json({ error: 'Auth routes not available' });
  });
}

// ============================================
// ORDER ROUTES (Import from external file)
// ============================================
try {
  const orderRoutes = require('../src/routes/orderRoutes');
  app.use('/api/orders', orderRoutes);
  console.log('✅ Order routes loaded');
} catch (error) {
  console.error('❌ Order routes not found:', error.message);
  app.use('/api/orders', (req, res) => {
    res.status(404).json({ error: 'Order routes not available' });
  });
}

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;