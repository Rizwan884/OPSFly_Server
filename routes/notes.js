const express = require('express');
const router = express.Router();
const { transcribeNote, analyzeNote, saveNote, getNotes, deleteNote } = require('../controllers/notesController');

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

// POST /api/notes/transcribe — upload audio → Whisper → transcript
router.post('/transcribe', transcribeNote);

// POST /api/notes/analyze — transcript → OpenRouter → issues
router.post('/analyze', analyzeNote);

// POST /api/notes/save — save transcript + issues to MongoDB
router.post('/save', saveNote);

// GET /api/notes — fetch all notes newest first
router.get('/', getNotes);

// DELETE /api/notes/:id — delete a specific note
router.delete('/:id', deleteNote);

module.exports = router;
