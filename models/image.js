const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  metadata: { type: Object },
  s3Key: { type: String, required: true },

  // --- NEW AI FIELDS ---
  caption: { type: String, default: null },          // AI-generated description
  tags: { type: [String], default: [] },          // Rekognition + Gemini labels
  embedding: { type: [Number], default: null },        // 768-dim vector
  aiProcessed: { type: Boolean, default: false },      // flag: has AI run yet?
});

module.exports = mongoose.model('Image', imageSchema);
