/* ════════════════════════════════════════════════════════
   GD Platform — Live GD Room
   Socket.IO + Microphone Toggle + Contribution Tracking
   ════════════════════════════════════════════════════════ */

let socket = null;
let roomData = null;
let currentUser = null;
let isHost = false;
let gdActive = false;
let gdStartTime = null;
let gdEndTime = null;
let gdDurationMinutes = 15;
let timerInterval = null;

// Microphone & Speech Recognition state
let isSpeaking = false;
let mediaRecorder = null;
let audioStream = null;
let speechRecognition = null;
let recognizedTranscript = '';
let currentContribution = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  setupNavbar();

  currentUser = getUser();

  const params = new URLSearchParams(window.location.search);
  const roomCode = params.get('code');

  if (!roomCode) {
    showToast('No room code provided', 'error');
    setTimeout(() => window.location.href = '/dashboard.html', 1000);
    return;
  }

  await loadRoom(roomCode);
});

// ── Load Room Data ──────────────────────────────────────
async function loadRoom(code) {
  try {
    // Join the room via API
    const { room } = await api(`/rooms/${code}/join`, { method: 'POST' });
    roomData = room;
    isHost = room.host_id === currentUser.id;

    // Connect Socket.IO
    connectSocket(code);

    // Show waiting room
    showWaitingRoom();
  } catch (err) {
    document.getElementById('loadingState').innerHTML = `
      <div class="empty-state">
        <h3>Cannot join room</h3>
        <p>${escapeHtml(err.message)}</p>
        <a href="/dashboard.html" class="btn btn-primary mt-6">Back to Dashboard</a>
      </div>
    `;
  }
}

// ── Socket.IO Connection ────────────────────────────────
function connectSocket(roomCode) {
  socket = io(BACKEND_URL, {
    auth: { token: getToken() },
  });

  socket.on('connect', () => {
    socket.emit('join-room', roomCode);
  });

  socket.on('participant-update', (participants) => {
    renderParticipants(participants);
  });

  socket.on('gd-started', ({ startTime, endTime, durationSeconds, durationMinutes, sessionId }) => {
    gdActive = true;
    gdStartTime = new Date(startTime);
    gdDurationMinutes = durationMinutes || 15;
    gdEndTime = endTime ? new Date(endTime) : new Date(gdStartTime.getTime() + (durationSeconds || (gdDurationMinutes * 60)) * 1000);
    roomData.sessionId = sessionId;
    showGdRoom();
    startTimer();
  });

  socket.on('speaking-update', ({ userId, username, status }) => {
    // Update participant list UI (handled by participant-update)
  });

  socket.on('mic-acquired', ({ userId, username, socketId }) => {
    handleMicAcquired({ userId, username, socketId });
  });

  socket.on('mic-released', (data) => {
    handleMicReleased(data?.previousSpeakerUsername);
  });

  socket.on('mic-rejected', ({ speakerUsername, message }) => {
    handleMicRejected({ speakerUsername, message });
  });

  socket.on('topic-updated', ({ topic }) => {
    roomData.topic = topic;
    const topicEl = document.getElementById('topicText');
    const gdTopicEl = document.getElementById('gdTopicText');
    if (topicEl) topicEl.textContent = topic;
    if (gdTopicEl) gdTopicEl.textContent = topic;
    showToast('Discussion topic updated!', 'info');
  });

  socket.on('gd-ending', () => {
    openModal('evalLoadingModal');
  });

  socket.on('gd-ended', ({ sessionId, duration }) => {
    gdActive = false;
    stopTimer();
    stopSpeaking(true); // Force stop if still speaking
    closeModal('evalLoadingModal');

    // Redirect to result page
    window.location.href = `/result.html?session=${sessionId}`;
  });

  socket.on('error-msg', (msg) => {
    showToast(msg, 'error');
  });

  socket.on('disconnect', () => {
    showToast('Connection lost. Reconnecting...', 'info');
  });

  socket.on('reconnect', () => {
    socket.emit('join-room', roomCode);
    showToast('Reconnected!', 'success');
  });
}

