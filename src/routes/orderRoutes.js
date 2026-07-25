const express = require('express');
const { placeOrder, getMyOrders, getOrderById, updateOrderStatus, getAllOrders } = require('../controllers/orderController');
const authMiddleware = require('../middleware/AuthMiddleware');

const router = express.Router();

// All routes are protected (user must be logged in)
router.use(authMiddleware);

// User Routes
router.post('/', placeOrder);                 // Place an order
router.get('/', getMyOrders);                 // Get my order history
router.get('/:id', getOrderById);             // Get a single order

// Admin Routes (Controller ke andar role check hai, is liye AdminMiddleware ki zaroorat nahi)
router.put('/:id/status', updateOrderStatus);
router.get('/admin/all', getAllOrders);

module.exports = router;