/* ════════════════════════════════════════════════════════
   GD Platform — Result Page Logic
   ════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  setupNavbar();

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');

  if (!sessionId) {
    window.location.href = '/dashboard.html';
    return;
  }

  await loadResult(sessionId);
});

async function loadResult(sessionId) {
  try {
    const data = await api(`/sessions/${sessionId}`);
    const { session, evaluation, contributions } = data;

    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('resultView').classList.remove('hidden');

    // Header
    document.getElementById('topicText').textContent = session.topic;
    document.getElementById('sessionMeta').textContent =
      `${session.room_name} · ${formatDate(session.started_at)} · ${formatDuration(session.duration)} · ${session.participant_count} participants`;

    if (!evaluation) {
      document.querySelector('.result-page').insertAdjacentHTML('beforeend', `
        <div class="empty-state mt-8">
          <h3>Evaluation Pending</h3>
          <p>Your performance report is still being generated or is unavailable.</p>
        </div>
      `);
      return;
    }

    // Overall Score
    const scoreVal = Math.round(evaluation.overall_score || 0);
    document.getElementById('overallScore').textContent = scoreVal;

    // Score breakdown
    const categories = [
      { label: 'Communication',  score: evaluation.communication_score },
      { label: 'Content Quality', score: evaluation.content_score },
      { label: 'Participation',  score: evaluation.participation_score },
      { label: 'Collaboration',  score: evaluation.collaboration_score },
      { label: 'Leadership',     score: evaluation.leadership_score },
    ];

    document.getElementById('scoreBreakdown').innerHTML = categories.map(c => {
      const pct = Math.round(c.score || 0);
      return `
        <div class="score-category">
          <div class="score-category-name">${c.label}</div>
          <div class="score-category-value ${getScoreClass(pct)}">${pct}</div>
          <div class="score-bar-track">
            <div class="score-bar-fill" style="width:0%" data-width="${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');

    // Animate bars
    setTimeout(() => {
      document.querySelectorAll('.score-bar-fill').forEach(bar => {
        bar.style.width = bar.getAttribute('data-width');
      });
    }, 120);

    // Strengths
    const strengthsEl = document.getElementById('strengthsList');
    if (evaluation.strengths && evaluation.strengths.length > 0) {
      strengthsEl.innerHTML = evaluation.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('');
    } else {
      strengthsEl.innerHTML = '<li class="text-tertiary">No specific strengths recorded.</li>';
    }

    // Improvements
    const improvementsEl = document.getElementById('improvementsList');
    if (evaluation.improvements && evaluation.improvements.length > 0) {
      improvementsEl.innerHTML = evaluation.improvements.map(i => `<li>${escapeHtml(i)}</li>`).join('');
    } else {
      improvementsEl.innerHTML = '<li class="text-tertiary">No specific areas for improvement recorded.</li>';
    }

    // Detailed feedback
    document.getElementById('feedbackText').textContent = evaluation.feedback || 'No detailed feedback available.';

    // Contributions
    const contributionsEl = document.getElementById('contributionsList');
    if (contributions && contributions.length > 0) {
      contributionsEl.innerHTML = contributions.map(c => {
        const start = new Date(c.start_time);
        const sessionStart = new Date(session.started_at);
        const relativeStart = Math.round((start - sessionStart) / 1000);
        const hasTranscript = c.transcript && c.transcript.trim().length > 0;
        return `
          <div class="contribution-item">
            <div class="contribution-meta">
              <span><strong>Turn ${c.contribution_order}</strong></span>
              <span>At ${formatDuration(relativeStart)}</span>
              <span>Duration: ${c.duration ? c.duration.toFixed(1) : '0'}s</span>
            </div>
            ${hasTranscript
              ? `<div class="contribution-transcript">"${escapeHtml(c.transcript.trim())}"</div>`
              : `<div class="contribution-transcript text-tertiary" style="border-left-color: var(--border-strong);">[No transcript recorded for this turn]</div>`
            }
          </div>
        `;
      }).join('');
    } else {
      contributionsEl.innerHTML = `<p class="text-tertiary text-sm">You did not make any verbal contributions during this session.</p>`;
    }

  } catch (err) {
    document.getElementById('loadingState').innerHTML = `
      <div class="empty-state">
        <h3>Cannot load result</h3>
        <p>${escapeHtml(err.message)}</p>
        <a href="dashboard.html" class="btn btn-primary mt-6">Back to Dashboard</a>
      </div>
    `;
  }
}