// ── Show Waiting Room ───────────────────────────────────
function showWaitingRoom() {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('waitingRoom').classList.remove('hidden');

  document.getElementById('topicText').textContent = roomData.topic;

  const codeDisplay = document.getElementById('roomCodeDisplay');
  codeDisplay.textContent = roomData.code;
  codeDisplay.addEventListener('click', () => {
    navigator.clipboard.writeText(roomData.code).then(() => {
      showToast('Room code copied!', 'success');
    });
  });

  document.getElementById('hostName').textContent = roomData.host_username;

  // Retrieve duration set during room creation if any
  const savedDuration = sessionStorage.getItem('host_duration_' + roomData.code) || '15';
  const durationDisplay = document.getElementById('waitingDurationDisplay');
  if (durationDisplay) durationDisplay.textContent = `${savedDuration} mins`;

  // Navbar Leave Room button
  const navLeaveBtn = document.getElementById('navLeaveBtn');
  if (navLeaveBtn) {
    navLeaveBtn.classList.remove('hidden');
    navLeaveBtn.onclick = () => openModal('leaveRoomModal');
  }

  // Wire confirm leave button
  const confirmLeaveBtn = document.getElementById('confirmLeaveRoom');
  if (confirmLeaveBtn) {
    confirmLeaveBtn.onclick = () => {
      closeModal('leaveRoomModal');
      leaveRoomAction();
    };
  }

  // Actions
  const actionsDiv = document.getElementById('waitingActions');
  if (isHost) {
    actionsDiv.innerHTML = `
      <div class="host-duration-card mb-4" style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--s-4); text-align: left;">
        <label for="gdDurationSelect" class="form-label" style="font-weight: 700; color: var(--text-primary); margin-bottom: 6px; display: block;">
          ⏱️ Discussion Duration:
        </label>
        <div style="display: flex; gap: var(--s-3); align-items: center; flex-wrap: wrap;">
          <select id="gdDurationSelect" class="form-input" style="max-width: 220px; font-weight: 600;">
            <option value="5" ${savedDuration === '5' ? 'selected' : ''}>5 Minutes</option>
            <option value="10" ${savedDuration === '10' ? 'selected' : ''}>10 Minutes</option>
            <option value="15" ${savedDuration === '15' ? 'selected' : ''}>15 Minutes (Standard)</option>
            <option value="20" ${savedDuration === '20' ? 'selected' : ''}>20 Minutes</option>
            <option value="30" ${savedDuration === '30' ? 'selected' : ''}>30 Minutes</option>
            <option value="45" ${savedDuration === '45' ? 'selected' : ''}>45 Minutes</option>
          </select>
          <span class="text-tertiary text-xs" style="flex: 1; min-width: 180px;">The timer starts automatically upon launch and synchronizes across all participants.</span>
        </div>
      </div>
      <button class="btn btn-primary btn-lg" id="startGdBtn">Start Discussion</button>
      <p class="text-tertiary text-sm mt-3">Share the room code with participants before starting.</p>
    `;

    // Host can regenerate / change topic to another category
    const changeTopicBtn = document.getElementById('changeTopicBtn');
    if (changeTopicBtn) {
      changeTopicBtn.classList.remove('hidden');
      changeTopicBtn.onclick = async () => {
        changeTopicBtn.disabled = true;
        changeTopicBtn.textContent = 'Generating...';
        try {
          const res = await api(`/rooms/${roomData.code}/topic/regenerate`, { method: 'POST' });
          if (res?.topic) {
            roomData.topic = res.topic;
            document.getElementById('topicText').textContent = res.topic;
            showToast('New topic generated!', 'success');
          }
        } catch (err) {
          showToast(err.message || 'Could not change topic', 'error');
        } finally {
          changeTopicBtn.disabled = false;
          changeTopicBtn.textContent = '🎲 Change Topic';
        }
      };
    }

    document.getElementById('gdDurationSelect').addEventListener('change', (e) => {
      const val = e.target.value;
      if (durationDisplay) durationDisplay.textContent = `${val} mins`;
      sessionStorage.setItem('host_duration_' + roomData.code, val);
    });

    document.getElementById('startGdBtn').addEventListener('click', () => {
      const durationMinutes = parseInt(document.getElementById('gdDurationSelect')?.value || savedDuration, 10);
      socket.emit('start-gd', { roomCode: roomData.code, durationMinutes });
    });
  } else {
    // Non-hosts do not have change topic capability
    const changeTopicBtn = document.getElementById('changeTopicBtn');
    if (changeTopicBtn) changeTopicBtn.classList.add('hidden');
    actionsDiv.innerHTML = `
      <div class="waiting-message">
        <h3>Waiting for host to start</h3>
        <p>The host will configure the discussion duration and start when everyone is ready.</p>
        <button class="btn btn-ghost text-danger mt-4" id="waitingLeaveBtn" style="border: 1px solid rgba(192,57,43,0.35);">Leave Room</button>
      </div>
    `;
    document.getElementById('waitingLeaveBtn')?.addEventListener('click', () => {
      openModal('leaveRoomModal');
    });
  }
}

