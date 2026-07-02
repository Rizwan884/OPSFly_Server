const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendToToken, isFirebaseReady } = require('../services/pushNotifications');

// Mock auth middleware for Express routes
const mockAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Auth required' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'opsfly_premium_secure_jwt_secret_2026');
    req.user = await User.findById(decoded.userId || decoded.id);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// POST /api/test-push
// body: { fcmToken: string, title?: string, body?: string }
//
// Sends a single test push notification directly to the given FCM token,
// bypassing the user/task/note flows. Used for QA to verify the Firebase
// Admin SDK is configured correctly on this deployment and that a real
// device token can receive a push end-to-end.
router.post('/', mockAuth, async (req, res) => {
  const { fcmToken, title, body } = req.body || {};
  if (!fcmToken) return res.status(400).json({ error: 'fcmToken is required' });

  const result = await sendToToken(
    fcmToken,
    title || 'OpsFly Test Notification',
    body || 'This is a test push sent from /api/test-push.',
    { type: 'test_push' }
  );

  return res.status(200).json({
    firebaseConfigured: isFirebaseReady(),
    ...result,
  });
});

module.exports = router;
