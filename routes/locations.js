const express = require('express');
const router = express.Router();
const Location = require('../models/Location');
const User = require('../models/User');
const { verifyLocationAccess, getUserAccessibleLocationIds } = require('../middleware/scopeByLocation');

// Middleware to mock token validation or use basic auth checks for demo
// Let's implement organization context resolution
const mockAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Auth required' });
    // In real app, verify jwt. In Express demo, fetch first user for simplicity or decode jwt
    const jwt = require('jsonwebtoken');
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'opsfly_premium_secure_jwt_secret_2026');
    req.user = await User.findById(decoded.userId || decoded.id);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

router.use(mockAuth);

// POST /api/locations — create location
router.post('/', async (req, res) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'Manager') {
      return res.status(403).json({ error: 'Forbidden. Owner only.' });
    }

    const { name, address } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Location name is required' });
    }

    const location = await Location.create({
      organizationId: req.user.organizationId,
      name: name.trim(),
      address: address?.trim() || '',
    });

    req.user.locationIds.push(location._id);
    await req.user.save();

    return res.status(201).json(location);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create location', detail: error.message });
  }
});

// GET /api/locations — get locations for current user based on role
router.get('/', async (req, res) => {
  try {
    const accessibleIds = await getUserAccessibleLocationIds(req.user);
    
    let query = { _id: { $in: accessibleIds } };
    if (req.user.role === 'owner') {
      query = { organizationId: req.user.organizationId };
    }

    const locations = await Location.find(query);
    return res.json(locations);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// GET /api/locations/:id — get single location
router.get('/:id', async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) return res.status(404).json({ error: 'Location not found' });

    const accessibleIds = await getUserAccessibleLocationIds(req.user);
    if (!accessibleIds.includes(req.params.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json(location);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch location details' });
  }
});

module.exports = router;