// ── Show GD Room ────────────────────────────────────────
function showGdRoom() {
  document.getElementById('waitingRoom').classList.add('hidden');
  document.getElementById('gdRoom').classList.remove('hidden');

  document.getElementById('gdTopicText').textContent = roomData.topic;

  // Mic button
  const micBtn = document.getElementById('micBtn');
  micBtn.addEventListener('click', toggleMicrophone);
  handleMicReleased();

  // Host vs Participant controls
  const controlsDiv = document.getElementById('gdControls');
  if (isHost) {
    // Only the host can manually end the GD
    controlsDiv.innerHTML = `
      <button class="btn btn-danger btn-lg" id="endGdBtn">End Discussion</button>
    `;
    document.getElementById('endGdBtn').addEventListener('click', () => {
      openModal('endGdModal');
    });
    document.getElementById('confirmEndGd').addEventListener('click', () => {
      closeModal('endGdModal');
      socket.emit('end-gd', roomData.code);
    });
  } else {
    // Participants have a Leave Room option (never End GD)
    controlsDiv.innerHTML = `
      <button class="btn btn-ghost text-danger" id="participantLeaveBtn" style="border: 1px solid rgba(192,57,43,0.35); font-weight: 600;">Leave Room</button>
    `;
    document.getElementById('participantLeaveBtn').addEventListener('click', () => {
      openModal('leaveRoomModal');
    });
  }

  // Ensure navbar leave button is wired
  const navLeaveBtn = document.getElementById('navLeaveBtn');
  if (navLeaveBtn) {
    navLeaveBtn.classList.remove('hidden');
    navLeaveBtn.onclick = () => openModal('leaveRoomModal');
  }

  const confirmLeaveBtn = document.getElementById('confirmLeaveRoom');
  if (confirmLeaveBtn) {
    confirmLeaveBtn.onclick = () => {
      closeModal('leaveRoomModal');
      leaveRoomAction();
    };
  }
}

// ── Participant Leave Room Action ────────────────────────
function leaveRoomAction() {
  if (isSpeaking) {
    stopSpeaking(true);
  }
  if (audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }
  if (socket && roomData) {
    socket.emit('leave-room', roomData.code);
  }
  showToast('You left the room.', 'info');
  setTimeout(() => {
    window.location.href = '/dashboard.html';
  }, 250);
}

// ── Render Participants ─────────────────────────────────
function renderParticipants(participants) {
  const countEl = document.getElementById('participantCount');
  if (countEl) countEl.textContent = participants.length;

  // Waiting room list
  const waitingList = document.getElementById('waitingParticipants');
  if (waitingList && !waitingList.closest('.hidden')) {
    waitingList.innerHTML = participants.map(p => `
      <div class="participant-item ${p.status === 'speaking' ? 'speaking' : ''}">
        <div class="participant-avatar">${getInitials(p.username)}</div>
        <div class="participant-name">
          ${escapeHtml(p.username)}
          ${p.id === roomData.host_id ? '<span class="host-badge">Host</span>' : ''}
          ${p.id === currentUser.id ? '<span class="text-muted" style="font-size:0.8rem;margin-left:4px;">(You)</span>' : ''}
        </div>
        <div class="participant-status status-ready">
          <span class="status-dot ready"></span>
          Ready
        </div>
      </div>
    `).join('');
  }

  // GD room list
  const gdList = document.getElementById('gdParticipants');
  if (gdList && !gdList.closest('.hidden')) {
    gdList.innerHTML = participants.map(p => {
      const isSpeaking = p.status === 'speaking';
      return `
        <div class="participant-item ${isSpeaking ? 'speaking' : ''}">
          <div class="participant-avatar">${getInitials(p.username)}</div>
          <div class="participant-name">
            ${escapeHtml(p.username)}
            ${p.id === roomData.host_id ? '<span class="host-badge">Host</span>' : ''}
            ${p.id === currentUser.id ? '<span class="text-muted" style="font-size:0.8rem;margin-left:4px;">(You)</span>' : ''}
          </div>
          <div class="participant-status ${isSpeaking ? 'status-speaking' : 'status-ready'}">
            <span class="status-dot ${isSpeaking ? 'speaking' : 'ready'}"></span>
            ${isSpeaking ? 'Speaking' : 'Ready'}
          </div>
        </div>
      `;
    }).join('');
  }
}

