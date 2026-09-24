const express = require('express');
const { db } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// ── Get Performance Summary ─────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const stats = await db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        COALESCE(AVG(e.overall_score), 0) as avg_score,
        COALESCE(MAX(e.overall_score), 0) as best_score,
        COALESCE(
          (SELECT e2.overall_score FROM evaluations e2
           JOIN sessions s2 ON e2.session_id = s2.id
           WHERE e2.user_id = ?
           ORDER BY s2.started_at DESC LIMIT 1), 0
        ) as latest_score
      FROM evaluations e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.user_id = ? AND s.ended_at IS NOT NULL
    `).get(req.user.id, req.user.id);

    const contributionStats = await db.prepare(`
      SELECT
        COUNT(*) as total_contributions,
        COALESCE(SUM(c.duration), 0) as total_speaking_time
      FROM contributions c
      JOIN sessions s ON c.session_id = s.id
      WHERE c.user_id = ? AND s.ended_at IS NOT NULL
    `).get(req.user.id);

    res.json({
      total_sessions: parseInt(stats.total_sessions, 10) || 0,
      avg_score: Math.round((parseFloat(stats.avg_score) || 0) * 10) / 10,
      best_score: Math.round(parseFloat(stats.best_score) || 0),
      latest_score: Math.round(parseFloat(stats.latest_score) || 0),
      total_contributions: parseInt(contributionStats.total_contributions, 10) || 0,
      total_speaking_time: Math.round(parseFloat(contributionStats.total_speaking_time) || 0),
    });
  } catch (err) {
    console.error('Performance stats error:', err);
    res.status(500).json({ error: 'Failed to get performance' });
  }
});

// ── Get Performance History (for charts) ────────────────
router.get('/history', auth, async (req, res) => {
  try {
    const history = await db.prepare(`
      SELECT
        s.id as session_id,
        s.topic,
        s.started_at,
        e.overall_score,
        e.communication_score,
        e.content_score,
        e.participation_score,
        e.collaboration_score,
        e.leadership_score
      FROM evaluations e
      JOIN sessions s ON e.session_id = s.id
      WHERE e.user_id = ? AND s.ended_at IS NOT NULL
      ORDER BY s.started_at ASC
    `).all(req.user.id);

    res.json({ history });
  } catch (err) {
    console.error('Performance history error:', err);
    res.status(500).json({ error: 'Failed to get performance history' });
  }
});

module.exports = router;
