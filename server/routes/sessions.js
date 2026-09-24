const express = require('express');
const { db } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

// ── List User's Sessions ────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const sessions = await db.prepare(`
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
router.get('/:id', auth, async (req, res) => {
  try {
    const session = await db.prepare(`
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
    const wasParticipant = await db.prepare(`
      SELECT id FROM room_participants WHERE room_id = (SELECT room_id FROM sessions WHERE id = ?) AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!wasParticipant) {
      return res.status(403).json({ error: 'You were not a participant in this session' });
    }

    // Get this user's evaluation only
    const evaluation = await db.prepare(`
      SELECT * FROM evaluations WHERE session_id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    // Get this user's contributions only
    const contributions = await db.prepare(`
      SELECT id, start_time, end_time, duration, contribution_order, transcript
      FROM contributions
      WHERE session_id = ? AND user_id = ?
      ORDER BY contribution_order ASC
    `).all(req.params.id, req.user.id);

    // Parse JSON fields in evaluation and format 8 criteria
    if (evaluation) {
      try { evaluation.strengths = JSON.parse(evaluation.strengths); } catch { evaluation.strengths = []; }
      try { evaluation.improvements = JSON.parse(evaluation.improvements); } catch { evaluation.improvements = []; }

      const contentQuality = Math.round(Number(evaluation.content_score) || 0);
      const communication = Math.round(Number(evaluation.communication_score) || 0);
      const participation = Math.round(Number(evaluation.participation_score) || 0);
      const teamInteraction = Math.round(Number(evaluation.collaboration_score) || 0);
      const leadership = Math.round(Number(evaluation.leadership_score) || 0);
      const relevance = evaluation.relevance_score != null
        ? Math.round(Number(evaluation.relevance_score))
        : contentQuality;
      const confidence = evaluation.confidence_score != null
        ? Math.round(Number(evaluation.confidence_score))
        : Math.round(((communication + leadership) / 2));
      const overall = Math.round(Number(evaluation.overall_score) || 0);

      evaluation.content_quality_score = contentQuality;
      evaluation.relevance_score = relevance;
      evaluation.team_interaction_score = teamInteraction;
      evaluation.confidence_score = confidence;
      evaluation.overall_performance_score = overall;

      evaluation.criteria_list = [
        {
          key: 'content_quality',
          label: 'Content Quality',
          description: 'Relevance, clarity, reasoning, examples and understanding of the topic',
          score: contentQuality,
        },
        {
          key: 'communication',
          label: 'Communication',
          description: 'Clarity, organization and effectiveness of expression',
          score: communication,
        },
        {
          key: 'participation',
          label: 'Participation',
          description: 'Meaningful contribution and consistency throughout the GD',
          score: participation,
        },
        {
          key: 'relevance',
          label: 'Relevance',
          description: 'Whether the participant stays connected to the GD topic',
          score: relevance,
        },
        {
          key: 'team_interaction',
          label: 'Team Interaction',
          description: "Ability to respond to and build upon other participants' points",
          score: teamInteraction,
        },
        {
          key: 'confidence',
          label: 'Confidence',
          description: 'Delivery characteristics observable from the recorded contribution',
          score: confidence,
        },
        {
          key: 'leadership',
          label: 'Leadership',
          description: 'Initiative, constructive direction and ability to move discussion forward',
          score: leadership,
        },
        {
          key: 'overall_performance',
          label: 'Overall Performance',
          description: 'Overall quality based on the above evidence',
          score: overall,
        },
      ];
    }

    res.json({ session, evaluation, contributions });
  } catch (err) {
    console.error('Get session detail error:', err);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

module.exports = router;
