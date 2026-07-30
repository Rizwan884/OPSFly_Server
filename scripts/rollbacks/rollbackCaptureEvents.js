require('dotenv').config();
const mongoose = require('mongoose');
const CaptureEvent = require('../../models/CaptureEvent');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

// Deletes ALL CaptureEvent documents. Destructive — requires an explicit
// --confirm flag (`node rollbackCaptureEvents.js --confirm`) or it only
// reports how many documents WOULD be deleted, without touching anything.
async function rollbackCaptureEvents() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    const count = await CaptureEvent.countDocuments({});
    const confirmed = process.argv.includes('--confirm');

    if (!confirmed) {
      console.log(`⚠️  DRY RUN: ${count} CaptureEvent document(s) would be deleted.`);
      console.log('   Re-run with --confirm to actually delete them.');
      process.exit(0);
    }

    const result = await CaptureEvent.deleteMany({});
    console.log(`Deleted ${result.deletedCount} CaptureEvent document(s)`);
    process.exit(0);
  } catch (err) {
    console.error('❌ rollbackCaptureEvents failed:', err);
    process.exit(1);
  }
}

rollbackCaptureEvents();
