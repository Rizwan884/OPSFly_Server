require('dotenv').config();
const mongoose = require('mongoose');
const Note = require('../../models/Note');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

async function rollbackNoteIssues() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    const result = await Note.updateMany(
      {},
      { $unset: { 'issues.$[].categoryKey': '', 'issues.$[].severityKey': '' } }
    );

    console.log(`Rolled back categoryKey/severityKey on ${result.modifiedCount} note(s)`);
    process.exit(0);
  } catch (err) {
    console.error('❌ rollbackNoteIssues failed:', err);
    process.exit(1);
  }
}

rollbackNoteIssues();
