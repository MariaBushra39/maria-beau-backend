const db = require('../config/db');

const Product = {
    // 1. TEST
    test: async () => {
        return { message: 'Product model is working!' };
    },

    // 2. ADD PRODUCT
    create: async (data) => {
    const { name, description, price, category, subcategory, sizes, colors, images, stock, is_featured } = data;
    const [result] = await db.query(
        `INSERT INTO products (id, name, description, price, category, subcategory, sizes, colors, images, stock, is_featured)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, description, price, category, subcategory, JSON.stringify(sizes), JSON.stringify(colors), JSON.stringify(images), stock, is_featured || false]
    );
    return result;
},

    // 3. GET ALL PRODUCTS
    findAll: async () => {
        const [rows] = await db.query(`SELECT * FROM products ORDER BY created_at DESC`);
        return rows;
    },

    // 4. GET PRODUCT BY ID
    findById: async (id) => {
        const [rows] = await db.query(`SELECT * FROM products WHERE id = ?`, [id]);
        return rows[0];
    },

    // 5. UPDATE PRODUCT
    update: async (id, data) => {
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(data)) {
            if (['sizes', 'colors', 'images'].includes(key)) {
                fields.push(`${key} = ?`);
                values.push(JSON.stringify(value));
            } else {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }
        values.push(id);
        const [result] = await db.query(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
        return result;
    },

    // 6. DELETE PRODUCT
    delete: async (id) => {
        const [result] = await db.query(`DELETE FROM products WHERE id = ?`, [id]);
        return result;
    },

    // 7. SEARCH PRODUCTS (Naya function)
    search: async (filters) => {
        let query = 'SELECT * FROM products WHERE 1=1';
        const values = [];

        if (filters.search) {
            query += ' AND name LIKE ?';
            values.push(`%${filters.search}%`);
        }
        if (filters.category) {
            query += ' AND category = ?';
            values.push(filters.category);
        }
        if (filters.minPrice) {
            query += ' AND price >= ?';
            values.push(parseFloat(filters.minPrice));
        }
        if (filters.maxPrice) {
            query += ' AND price <= ?';
            values.push(parseFloat(filters.maxPrice));
        }

        query += ' ORDER BY created_at DESC';
        
        const [rows] = await db.query(query, values);
        return rows;
    }
};

module.exports = Product;