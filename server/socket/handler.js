const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');
const { evaluateParticipant } = require('../services/evaluationService');

// In-memory state for active rooms
const activeRooms = new Map(); // roomCode -> { participants: Map<socketId, userInfo>, session: {...}, speakingUser: null }

function initializeSocket(io) {
  // Auth middleware for Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      socket.user = { id: decoded.id, username: decoded.username };
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 ${socket.user.username} connected (${socket.id})`);

    // ── Join Room ─────────────────────────────────────
    socket.on('join-room', (roomCode) => {
      const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
      if (!room) return socket.emit('error-msg', 'Room not found');

      socket.join(roomCode);
      socket.roomCode = roomCode;

      // Initialize room state if needed
      if (!activeRooms.has(roomCode)) {
        activeRooms.set(roomCode, {
          participants: new Map(),
          session: null,
          speakingUser: null,
          gdStarted: false,
          startTime: null,
        });
      }

      const roomState = activeRooms.get(roomCode);
      roomState.participants.set(socket.id, {
        id: socket.user.id,
        username: socket.user.username,
        status: 'ready',
      });

      // Broadcast updated participant list
      broadcastParticipants(io, roomCode);

      // If GD is already active, notify the joining user
      if (roomState.gdStarted) {
        socket.emit('gd-started', {
          startTime: roomState.startTime,
          sessionId: roomState.session?.id,
        });
      }
    });

    // ── Start GD ──────────────────────────────────────
    socket.on('start-gd', (roomCode) => {
      const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
      if (!room) return socket.emit('error-msg', 'Room not found');
      if (room.host_id !== socket.user.id) return socket.emit('error-msg', 'Only the host can start the GD');

      const roomState = activeRooms.get(roomCode);
      if (!roomState || roomState.gdStarted) return;

      // Create session in DB
      const now = new Date().toISOString();
      const result = db.prepare(
        'INSERT INTO sessions (room_id, topic, started_at) VALUES (?, ?, ?)'
      ).run(room.id, room.topic, now);

      // Update room status
      db.prepare("UPDATE rooms SET status = 'active' WHERE id = ?").run(room.id);

      roomState.gdStarted = true;
      roomState.startTime = now;
      roomState.session = { id: result.lastInsertRowid, startTime: now };

      io.to(roomCode).emit('gd-started', {
        startTime: now,
        sessionId: result.lastInsertRowid,
      });

      console.log(`🎙️ GD started in room ${roomCode}`);
    });

    // ── Start Speaking ────────────────────────────────
    socket.on('start-speaking', (roomCode) => {
      const roomState = activeRooms.get(roomCode);
      if (!roomState || !roomState.gdStarted) return;

      // Update speaking status
      const participant = roomState.participants.get(socket.id);
      if (participant) {
        participant.status = 'speaking';
        participant.speakStartTime = new Date().toISOString();
        roomState.speakingUser = socket.id;
      }

      io.to(roomCode).emit('speaking-update', {
        userId: socket.user.id,
        username: socket.user.username,
        status: 'speaking',
      });

      broadcastParticipants(io, roomCode);
    });

    // ── Stop Speaking ─────────────────────────────────
    socket.on('stop-speaking', ({ roomCode, contributionData }) => {
      const roomState = activeRooms.get(roomCode);
      if (!roomState || !roomState.gdStarted) return;

      const participant = roomState.participants.get(socket.id);
      if (participant) {
        participant.status = 'ready';
        if (roomState.speakingUser === socket.id) {
          roomState.speakingUser = null;
        }
      }

      // Save contribution metadata to DB
      if (roomState.session && contributionData) {
        try {
          // Count existing contributions for ordering
          const existingCount = db.prepare(
            'SELECT COUNT(*) as count FROM contributions WHERE session_id = ? AND user_id = ?'
          ).get(roomState.session.id, socket.user.id).count;

          db.prepare(
            'INSERT INTO contributions (session_id, user_id, start_time, end_time, duration, transcript, contribution_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(
            roomState.session.id,
            socket.user.id,
            contributionData.startTime,
            contributionData.endTime,
            contributionData.duration,
            contributionData.transcript || null,
            existingCount + 1
          );
        } catch (err) {
          console.error('Save contribution error:', err);
        }
      }

      io.to(roomCode).emit('speaking-update', {
        userId: socket.user.id,
        username: socket.user.username,
        status: 'ready',
      });

      broadcastParticipants(io, roomCode);
    });

    // ── End GD ────────────────────────────────────────
    socket.on('end-gd', async (roomCode) => {
      const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
      if (!room) return socket.emit('error-msg', 'Room not found');
      if (room.host_id !== socket.user.id) return socket.emit('error-msg', 'Only the host can end the GD');

      const roomState = activeRooms.get(roomCode);
      if (!roomState || !roomState.gdStarted || !roomState.session) return;

      const now = new Date().toISOString();
      const startTime = new Date(roomState.session.startTime);
      const endTime = new Date(now);
      const durationSec = (endTime - startTime) / 1000;

      // Update session
      db.prepare(
        'UPDATE sessions SET ended_at = ?, duration = ? WHERE id = ?'
      ).run(now, Math.round(durationSec), roomState.session.id);

      // Update room status
      db.prepare("UPDATE rooms SET status = 'ended' WHERE id = ?").run(room.id);

      // Notify all participants that evaluation is in progress
      io.to(roomCode).emit('gd-ending', { message: 'Evaluating performance...' });

      // Evaluate each participant individually
      const participants = db.prepare(`
        SELECT DISTINCT rp.user_id, u.username
        FROM room_participants rp
        JOIN users u ON rp.user_id = u.id
        WHERE rp.room_id = ?
      `).all(room.id);

      const evaluationPromises = participants.map(async (participant) => {
        try {
          // Get this participant's contributions
          const contributions = db.prepare(
            'SELECT * FROM contributions WHERE session_id = ? AND user_id = ? ORDER BY contribution_order ASC'
          ).all(roomState.session.id, participant.user_id);

          const contributionDurations = contributions.map(c => c.duration || 0);
          const totalSpeakingTime = contributionDurations.reduce((a, b) => a + b, 0);
          const contributionTimestamps = contributions.map(c => {
            const cs = new Date(c.start_time);
            return (cs - startTime) / 1000;
          });

          const evalData = {
            username: participant.username,
            topic: room.topic,
            totalParticipants: participants.length,
            contributionCount: contributions.length,
            totalSpeakingTime,
            discussionDuration: durationSec,
            contributionDurations,
            contributionTimestamps,
            contributions: contributions.map(c => ({
              order: c.contribution_order,
              duration: c.duration || 0,
              transcript: c.transcript ? c.transcript.trim() : '',
            })),
          };

          const evaluation = await evaluateParticipant(evalData);

          // Store evaluation
          db.prepare(`
            INSERT OR REPLACE INTO evaluations
            (session_id, user_id, overall_score, communication_score, content_score,
             participation_score, collaboration_score, leadership_score,
             strengths, improvements, feedback)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            roomState.session.id,
            participant.user_id,
            evaluation.overall_score,
            evaluation.communication_score,
            evaluation.content_score,
            evaluation.participation_score,
            evaluation.collaboration_score,
            evaluation.leadership_score,
            JSON.stringify(evaluation.strengths),
            JSON.stringify(evaluation.improvements),
            evaluation.feedback
          );

          return { userId: participant.user_id, evaluation };
        } catch (err) {
          console.error(`Evaluation error for ${participant.username}:`, err);
          return { userId: participant.user_id, evaluation: null };
        }
      });

      await Promise.all(evaluationPromises);

      // Notify all participants
      io.to(roomCode).emit('gd-ended', {
        sessionId: roomState.session.id,
        duration: Math.round(durationSec),
      });

      // Cleanup
      roomState.gdStarted = false;
      roomState.session = null;
      roomState.speakingUser = null;

      console.log(`🏁 GD ended in room ${roomCode}`);
    });

    // ── Disconnect ────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`❌ ${socket.user.username} disconnected`);

      if (socket.roomCode) {
        const roomState = activeRooms.get(socket.roomCode);
        if (roomState) {
          roomState.participants.delete(socket.id);
          if (roomState.speakingUser === socket.id) {
            roomState.speakingUser = null;
          }
          broadcastParticipants(io, socket.roomCode);

          if (roomState.participants.size === 0) {
            activeRooms.delete(socket.roomCode);
          }
        }
      }
    });

    // ── Leave Room ────────────────────────────────────
    socket.on('leave-room', (roomCode) => {
      socket.leave(roomCode);

      const roomState = activeRooms.get(roomCode);
      if (roomState) {
        roomState.participants.delete(socket.id);
        if (roomState.speakingUser === socket.id) {
          roomState.speakingUser = null;
        }
        broadcastParticipants(io, roomCode);
      }

      socket.roomCode = null;
    });
  });
}

function broadcastParticipants(io, roomCode) {
  const roomState = activeRooms.get(roomCode);
  if (!roomState) return;

  const participants = [];
  for (const [, userInfo] of roomState.participants) {
    participants.push({
      id: userInfo.id,
      username: userInfo.username,
      status: userInfo.status,
    });
  }

  // De-duplicate by user ID (in case of reconnection)
  const uniqueParticipants = [];
  const seen = new Set();
  for (const p of participants) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      uniqueParticipants.push(p);
    }
  }

  io.to(roomCode).emit('participant-update', uniqueParticipants);
}

module.exports = { initializeSocket };
