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

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
// ✅ NEW: COUPON CODES (simple in-memory map for now)
// Move to a DB table later if you want admin-managed coupons.
// ============================================
const COUPONS = {
  WELCOME10: { type: 'percent', value: 10 },
  FLAT200: { type: 'flat', value: 200 }
};

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
  const [users] = await connection.query('SELECT id, name FROM users WHERE id = ?', [decoded.id]);
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
// ✅ NEW: COUPON VALIDATION ROUTE
// ============================================
app.post('/api/coupons/validate', (req, res) => {
  const { code } = req.body;
  const key = (code || '').trim().toUpperCase();
  const coupon = COUPONS[key];
  if (!coupon) {
    return res.status(404).json({ success: false, message: 'Invalid coupon code' });
  }
  res.json({ success: true, data: coupon }); // { type: 'percent'|'flat', value }
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
app.post('/api/auth/register', async (req, res) => {
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
      from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Password - MariaBeau',
      html: `...` // full branded email HTML (unchanged)
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

app.post('/api/orders', async (req, res) => {
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

    // 4️⃣ ✅ NEW: Recalculate discount server-side (never trust client amount)
    let discountAmount = 0;
    let appliedCouponCode = null;
    if (couponCode) {
      const coupon = COUPONS[couponCode.trim().toUpperCase()];
      if (coupon) {
        appliedCouponCode = couponCode.trim().toUpperCase();
        discountAmount = coupon.type === 'percent'
          ? (subtotal * coupon.value) / 100
          : Math.min(coupon.value, subtotal);
      }
      // Invalid/unknown coupon codes are silently ignored rather than failing the order
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

      // 8️⃣ Send confirmation email (non-blocking)
      try {
        await transporter.sendMail({
          from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
          to: shippingAddress.email,
          subject: 'Order Confirmation - MariaBeau',
          html: `<p>Order #${orderId.slice(0, 8)} placed successfully! Total: Rs. ${totalPrice}</p>`
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
      `SELECT o.*, u.name AS user_name 
       FROM orders o 
       LEFT JOIN users u ON o.user_id = u.id 
       ORDER BY o.created_at DESC`
    );
    // ✅ NEW: for guest orders (no logged-in user), pull the name they actually
    // typed at checkout out of the stored shipping_address JSON instead of
    // falling back to the generic "Guest" label.
    const ordersWithNames = rows.map(order => {
      if (order.user_name) return order;
      let guestName = 'Guest';
      try {
        const addr = JSON.parse(order.shipping_address);
        const fullName = `${addr.firstName || ''} ${addr.lastName || ''}`.trim();
        if (fullName) guestName = fullName;
      } catch (e) {}
      return { ...order, user_name: guestName };
    });
    res.json({ success: true, data: ordersWithNames });
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

    // Send status update email (non-blocking)
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
          const statusDisplay = status.charAt(0).toUpperCase() + status.slice(1);
          await transporter.sendMail({
            from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
            to: customerEmail,
            subject: `Order ${statusDisplay} - MariaBeau`,
            html: `<p>Your order #${order.id.slice(0, 8)} has been <strong>${status}</strong>.</p>`
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
    const [reviews] = await connection.query(
      'SELECT id, user_name, rating, comment, created_at FROM reviews WHERE product_id = ? ORDER BY created_at DESC',
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
    await connection.query(
      'INSERT INTO reviews (id, product_id, user_id, user_name, rating, comment) VALUES (UUID(), ?, ?, ?, ?, ?)',
      [req.params.id, user.id, user.name, ratingNum, comment || null]
    );
    const [avgResult] = await connection.query(
      'SELECT AVG(rating) AS avgRating FROM reviews WHERE product_id = ?',
      [req.params.id]
    );
    const newAvg = avgResult[0].avgRating || 0;
    await connection.query('UPDATE products SET rating = ? WHERE id = ?', [newAvg, req.params.id]);
    res.json({ success: true, message: 'Review submitted successfully' });
  } catch (error) {
    console.error('❌ Add review error:', error.message);
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