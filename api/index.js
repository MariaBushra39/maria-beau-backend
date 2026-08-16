// console.log('🚀 FRESH DEPLOYMENT - CACHE BYPASS ' + Date.now());
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');
const rateLimit = require('express-rate-limit'); // ✅ NEW

dotenv.config();

const app = express();
app.set('trust proxy', 1); // ✅ NEW: required for rate limiting to work correctly on Vercel
app.use(cors());
app.use(express.json());

// ============================================
// ✅ NEW: RATE LIMITERS
// Protects against brute-force login attempts and order/checkout spam.
// ============================================

// Login/Register/Forgot-Password — max 8 attempts per IP every 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Order placement (guest + logged-in) — max 10 orders per IP every 30 minutes
const orderLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many orders placed from this device. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================
// ✅ CLOUDINARY — ENVIRONMENT VARIABLES (SECURE)
// ============================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer - keep file in memory, then stream to Cloudinary
const upload = multer({ storage: multer.memoryStorage() });

// ============================================
// DATABASE CONNECTION — ✅ FIXED: now a pool instead of a single shared connection
// A single shared connection was unsafe on Vercel serverless, since concurrent
// requests on the same warm instance could interleave transactions on it.
// A pool gives each request/transaction its own dedicated connection.
// ============================================
let pool;
const getPool = () => {
  if (pool) return pool;

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

  pool = mysql.createPool({
    ...connectionConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  console.log('✅ Database pool created');
  return pool;
};

// Drop-in replacement for the old connectDB() — returns the pool.
// pool.query(...) works exactly like connection.query(...) for simple queries
// (it borrows and returns a connection automatically).
// For multi-step transactions, use getPool().getConnection() instead (see /api/orders).
const connectDB = async () => {
  return getPool();
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
// ADMIN AUTH HELPERS
// ============================================
const requireAdmin = async (req) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    const err = new Error('No token provided');
    err.status = 401;
    throw err;
  }
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const connection = await connectDB();
  const [users] = await connection.query('SELECT id, role FROM users WHERE id = ?', [decoded.id]);
  if (users.length === 0) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (users[0].role !== 'admin') {
    const err = new Error('Admin access required');
    err.status = 403;
    throw err;
  }
  return users[0];
};

const requireUser = async (req) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    const err = new Error('Please log in to write a review');
    err.status = 401;
    throw err;
  }
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const connection = await connectDB();
  const [users] = await connection.query('SELECT id, name, email FROM users WHERE id = ?', [decoded.id]);
  if (users.length === 0) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return users[0];
};

// ============================================
// ROOT AND TEST ROUTES
// ============================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Maria B. API is LIVE on Vercel!',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Server is working perfectly!' });
});

