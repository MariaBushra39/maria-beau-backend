const db = require('../config/db');

const Order = {
    // 1. Place a new order
    create: async (userId, totalPrice, shippingAddress, paymentMethod, items) => {
        // Insert into orders table
        const [orderResult] = await db.query(
            `INSERT INTO orders (id, user_id, total_price, shipping_address, payment_method)
             VALUES (UUID(), ?, ?, ?, ?)`,
            [userId, totalPrice, JSON.stringify(shippingAddress), paymentMethod]
        );

        // Get the generated Order ID
        const [orderRow] = await db.query(
            `SELECT id FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );
        const orderIdGen = orderRow[0].id;

        // Insert order items
        for (const item of items) {
            await db.query(
                `INSERT INTO order_items (id, order_id, product_id, quantity, price)
                 VALUES (UUID(), ?, ?, ?, ?)`,
                [orderIdGen, item.product_id, item.quantity, item.price]
            );
        }

        return { orderId: orderIdGen };
    },

    // 2. Get orders by User ID
    findByUser: async (userId) => {
        const [orders] = await db.query(
            `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
            [userId]
        );
        
        for (let order of orders) {
            const [items] = await db.query(
                `SELECT oi.*, p.name as product_name 
                 FROM order_items oi 
                 JOIN products p ON oi.product_id = p.id 
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items;
        }
        return orders;
    },

    // 3. Get single order by ID
    findById: async (orderId) => {
        const [orders] = await db.query(
            `SELECT * FROM orders WHERE id = ?`,
            [orderId]
        );
        if (orders.length === 0) return null;

        const order = orders[0];
        const [items] = await db.query(
            `SELECT oi.*, p.name as product_name 
             FROM order_items oi 
             JOIN products p ON oi.product_id = p.id 
             WHERE oi.order_id = ?`,
            [orderId]
        );
        order.items = items;
        return order;
    },

    // 4. Update order status
    updateStatus: async (orderId, status) => {
        const [result] = await db.query(
            `UPDATE orders SET status = ? WHERE id = ?`,
            [status, orderId]
        );
        return result;
    },

    // 5. Get all orders (Admin)
    findAll: async () => {
        const [orders] = await db.query(
            `SELECT o.*, u.name as user_name, u.email as user_email 
             FROM orders o 
             JOIN users u ON o.user_id = u.id 
             ORDER BY o.created_at DESC`
        );
        for (let order of orders) {
            const [items] = await db.query(
                `SELECT oi.*, p.name as product_name 
                 FROM order_items oi 
                 JOIN products p ON oi.product_id = p.id 
                 WHERE oi.order_id = ?`,
                [order.id]
            );
            order.items = items;
        }
        return orders;
    }
};

module.exports = Order;