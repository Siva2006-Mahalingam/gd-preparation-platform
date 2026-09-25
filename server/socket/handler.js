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
            endTime: roomState.endTime,
            durationSeconds: roomState.durationSeconds,
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

    // Live interim transcript stream from active speaker
    socket.on('speech-transcript', ({ roomCode, transcript }) => {
      const roomState = activeRooms.get(roomCode);
      if (roomState && roomState.currentSpeaker && roomState.currentSpeaker.socketId === socket.id) {
        roomState.currentSpeaker.lastTranscript = transcript;
      }
    });

    // ── Start GD with Duration / Synchronized Timer ────
    socket.on('start-gd', async (data) => {
      try {
        const roomCode = typeof data === 'string' ? data : data?.roomCode;
        const requestedDuration = typeof data === 'object' ? parseInt(data?.durationMinutes, 10) : 15;
        const durationMinutes = Math.min(Math.max(isNaN(requestedDuration) ? 15 : requestedDuration, 1), 120);
        const durationSeconds = durationMinutes * 60;

        const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
        if (!room) return socket.emit('error-msg', 'Room not found');
        if (room.host_id !== socket.user.id) return socket.emit('error-msg', 'Only the host can start the GD');

        const roomState = activeRooms.get(roomCode);
        if (!roomState || roomState.gdStarted) return;

        // Create session in DB
        const now = new Date().toISOString();
        const endTime = new Date(Date.now() + durationSeconds * 1000).toISOString();

        const result = await db.prepare(
          'INSERT INTO sessions (room_id, topic, started_at) VALUES (?, ?, ?)'
        ).run(room.id, room.topic, now);

        // Update room status
        await db.prepare("UPDATE rooms SET status = 'active' WHERE id = ?").run(room.id);

        roomState.gdStarted = true;
        roomState.startTime = now;
        roomState.endTime = endTime;
        roomState.durationSeconds = durationSeconds;
        roomState.durationMinutes = durationMinutes;
        roomState.session = { id: result.lastInsertRowid, startTime: now };
        roomState.currentSpeaker = null; // No one gets the mic automatically
        roomState.isEnding = false;

        // Reset participant statuses to ready
        for (const [, p] of roomState.participants) {
          p.status = 'ready';
        }

        // Cancel any pending timer
        if (roomState.autoEndTimer) {
          clearTimeout(roomState.autoEndTimer);
          roomState.autoEndTimer = null;
        }

        // Automatically end GD when timer reaches zero
        roomState.autoEndTimer = setTimeout(async () => {
          console.log(`⏰ Timer reached zero for room ${roomCode} (${durationMinutes}m). Auto-ending GD.`);
          await executeEndGd(io, roomCode, 'timer_expired');
        }, durationSeconds * 1000);

        io.to(roomCode).emit('gd-started', {
          startTime: now,
          endTime,
          durationSeconds,
          durationMinutes,
          sessionId: result.lastInsertRowid,
        });

        // Enable speak button for EVERY participant initially
        io.to(roomCode).emit('mic-released');

        broadcastParticipants(io, roomCode);
        console.log(`🎙️ GD started in room ${roomCode} for ${durationMinutes} mins (Timer starts automatically)`);
      } catch (err) {
        console.error('Start GD error:', err);
        socket.emit('error-msg', 'Failed to start GD');
      }
    });

    // ── First-Come-First-Served Microphone Request ────
    socket.on('request-mic', (roomCode) => {
      const roomState = activeRooms.get(roomCode);
      if (!roomState || !roomState.gdStarted || roomState.isEnding) {
        socket.emit('mic-rejected', {
          message: 'The discussion has ended or is not active.',
        });
        return;
      }

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

    // ── End GD (Manual Host Action) ──────────────────
    socket.on('end-gd', async (roomCode) => {
      try {
        const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
        if (!room) return socket.emit('error-msg', 'Room not found');
        if (room.host_id !== socket.user.id) return socket.emit('error-msg', 'Only the host can end the GD');

        await executeEndGd(io, roomCode, 'host_manual');
      } catch (err) {
        console.error('End GD error:', err);
        socket.emit('error-msg', 'Failed to end GD');
      }
    });

    // ── Disconnect ────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`❌ ${socket.user.username} disconnected`);
      if (socket.roomCode) {
        handleUserLeaving(io, socket, socket.roomCode);
      }
    });

    // ── Leave Room (Participant Permission) ────────────
    socket.on('leave-room', (roomCode) => {
      socket.leave(roomCode);
      handleUserLeaving(io, socket, roomCode);
      socket.roomCode = null;
    });
  });
}

/**
 * Handle participant leaving or disconnecting.
 * - If participant leaves while speaking, automatically save their contribution and release mic lock.
 * - Remaining participants continue the GD normally.
 * - Leaving room does NOT end the GD.
 */
