const Note = require('../models/Note');
const { analyzeTranscript } = require('../services/analyzer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/notes/transcribe
 * Upload audio → Whisper → transcript
 */
const transcribeNote = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const audioPath = req.file.path;
    console.log(`[Transcribe] Processing file: ${audioPath}`);

    // Call Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
    });

    const transcript = transcription.text;
    console.log(`[Transcribe] Whisper result: ${transcript}`);

    // M2: Trigger AI analysis automatically after transcription
    const analysis = await analyzeTranscript(transcript);

    return res.json({ 
      transcript,
      issues: analysis.issues || []
    });
  } catch (error) {
    console.error('Transcription error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Transcription failed', detail: error.message });
  }
};

/**
 * POST /api/notes/analyze
 * Manual trigger for analysis (used for text notes)
 */
const analyzeNote = async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'transcript is required' });
    }
    const analysis = await analyzeTranscript(transcript);
    return res.json(analysis);
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: 'Analysis failed' });
  }
};

/**
 * POST /api/notes/save
 * Saves a note (transcript + issues + metadata) to MongoDB.
 */
const saveNote = async (req, res) => {
  try {
    const { transcript, source = 'voice', rawAudio, issues, analyzedAt } = req.body;

    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'transcript is required' });
    }

    const note = await Note.create({
      transcript: transcript.trim(),
      source,
      rawAudio: rawAudio || null,
      issues: issues || [],
      analyzedAt: analyzedAt || null
    });

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
const getNotes = async (req, res) => {
  try {
    const notes = await Note.find().sort({ createdAt: -1 });
    return res.json(notes);
  } catch (error) {
    console.error('Get notes error:', error);
    return res.status(500).json({ error: 'Failed to fetch notes' });
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
    if (!note) return res.status(404).json({ error: 'Note not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete note error:', error);
    return res.status(500).json({ error: 'Failed to delete note' });
  }
};

module.exports = { transcribeNote, analyzeNote, saveNote, getNotes, deleteNote };