// ── Timer ───────────────────────────────────────────────
function startTimer() {
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimer() {
  if (!gdEndTime) return;
  const now = Date.now();
  const remaining = Math.max(0, Math.floor((gdEndTime.getTime() - now) / 1000));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const timerEl = document.getElementById('timerValue');
  if (timerEl) {
    timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    if (remaining <= 60 && remaining > 0) {
      timerEl.classList.add('timer-warning');
    } else if (remaining === 0) {
      timerEl.classList.add('timer-expired');
      timerEl.textContent = '00:00';
    } else {
      timerEl.classList.remove('timer-warning', 'timer-expired');
    }
  }
}

// ══════════════════════════════════════════════════════════
// MICROPHONE — First-Come-First-Served Room-Wide System
// Server maintains lock via Socket.IO. First click wins.
// When speaker stops, mic released for EVERY participant.
// ══════════════════════════════════════════════════════════

async function toggleMicrophone() {
  if (!gdActive) return;

  if (isSpeaking) {
    // Current speaker clicks "Stop Speaking"
    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
      micBtn.disabled = true;
      micBtn.textContent = 'Releasing...';
    }
    stopSpeaking(false);
  } else {
    // Participant requests the floor (first-come-first-served)
    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
      micBtn.disabled = true;
      micBtn.textContent = 'Requesting...';
    }
    const micLabel = document.getElementById('micLabel');
    if (micLabel) {
      micLabel.textContent = 'Requesting microphone...';
    }
    // Server locks mic for first request to reach it
    socket.emit('request-mic', roomData.code);
  }
}

// ── Mic Acquired: Server granted the floor ─────────────────
async function handleMicAcquired({ userId, username, socketId }) {
  const isMe = (socketId === socket.id) || (userId === currentUser?.id);
  const micBtn = document.getElementById('micBtn');
  const micLabel = document.getElementById('micLabel');
  const banner = document.getElementById('speakerStatusBanner');
  const bannerText = document.getElementById('speakerStatusText');
  const bannerIcon = document.getElementById('speakerBannerIcon');

  if (isMe) {
    // This participant won the speaking turn!
    isSpeaking = true;

    if (banner) {
      banner.className = 'speaker-banner speaking';
    }
    if (bannerIcon) bannerIcon.textContent = '🔴';
    if (bannerText) bannerText.textContent = 'You have the microphone — Speak now, tap Stop Speaking when done';

    if (micBtn) {
      micBtn.disabled = false;
      micBtn.classList.remove('locked');
      micBtn.classList.add('active');
      micBtn.textContent = 'Stop Speaking';
      micBtn.title = 'Click to finish speaking and release microphone';
    }
    if (micLabel) {
      micLabel.textContent = 'You are speaking — tap Stop Speaking when done';
      micLabel.classList.add('recording');
    }

    // Start recording audio and speech recognition locally
    await startAudioRecording();
  } else {
    // Another participant acquired the floor -> Disable Speak for all others
    if (isSpeaking) {
      stopSpeaking(true);
    }
    isSpeaking = false;

    if (banner) {
      banner.className = 'speaker-banner occupied';
    }
    if (bannerIcon) bannerIcon.textContent = '🎙️';
    if (bannerText) bannerText.textContent = `${username} has the microphone (Speaking...)`;

    if (micBtn) {
      micBtn.disabled = true;
      micBtn.classList.remove('active');
      micBtn.classList.add('locked');
      micBtn.textContent = 'Mic In Use';
      micBtn.title = `${username} is currently speaking`;
    }
    if (micLabel) {
      micLabel.textContent = `${username} is speaking...`;
      micLabel.classList.remove('recording');
    }

    const liveBox = document.getElementById('liveTranscriptContainer');
    if (liveBox) liveBox.classList.add('hidden');
  }
}

