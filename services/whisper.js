const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Transcribes an audio file using the OpenAI Whisper API.
 *
 * @param {string} filePath  Absolute path to the audio file on disk.
 * @param {string} mimeType  MIME type of the file (e.g. 'audio/webm', 'audio/mp4').
 * @returns {Promise<string>} The transcribed text.
 *
 * M2: After receiving the transcript, pass it to the AI classifier:
 *   const issues = await classifyTranscript(transcript);
 *   return { transcript, issues };
 */
async function transcribeAudio(filePath, mimeType) {
  const fileStream = fs.createReadStream(filePath);

  // Determine filename extension so Whisper identifies the format correctly
  const ext = mimeType === 'audio/mp4' ? 'mp4'
    : mimeType === 'audio/mpeg' ? 'mp3'
    : mimeType === 'audio/ogg' ? 'ogg'
    : 'webm'; // default for Chrome/Android

  const response = await openai.audio.transcriptions.create({
    file: fileStream,
    model: 'whisper-1',
    response_format: 'text',
    // M2: language: 'en',  // optionally pin language
  });

  // openai SDK returns the transcript string directly when response_format is 'text'
  return typeof response === 'string' ? response : response.text;
}

module.exports = { transcribeAudio };
