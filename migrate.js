const cloudinary = require('cloudinary').v2;
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 🔥 YOUR CLOUDINARY CREDENTIALS
cloudinary.config({
  cloud_name: 'bvqvahxw',
  api_key: '864735194487412',
  api_secret: 'NBNEHDrFjPVAXftWYEyOcf0rLZk'
});

(async () => {
  try {
    const db = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    console.log('Database connected!');

    // Saare products lo
    const [rows] = await db.query('SELECT id, images FROM products WHERE images IS NOT NULL');

    if (rows.length === 0) {
      console.log('No products found.');
      process.exit(0);
    }

    console.log(`📦 ${rows.length} products mile. Upload shuru...`);

    for (const product of rows) {
      let images = [];

      // 🔥 Handle both JSON array and plain string
      if (typeof product.images === 'string' && product.images.startsWith('[')) {
        images = JSON.parse(product.images);
      } else if (typeof product.images === 'string') {
        // Plain string (comma separated ya single filename)
        images = product.images.split(',').map(s => s.trim()).filter(s => s.length > 0);
      } else if (Array.isArray(product.images)) {
        images = product.images;
      } else {
        console.log(`Unknown format for product ${product.id}: ${typeof product.images}`);
        continue;
      }

      let updated = false;
      let newImages = [];

      for (const img of images) {
        if (img.startsWith('http')) {
          newImages.push(img);
          continue;
        }

        if (img === 'dummy.jpg' || img === '' || img === 'null' || img === 'undefined') {
          newImages.push('https://placehold.co/600x800?text=No+Image');
          continue;
        }

        const filePath = path.join(__dirname, 'uploads', img);

        if (!fs.existsSync(filePath)) {
          console.log(`File not found: ${img}, skip kar rahe hain.`);
          newImages.push('https://placehold.co/600x800?text=Image+Missing');
          continue;
        }

        try {
          const result = await cloudinary.uploader.upload(filePath, {
            folder: 'mariabeau_products'
          });
          console.log(`Upload complete: ${img} -> ${result.secure_url}`);
          newImages.push(result.secure_url);
          updated = true;
        } catch (err) {
          console.error(`Upload fail: ${img}`, err.message);
          newImages.push('https://placehold.co/600x800?text=Upload+Fail');
        }
      }

      if (updated || JSON.stringify(images) !== JSON.stringify(newImages)) {
        await db.query('UPDATE products SET images = ? WHERE id = ?', [
          JSON.stringify(newImages),
          product.id
        ]);
        console.log(`Product ${product.id} update ho gaya.`);
      }
    }

    console.log('Congratulations! Products uploaded successfully to cloudinary and database updated.');
    process.exit(0);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();