app.get('/api/db-test', async (req, res) => {
  try {
    const connection = await connectDB();
    const [rows] = await connection.query('SELECT 1 as test');
    res.json({ success: true, message: 'Database connected!', data: rows });
  } catch (error) {
    console.error('❌ DB Test error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ✅ CHANGED: COUPON VALIDATION ROUTE — now checks the database
// (active coupons that haven't expired) instead of a hardcoded list.
// ============================================
app.post('/api/coupons/validate', async (req, res) => {
  try {
    const { code } = req.body;
    const key = (code || '').trim().toUpperCase();
    if (!key) {
      return res.status(400).json({ success: false, message: 'Please enter a coupon code' });
    }
    const connection = await connectDB();
    const [rows] = await connection.query(
      `SELECT type, value FROM coupons
       WHERE code = ? AND active = 1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [key]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invalid or expired coupon code' });
    }
    res.json({ success: true, data: rows[0] }); // { type: 'percent'|'flat', value }
  } catch (error) {
    console.error('❌ Coupon validate error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================================
// ✅ NEW: COUPON MANAGEMENT (ADMIN)
// ============================================

// List all coupons (active + inactive) for the admin panel
app.get('/api/coupons/admin/all', async (req, res) => {
  try {
    await requireAdmin(req);
    const connection = await connectDB();
    const [rows] = await connection.query('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('❌ Get coupons error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// Create a new coupon
app.post('/api/coupons', async (req, res) => {
  try {
    await requireAdmin(req);
    const { code, type, value, expires_at } = req.body;
    const cleanCode = (code || '').trim().toUpperCase();

    if (!cleanCode || !['percent', 'flat'].includes(type) || !value || Number(value) <= 0) {
      return res.status(400).json({ success: false, message: 'Please provide a valid code, type, and value.' });
    }
    if (type === 'percent' && Number(value) > 100) {
      return res.status(400).json({ success: false, message: 'Percentage discount cannot exceed 100.' });
    }

    const connection = await connectDB();
    const [existing] = await connection.query('SELECT id FROM coupons WHERE code = ?', [cleanCode]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'A coupon with this code already exists.' });
    }

    await connection.query(
      'INSERT INTO coupons (id, code, type, value, expires_at) VALUES (UUID(), ?, ?, ?, ?)',
      [cleanCode, type, value, expires_at || null]
    );
    res.json({ success: true, message: 'Coupon created successfully' });
  } catch (error) {
    console.error('❌ Create coupon error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// Toggle a coupon active/inactive
app.put('/api/coupons/:id/toggle', async (req, res) => {
  try {
    await requireAdmin(req);
    const connection = await connectDB();
    const [rows] = await connection.query('SELECT active FROM coupons WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    const newActive = rows[0].active ? 0 : 1;
    await connection.query('UPDATE coupons SET active = ? WHERE id = ?', [newActive, req.params.id]);
    res.json({ success: true, message: newActive ? 'Coupon activated' : 'Coupon deactivated' });
  } catch (error) {
    console.error('❌ Toggle coupon error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// Delete a coupon
app.delete('/api/coupons/:id', async (req, res) => {
  try {
    await requireAdmin(req);
    const connection = await connectDB();
    await connection.query('DELETE FROM coupons WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (error) {
    console.error('❌ Delete coupon error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================
// ✅ NEW: EMAIL DIAGNOSTIC ROUTE
// Visit this URL directly in your browser after deploying to see the
// REAL error if email sending is broken (e.g. Gmail app password issue).
// Remove this route once email is confirmed working.
// ============================================
app.get('/api/test-email', async (req, res) => {
  const testTo = req.query.to || process.env.EMAIL_USER;
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({
        success: false,
        message: 'EMAIL_USER or EMAIL_PASS is missing from Vercel environment variables.'
      });
    }
    await transporter.sendMail({
      from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
      to: testTo,
      subject: 'MariaBeau — Test Email',
      html: `<p>This is a test email sent at ${new Date().toISOString()}. If you received this, email sending is working correctly.</p>`
    });
    res.json({ success: true, message: `Test email sent to ${testTo}. Check the inbox (and spam folder).` });
  } catch (error) {
    console.error('❌ Test email error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message,
      code: error.code || null
    });
  }
});

// ============================================
// 🔐 AUTH ROUTES
// ============================================

// ✅ REGISTER — includes id in JWT
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const connection = await connectDB();

    const [existing] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID();
    await connection.query(
      'INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)',
      [userId, name, email, hashedPassword]
    );

    const token = jwt.sign({ id: userId, email }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: { id: userId, name, email }
    });
  } catch (error) {
    console.error('❌ Register error:', error.message);
    console.error(error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: error.stack
    });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
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

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
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
      from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Password - MariaBeau',
      html: `
        <div style="max-width:600px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;background:#faf7f2;">
          <div style="background:#1a1a1a;padding:36px 24px;text-align:center;">
            <span style="font-size:30px;font-weight:bold;letter-spacing:1px;color:#2FA88E;">Maria</span><span style="font-size:30px;font-weight:bold;letter-spacing:1px;color:#B5762E;">Beau</span>
            <div style="width:60px;height:2px;background:#B5762E;margin:14px auto 0 auto;"></div>
          </div>
          <div style="background:#ffffff;padding:40px 32px;">
            <h1 style="font-size:22px;color:#1a1a1a;margin:0 0 12px 0;text-align:center;">Reset Your Password</h1>
            <p style="font-size:15px;color:#666;line-height:1.6;margin:0 0 28px 0;text-align:center;">
              We received a request to reset the password for your MariaBeau account.<br>
              Click the button below to choose a new password. This link expires in 1 hour.
            </p>
            <div style="text-align:center;margin-bottom:28px;">
              <a href="${resetLink}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:4px;font-size:15px;font-weight:bold;">
                Reset Password
              </a>
            </div>
            <p style="font-size:13px;color:#aaa;line-height:1.6;margin:0;text-align:center;">
              If you didn't request this, you can safely ignore this email — your password will remain unchanged.
            </p>
          </div>
          <div style="text-align:center;padding:20px;font-size:12px;color:#aaa;">
            © ${new Date().getFullYear()} MariaBeau. All rights reserved.
          </div>
        </div>
      `
    });
    res.json({ success: true, message: 'Reset link sent to your email' });
  } catch (error) {
    console.error('❌ Forgot password error:', error.message);
    console.error(error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: error.stack
    });
  }
});

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
    console.error(error.stack);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: error.stack
    });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const connection = await connectDB();
    const [users] = await connection.query(
      'SELECT id, name, email, role, profile_pic FROM users WHERE id = ?',
      [decoded.id]
    );
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user: users[0] });
  } catch (error) {
    console.error('❌ /api/auth/me error:', error.message);
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
});

// ============================================
// 📦 ORDER ROUTES — SECURE + TRANSACTIONAL
// ✅ FIXED: uses a dedicated pooled connection for the whole transaction,
// released back to the pool in a `finally` block.
// ✅ NEW: accepts billingAddress + couponCode, discount recalculated server-side.
// ============================================

app.post('/api/orders', orderLimiter, async (req, res) => {
  let connection;
  try {
    const { shippingAddress, billingAddress, paymentMethod, couponCode, items } = req.body;

    // 1️⃣ Validate email
    if (!shippingAddress.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shippingAddress.email)) {
      return res.status(400).json({
        success: false,
        message: 'Valid email address is required for order confirmation.'
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Your cart is empty' });
    }

    // Generate order ID
    const orderId = crypto.randomUUID();

    // 2️⃣ Get a dedicated connection from the pool for this whole transaction
    connection = await getPool().getConnection();
    await connection.beginTransaction();

    // 3️⃣ Lock product rows and fetch prices/stock inside the transaction
    const productIds = items.map(i => i.product_id);
    const [productRows] = await connection.query(
      'SELECT id, name, price, stock FROM products WHERE id IN (?) FOR UPDATE',
      [productIds]
    );
    const productMap = {};
    productRows.forEach(p => productMap[p.id] = p);

    // Validate all products exist and stock is sufficient
    let subtotal = 0;
    for (const item of items) {
      const product = productMap[item.product_id];
      if (!product) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Product not found: ${item.product_id}`
        });
      }
      if (item.quantity > product.stock) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Sorry, only ${product.stock} item${product.stock === 1 ? '' : 's'} of "${product.name}" ${product.stock === 1 ? 'is' : 'are'} available in stock.`
        });
      }
      subtotal += product.price * item.quantity;
    }

    // 4️⃣ ✅ CHANGED: Recalculate discount server-side using the coupons table
    // (never trust the client-sent discount amount)
    let discountAmount = 0;
    let appliedCouponCode = null;
    if (couponCode) {
      const cleanCode = couponCode.trim().toUpperCase();
      const [couponRows] = await connection.query(
        `SELECT type, value FROM coupons
         WHERE code = ? AND active = 1 AND (expires_at IS NULL OR expires_at > NOW())`,
        [cleanCode]
      );
      if (couponRows.length > 0) {
        const coupon = couponRows[0];
        appliedCouponCode = cleanCode;
        discountAmount = coupon.type === 'percent'
          ? (subtotal * coupon.value) / 100
          : Math.min(coupon.value, subtotal);
      }
      // Invalid/expired/unknown coupon codes are silently ignored rather than failing the order
    }

    // 5️⃣ Calculate shipping & final total
    const shipping = subtotal >= 3000 ? 0 : 200;
    const totalPrice = Math.max(subtotal - discountAmount, 0) + shipping;

    // 6️⃣ Get userId (optional)
    const token = req.headers.authorization?.split(' ')[1];
    let userId = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
      } catch (e) {}
    }

    // ✅ NEW: fold billing address + coupon info into the stored shipping_address JSON
    const storedAddress = {
      ...shippingAddress,
      billingAddress: billingAddress || null,
      couponCode: appliedCouponCode,
      discountAmount
    };

    try {
      // Insert order
      await connection.query(
        'INSERT INTO orders (id, user_id, total_price, status, shipping_address, payment_method) VALUES (?, ?, ?, ?, ?, ?)',
        [orderId, userId, totalPrice, 'pending', JSON.stringify(storedAddress), paymentMethod]
      );

      // Insert order items & deduct stock
      for (const item of items) {
        const product = productMap[item.product_id];
        // Insert order item
        await connection.query(
          'INSERT INTO order_items (id, order_id, product_id, quantity, price) VALUES (UUID(), ?, ?, ?, ?)',
          [orderId, item.product_id, item.quantity, product.price]
        );
        // Deduct stock with condition and check affected rows
        const [updateResult] = await connection.query(
          'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
          [item.quantity, item.product_id, item.quantity]
        );
        if (updateResult.affectedRows === 0) {
          // Stock became insufficient due to concurrent order
          await connection.rollback();
          return res.status(400).json({
            success: false,
            message: `Sorry, "${product.name}" is no longer available in the requested quantity.`
          });
        }
      }

      // 7️⃣ COMMIT
      await connection.commit();

      // 8️⃣ Send confirmation email (non-blocking) — ✅ branded HTML template (same for guest & logged-in)
      try {
        await transporter.sendMail({
          from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
          to: shippingAddress.email,
          subject: 'Order Confirmation - MariaBeau',
          html: `
            <div style="max-width:600px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;background:#faf7f2;">
              <div style="background:#1a1a1a;padding:36px 24px;text-align:center;">
                <span style="font-size:30px;font-weight:bold;letter-spacing:1px;color:#2FA88E;">Maria</span><span style="font-size:30px;font-weight:bold;letter-spacing:1px;color:#B5762E;">Beau</span>
                <div style="width:60px;height:2px;background:#B5762E;margin:14px auto 0 auto;"></div>
              </div>
              <div style="background:#ffffff;padding:40px 32px;">
                <div style="text-align:center;margin-bottom:28px;">
                  <div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:50%;background:#e9f7f2;color:#2FA88E;font-size:28px;">✓</div>
                </div>
                <h1 style="font-size:24px;color:#1a1a1a;margin:0 0 12px 0;text-align:center;">Thank You For Your Order!</h1>
                <p style="font-size:15px;color:#666;line-height:1.6;margin:0 0 28px 0;text-align:center;">
                  We've received your order and we're getting it ready.<br>Here are your order details:
                </p>
                <div style="background:#faf7f2;border:1px solid #e8dcc4;border-radius:8px;padding:22px 26px;margin-bottom:28px;">
                  <table style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td style="padding:10px 0;color:#888;font-size:14px;border-bottom:1px solid #e8dcc4;">Order ID</td>
                      <td style="padding:10px 0;color:#1a1a1a;font-size:16px;font-weight:bold;text-align:right;border-bottom:1px solid #e8dcc4;">#${orderId.slice(0, 8)}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 0;color:#888;font-size:14px;">Total Amount</td>
                      <td style="padding:10px 0;color:#B5762E;font-size:19px;font-weight:bold;text-align:right;">Rs. ${totalPrice}</td>
                    </tr>
                  </table>
                </div>
                <p style="font-size:14px;color:#888;line-height:1.6;margin:0;text-align:center;">
                  We'll notify you again once your order ships.<br>Thank you for shopping with MariaBeau!
                </p>
              </div>
              <div style="text-align:center;padding:20px;font-size:12px;color:#aaa;">
                © ${new Date().getFullYear()} MariaBeau. All rights reserved.
              </div>
            </div>
          `
        });
      } catch (emailError) {
        console.error('⚠️ Email send failed:', emailError.message);
        // Do not fail the order
      }

      res.json({ success: true, data: { orderId } });

    } catch (txError) {
      // 9️⃣ ROLLBACK on error
      await connection.rollback();
      console.error('❌ Transaction failed:', txError.message);
      throw txError;
    }

  } catch (error) {
    console.error('❌ Order error:', error.message);
    console.error(error.stack);
    if (connection) await connection.rollback().catch(() => {});
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
      stack: error.stack
    });
  } finally {
    // ✅ Always release the pooled connection back to the pool
    if (connection) connection.release();
  }
});

// ============================================
// ✅ NEW: MY ORDERS (logged-in user's own orders + cancel)
// ============================================

// Get the current logged-in user's own orders, with product line items
app.get('/api/orders', async (req, res) => {
  try {
    const authUser = await requireUser(req);
    const connection = await connectDB();
    const [rows] = await connection.query(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [authUser.id]
    );

    const orderIds = rows.map(o => o.id);
    let itemsByOrder = {};
    if (orderIds.length > 0) {
      const [itemRows] = await connection.query(
        `SELECT oi.order_id, oi.quantity, oi.price, p.name AS product_name, p.images AS product_images
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id IN (?)`,
        [orderIds]
      );
      itemRows.forEach(item => {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
        itemsByOrder[item.order_id].push({
          product_name: item.product_name || 'Unknown Product',
          quantity: item.quantity,
          price: item.price,
          images: parseImages(item.product_images)
        });
      });
    }

    const ordersWithItems = rows.map(order => ({
      ...order,
      items: itemsByOrder[order.id] || []
    }));

    res.json({ success: true, data: ordersWithItems });
  } catch (error) {
    console.error('❌ Get my orders error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// Let a logged-in user cancel their own order — only allowed while it's
// still pending or confirmed (not once it's already processing/shipped/etc).
app.put('/api/orders/:id/cancel', async (req, res) => {
  let connection;
  try {
    const authUser = await requireUser(req);
    connection = await getPool().getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.query(
      'SELECT status, user_id FROM orders WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (existing[0].user_id !== authUser.id) {
      await connection.rollback();
      return res.status(403).json({ success: false, message: 'You are not authorized to cancel this order' });
    }
    const cancellableStatuses = ['pending', 'confirmed'];
    if (!cancellableStatuses.includes(existing[0].status)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: `This order can no longer be cancelled (current status: ${existing[0].status}). Please contact support if you need help.`
      });
    }

    await connection.query('UPDATE orders SET status = ? WHERE id = ?', ['cancelled', req.params.id]);

    // Restore stock for every item in the cancelled order
    const [orderItems] = await connection.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
      [req.params.id]
    );
    for (const oi of orderItems) {
      await connection.query('UPDATE products SET stock = stock + ? WHERE id = ?', [oi.quantity, oi.product_id]);
    }

    await connection.commit();

    // Send a branded cancellation confirmation email (non-blocking)
    try {
      await transporter.sendMail({
        from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
        to: authUser.email,
        subject: 'Order Cancelled - MariaBeau',
        html: `
          <div style="max-width:600px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;background:#faf7f2;">
            <div style="background:#1a1a1a;padding:36px 24px;text-align:center;">
              <span style="font-size:30px;font-weight:bold;letter-spacing:1px;color:#2FA88E;">Maria</span><span style="font-size:30px;font-weight:bold;letter-spacing:1px;color:#B5762E;">Beau</span>
              <div style="width:60px;height:2px;background:#B5762E;margin:14px auto 0 auto;"></div>
            </div>
            <div style="background:#ffffff;padding:40px 32px;">
              <div style="text-align:center;margin-bottom:24px;">
                <span style="display:inline-block;padding:8px 20px;border-radius:20px;background:#c0392b1A;color:#c0392b;font-size:14px;font-weight:bold;letter-spacing:0.5px;">
                  CANCELLED
                </span>
              </div>
              <h1 style="font-size:22px;color:#1a1a1a;margin:0 0 12px 0;text-align:center;">Order Cancelled</h1>
              <p style="font-size:15px;color:#666;line-height:1.6;margin:0 0 28px 0;text-align:center;">
                Your order has been cancelled as requested. If this was a mistake, please contact us and we'll be happy to help.
              </p>
              <div style="background:#faf7f2;border:1px solid #e8dcc4;border-radius:8px;padding:18px 26px;margin-bottom:8px;text-align:center;">
                <span style="color:#888;font-size:14px;">Order ID: </span>
                <span style="color:#1a1a1a;font-size:16px;font-weight:bold;">#${req.params.id.slice(0, 8)}</span>
              </div>
            </div>
            <div style="text-align:center;padding:20px;font-size:12px;color:#aaa;">
              © ${new Date().getFullYear()} MariaBeau. All rights reserved.
            </div>
          </div>
        `
      });
    } catch (emailError) {
      console.error('⚠️ Cancel email failed:', emailError.message);
    }

    res.json({ success: true, message: 'Order cancelled successfully' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('❌ Cancel order error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  } finally {
    if (connection) connection.release();
  }
});

// ============================================
// TRACK ORDER (unchanged)
// ============================================
app.post('/api/orders/track', async (req, res) => {
  try {
    const { orderId, email } = req.body;
    if (!orderId || !orderId.trim() || !email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Order ID and email are required' });
    }
    const connection = await connectDB();
    const [orders] = await connection.query(
      'SELECT * FROM orders WHERE id LIKE ? LIMIT 1',
      [`${orderId.trim().replace(/^#/, '')}%`]
    );
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found. Please check your order number.' });
    }
    const order = orders[0];
    let shippingAddress = {};
    try {
      shippingAddress = JSON.parse(order.shipping_address);
    } catch (e) {}
    const orderEmail = (shippingAddress.email || '').toLowerCase().trim();
    if (!orderEmail || orderEmail !== email.toLowerCase().trim()) {
      return res.status(404).json({ success: false, message: 'Order not found. Please check your order number.' });
    }
    res.json({
      success: true,
      data: {
        id: order.id,
        status: order.status,
        total_price: order.total_price,
        payment_method: order.payment_method,
        created_at: order.created_at
      }
    });
  } catch (error) {
    console.error('❌ Track order error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============================================
// ADMIN ORDERS
// ============================================
app.get('/api/orders/admin/all', async (req, res) => {
  try {
    await requireAdmin(req);
    const connection = await connectDB();
    const [rows] = await connection.query(
      `SELECT o.*, u.name AS user_name, u.email AS user_email
       FROM orders o 
       LEFT JOIN users u ON o.user_id = u.id 
       ORDER BY o.created_at DESC`
    );

    // ✅ NEW: fetch every order's line items (product name, qty, price) in one query
    const orderIds = rows.map(o => o.id);
    let itemsByOrder = {};
    if (orderIds.length > 0) {
      const [itemRows] = await connection.query(
        `SELECT oi.order_id, oi.quantity, oi.price, p.name AS product_name, p.images AS product_images, p.category, p.subcategory
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id IN (?)`,
        [orderIds]
      );
      itemRows.forEach(item => {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
        itemsByOrder[item.order_id].push({
          name: item.product_name || 'Unknown Product',
          quantity: item.quantity,
          price: item.price,
          images: parseImages(item.product_images), // ✅ NEW: for admin thumbnail
          category: item.category || null,           // ✅ NEW
          subcategory: item.subcategory || null       // ✅ NEW
        });
      });
    }

    // ✅ NEW: for guest orders, pull name/email from the stored shipping_address
    // JSON instead of falling back to generic "Guest" with no email.
    const ordersWithDetails = rows.map(order => {
      let displayName = order.user_name;
      let displayEmail = order.user_email;
      try {
        const addr = JSON.parse(order.shipping_address);
        if (!displayName) {
          const fullName = `${addr.firstName || ''} ${addr.lastName || ''}`.trim();
          if (fullName) displayName = fullName;
        }
        if (!displayEmail) displayEmail = addr.email;
      } catch (e) {}
      return {
        ...order,
        user_name: displayName || 'Guest',
        user_email: displayEmail || null,
        items: itemsByOrder[order.id] || []
      };
    });

    res.json({ success: true, data: ordersWithDetails });
  } catch (error) {
    console.error('❌ Admin get orders error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// ✅ Transactional status update — also uses a dedicated pooled connection now
app.put('/api/orders/:id/status', async (req, res) => {
  let connection;
  try {
    await requireAdmin(req);
    const { status } = req.body;

    connection = await getPool().getConnection();
    await connection.beginTransaction();

    // Lock the order row inside the transaction
    const [existing] = await connection.query(
      'SELECT status FROM orders WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const previousStatus = existing[0].status;

    // Update status
    await connection.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);

    // Restore stock if cancelling and not already cancelled
    if (status === 'cancelled' && previousStatus !== 'cancelled') {
      const [orderItems] = await connection.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
        [req.params.id]
      );
      for (const oi of orderItems) {
        await connection.query(
          'UPDATE products SET stock = stock + ? WHERE id = ?',
          [oi.quantity, oi.product_id]
        );
      }
    }

    // Commit transaction
    await connection.commit();

    // Send status update email (non-blocking) — ✅ branded HTML, same for guest & logged-in
    try {
      const [orderRows] = await connection.query(`
        SELECT o.*, u.email as user_email, u.name as user_name
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?
      `, [req.params.id]);
      const order = orderRows[0];
      if (order) {
        let customerEmail = order.user_email;
        if (!customerEmail && order.shipping_address) {
          try {
            const addr = JSON.parse(order.shipping_address);
            customerEmail = addr.email;
          } catch (e) {}
        }
        if (customerEmail) {
          // ✅ Status-specific display text, color, and message
          const statusMap = {
            pending: { label: 'Pending', color: '#B5762E', message: 'Your order is being reviewed and will be processed shortly.' },
            confirmed: { label: 'Confirmed', color: '#2FA88E', message: 'Your order has been confirmed and is being prepared.' },
            processing: { label: 'Processing', color: '#2FA88E', message: 'Your order is currently being processed.' },
            shipped: { label: 'Shipped', color: '#2FA88E', message: 'Great news — your order is on its way to you!' },
            delivered: { label: 'Delivered', color: '#2FA88E', message: 'Your order has been delivered. We hope you love it!' },
            cancelled: { label: 'Cancelled', color: '#c0392b', message: 'Your order has been cancelled. If this was unexpected, please contact us.' }
          };
          const info = statusMap[status] || { label: status, color: '#B5762E', message: 'Your order status has been updated.' };

          await transporter.sendMail({
            from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
            to: customerEmail,
            subject: `Order ${info.label} - MariaBeau`,
            html: `
              <div style="max-width:600px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;background:#faf7f2;">
                <div style="background:#1a1a1a;padding:36px 24px;text-align:center;">
                  <span style="font-size:30px;font-weight:bold;letter-spacing:1px;color:#2FA88E;">Maria</span><span style="font-size:30px;font-weight:bold;letter-spacing:1px;color:#B5762E;">Beau</span>
                  <div style="width:60px;height:2px;background:#B5762E;margin:14px auto 0 auto;"></div>
                </div>
                <div style="background:#ffffff;padding:40px 32px;">
                  <div style="text-align:center;margin-bottom:24px;">
                    <span style="display:inline-block;padding:8px 20px;border-radius:20px;background:${info.color}1A;color:${info.color};font-size:14px;font-weight:bold;letter-spacing:0.5px;">
                      ${info.label.toUpperCase()}
                    </span>
                  </div>
                  <h1 style="font-size:22px;color:#1a1a1a;margin:0 0 12px 0;text-align:center;">Order ${info.label}</h1>
                  <p style="font-size:15px;color:#666;line-height:1.6;margin:0 0 28px 0;text-align:center;">
                    ${info.message}
                  </p>
                  <div style="background:#faf7f2;border:1px solid #e8dcc4;border-radius:8px;padding:18px 26px;margin-bottom:8px;text-align:center;">
                    <span style="color:#888;font-size:14px;">Order ID: </span>
                    <span style="color:#1a1a1a;font-size:16px;font-weight:bold;">#${order.id.slice(0, 8)}</span>
                  </div>
                </div>
                <div style="text-align:center;padding:20px;font-size:12px;color:#aaa;">
                  © ${new Date().getFullYear()} MariaBeau. All rights reserved.
                </div>
              </div>
            `
          });
        }
      }
    } catch (emailError) {
      console.error('⚠️ Status email failed:', emailError.message);
    }

    res.json({ success: true, message: 'Order status updated' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('❌ Update order status error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  } finally {
    if (connection) connection.release();
  }
});

// ============================================
// PRODUCTS ROUTES (unchanged)
// ============================================
const parseImages = (images) => {
  if (!images) return [];
  if (Array.isArray(images)) return images;
  if (typeof images === 'string') {
    try {
      const parsed = JSON.parse(images);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      return [images];
    }
  }
  return [images];
};

app.get('/api/products', async (req, res) => {
  try {
    const connection = await connectDB();
    const [rows] = await connection.query('SELECT * FROM products ORDER BY created_at DESC');
    const products = rows.map(p => ({ ...p, images: parseImages(p.images) }));
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
    const product = { ...rows[0], images: parseImages(rows[0].images) };
    res.json({ success: true, data: product });
  } catch (error) {
    console.error('❌ Product error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching product' });
  }
});

// ============================================
// IMAGE UPLOAD (unchanged)
// ============================================
app.post('/api/products/upload-image', upload.single('image'), async (req, res) => {
  try {
    await requireAdmin(req);
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    const uploadFromBuffer = () => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'mariabeau_products' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });
    };
    try {
      const result = await uploadFromBuffer();
      res.json({ success: true, data: { filename: result.secure_url } });
    } catch (cloudinaryError) {
      console.error('☁️ Cloudinary upload error:', cloudinaryError.message);
      res.status(500).json({ success: false, message: 'Image upload to Cloudinary failed. Please try again.' });
    }
  } catch (error) {
    console.error('❌ Image upload error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Image upload failed' });
  }
});

// ============================================
// ADD/UPDATE/DELETE PRODUCT (unchanged)
// ============================================
app.post('/api/products', async (req, res) => {
  try {
    await requireAdmin(req);
    const { name, description, price, discount_price, category, subcategory, sizes, colors, images, stock, is_featured } = req.body;
    const connection = await connectDB();
    await connection.query(
      `INSERT INTO products (id, name, description, price, discount_price, category, subcategory, sizes, colors, images, stock, is_featured) 
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        price,
        discount_price || null,
        category,
        subcategory || null,
        JSON.stringify(sizes || []),
        JSON.stringify(colors || []),
        JSON.stringify(images || []),
        stock || 0,
        is_featured ? 1 : 0
      ]
    );
    const [rows] = await connection.query(
      'SELECT id FROM products WHERE name = ? ORDER BY created_at DESC LIMIT 1',
      [name]
    );
    res.json({ success: true, data: { id: rows[0]?.id }, message: 'Product added successfully' });
  } catch (error) {
    console.error('❌ Add product error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    await requireAdmin(req);
    const { name, description, price, discount_price, category, subcategory, sizes, colors, images, stock, is_featured } = req.body;
    const connection = await connectDB();
    await connection.query(
      `UPDATE products 
       SET name = ?, description = ?, price = ?, discount_price = ?, category = ?, subcategory = ?, 
           sizes = ?, colors = ?, images = ?, stock = ?, is_featured = ? 
       WHERE id = ?`,
      [
        name,
        description || null,
        price,
        discount_price || null,
        category,
        subcategory || null,
        JSON.stringify(sizes || []),
        JSON.stringify(colors || []),
        JSON.stringify(images || []),
        stock || 0,
        is_featured ? 1 : 0,
        req.params.id
      ]
    );
    res.json({ success: true, message: 'Product updated successfully' });
  } catch (error) {
    console.error('❌ Update product error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await requireAdmin(req);
    const connection = await connectDB();
    await connection.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('❌ Delete product error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================
// REVIEWS (unchanged)
// ============================================
app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const connection = await connectDB();
    // ✅ CHANGED: only show reviews the admin has approved
    const [reviews] = await connection.query(
      'SELECT id, user_name, rating, comment, created_at FROM reviews WHERE product_id = ? AND approved = 1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ success: true, data: reviews });
  } catch (error) {
    console.error('❌ Get reviews error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching reviews' });
  }
});

app.post('/api/products/:id/reviews', async (req, res) => {
  try {
    const user = await requireUser(req);
    const { rating, comment } = req.body;
    const ratingNum = parseInt(rating);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }
    const connection = await connectDB();
    // ✅ CHANGED: reviews start as unapproved (approved = 0) and don't affect
    // the product's average rating until an admin approves them.
    await connection.query(
      'INSERT INTO reviews (id, product_id, user_id, user_name, rating, comment, approved) VALUES (UUID(), ?, ?, ?, ?, ?, 0)',
      [req.params.id, user.id, user.name, ratingNum, comment || null]
    );
    res.json({ success: true, message: 'Review submitted! It will appear on the product page once approved.' });
  } catch (error) {
    console.error('❌ Add review error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================
// ✅ NEW: REVIEW MODERATION (admin only)
// ============================================

// Recalculates a product's average rating using only approved reviews
const recalcProductRating = async (connection, productId) => {
  const [avgResult] = await connection.query(
    'SELECT AVG(rating) AS avgRating FROM reviews WHERE product_id = ? AND approved = 1',
    [productId]
  );
  const newAvg = avgResult[0].avgRating || 0;
  await connection.query('UPDATE products SET rating = ? WHERE id = ?', [newAvg, productId]);
};

// List all reviews (pending first) with product name, for the admin moderation queue
app.get('/api/reviews/admin/all', async (req, res) => {
  try {
    await requireAdmin(req);
    const connection = await connectDB();
    const [rows] = await connection.query(
      `SELECT r.*, p.name AS product_name
       FROM reviews r
       LEFT JOIN products p ON r.product_id = p.id
       ORDER BY r.approved ASC, r.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('❌ Admin get reviews error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// Approve a pending review — makes it public and updates the product's rating
app.put('/api/reviews/:id/approve', async (req, res) => {
  try {
    await requireAdmin(req);
    const connection = await connectDB();
    const [existing] = await connection.query('SELECT product_id FROM reviews WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    await connection.query('UPDATE reviews SET approved = 1 WHERE id = ?', [req.params.id]);
    await recalcProductRating(connection, existing[0].product_id);
    res.json({ success: true, message: 'Review approved' });
  } catch (error) {
    console.error('❌ Approve review error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// Reject/delete a review — removes it and recalculates the product's rating
app.delete('/api/reviews/:id', async (req, res) => {
  try {
    await requireAdmin(req);
    const connection = await connectDB();
    const [existing] = await connection.query('SELECT product_id FROM reviews WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }
    await connection.query('DELETE FROM reviews WHERE id = ?', [req.params.id]);
    await recalcProductRating(connection, existing[0].product_id);
    res.json({ success: true, message: 'Review deleted' });
  } catch (error) {
    console.error('❌ Delete review error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;