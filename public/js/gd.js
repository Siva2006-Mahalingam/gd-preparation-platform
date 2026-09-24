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

  socket.on('gd-started', ({ startTime, sessionId }) => {
    gdActive = true;
    gdStartTime = new Date(startTime);
    roomData.sessionId = sessionId;
    showGdRoom();
    startTimer();
  });

  socket.on('speaking-update', ({ userId, username, status }) => {
    // Update participant list UI (handled by participant-update)
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

  // Actions
  const actionsDiv = document.getElementById('waitingActions');
  if (isHost) {
    actionsDiv.innerHTML = `
      <button class="btn btn-primary btn-lg" id="startGdBtn">Start Discussion</button>
      <p class="text-tertiary text-sm mt-3">Share the room code with participants before starting.</p>
    `;
    document.getElementById('startGdBtn').addEventListener('click', () => {
      socket.emit('start-gd', roomData.code);
    });
  } else {
    actionsDiv.innerHTML = `
      <div class="waiting-message">
        <h3>Waiting for host to start</h3>
        <p>The host will start the discussion when everyone is ready.</p>
      </div>
    `;
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

  // Host controls
  const controlsDiv = document.getElementById('gdControls');
  if (isHost) {
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
  }
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
  if (!gdStartTime) return;
  const elapsed = Math.floor((Date.now() - gdStartTime.getTime()) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timerEl = document.getElementById('timerValue');
  if (timerEl) {
    timerEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

// ══════════════════════════════════════════════════════════
// MICROPHONE — Tap to speak / Tap to stop + Real-Time STT
// ══════════════════════════════════════════════════════════

async function toggleMicrophone() {
  if (!gdActive) return;

  if (isSpeaking) {
    stopSpeaking(false);
  } else {
    await startSpeaking();
  }
}

async function startSpeaking() {
  try {
    // Request mic permission only on first use
    if (!audioStream) {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        }
      });
    }

    // Create a new MediaRecorder for this contribution
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(audioStream, { mimeType });
    const chunks = [];

    // Initialize contribution tracking object
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
        console.warn('SpeechRecognition initialization error:', recErr);
      }
    }

    mediaRecorder.start(1000); // Collect audio data
    isSpeaking = true;

    // Update UI
    const micBtn = document.getElementById('micBtn');
    micBtn.classList.add('active');
    micBtn.textContent = 'STOP';
    document.getElementById('micLabel').textContent = 'Tap to stop';
    document.getElementById('micLabel').classList.add('recording');

    // Show live transcript container
    const liveBox = document.getElementById('liveTranscriptContainer');
    const liveText = document.getElementById('liveTranscriptText');
    if (liveBox) liveBox.classList.remove('hidden');
    if (liveText) liveText.textContent = 'Listening to speech...';

    // Notify other participants
    socket.emit('start-speaking', roomData.code);

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showToast('Microphone permission denied. Please allow access.', 'error');
    } else {
      showToast('Could not access microphone: ' + err.message, 'error');
    }
  }
}

function stopSpeaking(forced) {
  if (!isSpeaking && !forced) return;

  isSpeaking = false;

  // Stop speech recognition
  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch (_) {}
    speechRecognition = null;
  }

  // Preserve contrib reference for async upload
  const contrib = currentContribution;
  currentContribution = null;

  // Stop MediaRecorder
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }

  if (contrib) {
    contrib.endTime = new Date().toISOString();
    const start = new Date(contrib.startTime);
    const end = new Date(contrib.endTime);
    contrib.duration = Math.max(0.5, (end - start) / 1000);
    const finalTranscript = (contrib.transcript || recognizedTranscript || '').trim();

    // Send contribution data with transcript to server via socket
    socket.emit('stop-speaking', {
      roomCode: roomData.code,
      contributionData: {
        startTime: contrib.startTime,
        endTime: contrib.endTime,
        duration: contrib.duration,
        transcript: finalTranscript,
      },
    });

    // Upload audio blob once MediaRecorder produces it
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

  // Update UI
  const micBtn = document.getElementById('micBtn');
  if (micBtn) {
    micBtn.classList.remove('active');
    micBtn.textContent = 'MIC';
  }
  const micLabel = document.getElementById('micLabel');
  if (micLabel) {
    micLabel.textContent = 'Tap to speak';
    micLabel.classList.remove('recording');
  }

  const liveBox = document.getElementById('liveTranscriptContainer');
  if (liveBox) {
    setTimeout(() => {
      if (!isSpeaking) liveBox.classList.add('hidden');
    }, 2500);
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
