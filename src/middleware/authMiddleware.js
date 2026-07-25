const jwt = require('jsonwebtoken');

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        console.log('🔍 Auth Header Received:', authHeader); // Debug

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        console.log('🔍 Token Extracted:', token); // Debug

        const decoded = await jwt.verify(token, process.env.JWT_SECRET || 'maria-b-super-secret-key-2026');
        console.log('✅ Decoded User:', decoded); // Debug - Yahan role dekhein!

        req.user = decoded;
        next();
    } catch (error) {
        console.log('❌ Auth Error:', error.message); // Debug
        return res.status(401).json({ success: false, message: 'Invalid or expired token', error: error.message });
    }
};

module.exports = authMiddleware;