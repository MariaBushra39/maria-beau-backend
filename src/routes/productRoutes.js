const express = require('express');
const productController = require('../controllers/productController');
const jwt = require('jsonwebtoken');
const upload = require('../utils/upload'); // 🔥 Import upload

const router = express.Router();

// ============================================
// PUBLIC ROUTES (Sab dekh sakte hain)
// ============================================
router.get('/test', productController.testProduct);
router.get('/', productController.getAllProducts);
router.get('/search', productController.searchProducts); // 🔍 Search Route
router.get('/:id', productController.getProductById);

// ============================================
// ADMIN CHECK (Sirf Admin)
// ============================================
const adminCheck = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'maria-b-super-secret-key-2026');

        if (decoded.role !== 'admin' && decoded.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only admins can perform this action.'
            });
        }

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid token', error: error.message });
    }
};

// ============================================
// ADMIN ROUTES (Sirf Admin)
// ============================================
router.post('/', adminCheck, productController.addProduct);
router.post('/upload-image', adminCheck, upload.single('image'), productController.uploadProductImage); // 📸 Upload Route
router.put('/:id', adminCheck, productController.updateProduct);
router.delete('/:id', adminCheck, productController.deleteProduct);

module.exports = router;