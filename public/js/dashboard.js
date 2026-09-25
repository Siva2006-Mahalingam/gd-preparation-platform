/* ════════════════════════════════════════════════════════
   GD Platform — Dashboard Logic
   ════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  if (!requireAuth()) return;
  setupNavbar();

  const user = getUser();
  document.getElementById('welcomeName').textContent = user.username;

  loadStats();
  loadRecentSessions();
  setupActions();
});

// ── Load Stats ──────────────────────────────────────────
async function loadStats() {
  try {
    const stats = await api('/performance');
    document.getElementById('statTotal').textContent = stats.total_sessions || '0';
    document.getElementById('statAvg').textContent   = stats.avg_score  ? Math.round(stats.avg_score)  : '—';
    document.getElementById('statBest').textContent  = stats.best_score ? Math.round(stats.best_score) : '—';
    document.getElementById('statLatest').textContent = stats.latest_score ? Math.round(stats.latest_score) : '—';
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

// ── Load Recent Sessions ────────────────────────────────
async function loadRecentSessions() {
  const container = document.getElementById('recentSessions');

  try {
    const { sessions } = await api('/sessions');
    const recent = sessions.slice(0, 5);

    if (recent.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No sessions yet</h3>
          <p>Create or join a GD room to get started.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="sessions-table">
        ${recent.map(s => {
          const score = Math.round(s.overall_score || 0);
          return `
            <div class="session-row" onclick="window.location.href='result.html?session=${s.id}'" style="cursor:pointer;">
              <div>
                <div class="session-topic">${escapeHtml(s.topic)}</div>
                <div class="session-meta">${formatDate(s.started_at)} &middot; ${s.participant_count} participants &middot; ${formatDuration(s.duration || 0)}</div>
              </div>
              <div class="session-score ${getScoreClass(score)}">${score}</div>
              <div class="badge badge-blue" style="font-size:0.7rem;">View</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Couldn't load sessions</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

// ── Setup Actions ───────────────────────────────────────
function setupActions() {
  document.getElementById('createRoomAction').addEventListener('click', () => {
    openModal('createRoomModal');
  });

  document.getElementById('joinRoomAction').addEventListener('click', () => {
    openModal('joinRoomModal');
  });

  // Visibility toggle label
  const publicToggle = document.getElementById('roomPublic');
  const visLabel = document.getElementById('visibilityLabel');
  publicToggle.addEventListener('change', () => {
    visLabel.textContent = publicToggle.checked
      ? 'Public — anyone can find and join'
      : 'Private — only people with the code can join';
  });

  // Create Room Form
  document.getElementById('createRoomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('createRoomBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      const { room } = await api('/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('roomName').value.trim(),
          isPublic: document.getElementById('roomPublic').checked,
          maxParticipants: parseInt(document.getElementById('maxParticipants').value),
        }),
      });

      const chosenDuration = document.getElementById('roomDuration')?.value || '15';
      if (room?.code) {
        sessionStorage.setItem('host_duration_' + room.code, chosenDuration);
      }

      showToast('Room created!', 'success');
      closeModal('createRoomModal');
      window.location.href = `room.html?code=${room.code}`;
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Host Session';
    }
  });

  // Join Room Form
  document.getElementById('joinRoomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('joinRoomBtn');
    const code = document.getElementById('roomCode').value.trim().toUpperCase();

    if (!code) {
      showToast('Please enter a room code', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Joining...';

    try {
      const { room } = await api(`/rooms/${code}/join`, { method: 'POST' });
      showToast('Joined room!', 'success');
      closeModal('joinRoomModal');
      window.location.href = `room.html?code=${room.code}`;
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Join Session';
    }
  });
}