async function handleUserLeaving(io, socket, roomCode) {
  const roomState = activeRooms.get(roomCode);
  if (!roomState) return;

  // If the leaving user was currently holding the microphone, auto-save contribution & release lock
  if (roomState.currentSpeaker && roomState.currentSpeaker.socketId === socket.id) {
    const prevSpeaker = roomState.currentSpeaker;
    roomState.currentSpeaker = null;

    if (roomState.session) {
      try {
        const now = new Date().toISOString();
        const durationSec = Math.max(0.5, (new Date(now) - new Date(prevSpeaker.startTime)) / 1000);
        const countResult = await db.prepare(
          'SELECT COUNT(*) as count FROM contributions WHERE session_id = ? AND user_id = ?'
        ).get(roomState.session.id, prevSpeaker.userId);

        await db.prepare(
          'INSERT INTO contributions (session_id, user_id, start_time, end_time, duration, transcript, contribution_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          roomState.session.id,
          prevSpeaker.userId,
          prevSpeaker.startTime,
          now,
          durationSec,
          prevSpeaker.lastTranscript || '[Contribution before leaving room]',
          (parseInt(countResult?.count, 10) || 0) + 1
        );
        console.log(`💾 Auto-saved speaking contribution for ${prevSpeaker.username} upon leaving room`);
      } catch (saveErr) {
        console.error('Error auto-saving contribution on leave:', saveErr);
      }
    }

    // Release microphone lock for all remaining participants
    io.to(roomCode).emit('mic-released', {
      previousSpeakerUsername: prevSpeaker.username,
      userId: prevSpeaker.userId,
    });
  }

  roomState.participants.delete(socket.id);
  broadcastParticipants(io, roomCode);

  if (roomState.participants.size === 0) {
    if (roomState.autoEndTimer) {
      clearTimeout(roomState.autoEndTimer);
      roomState.autoEndTimer = null;
    }
    activeRooms.delete(roomCode);
  }
}

/**
 * Conclude GD discussion: handles both Timer Reaching Zero and Host Manual End.
 * - Stops accepting new speaking turns.
 * - Stops current speaking session if active & saves contribution.
 * - Evaluates all participants on 8 criteria.
 * - Emits gd-ended with sessionId.
 */
async function executeEndGd(io, roomCode, triggerReason = 'host_manual') {
  const roomState = activeRooms.get(roomCode);
  if (!roomState || !roomState.gdStarted || !roomState.session || roomState.isEnding) return;

  roomState.isEnding = true;

  // Clear pending timer
  if (roomState.autoEndTimer) {
    clearTimeout(roomState.autoEndTimer);
    roomState.autoEndTimer = null;
  }

  // 1. If someone is speaking, stop them and save their contribution
  if (roomState.currentSpeaker) {
    const speaker = roomState.currentSpeaker;
    roomState.currentSpeaker = null;

    try {
      const now = new Date().toISOString();
      const durSec = Math.max(0.5, (new Date(now) - new Date(speaker.startTime)) / 1000);

      const countResult = await db.prepare(
        'SELECT COUNT(*) as count FROM contributions WHERE session_id = ? AND user_id = ?'
      ).get(roomState.session.id, speaker.userId);

      await db.prepare(
        'INSERT INTO contributions (session_id, user_id, start_time, end_time, duration, transcript, contribution_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        roomState.session.id,
        speaker.userId,
        speaker.startTime,
        now,
        durSec,
        speaker.lastTranscript || '[Contribution completed as discussion ended]',
        (parseInt(countResult?.count, 10) || 0) + 1
      );
    } catch (saveErr) {
      console.error('Error auto-saving final speaker contribution on GD end:', saveErr);
    }
  }

  // 2. Notify all participants that evaluation is beginning
  io.to(roomCode).emit('gd-ending', { reason: triggerReason });

  // 3. Mark session and room ended in DB
  const now = new Date().toISOString();
  const actualDurationSec = (new Date(now) - new Date(roomState.startTime)) / 1000;

  try {
    const room = await db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
    if (!room) return;

    await db.prepare(
      'UPDATE sessions SET ended_at = ?, duration = ? WHERE id = ?'
    ).run(now, Math.round(actualDurationSec), roomState.session.id);

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
          discussionDuration: actualDurationSec,
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

    // Notify all participants with sessionId to view results
    io.to(roomCode).emit('gd-ended', {
      sessionId: roomState.session.id,
      duration: Math.round(actualDurationSec),
      reason: triggerReason,
    });

    console.log(`🏁 GD ended in room ${roomCode} (${triggerReason})`);
  } catch (err) {
    console.error('Error during executeEndGd:', err);
    io.to(roomCode).emit('error-msg', 'Error processing GD conclusion');
  } finally {
    roomState.gdStarted = false;
    roomState.session = null;
    roomState.currentSpeaker = null;
    roomState.isEnding = false;
  }
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
