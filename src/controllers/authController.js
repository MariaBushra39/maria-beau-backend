const User = require('../models/userModel');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendWelcomeEmail, sendResetEmail } = require('../utils/email');

// ============================================================
// 1️⃣ REGISTER
// ============================================================
const register = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        const existingUser = await User.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User already exists'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create(name, email, hashedPassword);

        // ✅ Welcome Email Send Karein (Background mein)
        try {
            await sendWelcomeEmail(email, name);
            console.log('✅ Welcome email sent to', email);
        } catch (emailError) {
            console.log('❌ Welcome email failed:', emailError.message);
        }

        res.status(201).json({
            success: true,
            message: 'User registered successfully!',
            data: { name, email }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
};

// ============================================================
// 2️⃣ LOGIN
// ============================================================
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findByEmail(email);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret-key',
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Login successful!',
            data: {
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
};

// ============================================================
// 3️⃣ FORGOT PASSWORD
// ============================================================
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findByEmail(email);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found with this email'
            });
        }

        // ✅ Generate Reset Token
        const token = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 3600000; // 1 hour

        // ✅ Save to Database
        const db = require('../config/db');
        await db.query(
            `UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE email = ?`,
            [token, expires, email]
        );

        // ✅ Send Reset Email
        await sendResetEmail(email, user.name, token);

        res.json({
            success: true,
            message: 'Password reset link sent to your email!'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to send reset email',
            error: error.message
        });
    }
};

// ============================================================
// 4️⃣ RESET PASSWORD
// ============================================================
const resetPassword = async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        const db = require('../config/db');

        // ✅ Find user with valid token
        const [users] = await db.query(
            `SELECT * FROM users WHERE reset_password_token = ? AND reset_password_expires > ?`,
            [token, Date.now()]
        );

        if (users.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        const user = users[0];

        // ✅ Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // ✅ Update password & clear token
        await db.query(
            `UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?`,
            [hashedPassword, user.id]
        );

        res.json({
            success: true,
            message: 'Password reset successfully!'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to reset password',
            error: error.message
        });
    }
};

// ============================================================
// 5️⃣ EXPORTS
// ============================================================
module.exports = { register, login, forgotPassword, resetPassword };