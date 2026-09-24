const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');
const { evaluateParticipant } = require('../services/evaluationService');

// In-memory state for active rooms
// roomCode -> {
//   participants: Map<socketId, userInfo>,
//   session: {...},
//   currentSpeaker: null | { socketId, userId, username, startTime },
//   gdStarted: boolean,
//   startTime: timestamp
// }
const activeRooms = new Map();

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
    socket.on('join-room', async (roomCode) => {
      try {
        const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
        if (!room) return socket.emit('error-msg', 'Room not found');

        socket.join(roomCode);
        socket.roomCode = roomCode;

        // Initialize room state if needed
        if (!activeRooms.has(roomCode)) {
          activeRooms.set(roomCode, {
            participants: new Map(),
            session: null,
            currentSpeaker: null,
            gdStarted: false,
            startTime: null,
          });
        }

        const roomState = activeRooms.get(roomCode);
        roomState.participants.set(socket.id, {
          id: socket.user.id,
          username: socket.user.username,
          status: (roomState.currentSpeaker && roomState.currentSpeaker.socketId === socket.id) ? 'speaking' : 'ready',
        });

        // Broadcast updated participant list
        broadcastParticipants(io, roomCode);

        // If GD is already active, notify the joining user
        if (roomState.gdStarted) {
          socket.emit('gd-started', {
            startTime: roomState.startTime,
            sessionId: roomState.session?.id,
          });

          // Sync current microphone state
          if (roomState.currentSpeaker) {
            socket.emit('mic-acquired', {
              userId: roomState.currentSpeaker.userId,
              username: roomState.currentSpeaker.username,
              socketId: roomState.currentSpeaker.socketId,
              startTime: roomState.currentSpeaker.startTime,
            });
          } else {
            socket.emit('mic-released');
          }
        }
      } catch (err) {
        console.error('Join room socket error:', err);
        socket.emit('error-msg', 'Failed to join room');
      }
    });

    // ── Start GD ──────────────────────────────────────
    socket.on('start-gd', async (roomCode) => {
      try {
        const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
        if (!room) return socket.emit('error-msg', 'Room not found');
        if (room.host_id !== socket.user.id) return socket.emit('error-msg', 'Only the host can start the GD');

        const roomState = activeRooms.get(roomCode);
        if (!roomState || roomState.gdStarted) return;

        // Create session in DB
        const now = new Date().toISOString();
        const result = await db.prepare(
          'INSERT INTO sessions (room_id, topic, started_at) VALUES (?, ?, ?)'
        ).run(room.id, room.topic, now);

        // Update room status
        await db.prepare("UPDATE rooms SET status = 'active' WHERE id = ?").run(room.id);

        roomState.gdStarted = true;
        roomState.startTime = now;
        roomState.session = { id: result.lastInsertRowid, startTime: now };
        roomState.currentSpeaker = null; // No one gets the mic automatically

        // Reset participant statuses to ready
        for (const [, p] of roomState.participants) {
          p.status = 'ready';
        }

        io.to(roomCode).emit('gd-started', {
          startTime: now,
          sessionId: result.lastInsertRowid,
        });

        // Enable speak button for EVERY participant initially
        io.to(roomCode).emit('mic-released');

        broadcastParticipants(io, roomCode);
        console.log(`🎙️ GD started in room ${roomCode}`);
      } catch (err) {
        console.error('Start GD error:', err);
        socket.emit('error-msg', 'Failed to start GD');
      }
    });

    // ── First-Come-First-Served Microphone Request ────
    socket.on('request-mic', (roomCode) => {
      const roomState = activeRooms.get(roomCode);
      if (!roomState || !roomState.gdStarted) return;

      // Lock check: if someone is already speaking, reject immediately
      if (roomState.currentSpeaker) {
        socket.emit('mic-rejected', {
          speakerUsername: roomState.currentSpeaker.username,
          message: `${roomState.currentSpeaker.username} is currently speaking.`,
        });
        return;
      }

      // First-come gets the lock
      const now = new Date().toISOString();
      roomState.currentSpeaker = {
        socketId: socket.id,
        userId: socket.user.id,
        username: socket.user.username,
        startTime: now,
      };

      const participant = roomState.participants.get(socket.id);
      if (participant) {
        participant.status = 'speaking';
        participant.speakStartTime = now;
      }

      // Immediately notify all participants: mic acquired by this user
      io.to(roomCode).emit('mic-acquired', {
        userId: socket.user.id,
        username: socket.user.username,
        socketId: socket.id,
        startTime: now,
      });

      broadcastParticipants(io, roomCode);
    });

    // Backward compatibility alias for start-speaking
    socket.on('start-speaking', (roomCode) => {
      const roomState = activeRooms.get(roomCode);
      if (!roomState || !roomState.gdStarted) return;

      if (!roomState.currentSpeaker) {
        const now = new Date().toISOString();
        roomState.currentSpeaker = {
          socketId: socket.id,
          userId: socket.user.id,
          username: socket.user.username,
          startTime: now,
        };

        const participant = roomState.participants.get(socket.id);
        if (participant) {
          participant.status = 'speaking';
          participant.speakStartTime = now;
        }

        io.to(roomCode).emit('mic-acquired', {
          userId: socket.user.id,
          username: socket.user.username,
          socketId: socket.id,
          startTime: now,
        });

        broadcastParticipants(io, roomCode);
      }
    });

    // ── Release Microphone / Stop Speaking ────────────
    async function handleReleaseMic({ roomCode, contributionData }) {
      const roomState = activeRooms.get(roomCode);
      if (!roomState || !roomState.gdStarted) return;

      // Only the current speaker can release the microphone
      if (!roomState.currentSpeaker || roomState.currentSpeaker.socketId !== socket.id) {
        return;
      }

      const prevSpeaker = roomState.currentSpeaker;
      roomState.currentSpeaker = null;

      const participant = roomState.participants.get(socket.id);
      if (participant) {
        participant.status = 'ready';
      }

      // Save contribution metadata to DB
      if (roomState.session && contributionData) {
        try {
          const countResult = await db.prepare(
            'SELECT COUNT(*) as count FROM contributions WHERE session_id = ? AND user_id = ?'
          ).get(roomState.session.id, socket.user.id);

          await db.prepare(
            'INSERT INTO contributions (session_id, user_id, start_time, end_time, duration, transcript, contribution_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(
            roomState.session.id,
            socket.user.id,
            contributionData.startTime || prevSpeaker.startTime,
            contributionData.endTime || new Date().toISOString(),
            contributionData.duration || 0,
            contributionData.transcript || null,
            (parseInt(countResult?.count, 10) || 0) + 1
          );
        } catch (err) {
          console.error('Save contribution error:', err);
        }
      }

      // Immediately release microphone lock for EVERY participant
      io.to(roomCode).emit('mic-released', {
        previousSpeakerUsername: prevSpeaker.username,
        userId: prevSpeaker.userId,
      });

      broadcastParticipants(io, roomCode);
    }

    socket.on('release-mic', (data) => handleReleaseMic(data));
    socket.on('stop-speaking', (data) => handleReleaseMic(data));

    // ── End GD ────────────────────────────────────────
    socket.on('end-gd', async (roomCode) => {
      try {
        const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
        if (!room) return socket.emit('error-msg', 'Room not found');
        if (room.host_id !== socket.user.id) return socket.emit('error-msg', 'Only the host can end the GD');

        const roomState = activeRooms.get(roomCode);
        if (!roomState || !roomState.gdStarted || !roomState.session) return;

        // Notify room evaluation is starting
        io.to(roomCode).emit('gd-ending');

        // End session in DB
        const now = new Date().toISOString();
        const durationSec = (new Date(now) - new Date(roomState.startTime)) / 1000;

        await db.prepare(
          'UPDATE sessions SET ended_at = ?, duration = ? WHERE id = ?'
        ).run(now, Math.round(durationSec), roomState.session.id);

        await db.prepare("UPDATE rooms SET status = 'ended' WHERE id = ?").run(room.id);

        // Fetch participants for evaluation
        const participants = await db.prepare(`
          SELECT u.id as user_id, u.username
          FROM room_participants rp
          JOIN users u ON rp.user_id = u.id
          WHERE rp.room_id = ?
        `).all(room.id);

        // Run AI evaluation for each participant
        const evaluationPromises = participants.map(async (participant) => {
          try {
            const contributions = await db.prepare(
              'SELECT transcript, duration, start_time, contribution_order FROM contributions WHERE session_id = ? AND user_id = ? ORDER BY start_time ASC'
            ).all(roomState.session.id, participant.user_id);

            const totalSpeakingTime = contributions.reduce((sum, c) => sum + (c.duration || 0), 0);
            const durations = contributions.map(c => c.duration || 0);
            const timestamps = contributions.map(c =>
              Math.max(0, (new Date(c.start_time) - new Date(roomState.startTime)) / 1000)
            );

            const evalData = {
              username: participant.username,
              topic: room.topic,
              totalParticipants: participants.length,
              contributionCount: contributions.length,
              totalSpeakingTime,
              discussionDuration: durationSec,
              contributionDurations: durations,
              contributionTimestamps: timestamps,
              contributions: contributions.map(c => ({
                order: c.contribution_order,
                duration: c.duration || 0,
                transcript: c.transcript ? c.transcript.trim() : '',
              })),
            };

            const evaluation = await evaluateParticipant(evalData);

            // Store evaluation in DB
            await db.prepare(`
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
              evaluation.content_quality_score, // matches content_score
              evaluation.participation_score,
              evaluation.team_interaction_score, // matches collaboration_score
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
        roomState.currentSpeaker = null;

        console.log(`🏁 GD ended in room ${roomCode}`);
      } catch (err) {
        console.error('End GD error:', err);
        socket.emit('error-msg', 'Failed to end GD');
      }
    });

    // ── Disconnect ────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`❌ ${socket.user.username} disconnected`);

      if (socket.roomCode) {
        const roomState = activeRooms.get(socket.roomCode);
        if (roomState) {
          // If the disconnected user was holding the microphone, release it immediately!
          if (roomState.currentSpeaker && roomState.currentSpeaker.socketId === socket.id) {
            const prevSpeaker = roomState.currentSpeaker;
            roomState.currentSpeaker = null;
            io.to(socket.roomCode).emit('mic-released', {
              previousSpeakerUsername: prevSpeaker.username,
              userId: prevSpeaker.userId,
            });
          }

          roomState.participants.delete(socket.id);
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
        if (roomState.currentSpeaker && roomState.currentSpeaker.socketId === socket.id) {
          const prevSpeaker = roomState.currentSpeaker;
          roomState.currentSpeaker = null;
          io.to(roomCode).emit('mic-released', {
            previousSpeakerUsername: prevSpeaker.username,
            userId: prevSpeaker.userId,
          });
        }

        roomState.participants.delete(socket.id);
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
