// Log in / sign up screen. On CrazyGames, players sign in with their CrazyGames account instead
// (openAuth shows the CrazyGames dialog), as the platform requires.
import { $ } from '../core/util.js';
import { login, register, loginWithCrazyGames } from '../net/account.js';
import { cg, showAuthPrompt } from '../net/crazygames.js';
import { screens } from './screens.js';
import { notify } from './toasts.js';

let mode = 'login';

function render() {
  document.querySelectorAll('#authtabs button').forEach((b) => {
    const on = b.dataset.v === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  const signup = mode === 'signup';
  $('authsubmit').textContent = signup ? 'Create account' : 'Log in';
  $('anamelabel').textContent = signup ? 'Username' : 'Username or email';
  $('aname').maxLength = signup ? 16 : 254;
  $('aemailwrap').classList.toggle('hidden', !signup);
  $('apass').autocomplete = signup ? 'new-password' : 'current-password';
  $('authhint').textContent = signup ? 'Username: 3–16 letters, numbers or _ · Password: 8+ characters · Email lets you log in with it too' : '';
  $('autherr').textContent = '';
}

/** Open sign-in. On CrazyGames this shows CrazyGames' own dialog and links the account. */
export async function openAuth(m) {
  if (cg.active && cg.accounts) {
    if (await showAuthPrompt()) {
      try { if (await loginWithCrazyGames()) notify('Signed in with CrazyGames — your progress is saved.', { type: 'success' }); } catch (err) { notify(err.message, { type: 'error' }); }
    }
    return;
  }
  mode = m;
  screens.open('auth');
}

export function initAuth() {
  screens.register('auth', { onOpen: render });
  document.querySelectorAll('#authtabs button').forEach((b) => { b.onclick = () => { mode = b.dataset.v; render(); }; });
  $('authform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('authsubmit'), name = $('aname').value.trim(), pw = $('apass').value, email = $('aemail').value.trim();
    btn.disabled = true;
    $('autherr').textContent = '';
    try {
      if (mode === 'login') await login(name, pw); else await register(name, pw, email);
      $('apass').value = '';
      screens.back();
      notify(mode === 'login' ? 'Welcome back!' : `Account created — welcome, ${name}!`, { type: 'success' });
    } catch (err) {
      $('autherr').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
