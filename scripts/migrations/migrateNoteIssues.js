require('dotenv').config();
const mongoose = require('mongoose');
const Note = require('../../models/Note');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

const CATEGORY_MAP = {
  Staffing: 'staffing',
  'Cost Risk': 'cost_risk',
  Maintenance: 'maintenance',
  Other: 'other',
};

const SEVERITY_MAP = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
};

// Idempotent: only touches issues missing categoryKey, safe to re-run.
async function migrateNoteIssues() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    const notes = await Note.find({ 'issues.0': { $exists: true } });

    let notesMigrated = 0;
    let issuesUpdated = 0;

    for (const note of notes) {
      let changed = false;

      note.issues.forEach((issue) => {
        if (issue.type && !issue.categoryKey) {
          issue.categoryKey = CATEGORY_MAP[issue.type] || 'other';
          changed = true;
          issuesUpdated++;
        }
        if (issue.severity && !issue.severityKey) {
          issue.severityKey = SEVERITY_MAP[issue.severity] || 'medium';
          changed = true;
        }
      });

      if (changed) {
        await note.save();
        notesMigrated++;
      }
    }

    console.log(`Migrated ${notesMigrated} notes, ${issuesUpdated} issues updated`);
    process.exit(0);
  } catch (err) {
    console.error('❌ migrateNoteIssues failed:', err);
    process.exit(1);
  }
}

migrateNoteIssues();
