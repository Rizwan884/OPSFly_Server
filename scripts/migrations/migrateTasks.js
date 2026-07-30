require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../../models/Task');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

const PRIORITY_MAP = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
};

// Idempotent: only touches tasks missing priorityKey, safe to re-run.
async function migrateTasks() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    const tasks = await Task.find({
      $or: [{ priorityKey: { $exists: false } }, { priorityKey: null }],
    });

    let migratedCount = 0;
    for (const task of tasks) {
      task.priorityKey = PRIORITY_MAP[task.priority] || 'medium';
      await task.save();
      migratedCount++;
    }

    console.log(`Migrated ${migratedCount} tasks`);
    process.exit(0);
  } catch (err) {
    console.error('❌ migrateTasks failed:', err);
    process.exit(1);
  }
}

migrateTasks();
