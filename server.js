const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ✅ BAS TEST ROUTE (Sab se pehle check karo ke server chal raha hai)
app.get('/', (req, res) => {
  res.send('✅ Maria B. API is LIVE on Vercel!');
});

app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Server is working perfectly!' });
});

// ============================================
// ✅ VERCEL EXPORT (Listen hata diya hai)
// ============================================
module.exports = app;