// ── Mic Released: Floor is open for EVERY participant ──────
function handleMicReleased(previousSpeakerUsername) {
  // If we were speaking, stop local recording
  if (isSpeaking) {
    stopLocalAudioRecording();
    isSpeaking = false;
  }

  const micBtn = document.getElementById('micBtn');
  const micLabel = document.getElementById('micLabel');
  const banner = document.getElementById('speakerStatusBanner');
  const bannerText = document.getElementById('speakerStatusText');
  const bannerIcon = document.getElementById('speakerBannerIcon');

  if (banner) {
    banner.className = 'speaker-banner free';
  }
  if (bannerIcon) bannerIcon.textContent = '🟢';
  if (bannerText) {
    bannerText.textContent = previousSpeakerUsername
      ? `Microphone available (${previousSpeakerUsername} finished) — Click Speak to take the floor`
      : 'Microphone available — Click Speak to take the floor';
  }

  // Speak button is enabled again for EVERY participant, including previous speaker
  if (micBtn) {
    micBtn.disabled = false;
    micBtn.classList.remove('active', 'locked');
    micBtn.textContent = 'Speak';
    micBtn.title = 'Click to speak';
  }
  if (micLabel) {
    micLabel.textContent = 'Microphone free — click Speak to take the floor';
    micLabel.classList.remove('recording');
  }

  const liveBox = document.getElementById('liveTranscriptContainer');
  if (liveBox) {
    setTimeout(() => {
      if (!isSpeaking) liveBox.classList.add('hidden');
    }, 1500);
  }
}

// ── Mic Rejected: Someone else clicked first ───────────────
function handleMicRejected({ speakerUsername, message }) {
  showToast(message || `${speakerUsername || 'Another participant'} already took the microphone.`, 'warning');

  const micBtn = document.getElementById('micBtn');
  const micLabel = document.getElementById('micLabel');
  const banner = document.getElementById('speakerStatusBanner');
  const bannerText = document.getElementById('speakerStatusText');
  const bannerIcon = document.getElementById('speakerBannerIcon');

  if (banner) {
    banner.className = 'speaker-banner occupied';
  }
  if (bannerIcon) bannerIcon.textContent = '🎙️';
  if (bannerText) {
    bannerText.textContent = speakerUsername
      ? `${speakerUsername} has the microphone (Speaking...)`
      : 'Microphone currently in use';
  }

  if (micBtn) {
    micBtn.disabled = true;
    micBtn.classList.remove('active');
    micBtn.classList.add('locked');
    micBtn.textContent = 'Mic In Use';
  }
  if (micLabel) {
    micLabel.textContent = speakerUsername ? `${speakerUsername} is speaking...` : 'Microphone in use';
    micLabel.classList.remove('recording');
  }
}

