const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { db } = require('../db');
const { transcribeAudio } = require('../services/transcriptionService');

const router = express.Router();

// Configure storage for audio uploads
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `speech-${req.user?.id || 'anon'}-${uniqueSuffix}.webm`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

/**
 * POST /api/contributions/upload
 * Uploads audio recording and/or transcript for a speaking contribution.
 */
router.post('/upload', auth, upload.single('audio'), async (req, res) => {
  try {
    const { sessionId, startTime, endTime, duration, clientTranscript } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const audioPath = req.file ? path.relative(path.join(__dirname, '..', '..'), req.file.path) : null;
    let finalTranscript = clientTranscript ? clientTranscript.trim() : null;

    // If client transcript is empty and we have an uploaded audio file, attempt Whisper transcription
    if (!finalTranscript && req.file) {
      try {
        const whisperResult = await transcribeAudio(req.file.path, req.file.originalname);
        if (whisperResult) {
          finalTranscript = whisperResult;
        }
      } catch (sttErr) {
        console.warn('Whisper STT attempt warning:', sttErr.message);
      }
    }

    // Check if a contribution record already exists for this session, user, and start_time (created by socket)
    let contribution = null;
    if (startTime) {
      contribution = await db.prepare(`
        SELECT * FROM contributions
        WHERE session_id = ? AND user_id = ? AND start_time = ?
      `).get(sessionId, req.user.id, startTime);
    }

    if (contribution) {
      // Update existing record
      await db.prepare(`
        UPDATE contributions
        SET audio_path = COALESCE(?, audio_path),
            transcript = COALESCE(?, transcript),
            duration = COALESCE(?, duration),
            end_time = COALESCE(?, end_time)
        WHERE id = ?
      `).run(
        audioPath,
        finalTranscript,
        duration ? parseFloat(duration) : null,
        endTime,
        contribution.id
      );

      return res.json({
        success: true,
        contributionId: contribution.id,
        transcript: finalTranscript,
        audioPath,
      });
    }

    // Otherwise insert new contribution
    const countResult = await db.prepare(
      'SELECT COUNT(*) as count FROM contributions WHERE session_id = ? AND user_id = ?'
    ).get(sessionId, req.user.id);

    const result = await db.prepare(`
      INSERT INTO contributions
      (session_id, user_id, start_time, end_time, duration, audio_path, transcript, contribution_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      req.user.id,
      startTime || new Date().toISOString(),
      endTime || new Date().toISOString(),
      duration ? parseFloat(duration) : 0,
      audioPath,
      finalTranscript,
      (parseInt(countResult?.count, 10) || 0) + 1
    );

    res.json({
      success: true,
      contributionId: result.lastInsertRowid,
      transcript: finalTranscript,
      audioPath,
    });
  } catch (err) {
    console.error('Upload contribution error:', err);
    res.status(500).json({ error: 'Failed to process contribution' });
  }
});

module.exports = router;
