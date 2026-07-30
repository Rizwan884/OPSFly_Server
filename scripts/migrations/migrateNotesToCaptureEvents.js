require('dotenv').config();
const mongoose = require('mongoose');
const Note = require('../../models/Note');
const CaptureEvent = require('../../models/CaptureEvent');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

// Idempotent: only creates a CaptureEvent for notes that don't already
// have one referencing them via resultNoteId, safe to re-run.
async function migrateNotesToCaptureEvents() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    const existingResultNoteIds = await CaptureEvent.distinct('resultNoteId');
    const existingSet = new Set(existingResultNoteIds.map((id) => id?.toString()));

    const notes = await Note.find({});

    let createdCount = 0;
    let skippedCount = 0;
    for (const note of notes) {
      if (existingSet.has(note._id.toString())) continue;

      if (!note.organizationId || !note.userId) {
        console.warn(`  ⚠️  Skipping note ${note._id} — missing required organizationId or userId`);
        skippedCount++;
        continue;
      }

      await CaptureEvent.create({
        organizationId: note.organizationId,
        locationId: note.locationId,
        userId: note.userId,
        deviceType: 'mobile_ios',
        captureType: note.source === 'voice' ? 'voice' : 'text',
        processingStatus: 'complete',
        resultNoteId: note._id,
        capturedAt: note.createdAt,
        processedAt: note.createdAt,
      });
      createdCount++;
    }

    console.log(`Created ${createdCount} CaptureEvents (${skippedCount} note(s) skipped due to missing required fields)`);
    process.exit(0);
  } catch (err) {
    console.error('❌ migrateNotesToCaptureEvents failed:', err);
    process.exit(1);
  }
}

migrateNotesToCaptureEvents();
