const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Organization = require('../models/Organization');
const IndustryConfig = require('../models/IndustryConfig');

const mockAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Auth required' });
    const jwt = require('jsonwebtoken');
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'opsfly_premium_secure_jwt_secret_2026');
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

// GET /api/config — used by frontend to get dynamic categories/labels/colors.
router.get('/', async (req, res) => {
  try {
    const org = await Organization.findById(req.user.organizationId).populate('configTemplateId');

    if (!org || !org.configTemplateId) {
      // Fall back to the default restaurant config so callers always get
      // something usable, even for an org that hasn't been migrated yet.
      const fallback = await IndustryConfig.findOne({ industryType: 'restaurant' });
      if (!fallback) return res.status(404).json({ error: 'No IndustryConfig available' });
      return res.json(fallback);
    }

    return res.json(org.configTemplateId);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch industry config', detail: error.message });
  }
});

module.exports = router;
