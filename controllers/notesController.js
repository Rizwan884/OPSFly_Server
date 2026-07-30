const Note = require('../models/Note');
const User = require('../models/User');
const Location = require('../models/Location');
const Notification = require('../models/Notification');
const TenantMemory = require('../models/TenantMemory');
const { sendPushNotification } = require('../services/pushNotifications');
const { analyzeTranscript } = require('../services/analyzer');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

// TODO: Replace with production OpenAI key when provided
// TODO: Replace with production Gemini key when provided
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

    // Create a file-like object with a proper extension to tell Whisper the format
    const originalName = req.file.originalname || 'audio.m4a';
    const fileStream = fs.createReadStream(audioPath);
    const fileObject = await OpenAI.toFile(fileStream, originalName);

    // Call Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fileObject,
      model: 'whisper-1',
    });

    const transcript = transcription.text;
    console.log(`[Transcribe] Whisper result: ${transcript}`);

    // M2: Trigger AI analysis automatically after transcription
    const analysis = await analyzeTranscript(transcript, req.user.organizationId);

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
    const analysis = await analyzeTranscript(transcript, req.user.organizationId);
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

    const selectedLocationId = req.headers['x-location-id'];
    if (!selectedLocationId) {
      return res.status(400).json({ error: 'x-location-id header is required' });
    }

    // Block note creation if location is inactive or soft-deleted
    const activeLocation = await Location.findById(selectedLocationId);
    if (!activeLocation || activeLocation.deleted || activeLocation.isActive === false) {
      return res.status(403).json({ error: 'This location is inactive and cannot accept new notes.' });
    }

    const note = await Note.create({
      transcript: transcript.trim(),
      source,
      rawAudio: rawAudio || null,
      issues: issues || [],
      analyzedAt: analyzedAt || new Date(),
      userId: req.user._id,
      locationId: selectedLocationId,
      organizationId: req.user.organizationId,
    });

    // Create TenantMemory from saved note (Vault 1)
    try {
      const memoryContent = `${note.transcript}. Issues detected: ${
        (note.issues || []).map(i => `${i.categoryKey || i.type}: ${i.quote}`).join(', ')
      }`;

      await TenantMemory.create({
        organizationId: note.organizationId,
        locationId: note.locationId,
        memoryType: 'observation',
        content: memoryContent,
        metadata: {
          sourceNoteId: note._id,
          captureSource: note.captureSource,
          tags: (note.issues || []).map(i => i.categoryKey || i.type)
        }
      });
    } catch (e) {
      // Don't fail note save if memory creation fails
      console.error('TenantMemory creation failed:', e.message);
    }

    // Trigger notification: note_added
    try {
      const activeLocUsers = await User.find({
        locationIds: selectedLocationId,
        isActive: { $ne: false },
        deleted: { $ne: true },
        _id: { $ne: req.user._id }
      });
      if (activeLocUsers.length > 0) {
        const notificationsToCreate = activeLocUsers.map(u => ({
          userId: u._id,
          type: 'note_added',
          message: `${req.user.name} added a note`,
          relatedNoteId: note._id,
        }));
        await Notification.insertMany(notificationsToCreate);

        // TRIGGER PUSH: notify GM/managers at that location
        const managersToNotify = activeLocUsers.filter(u =>
          ['owner', 'district_manager', 'gm', 'agm', 'Manager'].includes(u.role)
        );
        for (const mgr of managersToNotify) {
          await sendPushNotification(
            mgr._id,
            'New Note Added',
            `${req.user.name} added a note at ${activeLocation.name}`,
            { relatedNoteId: note._id, type: 'note_added' }
          );
        }
      }
    } catch (err) {
      console.error('Failed to create notifications for note', err);
    }

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
    const selectedLocationId = req.headers['x-location-id'];
    if (!selectedLocationId) {
      return res.status(400).json({ error: 'x-location-id header is required' });
    }

    let query = {
      locationId: selectedLocationId
    };

    if (req.user.role === 'department_manager') {
      const deptUsers = await User.find({
        locationIds: selectedLocationId,
        department: req.user.department
      }).select('_id');
      const deptUserIds = deptUsers.map(u => u._id);
      query.userId = { $in: deptUserIds };
    }

    const notes = await Note.find(query).sort({ createdAt: -1 });
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
