const express = require('express');
const { db } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// ── List User's Sessions ────────────────────────────────
router.get('/', auth, (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT
        s.id, s.topic, s.started_at, s.ended_at, s.duration,
        r.name as room_name, r.code as room_code,
        (SELECT COUNT(DISTINCT rp.user_id) FROM room_participants rp WHERE rp.room_id = s.room_id) as participant_count,
        e.overall_score,
        e.communication_score,
        e.content_score,
        e.participation_score,
        e.collaboration_score,
        e.leadership_score
      FROM sessions s
      JOIN rooms r ON s.room_id = r.id
      LEFT JOIN evaluations e ON e.session_id = s.id AND e.user_id = ?
      WHERE s.room_id IN (
        SELECT room_id FROM room_participants WHERE user_id = ?
      )
      AND s.ended_at IS NOT NULL
      ORDER BY s.started_at DESC
    `).all(req.user.id, req.user.id);

    res.json({ sessions });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// ── Get Session Detail ──────────────────────────────────
router.get('/:id', auth, (req, res) => {
  try {
    const session = db.prepare(`
      SELECT
        s.id, s.topic, s.started_at, s.ended_at, s.duration,
        r.name as room_name, r.code as room_code,
        (SELECT COUNT(DISTINCT rp.user_id) FROM room_participants rp WHERE rp.room_id = s.room_id) as participant_count
      FROM sessions s
      JOIN rooms r ON s.room_id = r.id
      WHERE s.id = ?
    `).get(req.params.id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check user was a participant
    const wasParticipant = db.prepare(`
      SELECT id FROM room_participants WHERE room_id = (SELECT room_id FROM sessions WHERE id = ?) AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!wasParticipant) {
      return res.status(403).json({ error: 'You were not a participant in this session' });
    }

    // Get this user's evaluation only
    const evaluation = db.prepare(`
      SELECT * FROM evaluations WHERE session_id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    // Get this user's contributions only
    const contributions = db.prepare(`
      SELECT id, start_time, end_time, duration, contribution_order, transcript
      FROM contributions
      WHERE session_id = ? AND user_id = ?
      ORDER BY contribution_order ASC
    `).all(req.params.id, req.user.id);

    // Parse JSON fields in evaluation
    if (evaluation) {
      try { evaluation.strengths = JSON.parse(evaluation.strengths); } catch { evaluation.strengths = []; }
      try { evaluation.improvements = JSON.parse(evaluation.improvements); } catch { evaluation.improvements = []; }
    }

    res.json({ session, evaluation, contributions });
  } catch (err) {
    console.error('Get session detail error:', err);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

module.exports = router;
