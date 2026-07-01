const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Mock auth middleware for Express routes
const mockAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Auth required' });
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

// POST /api/users/push-token — register push token
router.post('/push-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (token === undefined) return res.status(400).json({ error: 'Token is required' });
    req.user.fcmToken = token || null;
    await req.user.save();
    return res.json({ success: true, message: token ? 'FCM token saved' : 'FCM token cleared' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save FCM token', detail: error.message });
  }
});

// GET /api/users — get users (scoped by role)
router.get('/', async (req, res) => {
  try {
    let query = { organizationId: req.user.organizationId };
    if (req.user.role !== 'owner') {
      const { getUserAccessibleLocationIds } = require('../middleware/scopeByLocation');
      const accessibleLocationIds = await getUserAccessibleLocationIds(req.user);
      query.locationIds = { $in: accessibleLocationIds };
    }
    const users = await User.find(query).select('-password');
    return res.json(users);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users/invite — invite user
router.post('/invite', async (req, res) => {
  try {
    if (!['owner', 'gm', 'Manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden. Owner or GM only.' });
    }

    const { name, email, password, role, locationIds = [], department } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    let finalLocationIds = locationIds;
    if (req.user.role === 'gm' || req.user.role === 'agm') {
      finalLocationIds = [req.user.locationIds[0]];
    }

    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role,
      organizationId: req.user.organizationId,
      locationIds: finalLocationIds,
      department: department || null,
    });

    return res.status(201).json({ success: true, user: newUser });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to invite user', detail: error.message });
  }
});

// PATCH /api/users/:id — update user
router.patch('/:id', async (req, res) => {
  try {
    const isSelf = req.params.id.toString() === req.user._id.toString();
    const isManagement = ['owner', 'district_manager', 'gm', 'agm', 'Manager'].includes(req.user.role);

    if (!isSelf && !isManagement) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    if (targetUser.organizationId?.toString() !== req.user.organizationId?.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, email, role, locationIds, department, isActive, deleted, currentPassword, newPassword } = req.body;

    if (name) {
      targetUser.name = name.trim();
    }

    if (email && email.toLowerCase().trim() !== targetUser.email) {
      const existing = await User.findOne({ email: email.toLowerCase().trim() });
      if (existing) {
        return res.status(409).json({ error: 'Email address already in use' });
      }
      targetUser.email = email.toLowerCase().trim();
    }

    if (newPassword) {
      if (isSelf && !isManagement) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password required' });
        }
        const isMatch = await bcrypt.compare(currentPassword.trim(), targetUser.password);
        if (!isMatch) {
          return res.status(400).json({ error: 'Incorrect current password' });
        }
      }
      targetUser.password = await bcrypt.hash(newPassword.trim(), 10);
    }

    if (isManagement) {
      if (role) {
        if ((req.user.role === 'gm' || req.user.role === 'agm') && ['owner', 'district_manager'].includes(role)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        targetUser.role = role;
      }

      if (locationIds) {
        if (req.user.role === 'gm' || req.user.role === 'agm') {
          targetUser.locationIds = [req.user.locationIds[0]];
        } else {
          targetUser.locationIds = locationIds;
        }
      }

      if (department !== undefined) {
        targetUser.department = department || null;
      }

      if (isActive !== undefined) {
        targetUser.isActive = isActive;
      }

      if (deleted !== undefined) {
        targetUser.deleted = deleted;
        if (deleted === true) {
          targetUser.isActive = false;
        }
      }
    }

    await targetUser.save();
    return res.json({ success: true, user: targetUser });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

module.exports = router;
