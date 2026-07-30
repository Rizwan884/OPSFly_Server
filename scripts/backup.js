require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

async function backup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups', timestamp);

  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    fs.mkdirSync(backupDir, { recursive: true });

    const collections = await mongoose.connection.db.listCollections().toArray();

    if (collections.length === 0) {
      console.warn('⚠️  No collections found to back up.');
    }

    for (const { name } of collections) {
      const docs = await mongoose.connection.db.collection(name).find({}).toArray();
      const filePath = path.join(backupDir, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
      console.log(`  📄 ${name}: ${docs.length} document(s) → ${filePath}`);
    }

    console.log(`BACKUP COMPLETE: ${backupDir}`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Backup failed:', err);
    process.exit(1);
  }
}

backup();
