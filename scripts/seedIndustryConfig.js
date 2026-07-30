require('dotenv').config();
const mongoose = require('mongoose');
const IndustryConfig = require('../models/IndustryConfig');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing in environment variables!');
  process.exit(1);
}

// Exact system prompt currently hardcoded in services/analyzer.js.
const ISSUE_DETECTION_PROMPT = `You are an operations issue detector for the hospitality industry.
Analyze the following voice note transcript and extract all operational
issues mentioned.

For each issue return:
- type: category of issue (Staffing | Cost Risk | Maintenance | Other)
- severity: (High | Medium | Low)
- quote: the exact phrase from the transcript that triggered this issue
- suggestedTask: a short actionable task title

Return ONLY a valid JSON object in this exact format, no explanation,
no markdown, no extra text:

{
  "issues": [
    {
      "type": "Staffing",
      "severity": "High",
      "quote": "2 employees didn't show up this morning",
      "suggestedTask": "Review staffing coverage"
    }
  ]
}

If no issues are found return: { "issues": [] }`;

// Exact system prompt currently hardcoded in routes/summary.js's
// callAIForSummary (this repo has no separate summaryGenerator.js —
// the daily-summary prompt lives inline there).
const DAILY_SUMMARY_PROMPT = `You are an operations analyst for a hospitality business.
Given the following list of operational issues detected today, generate a concise daily summary.

Return ONLY valid JSON, no markdown, no explanation:
{
  "keyConcerns": [
    "Short staffing impacted service during lunch and dinner",
    "Bar pour cost is above target"
  ],
  "recommendedActions": [
    "Adjust staffing schedule for tomorrow",
    "Monitor bar pours tonight",
    "Fix entrance presentation"
  ]
}

Keep keyConcerns to max 3 most critical points.
Keep recommendedActions to max 3 actionable items.
Be concise and direct.`;

const PATTERN_RECOGNITION_PROMPT = `Analyze this operational issue and
      extract an anonymous pattern. Remove all identifying
      information including restaurant name, location, owner,
      employees, or specific addresses. Return only the
      operational pattern that could apply to any similar business.`;

const restaurantConfig = {
  industryType: 'restaurant',
  issueCategories: [
    { key: 'staffing', label: 'Staffing Issue', icon: 'users', color: '#EF4444' },
    { key: 'cost_risk', label: 'Cost Risk', icon: 'dollar', color: '#FF8A00' },
    { key: 'maintenance', label: 'Maintenance', icon: 'wrench', color: '#22C55E' },
    { key: 'other', label: 'Other', icon: 'info', color: '#64748B' },
  ],
  severityLevels: [
    { key: 'high', label: 'High', color: '#EF4444' },
    { key: 'medium', label: 'Medium', color: '#FF8A00' },
    { key: 'low', label: 'Low', color: '#22C55E' },
  ],
  departmentTypes: ['Front of House', 'Kitchen', 'Bar', 'Management', 'Maintenance', 'Other'],
  assetCategories: [
    'Kitchen Equipment',
    'Refrigeration',
    'HVAC',
    'POS Systems',
    'Security',
    'Dishwasher',
    'Fryers',
    'Ovens',
    'Ice Machine',
    'Other',
  ],
  vendorCategories: [
    'Food & Beverage',
    'HVAC',
    'Plumbing',
    'Electrical',
    'Pest Control',
    'Linen',
    'Grease',
    'Fire Suppression',
    'Refrigeration',
    'General Maintenance',
    'Other',
  ],
  onboardingPrompts: {
    issueDetection: ISSUE_DETECTION_PROMPT,
    dailySummary: DAILY_SUMMARY_PROMPT,
    patternRecognition: PATTERN_RECOGNITION_PROMPT,
  },
};

async function seedIndustryConfig() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected.');

    const doc = await IndustryConfig.findOneAndUpdate(
      { industryType: 'restaurant' },
      { $set: restaurantConfig },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`✅ IndustryConfig seeded for "restaurant" (_id: ${doc._id})`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding IndustryConfig failed:', err);
    process.exit(1);
  }
}

seedIndustryConfig();
