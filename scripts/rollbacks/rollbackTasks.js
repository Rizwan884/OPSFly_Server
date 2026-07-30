require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../../models/Task');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

async function rollbackTasks() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    const result = await Task.updateMany({}, { $unset: { priorityKey: '' } });

    console.log(`Rolled back priorityKey on ${result.modifiedCount} task(s)`);
    process.exit(0);
  } catch (err) {
    console.error('❌ rollbackTasks failed:', err);
    process.exit(1);
  }
}

rollbackTasks();
