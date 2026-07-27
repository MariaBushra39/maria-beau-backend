module.exports = (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Vercel serverless function is working!',
    timestamp: new Date().toISOString()
  });
};