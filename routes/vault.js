const express = require('express');
const router = express.Router();
const User = require('../models/User');
const TenantMemory = require('../models/TenantMemory');
const AnonymousPattern = require('../models/AnonymousPattern');
const PublicKnowledge = require('../models/PublicKnowledge');

// All vault routes require authentication. organizationId is ALWAYS taken
// from req.user (auth token) — NEVER trust organizationId from the request
// body or params.
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

// ── TENANT MEMORY (Vault 1) ─────────────────────────────────────────────────

// POST /api/vault/memory
router.post('/memory', async (req, res) => {
  try {
    const { content, memoryType, locationId, metadata } = req.body;
    if (!content || !memoryType) {
      return res.status(400).json({ error: 'content and memoryType are required' });
    }

    const memory = await TenantMemory.create({
      organizationId: req.user.organizationId,
      locationId: locationId || undefined,
      memoryType,
      content,
      metadata: metadata || {},
    });

    return res.status(201).json(memory);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create memory', detail: error.message });
  }
});

// GET /api/vault/memory
router.get('/memory', async (req, res) => {
  try {
    const { locationId, memoryType, limit = 20, skip = 0 } = req.query;

    const query = { organizationId: req.user.organizationId };
    if (locationId) query.locationId = locationId;
    if (memoryType) query.memoryType = memoryType;

    const [memories, total] = await Promise.all([
      TenantMemory.find(query)
        .sort({ createdAt: -1 })
        .skip(parseInt(skip, 10) || 0)
        .limit(parseInt(limit, 10) || 20),
      TenantMemory.countDocuments(query),
    ]);

    return res.json({ memories, total });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch memories', detail: error.message });
  }
});

// DELETE /api/vault/memory/:id
router.delete('/memory/:id', async (req, res) => {
  try {
    const memory = await TenantMemory.findById(req.params.id);
    if (!memory) return res.status(404).json({ error: 'Memory not found' });

    if (memory.organizationId.toString() !== req.user.organizationId.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await memory.deleteOne();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete memory', detail: error.message });
  }
});

// ── ANONYMOUS PATTERNS (Vault 2) ─────────────────────────────────────────────

// GET /api/vault/patterns — anonymous by design, no org scoping.
router.get('/patterns', async (req, res) => {
  try {
    const { industryType = 'restaurant', patternType, limit = 10 } = req.query;

    const query = { industryType };
    if (patternType) query.patternType = patternType;

    const patterns = await AnonymousPattern.find(query)
      .sort({ frequency: -1 })
      .limit(parseInt(limit, 10) || 10);

    return res.json(patterns);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch patterns', detail: error.message });
  }
});

// POST /api/vault/patterns — internal use only (M4), no direct client access yet.
router.post('/patterns', async (req, res) => {
  try {
    if (req.body && req.body.organizationId) {
      return res.status(400).json({ error: 'organizationId must never be present on an AnonymousPattern' });
    }

    const { industryType, patternType, patternText, climateZone, metadata } = req.body;
    if (!industryType || !patternType || !patternText) {
      return res.status(400).json({ error: 'industryType, patternType and patternText are required' });
    }

    const pattern = await AnonymousPattern.create({
      industryType,
      patternType,
      patternText,
      climateZone,
      metadata: metadata || {},
    });

    return res.status(201).json(pattern);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create pattern', detail: error.message });
  }
});

// ── PUBLIC KNOWLEDGE (Vault 3) ────────────────────────────────────────────────

// GET /api/vault/knowledge — public, no org scoping.
router.get('/knowledge', async (req, res) => {
  try {
    const { tags, sourceType, industryType = 'restaurant', limit = 10 } = req.query;

    const query = { industryType, isActive: true };
    if (sourceType) query.sourceType = sourceType;
    if (tags) {
      const tagList = Array.isArray(tags) ? tags : tags.split(',');
      query.tags = { $in: tagList };
    }

    const knowledge = await PublicKnowledge.find(query)
      .sort({ publishedDate: -1 })
      .limit(parseInt(limit, 10) || 10);

    return res.json(knowledge);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch public knowledge', detail: error.message });
  }
});

// POST /api/vault/knowledge — admin/seeding only.
// NOTE: this codebase has no dedicated "admin" role (see models/User.js role
// enum) — "owner" is treated as the admin-equivalent role for this endpoint.
router.post('/knowledge', async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Forbidden. Admin only.' });
    }

    const { sourceType, title, content, industryType, tags, sourceUrl, publishedDate } = req.body;
    if (!sourceType || !title || !content) {
      return res.status(400).json({ error: 'sourceType, title and content are required' });
    }

    const knowledge = await PublicKnowledge.create({
      sourceType,
      title,
      content,
      industryType: industryType || 'restaurant',
      tags: tags || [],
      sourceUrl,
      publishedDate,
    });

    return res.status(201).json(knowledge);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create public knowledge', detail: error.message });
  }
});

module.exports = router;
