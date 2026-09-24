const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Transcribe an audio file using configured Whisper API.
 * Supports Groq Whisper or OpenAI-compatible Whisper endpoints.
 * Returns the transcribed text string, or null on failure.
 *
 * @param {string} filePath - Absolute or relative path to the audio file
 * @param {string} [filename='audio.webm'] - Original filename
 * @returns {Promise<string|null>}
 */
async function transcribeAudio(filePath, filename = 'audio.webm') {
  if (!config.WHISPER_API_KEY) {
    console.log('ℹ️ Whisper API key not configured. Skipping server transcription.');
    return null;
  }

  try {
    if (!fs.existsSync(filePath)) {
      console.warn('Transcription error: audio file not found at', filePath);
      return null;
    }

    const fileBuffer = fs.readFileSync(filePath);
    if (!fileBuffer || fileBuffer.length === 0) {
      console.warn('Transcription warning: audio file is empty');
      return null;
    }

    // Determine mime type
    const ext = path.extname(filename).toLowerCase();
    const mimeType = ext === '.wav' ? 'audio/wav'
      : ext === '.mp3' ? 'audio/mpeg'
      : ext === '.m4a' ? 'audio/m4a'
      : 'audio/webm';

    const fileBlob = new Blob([fileBuffer], { type: mimeType });
    const formData = new FormData();
    formData.append('file', fileBlob, filename);
    formData.append('model', config.WHISPER_MODEL || 'whisper-large-v3');
    formData.append('response_format', 'json');

    const response = await fetch(config.WHISPER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.WHISPER_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Whisper API returned status ${response.status}:`, errorText);
      return null;
    }

    const data = await response.json();
    const transcript = data.text ? data.text.trim() : null;
    return transcript || null;
  } catch (err) {
    console.warn('⚠️ Server transcription error:', err.message);
    return null;
  }
}

module.exports = { transcribeAudio };
