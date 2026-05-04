const axios = require('axios');

/**
 * AI Analyzer Service
 * 
 * This service handles communication with OpenRouter to analyze
 * transcribed text and extract operational issues.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = 'https://openrouter.ai/api/v1';

const MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'openai/gpt-oss-120b:free',
  'tencent/hy3-preview:free',
  'nvidia/nemotron-3-super-120b-a12b:free'
];

const SYSTEM_PROMPT = `You are an operations issue detector for the hospitality industry. 
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

/**
 * Analyzes a transcript using OpenRouter AI models with fallback logic.
 * @param {string} transcript 
 * @returns {Promise<Object>} Analyzed issues
 */
async function analyzeTranscript(transcript) {
  if (!transcript) {
    return { issues: [] };
  }

  // Unified prompt to avoid "system message not supported" errors
  const unifiedPrompt = `${SYSTEM_PROMPT}\n\nTRANSCRIPT TO ANALYZE:\n"${transcript}"`;

  for (const model of MODELS) {
    try {
      console.log(`[Analyzer] Attempting analysis with model: ${model}`);
      
      const response = await axios.post(`${BASE_URL}/chat/completions`, {
        model: model,
        messages: [
          { role: 'user', content: unifiedPrompt }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ops-fly-client.vercel.app',
          'X-Title': 'OpsFly'
        },
        timeout: 20000 // 20s timeout
      });

      const content = response.data.choices[0].message.content;
      console.log(`[Analyzer] Raw AI response from ${model}:`, content);

      try {
        // Handle DeepSeek/R1 "thinking" tags or markdown
        let jsonStr = content.replace(/<think>[\s\S]*?<\/think>/g, '');
        jsonStr = jsonStr.replace(/```json\n?|\n?```/g, '').trim();
        
        // Find the first { and last } to extract JSON if there's surrounding text
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
        }

        const parsed = JSON.parse(jsonStr);
        
        console.log(`[Analyzer] Successfully analyzed using ${model}`);
        
        return parsed;
      } catch (parseError) {
        console.error(`[Analyzer] Failed to parse JSON from ${model}. Raw content length: ${content.length}`);
        continue; // Try next model if parse fails
      }

    } catch (error) {
      const errorData = error.response?.data?.error || error.message;
      console.error(`[Analyzer] Error with model ${model}:`, errorData);
      continue; // Try next model
    }
  }

  console.error('[Analyzer] All models failed to analyze transcript');
  return { issues: [], error: 'All AI models failed' };
}

module.exports = {
  analyzeTranscript
};
