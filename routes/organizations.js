const express = require('express');
const router = express.Router();
const Organization = require('../models/Organization');

// POST /api/organizations — create organization
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Organization name is required' });
    }
    const org = await Organization.create({ name: name.trim() });
    return res.status(201).json(org);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create organization', detail: error.message });
  }
});

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

// GET /api/organizations/:id — get organization details
router.get('/:id', async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    return res.json(org);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch organization details' });
  }
});

// PATCH /api/organizations/:id — update organization details
router.patch('/:id', mockAuth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Forbidden. Owner only.' });
    }

    const { name, industry } = req.body;
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    if (name) org.name = name.trim();
    if (industry) org.industry = industry;

    await org.save();
    return res.json({ success: true, organization: org });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update organization details', detail: error.message });
  }
});

module.exports = router;
