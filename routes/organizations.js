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

module.exports = router;