// ── Audio Recording & Speech Recognition (Activated on Lock Win)
async function startAudioRecording() {
  try {
    if (!audioStream) {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        }
      });
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(audioStream, { mimeType });
    const chunks = [];

    recognizedTranscript = '';
    currentContribution = {
      startTime: new Date().toISOString(),
      endTime: null,
      duration: 0,
      transcript: '',
      onAudioReady: null,
    };
    const activeContrib = currentContribution;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      if (activeContrib && typeof activeContrib.onAudioReady === 'function') {
        activeContrib.onAudioReady(blob);
      }
    };

    // Initialize Web Speech API for real-time speech-to-text
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        speechRecognition = new SpeechRecognition();
        speechRecognition.continuous = true;
        speechRecognition.interimResults = true;
        speechRecognition.lang = 'en-US';

        let finalTranscript = '';
        speechRecognition.onresult = (event) => {
          let interimTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript + ' ';
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          recognizedTranscript = (finalTranscript + interimTranscript).trim();
          if (activeContrib) {
            activeContrib.transcript = recognizedTranscript;
          }
          if (socket && roomData) {
            socket.emit('speech-transcript', { roomCode: roomData.code, transcript: recognizedTranscript });
          }
          const liveTextEl = document.getElementById('liveTranscriptText');
          if (liveTextEl) {
            liveTextEl.textContent = recognizedTranscript || 'Listening...';
          }
        };

        speechRecognition.onerror = (e) => {
          console.warn('Speech recognition note:', e.error);
        };

        speechRecognition.onend = () => {
          if (isSpeaking && speechRecognition) {
            try { speechRecognition.start(); } catch (_) {}
          }
        };

        speechRecognition.start();
      } catch (recErr) {
        console.warn('SpeechRecognition error:', recErr);
      }
    }

    mediaRecorder.start(1000);

    // Show live transcript box
    const liveBox = document.getElementById('liveTranscriptContainer');
    const liveText = document.getElementById('liveTranscriptText');
    if (liveBox) liveBox.classList.remove('hidden');
    if (liveText) liveText.textContent = 'Listening to your speech...';

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showToast('Microphone permission denied. Please allow access.', 'error');
    } else {
      showToast('Could not access microphone: ' + err.message, 'error');
    }
    // Release mic if local recording failed
    stopSpeaking(true);
  }
}

function stopLocalAudioRecording() {
  if (speechRecognition) {
    try { speechRecognition.stop(); } catch (_) {}
    speechRecognition = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
}

function stopSpeaking(forced) {
  if (!isSpeaking && !forced) return;

  isSpeaking = false;
  stopLocalAudioRecording();

  const contrib = currentContribution;
  currentContribution = null;

  if (contrib) {
    contrib.endTime = new Date().toISOString();
    const start = new Date(contrib.startTime);
    const end = new Date(contrib.endTime);
    contrib.duration = Math.max(0.5, (end - start) / 1000);
    const finalTranscript = (contrib.transcript || recognizedTranscript || '').trim();

    // Release microphone lock on server and record contribution
    if (socket) {
      socket.emit('release-mic', {
        roomCode: roomData.code,
        contributionData: {
          startTime: contrib.startTime,
          endTime: contrib.endTime,
          duration: contrib.duration,
          transcript: finalTranscript,
        },
      });
    }

    // Asynchronously upload audio recording
    contrib.onAudioReady = async (audioBlob) => {
      try {
        if (!roomData?.sessionId) return;
        const formData = new FormData();
        formData.append('sessionId', roomData.sessionId);
        formData.append('startTime', contrib.startTime);
        formData.append('endTime', contrib.endTime);
        formData.append('duration', contrib.duration);
        formData.append('clientTranscript', finalTranscript);
        if (audioBlob && audioBlob.size > 0) {
          formData.append('audio', audioBlob, 'contribution.webm');
        }

        await fetch('/api/contributions/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getToken()}`,
          },
          body: formData,
        });
      } catch (uploadErr) {
        console.warn('Audio upload warning:', uploadErr);
      }
    };
  }

  // Update UI to releasing state until server confirms mic-released
  const micBtn = document.getElementById('micBtn');
  if (micBtn) {
    micBtn.classList.remove('active');
    micBtn.disabled = true;
    micBtn.textContent = 'Speak';
  }
  const micLabel = document.getElementById('micLabel');
  if (micLabel) {
    micLabel.textContent = 'Releasing microphone...';
    micLabel.classList.remove('recording');
  }

  const liveBox = document.getElementById('liveTranscriptContainer');
  if (liveBox) {
    setTimeout(() => {
      if (!isSpeaking) liveBox.classList.add('hidden');
    }, 2000);
  }
}

// Clean up on page leave
window.addEventListener('beforeunload', () => {
  if (isSpeaking) {
    stopSpeaking(true);
  }
  if (audioStream) {
    audioStream.getTracks().forEach(t => t.stop());
  }
  if (socket && roomData) {
    socket.emit('leave-room', roomData.code);
  }
});
