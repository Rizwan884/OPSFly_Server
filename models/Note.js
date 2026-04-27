const mongoose = require('mongoose');

/**
 * Note — the core data model for OpsFly.
 *
 * M2: Add an `issues` array field here to store AI-detected issues.
 * M2: Add a `summary` field for the AI-generated daily summary.
 */
const noteSchema = new mongoose.Schema(
  {
    transcript: {
      type: String,
      required: true,
      trim: true,
    },
    rawAudio: {
      type: String, // filename of the uploaded audio file (optional)
      default: null,
    },
    source: {
      type: String,
      enum: ['voice', 'text'],
      default: 'voice',
    },
    // M2: issues: [{ type: String }],
    // M2: summary: { type: String },
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
  }
);

module.exports = mongoose.model('Note', noteSchema);
