/* ════════════════════════════════════════════════════════
   GD Platform — Performance Analytics Logic
   ════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;
  setupNavbar();

  // Chart.js defaults for light theme
  Chart.defaults.color = '#6b7280';
  Chart.defaults.borderColor = '#e2e4ec';
  Chart.defaults.font.family = "'Inter', sans-serif";

  await loadPerformance();
});

async function loadPerformance() {
  try {
    const stats = await api('/performance');
    const { history } = await api('/performance/history');

    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('performanceContainer').classList.remove('hidden');

    if (!history || history.length === 0) {
      document.getElementById('performanceContainer').innerHTML = `
        <div class="empty-state mt-8">
          <h3>No data yet</h3>
          <p>Complete some GD sessions to see your performance analytics.</p>
          <a href="/dashboard.html" class="btn btn-primary mt-6">Start a Session</a>
        </div>
      `;
      return;
    }

    // Stats
    document.getElementById('statTotal').textContent       = stats.total_sessions;
    document.getElementById('statAvg').textContent         = stats.avg_score ? Math.round(stats.avg_score) : '—';
    document.getElementById('statTime').textContent        = formatDuration(stats.total_speaking_time || 0);
    document.getElementById('statContributions').textContent = stats.total_contributions || '0';

    // Chart data
    const labels = history.map((_, i) => `Session ${i + 1}`);
    const overallScores = history.map(h => h.overall_score);

    const avgComm   = Math.round(history.reduce((s, h) => s + h.communication_score,  0) / history.length);
    const avgCont   = Math.round(history.reduce((s, h) => s + h.content_score,        0) / history.length);
    const avgPart   = Math.round(history.reduce((s, h) => s + h.participation_score,  0) / history.length);
    const avgCollab = Math.round(history.reduce((s, h) => s + h.collaboration_score,  0) / history.length);
    const avgLead   = Math.round(history.reduce((s, h) => s + h.leadership_score,     0) / history.length);

    // Trend chart
    const trendCtx = document.getElementById('trendChart').getContext('2d');
    const gradient = trendCtx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(59, 79, 216, 0.18)');
    gradient.addColorStop(1, 'rgba(59, 79, 216, 0.0)');

    new Chart(trendCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Overall Score',
          data: overallScores,
          borderColor: '#3b4fd8',
          backgroundColor: gradient,
          borderWidth: 2,
          pointBackgroundColor: '#3b4fd8',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.3,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: '#e2e4ec' },
            ticks: { color: '#9ca3af' },
          },
          x: {
            grid: { color: '#e2e4ec' },
            ticks: { color: '#9ca3af' },
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#111827',
            titleColor: '#f9fafb',
            bodyColor: '#d1d5db',
            padding: 10,
            borderRadius: 6,
          }
        }
      }
    });

    // Radar chart
    const radarCtx = document.getElementById('radarChart').getContext('2d');
    new Chart(radarCtx, {
      type: 'radar',
      data: {
        labels: ['Communication', 'Content', 'Participation', 'Collaboration', 'Leadership'],
        datasets: [{
          label: 'Average Score',
          data: [avgComm, avgCont, avgPart, avgCollab, avgLead],
          backgroundColor: 'rgba(59, 79, 216, 0.12)',
          borderColor: '#3b4fd8',
          pointBackgroundColor: '#3b4fd8',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: '#3b4fd8',
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: '#e2e4ec' },
            grid: { color: '#e2e4ec' },
            pointLabels: { color: '#4b5563', font: { size: 12, weight: '500' } },
            ticks: { display: false, min: 0, max: 100 },
          }
        },
        plugins: { legend: { display: false } }
      }
    });

  } catch (err) {
    document.getElementById('loadingState').innerHTML = `
      <div class="empty-state">
        <h3>Failed to load analytics</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}
