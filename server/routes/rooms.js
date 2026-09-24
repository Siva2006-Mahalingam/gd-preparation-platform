const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const auth = require('../middleware/auth');
const { fetchTopic } = require('../services/topicService');

const router = express.Router();

// Generate a short room code
function generateRoomCode() {
  return uuidv4().split('-')[0].toUpperCase();
}

// ── Create Room ─────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { name, isPublic, maxParticipants } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    const max = Math.min(Math.max(parseInt(maxParticipants) || 6, 2), 20);
    const code = generateRoomCode();

    // Fetch topic via API
    const topic = await fetchTopic();

    const result = await db.prepare(
      'INSERT INTO rooms (code, name, topic, host_id, is_public, max_participants, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(code, name.trim(), topic, req.user.id, isPublic ? 1 : 0, max, 'waiting');

    // Add host as participant
    await db.prepare('INSERT INTO room_participants (room_id, user_id) VALUES (?, ?)').run(
      result.lastInsertRowid, req.user.id
    );

    const room = await db.prepare(`
      SELECT r.*, u.username as host_username
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      WHERE r.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({ room });
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// ── Get Room by Code ────────────────────────────────────
router.get('/:code', auth, async (req, res) => {
  try {
    const room = await db.prepare(`
      SELECT r.*, u.username as host_username
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      WHERE r.code = ?
    `).get(req.params.code.toUpperCase());

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.status === 'ended') {
      return res.status(400).json({ error: 'This room has already ended' });
    }

    // Get participant count
    const countResult = await db.prepare(
      'SELECT COUNT(*) as count FROM room_participants WHERE room_id = ?'
    ).get(room.id);
    const participantCount = parseInt(countResult?.count, 10) || 0;

    if (participantCount >= room.max_participants) {
      // Check if user is already a participant
      const isParticipant = await db.prepare(
        'SELECT id FROM room_participants WHERE room_id = ? AND user_id = ?'
      ).get(room.id, req.user.id);

      if (!isParticipant) {
        return res.status(400).json({ error: 'Room is full' });
      }
    }

    // Get participants
    const participants = await db.prepare(`
      SELECT u.id, u.username
      FROM room_participants rp
      JOIN users u ON rp.user_id = u.id
      WHERE rp.room_id = ?
    `).all(room.id);

    res.json({
      room: {
        ...room,
        participant_count: participantCount,
        participants,
      },
    });
  } catch (err) {
    console.error('Get room error:', err);
    res.status(500).json({ error: 'Failed to get room' });
  }
});

// ── List Public Rooms ───────────────────────────────────
router.get('/public/list', auth, async (req, res) => {
  try {
    const rooms = await db.prepare(`
      SELECT r.*, u.username as host_username,
        (SELECT COUNT(*) FROM room_participants WHERE room_id = r.id) as participant_count
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      WHERE r.is_public = 1 AND r.status = 'waiting'
      ORDER BY r.created_at DESC
    `).all();

    res.json({ rooms });
  } catch (err) {
    console.error('List public rooms error:', err);
    res.status(500).json({ error: 'Failed to list rooms' });
  }
});

// ── Join Room ───────────────────────────────────────────
router.post('/:code/join', auth, async (req, res) => {
  try {
    const room = await db.prepare(`
      SELECT r.*, u.username as host_username
      FROM rooms r
      JOIN users u ON r.host_id = u.id
      WHERE r.code = ?
    `).get(req.params.code.toUpperCase());

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.status === 'ended') {
      return res.status(400).json({ error: 'This room has already ended' });
    }

    // Check if already a participant
    const existing = await db.prepare(
      'SELECT id FROM room_participants WHERE room_id = ? AND user_id = ?'
    ).get(room.id, req.user.id);

    if (!existing) {
      const countResult = await db.prepare(
        'SELECT COUNT(*) as count FROM room_participants WHERE room_id = ?'
      ).get(room.id);

      if ((parseInt(countResult?.count, 10) || 0) >= room.max_participants) {
        return res.status(400).json({ error: 'Room is full' });
      }

      await db.prepare('INSERT INTO room_participants (room_id, user_id) VALUES (?, ?)').run(
        room.id, req.user.id
      );
    }

    // If room doesn't have a topic, fetch one
    if (!room.topic) {
      const topic = await fetchTopic();
      await db.prepare('UPDATE rooms SET topic = ? WHERE id = ?').run(topic, room.id);
      room.topic = topic;
    }

    // Get updated participants
    const participants = await db.prepare(`
      SELECT u.id, u.username
      FROM room_participants rp
      JOIN users u ON rp.user_id = u.id
      WHERE rp.room_id = ?
    `).all(room.id);

    res.json({
      room: {
        ...room,
        participant_count: participants.length,
        participants,
      },
    });
  } catch (err) {
    console.error('Join room error:', err);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

module.exports = router;
