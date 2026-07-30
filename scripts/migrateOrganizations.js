require('dotenv').config();
const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const IndustryConfig = require('../models/IndustryConfig');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

async function migrateOrganizations() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    const restaurantConfig = await IndustryConfig.findOne({ industryType: 'restaurant' });
    if (!restaurantConfig) {
      console.error('❌ No "restaurant" IndustryConfig found. Run seedIndustryConfig.js first.');
      process.exit(1);
    }

    const orgsToUpdate = await Organization.find({
      $or: [{ industryType: { $exists: false } }, { industryType: null }],
    });

    let updatedCount = 0;
    for (const org of orgsToUpdate) {
      org.industryType = 'restaurant';
      if (!org.configTemplateId) {
        org.configTemplateId = restaurantConfig._id;
      }
      await org.save();
      updatedCount++;
    }

    console.log(`✅ Migrated ${updatedCount} organization(s) to industryType: "restaurant"`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Organization migration failed:', err);
    process.exit(1);
  }
}

migrateOrganizations();
