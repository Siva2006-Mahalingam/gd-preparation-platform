/* ════════════════════════════════════════════════════════
   GD Platform — Public Rooms Logic
   ════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  setupNavbar();
  await loadPublicRooms();
  
  // Auto-refresh every 30 seconds
  setInterval(loadPublicRooms, 30000);
});

async function loadPublicRooms() {
  const container = document.getElementById('roomsContainer');

  try {
    const { rooms } = await api('/rooms/public/list');

    if (!rooms || rooms.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No public rooms available</h3>
          <p>There are no open rooms right now. Create your own and invite others.</p>
          <a href="/dashboard.html" class="btn btn-primary mt-6">Go to Dashboard</a>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="rooms-grid">
        ${rooms.map(r => {
          const isFull = r.participant_count >= r.max_participants;
          return `
            <div class="room-card">
              <div class="room-card-name">${escapeHtml(r.name)}</div>
              <div class="room-card-topic">${escapeHtml(r.topic || 'Topic assigned when the discussion starts.')}</div>
              <div class="room-card-footer">
                <span class="room-card-participants">${r.participant_count}/${r.max_participants} participants</span>
                <span class="badge ${isFull ? 'badge-amber' : 'badge-green'}">${isFull ? 'Full' : 'Open'}</span>
              </div>
              <button
                class="btn btn-primary btn-block"
                style="margin-top: var(--s-4);"
                onclick="joinPublicRoom('${r.code}')"
                ${isFull ? 'disabled' : ''}
              >
                ${isFull ? 'Room Full' : 'Join Room'}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Failed to load rooms</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

async function joinPublicRoom(code) {
  try {
    const { room } = await api(`/rooms/${code}/join`, { method: 'POST' });
    showToast('Joined room!', 'success');
    window.location.href = `room.html?code=${room.code}`;
  } catch (err) {
    showToast(err.message, 'error');
    loadPublicRooms();
  }
}
