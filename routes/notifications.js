const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');

// Mock auth middleware for Express routes
const mockAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Auth required' });
    const jwt = require('jsonwebtoken');
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'opsfly_premium_secure_jwt_secret_2026');
    const User = require('../models/User');
    req.user = await User.findById(decoded.userId || decoded.id);
    if (!req.user || req.user.isActive === false || req.user.deleted === true) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

router.use(mockAuth);

// GET /api/notifications
router.get('/', async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    return res.json(notifications);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PATCH /api/notifications
router.patch('/', async (req, res) => {
  try {
    const { ids } = req.body || {};
    let query = { userId: req.user._id };
    if (ids && Array.isArray(ids)) {
      query._id = { $in: ids };
    }
    await Notification.updateMany(query, { $set: { read: true } });
    const updated = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update notifications' });
  }
});

module.exports = router;
