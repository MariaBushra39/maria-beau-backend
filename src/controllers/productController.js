const Product = require('../models/productModel');

const productController = {
    // 1. TEST
    testProduct: async (req, res) => {
        try {
            const result = await Product.test();
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    // 2. ADD PRODUCT (UPDATED - subcategory support)
    addProduct: async (req, res) => {
        try {
            const { name, description, price, category, subcategory, sizes, colors, images, stock, is_featured } = req.body;
            await Product.create({
                name,
                description,
                price,
                category,
                subcategory,
                sizes,
                colors,
                images,
                stock,
                is_featured
            });
            res.status(201).json({ success: true, message: 'Product added successfully!' });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to add product', error: error.message });
        }
    },

    // 3. GET ALL PRODUCTS
    getAllProducts: async (req, res) => {
        try {
            const products = await Product.findAll();
            res.json({ success: true, data: products });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to fetch products', error: error.message });
        }
    },

    // 4. GET PRODUCT BY ID
    getProductById: async (req, res) => {
        try {
            const product = await Product.findById(req.params.id);
            if (!product) {
                return res.status(404).json({ success: false, message: 'Product not found' });
            }
            res.json({ success: true, data: product });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to fetch product', error: error.message });
        }
    },

    // 5. UPDATE PRODUCT
    updateProduct: async (req, res) => {
        try {
            await Product.update(req.params.id, req.body);
            res.json({ success: true, message: 'Product updated successfully!' });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to update product', error: error.message });
        }
    },

    // 6. DELETE PRODUCT
    deleteProduct: async (req, res) => {
        try {
            await Product.delete(req.params.id);
            res.json({ success: true, message: 'Product deleted successfully!' });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Failed to delete product', error: error.message });
        }
    },

    // 7. 📸 IMAGE UPLOAD
    uploadProductImage: async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No file uploaded' });
            }
            res.json({
                success: true,
                message: 'Image uploaded successfully!',
                data: {
                    filename: req.file.filename,
                    path: `/uploads/${req.file.filename}`
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
        }
    },

    // 8. 🔍 SEARCH PRODUCTS
    searchProducts: async (req, res) => {
        try {
            const { search, category, minPrice, maxPrice } = req.query;
            const products = await Product.search({ search, category, minPrice, maxPrice });
            res.json({ success: true, data: products });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Search failed', error: error.message });
        }
    }
};

module.exports = productController;