/* ════════════════════════════════════════════════════════
   GD Platform — Auth (Login / Register)
   ════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // If already logged in, redirect to dashboard
  if (getToken() && getUser()) {
    window.location.href = '/dashboard.html';
    return;
  }

  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  // Auto-switch to register tab if URL hash is #register
  if (window.location.hash === '#register') {
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    registerForm.classList.add('active');
    loginForm.classList.remove('active');
  }

  // Tab switching
  loginTab.addEventListener('click', () => {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginForm.classList.add('active');
    registerForm.classList.remove('active');
  });

  registerTab.addEventListener('click', () => {
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    registerForm.classList.add('active');
    loginForm.classList.remove('active');
  });

  // Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = loginForm.querySelector('button[type="submit"]');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
      showToast('Please fill in all fields', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      setAuth(data.token, data.user);
      showToast('Welcome back!', 'success');
      setTimeout(() => window.location.href = '/dashboard.html', 500);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });

  // Register
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = registerForm.querySelector('button[type="submit"]');
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;

    if (!username || !email || !password) {
      showToast('Please fill in all fields', 'error');
      return;
    }

    if (username.length < 3) {
      showToast('Username must be at least 3 characters', 'error');
      return;
    }

    if (password.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account...';

    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
      });

      setAuth(data.token, data.user);
      showToast('Account created successfully!', 'success');
      setTimeout(() => window.location.href = '/dashboard.html', 500);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });
});
