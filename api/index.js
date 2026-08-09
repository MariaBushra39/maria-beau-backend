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

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// CLOUDINARY CONFIG
// ============================================
cloudinary.config({
  cloud_name: 'bvqvahxw',
  api_key: '864735194487412',
  api_secret: 'NBNEHDrFjPVAXftWYEyOcf0rLZk'
});

// Multer - keep file in memory, then stream to Cloudinary
const upload = multer({ storage: multer.memoryStorage() });

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
// 🛡️ ADMIN AUTH HELPER (used by admin-only routes)
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

// Like requireAdmin, but for any logged-in user (used for submitting reviews).
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
// DATABASE TEST ROUTE (Diagnostic)
// ============================================
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
    console.error(error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message,
      stack: error.stack 
    });
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
      from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Password - MariaBeau',
      html: `
      <div style="background:#f5f0eb; padding:40px 20px; font-family:'Helvetica Neue', Arial, sans-serif;">
        <table role="presentation" width="100%" style="max-width:480px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
          <tr>
            <td style="background:#1a1a1a; padding:28px 30px; text-align:center;">
              <span style="font-family:Georgia, 'Times New Roman', serif; font-size:26px; font-weight:bold; letter-spacing:3px; text-transform:uppercase;">
                <span style="color:#5FBF9F;">Maria</span><span style="color:#E8B84B;">Beau</span>
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 34px 20px;">
              <h1 style="font-family:Georgia, 'Times New Roman', serif; font-size:22px; color:#1a1a1a; margin:0 0 16px;">Reset Your Password</h1>
              <p style="font-size:14px; line-height:1.6; color:#555; margin:0 0 26px;">
                We received a request to reset the password for your MariaBeau account. Click the button below to choose a new password. This link will expire in 1 hour.
              </p>
              <div style="text-align:center; margin:32px 0;">
                <a href="${resetLink}" style="background:#1a1a1a; color:#ffffff; text-decoration:none; padding:14px 40px; font-size:13px; letter-spacing:2px; text-transform:uppercase; font-weight:600; border-radius:4px; display:inline-block;">
                  Reset Password
                </a>
              </div>
              <p style="font-size:12px; line-height:1.6; color:#999; margin:26px 0 0;">
                If you didn't request this, you can safely ignore this email — your password will remain unchanged.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9f6f2; padding:22px 34px; text-align:center; border-top:1px solid #f0ebe5;">
              <p style="font-size:11px; color:#aaa; margin:0; letter-spacing:0.5px;">
                &copy; ${new Date().getFullYear()} MariaBeau. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
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
    console.error(error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message,
      stack: error.stack 
    });
  }
});

// GET CURRENT USER (ME)
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
// 📦 ORDER ROUTE
// ============================================

app.post('/api/orders', async (req, res) => {
  try {
    const { totalPrice, shippingAddress, paymentMethod, items } = req.body;
    const connection = await connectDB();

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Your cart is empty' });
    }

    // Validate stock for every item BEFORE creating the order — never trust
    // frontend-only checks, since stock could have changed since the page loaded.
    for (const item of items) {
      const [productRows] = await connection.query('SELECT id, name, stock FROM products WHERE id = ?', [item.product_id]);
      if (productRows.length === 0) {
        return res.status(400).json({ success: false, message: 'One of the items in your cart no longer exists.' });
      }
      const available = productRows[0].stock;
      if (item.quantity > available) {
        return res.status(400).json({
          success: false,
          message: `Sorry, only ${available} item${available === 1 ? '' : 's'} of "${productRows[0].name}" ${available === 1 ? 'is' : 'are'} available in stock.`
        });
      }
    }

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
      // Decrease stock now that the order is confirmed. The "stock >= ?" guard
      // prevents it from ever going negative even under rare concurrent orders.
      await connection.query(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
        [item.quantity, item.product_id, item.quantity]
      );
    }

    try {
      await transporter.sendMail({
        from: `"MariaBeau" <${process.env.EMAIL_USER}>`,
        to: shippingAddress.email || 'mariabushra392@gmail.com',
        subject: 'Order Confirmation - MariaBeau',
        html: `
        <div style="background:#f5f0eb; padding:40px 20px; font-family:'Helvetica Neue', Arial, sans-serif;">
          <table role="presentation" width="100%" style="max-width:480px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
            <tr>
              <td style="background:#1a1a1a; padding:28px 30px; text-align:center;">
                <span style="font-family:Georgia, 'Times New Roman', serif; font-size:26px; font-weight:bold; letter-spacing:3px; text-transform:uppercase;">
                  <span style="color:#5FBF9F;">Maria</span><span style="color:#E8B84B;">Beau</span>
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 34px 20px;">
                <h1 style="font-family:Georgia, 'Times New Roman', serif; font-size:22px; color:#1a1a1a; margin:0 0 16px;">Thank You For Your Order!</h1>
                <p style="font-size:14px; line-height:1.6; color:#555; margin:0 0 26px;">
                  We've received your order and we're getting it ready. Here are your order details:
                </p>
                <table role="presentation" width="100%" style="background:#f9f6f2; border-radius:6px; margin-bottom:26px;">
                  <tr>
                    <td style="padding:16px 20px; font-size:13px; color:#888;">Order ID</td>
                    <td style="padding:16px 20px; font-size:13px; color:#1a1a1a; font-weight:600; text-align:right;">#${orderId?.slice(0, 8)}</td>
                  </tr>
                  <tr>
                    <td style="padding:0 20px 16px; font-size:13px; color:#888; border-top:1px solid #f0ebe5; padding-top:16px;">Total Amount</td>
                    <td style="padding:0 20px 16px; font-size:15px; color:#1a1a1a; font-weight:700; text-align:right; border-top:1px solid #f0ebe5; padding-top:16px;">Rs. ${totalPrice}</td>
                  </tr>
                </table>
                <p style="font-size:12px; line-height:1.6; color:#999; margin:0;">
                  We'll notify you again once your order ships. Thank you for shopping with MariaBeau!
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f9f6f2; padding:22px 34px; text-align:center; border-top:1px solid #f0ebe5;">
                <p style="font-size:11px; color:#aaa; margin:0; letter-spacing:0.5px;">
                  &copy; ${new Date().getFullYear()} MariaBeau. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </div>
        `
      });
    } catch (emailError) {
      console.error('⚠️ Email send failed:', emailError.message);
    }

    res.json({ success: true, data: { orderId } });
  } catch (error) {
    console.error('❌ Order error:', error.message);
    console.error(error.stack);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message,
      stack: error.stack 
    });
  }
});

// ============================================
// 🛡️ ADMIN ORDER ROUTES
// ============================================

// GET ALL ORDERS (Admin only)
// TRACK ORDER (Customer — no login required, verified by order ID + email)
app.post('/api/orders/track', async (req, res) => {
  try {
    const { orderId, email } = req.body;

    if (!orderId || !orderId.trim() || !email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Order ID and email are required' });
    }

    const connection = await connectDB();
    // Customers only ever see the first 8 characters of their order ID
    // (on the success page / confirmation email), so match by prefix.
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
    } catch (e) {
      shippingAddress = {};
    }

    const orderEmail = (shippingAddress.email || '').toLowerCase().trim();
    if (!orderEmail || orderEmail !== email.toLowerCase().trim()) {
      // Same generic message as "not found" — avoids revealing whether the order exists to someone guessing.
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
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('❌ Admin get orders error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// UPDATE ORDER STATUS (Admin only)
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    await requireAdmin(req);
    const { status } = req.body;
    const connection = await connectDB();

    const [existing] = await connection.query('SELECT status FROM orders WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const previousStatus = existing[0].status;

    await connection.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);

    // Restore stock only when moving INTO "cancelled" from a non-cancelled
    // state — checking previousStatus prevents restoring twice if an admin
    // sets it to "cancelled" more than once.
    if (status === 'cancelled' && previousStatus !== 'cancelled') {
      const [orderItems] = await connection.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
        [req.params.id]
      );
      for (const oi of orderItems) {
        await connection.query('UPDATE products SET stock = stock + ? WHERE id = ?', [oi.quantity, oi.product_id]);
      }
    }

    res.json({ success: true, message: 'Order status updated' });
  } catch (error) {
    console.error('❌ Update order status error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Server error' });
  }
});

// ============================================
// PRODUCTS ROUTES
// ============================================

// Safely normalize the "images" field into a flat array of strings.
// IMPORTANT: mysql2 auto-parses JSON columns, so p.images may already be
// an array (not a string). Re-running JSON.parse on an already-parsed
// array was the bug causing nested arrays like [["url.jpg"]].
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
    
    const products = rows.map(p => ({
      ...p,
      images: parseImages(p.images)
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
      images: parseImages(rows[0].images)
    };
    
    res.json({ success: true, data: product });
  } catch (error) {
    console.error('❌ Product error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching product' });
  }
});

// ============================================
// 🖼️ IMAGE UPLOAD (Admin only, uploads to Cloudinary)
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

    const result = await uploadFromBuffer();

    res.json({
      success: true,
      data: { filename: result.secure_url }
    });
  } catch (error) {
    console.error('❌ Image upload error:', error.message);
    const status = error.status || 500;
    res.status(status).json({ success: false, message: error.message || 'Image upload failed' });
  }
});

// ADD NEW PRODUCT (Admin only)
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

// UPDATE PRODUCT (Admin only)
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

// DELETE PRODUCT (Admin only)
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
// ⭐ REVIEWS
// ============================================

// GET ALL REVIEWS FOR A PRODUCT (public)
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

// SUBMIT A REVIEW (any logged-in user)
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

    // Keep the product's average rating in sync with its reviews.
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