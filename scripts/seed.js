require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Organization = require('../models/Organization');
const Location = require('../models/Location');
const User = require('../models/User');
const Note = require('../models/Note');
const Task = require('../models/Task');
const DailySummary = require('../models/DailySummary');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

async function seed() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    console.log('🗑️ Dropping existing collections...');
    await Organization.deleteMany({});
    await Location.deleteMany({});
    await User.deleteMany({});
    await Note.deleteMany({});
    await Task.deleteMany({});
    await DailySummary.deleteMany({});
    console.log('✅ Cleaned.');

    // 1. Create Organization
    console.log('🏢 Creating Organization...');
    const org = await Organization.create({
      name: 'Demo Restaurant Group'
    });
    console.log(`✅ Organization created: ${org.name} (${org._id})`);

    // 2. Create Locations
    console.log('📍 Creating Locations...');
    const downtown = await Location.create({
      organizationId: org._id,
      name: 'Downtown Location',
      address: '100 Main Street, Downtown'
    });
    const uptown = await Location.create({
      organizationId: org._id,
      name: 'Uptown Location',
      address: '250 High Street, Uptown'
    });
    const airport = await Location.create({
      organizationId: org._id,
      name: 'Airport Location',
      address: 'Terminal 2, Airport'
    });
    console.log('✅ Locations created.');

    // 3. Hash passwords
    console.log('🔑 Hashing passwords...');
    const passwordHash = await bcrypt.hash('password123', 10);

    // 4. Create Users
    console.log('👤 Creating Users...');
    
    // owner
    const owner = await User.create({
      name: 'Fred Owner',
      email: 'owner@demo.com',
      password: passwordHash,
      role: 'owner',
      organizationId: org._id,
      locationIds: [downtown._id, uptown._id, airport._id]
    });

    // district_manager
    const district = await User.create({
      name: 'Diana District',
      email: 'district@demo.com',
      password: passwordHash,
      role: 'district_manager',
      organizationId: org._id,
      locationIds: [downtown._id, uptown._id]
    });

    // gm
    const gm = await User.create({
      name: 'George GM',
      email: 'gm@demo.com',
      password: passwordHash,
      role: 'gm',
      organizationId: org._id,
      locationIds: [downtown._id]
    });

    // agm
    const agm = await User.create({
      name: 'Alex AGM',
      email: 'agm@demo.com',
      password: passwordHash,
      role: 'agm',
      organizationId: org._id,
      locationIds: [downtown._id]
    });

    // department manager 1 (FOH)
    const foh = await User.create({
      name: 'Fiona FOH',
      email: 'foh@demo.com',
      password: passwordHash,
      role: 'department_manager',
      organizationId: org._id,
      locationIds: [downtown._id],
      department: 'Front of House'
    });

    // department manager 2 (Kitchen)
    const kitchen = await User.create({
      name: 'Kevin Kitchen',
      email: 'kitchen@demo.com',
      password: passwordHash,
      role: 'department_manager',
      organizationId: org._id,
      locationIds: [downtown._id],
      department: 'Kitchen'
    });

    console.log('✅ Users created successfully.');
    
    // Create some initial dummy notes and tasks to make the demo populated and interactive
    console.log('📝 Creating initial seed notes & tasks...');
    
    // Downtown note
    const note1 = await Note.create({
      transcript: 'The dishwasher in the kitchen is leaking water and we have a very busy dinner service tonight. Need to get it fixed ASAP.',
      source: 'voice',
      locationId: downtown._id,
      organizationId: org._id,
      userId: kitchen._id,
      issues: [
        {
          type: 'Maintenance',
          severity: 'High',
          quote: 'dishwasher in the kitchen is leaking water',
          suggestedTask: 'Repair kitchen dishwasher leak'
        }
      ],
      analyzedAt: new Date()
    });

    // Downtown task
    await Task.create({
      title: 'Repair kitchen dishwasher leak',
      priority: 'High',
      status: 'open',
      sourceNoteId: note1._id,
      sourceIssueType: 'Maintenance',
      userId: kitchen._id,
      locationId: downtown._id,
      organizationId: org._id,
      assignedTo: kitchen._id,
      assignedBy: gm._id
    });

    // Uptown note
    const note2 = await Note.create({
      transcript: 'Wait times at Uptown host stand are too high. Need to staff an extra host for the weekend shift.',
      source: 'text',
      locationId: uptown._id,
      organizationId: org._id,
      userId: district._id,
      issues: [
        {
          type: 'Staffing',
          severity: 'Medium',
          quote: 'Need to staff an extra host for the weekend shift',
          suggestedTask: 'Schedule extra host for host stand'
        }
      ],
      analyzedAt: new Date()
    });

    await Task.create({
      title: 'Schedule extra host for host stand',
      priority: 'Medium',
      status: 'open',
      sourceNoteId: note2._id,
      sourceIssueType: 'Staffing',
      userId: district._id,
      locationId: uptown._id,
      organizationId: org._id
    });

    console.log('🎉 Seeding successfully completed!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seed();
