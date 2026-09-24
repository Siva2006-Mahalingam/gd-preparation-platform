/* ════════════════════════════════════════════════════════
   GD Platform — Shared Utilities
   Auth helpers, API wrapper, toasts, navigation
   ════════════════════════════════════════════════════════ */

const BACKEND_URL = window.BACKEND_URL || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? window.location.origin
    : (localStorage.getItem('gd_backend_url') || 'https://gd-preparation-platform.onrender.com')
);
const API_BASE = BACKEND_URL + '/api';

// ── Auth Helpers ────────────────────────────────────────
function getToken() {
  return localStorage.getItem('gd_token');
}

function getUser() {
  const data = localStorage.getItem('gd_user');
  return data ? JSON.parse(data) : null;
}

function setAuth(token, user) {
  localStorage.setItem('gd_token', token);
  localStorage.setItem('gd_user', JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem('gd_token');
  localStorage.removeItem('gd_user');
}

function logout() {
  clearAuth();
  window.location.href = '/auth.html';
}

function requireAuth() {
  if (!getToken() || !getUser()) {
    window.location.href = '/auth.html';
    return false;
  }
  return true;
}

// ── API Fetch Wrapper ───────────────────────────────────
async function api(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Something went wrong');
    }

    return data;
  } catch (err) {
    if (err.message === 'Invalid or expired token') {
      clearAuth();
      window.location.href = '/auth.html';
      return;
    }
    throw err;
  }
}

// ── Toast Notifications ─────────────────────────────────
function initToasts() {
  if (!document.querySelector('.toast-container')) {
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
}

function showToast(message, type = 'info') {
  initToasts();
  const container = document.querySelector('.toast-container');

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(60px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Modal Helpers ───────────────────────────────────────
function openModal(modalId) {
  document.getElementById(modalId)?.classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.remove('active');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

// ── Utility ─────────────────────────────────────────────
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getScoreClass(score) {
  if (score >= 75) return 'score-excellent';
  if (score >= 55) return 'score-good';
  if (score >= 35) return 'score-average';
  return 'score-poor';
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Navbar Setup ────────────────────────────────────────
function setupNavbar() {
  const user = getUser();
  if (!user) return;

  const userNameEl = document.querySelector('.navbar-user .user-name');
  if (userNameEl) userNameEl.textContent = user.username;

  const avatarEl = document.querySelector('.navbar-avatar');
  if (avatarEl) avatarEl.textContent = getInitials(user.username);

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);

  // Mobile nav toggle
  const mobileBtn = document.querySelector('.mobile-nav-btn');
  const navLinks = document.querySelector('.navbar-links');
  if (mobileBtn && navLinks) {
    mobileBtn.addEventListener('click', () => {
      navLinks.classList.toggle('mobile-open');
    });
  }

  // Set active nav link
  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
  document.querySelectorAll('.navbar-links a').forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    }
  });
}

// ── Close modal on overlay click ────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// ── Close modal on Escape ───────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllModals();
});
