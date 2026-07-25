const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
dotenv.config();

// ============================================================
// TRANSPORTER SETUP (Gmail)
// ============================================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ✅ Test connection on startup
transporter.verify((error, success) => {
    if (error) {
        console.log('SMTP Connection Error:', error.message);
    } else {
        console.log('SMTP Connection Ready to Send Emails');
    }
});

// ============================================================
// 1️⃣ WELCOME EMAIL
// ============================================================
const sendWelcomeEmail = async (to, name) => {
    try {
        console.log(`📧 Sending welcome email to: ${to}`);

        const mailOptions = {
            from: `"MARIABEAU" <${process.env.EMAIL_USER}>`,
            to,
            subject: 'Welcome to MARIABEAU! ',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0ebe5; border-radius: 12px;">
                    <h2 style="color: #1a1a1a; font-family: 'Playfair Display', serif;"> Welcome, ${name}!</h2>
                    <p>Thank you for joining <strong>MARIABEAU</strong>.</p>
                    <p>We're excited to have you. Start exploring our premium fashion collection.</p>
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="http://localhost:3000" style="background: #1a1a1a; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 30px;">Shop Now</a>
                    </p>
                    <p style="color: #888; font-size: 12px;">If you didn't create this account, please ignore this email.</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Welcome email sent to: ${to} (${info.messageId})`);
        return info;
    } catch (error) {
        console.log(`Welcome email failed for ${to}:`, error.message);
        throw error;
    }
};

// ============================================================
// 2️⃣ FORGOT PASSWORD EMAIL (RESET LINK)
// ============================================================
const sendResetEmail = async (to, name, token) => {
    try {
        console.log(`📧 Sending reset email to: ${to}`);

        const resetLink = `http://localhost:3000/reset-password/${token}`;

        const mailOptions = {
            from: `"MARIABEAU" <${process.env.EMAIL_USER}>`,
            to,
            subject: 'Reset Your Password - MARIABEAU',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0ebe5; border-radius: 12px;">
                    <h2 style="color: #1a1a1a;">🔐 Reset Your Password</h2>
                    <p>Hi ${name},</p>
                    <p>We received a request to reset your password. Click the button below to set a new password:</p>
                    <p style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" style="background: #1a1a1a; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 30px;">Reset Password</a>
                    </p>
                    <p>This link will expire in <strong>1 hour</strong>.</p>
                    <p style="color: #888; font-size: 12px;">If you didn't request this, please ignore this email.</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Reset email sent to: ${to} (${info.messageId})`);
        return info;
    } catch (error) {
        console.log(`Reset email failed for ${to}:`, error.message);
        throw error;
    }
};

// ============================================================
// 3️⃣ ORDER CONFIRMATION EMAIL
// ============================================================
const sendOrderConfirmationEmail = async (to, name, orderId, items, totalPrice) => {
    try {
        console.log(`Sending order confirmation to: ${to}`);

        // Generate order items HTML
        let itemsHtml = '';
        items.forEach(item => {
            itemsHtml += `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">Rs. ${item.price}</td>
                </tr>
            `;
        });

        const mailOptions = {
            from: `"MARIABEAU" <${process.env.EMAIL_USER}>`,
            to,
            subject: 'Order Confirmation - MARIABEAU ',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f0ebe5; border-radius: 12px;">
                    <h2 style="color: #1a1a1a; font-family: 'Playfair Display', serif;"> Order Confirmed, ${name}!</h2>
                    <p>Thank you for shopping with <strong>MARIABEAU</strong>.</p>
                    <p style="font-size: 14px; color: #666;">Your order has been placed successfully.</p>

                    <div style="background: #f9f6f2; padding: 16px; border-radius: 8px; margin: 16px 0;">
                        <p><strong>Order ID:</strong> ${orderId}</p>
                    </div>

                    <h3 style="margin-bottom: 12px;">Order Summary</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <thead>
                            <tr style="background: #f0ebe5;">
                                <th style="padding: 10px; text-align: left;">Product</th>
                                <th style="padding: 10px; text-align: center;">Qty</th>
                                <th style="padding: 10px; text-align: right;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                        </tbody>
                    </table>

                    <div style="text-align: right; margin-top: 16px; padding-top: 16px; border-top: 2px solid #1a1a1a;">
                        <p style="font-size: 18px; font-weight: 700;">Total: Rs. ${totalPrice}</p>
                    </div>

                    <p style="text-align: center; margin: 30px 0;">
                        <a href="http://localhost:3000" style="background: #1a1a1a; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 30px;">Continue Shopping</a>
                    </p>

                    <p style="color: #888; font-size: 12px; margin-top: 20px;">
                        You will receive a shipping confirmation once your order is dispatched.
                    </p>
                    <p style="color: #888; font-size: 12px;">If you have any questions, contact us at mariabushra392@gmail.com</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Order confirmation email sent to: ${to} (${info.messageId})`);
        return info;
    } catch (error) {
        console.log(`Order confirmation email failed for ${to}:`, error.message);
        throw error;
    }
};

// ============================================================
// EXPORTS
// ============================================================
module.exports = { sendWelcomeEmail, sendResetEmail, sendOrderConfirmationEmail };