// console.log('🚀 FRESH DEPLOYMENT - CACHE BYPASS ' + Date.now());
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// DATABASE CONNECTION (FIXED SSL)
// ============================================
let db;
const connectDB = async () => {
  if (!db) {
    let connectionConfig;
    if (process.env.DATABASE_URL) {
      let url = process.env.DATABASE_URL;
      const urlObj = new URL(url);
      urlObj.search = '';
      const cleanUri = urlObj.toString();
      connectionConfig = {
        uri: cleanUri,
        ssl: { rejectUnauthorized: false }
      };
    } else {
      connectionConfig = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'maria_b_db'
      };
    }
    db = await mysql.createConnection(connectionConfig);
    console.log('✅ Database connected');
  }
  return db;
};

// ============================================
// EMAIL TRANSPORTER
// ============================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

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
// 🔐 AUTH ROUTES (INLINE)
// ============================================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const connection = await connectDB();

    const [existing] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await connection.query(
      'INSERT INTO users (id, name, email, password) VALUES (UUID(), ?, ?, ?)',
      [name, email, hashedPassword]
    );

    const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: { name, email }
    });
  } catch (error) {
    console.error('❌ Register error:', error.message);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const connection = await connectDB();

    const [users] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('❌ Login error:', error.message);
    console.error('❌ Stack trace:', error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message,
      stack: error.stack 
    });
  }
});

// FORGOT PASSWORD
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const connection = await connectDB();

    const [users] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const resetLink = `https://maria-beau-frontend-lake.vercel.app/reset-password/${token}`;

    await connection.query(
      'UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE email = ?',
      [token, Date.now() + 3600000, email]
    );

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Reset Password - MariaBeau',
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password. This link expires in 1 hour.</p>`
    });

    res.json({ success: true, message: 'Reset link sent to your email' });
  } catch (error) {
    console.error('❌ Forgot password error:', error.message);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// RESET PASSWORD
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const connection = await connectDB();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [users] = await connection.query(
      'SELECT * FROM users WHERE email = ? AND reset_password_token = ? AND reset_password_expires > ?',
      [decoded.email, token, Date.now()]
    );

    if (users.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await connection.query(
      'UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE email = ?',
      [hashedPassword, decoded.email]
    );

    res.json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    console.error('❌ Reset password error:', error.message);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// ============================================
// 📦 ORDER ROUTE
// ============================================

app.post('/api/orders', async (req, res) => {
  try {
    const { totalPrice, shippingAddress, paymentMethod, items } = req.body;
    const connection = await connectDB();

    const token = req.headers.authorization?.split(' ')[1];
    let userId = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
      } catch (e) {}
    }

    const [orderResult] = await connection.query(
      'INSERT INTO orders (id, user_id, total_price, status, shipping_address, payment_method) VALUES (UUID(), ?, ?, ?, ?, ?)',
      [userId, totalPrice, 'pending', JSON.stringify(shippingAddress), paymentMethod]
    );

    const [orderRows] = await connection.query('SELECT id FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId || 1]);
    const orderId = orderRows[0]?.id;

    for (const item of items) {
      await connection.query(
        'INSERT INTO order_items (id, order_id, product_id, quantity, price) VALUES (UUID(), ?, ?, ?, ?)',
        [orderId, item.product_id, item.quantity, item.price]
      );
    }

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: shippingAddress.email || 'mariabushra392@gmail.com',
        subject: 'Order Confirmation - MariaBeau',
        html: `<p>Thank you for your order!</p><p>Order ID: ${orderId}</p><p>Total: Rs. ${totalPrice}</p>`
      });
    } catch (emailError) {
      console.error('⚠️ Email send failed:', emailError.message);
    }

    res.json({ success: true, data: { orderId } });
  } catch (error) {
    console.error('❌ Order error:', error.message);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// ============================================
// PRODUCTS ROUTES
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
// 404 HANDLER
// ============================================
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;