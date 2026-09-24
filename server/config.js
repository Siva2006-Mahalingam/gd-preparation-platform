require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'gd-platform-default-secret',

  // Topic API — used to fetch GD topics
  TOPIC_API_URL: process.env.TOPIC_API_URL || '',
  TOPIC_API_KEY: process.env.TOPIC_API_KEY || '',

  // Evaluation API — used for individual AI evaluation
  EVAL_API_URL: process.env.EVAL_API_URL || '',
  EVAL_API_KEY: process.env.EVAL_API_KEY || '',

  // Whisper Transcription API
  WHISPER_API_URL: process.env.WHISPER_API_URL || 'https://api.groq.com/openai/v1/audio/transcriptions',
  WHISPER_API_KEY: process.env.WHISPER_API_KEY || process.env.EVAL_API_KEY || '',
  WHISPER_MODEL: process.env.WHISPER_MODEL || 'whisper-large-v3',
};

// Log warnings for missing API config
if (!module.exports.TOPIC_API_URL) {
  console.warn('⚠️  TOPIC_API_URL is not set. Using fallback topics. Set it in .env');
}
if (!module.exports.EVAL_API_URL) {
  console.warn('⚠️  EVAL_API_URL is not set. Using metrics-based evaluation. Set it in .env');
}
