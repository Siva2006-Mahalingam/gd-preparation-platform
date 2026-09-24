/* ════════════════════════════════════════════════════════
   GD Platform — Sessions List Logic
   ════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  setupNavbar();
  await loadAllSessions();
});

async function loadAllSessions() {
  const container = document.getElementById('sessionsContainer');

  try {
    const { sessions } = await api('/sessions');

    if (!sessions || sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No sessions found</h3>
          <p>You haven't participated in any Group Discussions yet.</p>
          <a href="/dashboard.html" class="btn btn-primary mt-6">Go to Dashboard</a>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="sessions-list">
        ${sessions.map(s => {
          const score = Math.round(s.overall_score || 0);
          return `
            <a href="result.html?session=${s.id}" class="session-card">
              <div class="session-card-score ${getScoreClass(score)}">${score}</div>
              <div class="session-card-body">
                <div class="session-card-topic">${escapeHtml(s.topic)}</div>
                <div class="session-card-meta">${formatDate(s.started_at)} &middot; ${s.participant_count} participants &middot; ${formatDuration(s.duration || 0)}</div>
              </div>
              <div class="session-card-arrow">&#8250;</div>
            </a>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>Failed to load sessions</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}
