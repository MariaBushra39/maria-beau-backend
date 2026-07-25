const Order = require('../models/orderModel');
const { sendOrderConfirmationEmail } = require('../utils/email');

// 1. Place Order (Logged-in user)
const placeOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const { totalPrice, shippingAddress, paymentMethod, items } = req.body;

        console.log('Order Data:', { userId, totalPrice, shippingAddress, paymentMethod, items });

        if (!items || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Order must have at least one item'
            });
        }

        const result = await Order.create(
            userId,
            totalPrice,
            shippingAddress,
            paymentMethod,
            items
        );

        // ✅ Send order confirmation email
        try {
            // Get product names for items
            const db = require('../config/db');
            const productNames = [];
            for (const item of items) {
                const [rows] = await db.query('SELECT name FROM products WHERE id = ?', [item.product_id]);
                productNames.push({
                    name: rows[0]?.name || 'Product',
                    quantity: item.quantity,
                    price: item.price
                });
            }
            
            await sendOrderConfirmationEmail(
                req.user.email,
                req.user.name,
                result.orderId,
                productNames,
                totalPrice
            );
            console.log('Order confirmation email sent to:', req.user.email);
        } catch (emailError) {
            console.log('Order confirmation email failed:', emailError.message);
        }

        res.status(201).json({
            success: true,
            message: 'Order placed successfully!',
            data: { orderId: result.orderId }
        });
    } catch (error) {
        console.error('Place Order Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to place order',
            error: error.message
        });
    }
};

// 2. Get my orders (Logged-in user)
const getMyOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const orders = await Order.findByUser(userId);
        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
};

// 3. Get single order by ID
const getOrderById = async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        if (order.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to view this order'
            });
        }

        res.json({
            success: true,
            data: order
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order',
            error: error.message
        });
    }
};

// 4. Update order status (Admin only)
const updateOrderStatus = async (req, res) => {
    try {
        const orderId = req.params.id;
        const { status } = req.body;

        const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        await Order.updateStatus(orderId, status);
        res.json({
            success: true,
            message: 'Order status updated successfully!'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update order status',
            error: error.message
        });
    }
};

// 5. Get all orders (Admin only)
const getAllOrders = async (req, res) => {
    try {
        const orders = await Order.findAll();
        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
};

module.exports = { placeOrder, getMyOrders, getOrderById, updateOrderStatus, getAllOrders };