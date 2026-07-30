const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const User = require('../models/User');
const Note = require('../models/Note');
const CaptureEvent = require('../models/CaptureEvent');
const TenantMemory = require('../models/TenantMemory');
const { analyzeTranscript } = require('../services/analyzer');
const { transcribeAudio } = require('../services/whisper');
const { getSignedFileUrl, hasAwsCredentials } = require('../services/storage');

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

// Downloads the S3 object at fileKey to a local temp file so the existing
// Whisper service (which reads from a local filePath) can transcribe it.
async function downloadToTempFile(fileKey) {
  const signedUrl = await getSignedFileUrl(fileKey, 300);
  const response = await axios.get(signedUrl, { responseType: 'arraybuffer' });
  const tempPath = path.join(os.tmpdir(), `capture-${Date.now()}-${path.basename(fileKey)}`);
  fs.writeFileSync(tempPath, response.data);
  return tempPath;
}

// POST /api/capture
router.post('/', async (req, res) => {
  const { deviceType, captureType, rawPayload = {} } = req.body;

  if (!deviceType || !captureType) {
    return res.status(400).json({ error: 'deviceType and captureType are required' });
  }

  const captureEvent = await CaptureEvent.create({
    organizationId: req.user.organizationId,
    locationId: req.headers['x-location-id'] || null,
    userId: req.user._id,
    deviceType,
    captureType,
    rawPayload,
    processingStatus: 'pending',
  });

  try {
    let transcript = null;
    let source = 'text';

    if (captureType === 'text' && rawPayload.textContent) {
      transcript = rawPayload.textContent;
      source = 'text';
    } else if (captureType === 'voice' && rawPayload.audioFileKey) {
      source = 'voice';
      captureEvent.processingStatus = 'transcribing';
      await captureEvent.save();

      if (!hasAwsCredentials) {
        throw new Error('Cannot transcribe: AWS S3 is not configured (mock storage has no real audio file to download).');
      }

      const tempPath = await downloadToTempFile(rawPayload.audioFileKey);
      try {
        transcript = await transcribeAudio(tempPath, 'audio/m4a');
      } finally {
        fs.unlink(tempPath, () => {});
      }
    } else {
      throw new Error('rawPayload must include textContent for captureType "text" or audioFileKey for captureType "voice"');
    }

    captureEvent.processingStatus = 'analyzing';
    await captureEvent.save();

    const analysis = await analyzeTranscript(transcript, req.user.organizationId);

    const note = await Note.create({
      transcript,
      source,
      issues: analysis.issues || [],
      analyzedAt: new Date(),
      userId: req.user._id,
      locationId: captureEvent.locationId,
      organizationId: req.user.organizationId,
      captureSource: deviceType,
    });

    // Create TenantMemory from saved note (Vault 1) — kept consistent with
    // controllers/notesController.js's saveNote, so every note-creation
    // path builds Vault 1 memory, not just the legacy /api/notes/save one.
    try {
      const memoryContent = `${note.transcript}. Issues detected: ${
        (note.issues || []).map((i) => `${i.categoryKey || i.type}: ${i.quote}`).join(', ')
      }`;

      await TenantMemory.create({
        organizationId: note.organizationId,
        locationId: note.locationId,
        memoryType: 'observation',
        content: memoryContent,
        metadata: {
          sourceNoteId: note._id,
          captureSource: note.captureSource,
          tags: (note.issues || []).map((i) => i.categoryKey || i.type),
        },
      });
    } catch (e) {
      // Don't fail the capture if memory creation fails
      console.error('TenantMemory creation failed:', e.message);
    }

    captureEvent.processingStatus = 'complete';
    captureEvent.resultNoteId = note._id;
    captureEvent.processedAt = new Date();
    await captureEvent.save();

    return res.status(201).json({
      captureEventId: captureEvent._id,
      noteId: note._id,
      status: 'complete',
    });
  } catch (error) {
    captureEvent.processingStatus = 'failed';
    await captureEvent.save();
    return res.status(500).json({
      captureEventId: captureEvent._id,
      status: 'failed',
      error: error.message,
    });
  }
});

// GET /api/capture/:id
router.get('/:id', async (req, res) => {
  try {
    const captureEvent = await CaptureEvent.findById(req.params.id);
    if (!captureEvent) return res.status(404).json({ error: 'CaptureEvent not found' });

    if (captureEvent.organizationId.toString() !== req.user.organizationId.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json(captureEvent);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch capture event', detail: error.message });
  }
});

module.exports = router;
