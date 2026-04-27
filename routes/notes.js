const express = require('express');
const router = express.Router();
const { transcribeNote, saveNote, getNotes, deleteNote } = require('../controllers/notesController');

// POST /api/notes/transcribe — upload audio → Whisper → transcript
router.post('/transcribe', transcribeNote);

// POST /api/notes/save — save transcript to MongoDB
router.post('/save', saveNote);

// GET /api/notes — fetch all notes newest first
router.get('/', getNotes);

// DELETE /api/notes/:id — delete a specific note
router.delete('/:id', deleteNote);

module.exports = router;
