const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Note = require('../models/Note');
const { transcribeAudio } = require('../services/whisper');
const { analyzeTranscript } = require('../services/analyzer');

// ─── Multer config (disk storage for audio uploads) ───────────────────────────
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `audio-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — Whisper limit
}).single('audio');

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/notes/transcribe
 * Accepts an audio file, sends it to Whisper, returns the transcript.
 */
const transcribeNote = (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ error: 'Audio upload failed', detail: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    try {
      const mimeType = req.file.mimetype || 'audio/webm';
      const transcript = await transcribeAudio(req.file.path, mimeType);

      // M2: pass transcript to AI classifier here
      // const issues = await classifyTranscript(transcript);

      // Clean up temp file after successful transcription
      fs.unlink(req.file.path, () => {});

      return res.json({
        transcript,
        rawAudio: req.file.filename, // filename stored for reference
      });
    } catch (error) {
      console.error('--- WHISPER API ERROR ---');
      console.error('Status:', error.status);
      console.error('Type:', error.type);
      console.error('Message:', error.message);
      console.error('Code:', error.code);
      console.error('Full Error:', JSON.stringify(error, null, 2));
      console.error('--------------------------');
      
      fs.unlink(req.file.path, () => {}); // cleanup on error too
      return res.status(500).json({ error: 'Transcription failed', detail: error.message });
    }
  });
};

/**
 * POST /api/notes/analyze
 * Accepts transcript, returns AI-detected issues.
 */
const analyzeNote = async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required for analysis' });
    }

    const result = await analyzeTranscript(transcript);
    return res.json(result);
  } catch (error) {
    console.error('Analyze note error:', error);
    return res.status(500).json({ error: 'Analysis failed', detail: error.message });
  }
};

/**
 * POST /api/notes/save
 * Saves a note (transcript + issues + metadata) to MongoDB.
 */
const saveNote = async (req, res) => {
  try {
    const { transcript, source = 'voice', rawAudio, issues = [], analyzedAt } = req.body;

    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const note = await Note.create({
      transcript: transcript.trim(),
      source,
      rawAudio: rawAudio || null,
      issues,
      analyzedAt: analyzedAt || (issues.length > 0 ? new Date() : null),
    });

    // M3: trigger task creation here
    // trigger task creation here from note._id

    return res.status(201).json({ success: true, note });
  } catch (error) {
    console.error('Save note error:', error);
    return res.status(500).json({ error: 'Failed to save note', detail: error.message });
  }
};

/**
 * GET /api/notes
 * Returns all notes sorted by newest first.
 */
const getNotes = async (_req, res) => {
  try {
    const notes = await Note.find().sort({ createdAt: -1 }).lean();
    return res.json(notes);
  } catch (error) {
    console.error('Get notes error:', error);
    return res.status(500).json({ error: 'Failed to fetch notes', detail: error.message });
  }
};

/**
 * DELETE /api/notes/:id
 * Deletes a specific note.
 */
const deleteNote = async (req, res) => {
  try {
    const { id } = req.params;
    const note = await Note.findByIdAndDelete(id);
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    return res.json({ success: true, message: 'Note deleted' });
  } catch (error) {
    console.error('Delete note error:', error);
    return res.status(500).json({ error: 'Failed to delete note', detail: error.message });
  }
};

/**
 * PUT /api/notes/:id
 * Updates a specific note (e.g. issues or transcript).
 */
const updateNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { issues, transcript } = req.body;
    
    const note = await Note.findByIdAndUpdate(
      id,
      { issues, transcript },
      { new: true }
    );
    
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    return res.json({ success: true, note });
  } catch (error) {
    console.error('Update note error:', error);
    return res.status(500).json({ error: 'Failed to update note', detail: error.message });
  }
};

module.exports = { transcribeNote, analyzeNote, saveNote, getNotes, deleteNote, updateNote };
