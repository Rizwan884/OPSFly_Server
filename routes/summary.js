const express = require('express');
const router = express.Router();
const User = require('../models/User');
const DailySummary = require('../models/DailySummary');
const Note = require('../models/Note');
const Task = require('../models/Task');
const Location = require('../models/Location');
const axios = require('axios');
const { verifyLocationAccess } = require('../middleware/scopeByLocation');

const mockAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Auth required' });
    const jwt = require('jsonwebtoken');
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'opsfly_premium_secure_jwt_secret_2026');
    req.user = await User.findById(decoded.userId || decoded.id);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

router.use(mockAuth);

const startOfDay = (d) => {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (d) => {
  const date = new Date(d);
  date.setHours(23, 59, 59, 999);
  return date;
};

function parseJSONResponse(content) {
  try {
    let jsonStr = content.replace(/<think>[\s\S]*?<\/think>/g, '');
    jsonStr = jsonStr.replace(/```json\n?|\n?```/g, '').trim();
    
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }
    
    return JSON.parse(jsonStr);
  } catch (parseError) {
    console.error(`[SummaryGenerator] Failed to parse JSON response:`, parseError.message);
    return null;
  }
}

const SUMMARY_SYSTEM_PROMPT = `You are an operations analyst for a hospitality business.
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

async function callAIForSummary(issues) {
  if (!issues.length) return { keyConcerns: [], recommendedActions: [] };

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  const issueList = issues.map(i => `- [${i.severity}] ${i.type}: "${i.quote}"`).join('\n');
  const userPrompt = `${SUMMARY_SYSTEM_PROMPT}\n\nTODAY'S ISSUES:\n${issueList}`;

  if (GEMINI_API_KEY) {
    try {
      console.log('[SummaryGenerator] Attempting summary generation with Google Gemini...');
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
      );

      const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (content) {
        const parsed = parseJSONResponse(content);
        if (parsed) {
          return {
            keyConcerns: parsed.keyConcerns || [],
            recommendedActions: parsed.recommendedActions || [],
          };
        }
      }
    } catch (error) {
      console.error('[SummaryGenerator] Google Gemini API failed:', error.message);
    }
  }

  // Fallback to openrouter if api key exists
  if (OPENROUTER_API_KEY) {
    try {
      console.log('[SummaryGenerator] Attempting OpenRouter fallback...');
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'meta-llama/llama-3.2-3b-instruct:free',
        messages: [{ role: 'user', content: userPrompt }],
      }, {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ops-fly-client.vercel.app',
          'X-Title': 'OpsFly',
        },
        timeout: 25000,
      });

      const content = response.data.choices[0].message.content;
      const parsed = parseJSONResponse(content);
      if (parsed) {
        return {
          keyConcerns: parsed.keyConcerns || [],
          recommendedActions: parsed.recommendedActions || [],
        };
      }
    } catch (error) {
      console.error('[SummaryGenerator] OpenRouter failed:', error.message);
    }
  }

  return { keyConcerns: [], recommendedActions: [] };
}

async function generateDailySummary(date = new Date(), locationId) {
  if (!locationId) {
    throw new Error('locationId is required for generateDailySummary');
  }

  const location = await Location.findById(locationId);
  if (!location) {
    throw new Error('Location not found');
  }

  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const notes = await Note.find({ locationId, createdAt: { $gte: dayStart, $lte: dayEnd } });
  const allIssues = notes.flatMap(n => n.issues || []);

  const counts = { staffing: 0, cost: 0, maintenance: 0, other: 0 };
  allIssues.forEach(issue => {
    const t = (issue.type || '').toLowerCase();
    if (t.includes('staffing'))    counts.staffing++;
    else if (t.includes('cost'))   counts.cost++;
    else if (t.includes('maint'))  counts.maintenance++;
    else                           counts.other++;
  });

  const allTasks = await Task.find({ locationId, createdAt: { $gte: dayStart, $lte: dayEnd } });
  const completedTasks = allTasks.filter(t => t.status === 'completed').length;

  const { keyConcerns, recommendedActions } = await callAIForSummary(allIssues);

  const summary = await DailySummary.findOneAndUpdate(
    { date: dayStart, locationId },
    {
      date: dayStart,
      locationId,
      organizationId: location.organizationId,
      totalIssues:       allIssues.length,
      staffingIssues:    counts.staffing,
      costRisks:         counts.cost,
      maintenanceIssues: counts.maintenance,
      otherIssues:       counts.other,
      totalTasks:        allTasks.length,
      completedTasks,
      keyConcerns,
      recommendedActions,
      rawNoteIds: notes.map(n => n._id),
      generatedAt: new Date(),
    },
    { upsert: true, new: true }
  );

  return summary;
}

// GET /api/summary/today
router.get('/today', async (req, res) => {
  try {
    const locationId = req.headers['x-location-id'];
    if (!locationId) return res.status(400).json({ error: 'x-location-id header missing' });

    const summary = await generateDailySummary(new Date(), locationId);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to generate/fetch summary', detail: error.message });
  }
});

// POST /api/summary/today
router.post('/today', async (req, res) => {
  try {
    const locationId = req.headers['x-location-id'];
    if (!locationId) return res.status(400).json({ error: 'x-location-id header missing' });

    const summary = await generateDailySummary(new Date(), locationId);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to regenerate summary', detail: error.message });
  }
});

// GET /api/summary/list
router.get('/list', async (req, res) => {
  try {
    const locationId = req.headers['x-location-id'];
    if (!locationId) return res.status(400).json({ error: 'x-location-id header missing' });

    const summaries = await DailySummary.find({ locationId })
      .select('date totalIssues totalTasks completedTasks generatedAt')
      .sort({ date: -1 });

    return res.json(summaries);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch summary list', detail: error.message });
  }
});

// GET /api/summary/:date
router.get('/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const locationId = req.headers['x-location-id'];
    if (!locationId) return res.status(400).json({ error: 'x-location-id header missing' });

    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const existing = await DailySummary.findOne({ date: startOfDay(parsed), locationId });
    if (existing) return res.json(existing);

    const generated = await generateDailySummary(parsed, locationId);
    return res.json(generated);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch summary', detail: error.message });
  }
});

module.exports = router;
