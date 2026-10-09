// Account screen: stats summary, email, change password, delete account.
// CrazyGames-linked accounts have no password: those sections adapt (or hide) for them.
import { $, esc } from '../core/util.js';
import { game } from '../core/state.js';
import { MODES } from '../shared/modes.js';
import { session, refreshAccount, changePassword, deleteAccount, setEmail } from '../net/account.js';
import { screens } from './screens.js';
import { notify } from './toasts.js';

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function renderSummary() {
  const { user, stats } = session;
  if (!user) { screens.back(); return; }
  const s = stats || { rank: '—', kills: 0, deaths: 0, kd: 0, bestStreak: 0, coins: 0, seconds: 0 };
  $('accname').textContent = user.name;
  $('accsub').textContent = `${MODES[game.mode].name} · all-time stats`;
  $('accsummary').innerHTML = [
    ['World rank', stats ? `#${s.rank}` : '—'], ['Kills', s.kills], ['Deaths', s.deaths], ['K/D', (s.kd ?? 0).toFixed(2)],
    ['Best streak', s.bestStreak], ['Coins', s.coins], ['Time played', formatTime(s.seconds || 0)],
  ].map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${k}</span></div>`).join('');

  const noPassword = user.hasPassword === false;
  $('emailform').classList.toggle('hidden', user.platform === 'crazygames'); // your CrazyGames account is your login
  $('emailcur').textContent = user.email ? `Your email: ${user.email}. You can log in with it instead of your username.` : 'No email yet. Add one to log in with it.';
  $('emailremove').classList.toggle('hidden', !user.email);
  $('emailpwwrap').classList.toggle('hidden', noPassword);
  $('pwform').classList.toggle('hidden', noPassword);
  $('delpwlabel').textContent = noPassword ? `Type your username (${user.name}) to confirm` : 'Confirm with your password';
  $('delpw').type = noPassword ? 'text' : 'password';
  $('delpw').autocomplete = noPassword ? 'off' : 'current-password';
}

async function saveEmail(email) {
  const btn = $('emailform').querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await setEmail($('emailpw').value, email);
    $('emailpw').value = '';
    $('emailnew').value = '';
    renderSummary();
    setMsg('emailmsg', email ? 'Email saved.' : 'Email removed.', true);
  } catch (err) {
    setMsg('emailmsg', err.message);
  } finally {
    btn.disabled = false;
  }
}

function setMsg(id, text, ok = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('ok', ok);
}

export function initAccountPanel() {
  screens.register('account', {
    onOpen() {
      renderSummary();
      setMsg('pwmsg', '');
      setMsg('delmsg', '');
      setMsg('emailmsg', '');
      $('delzone').open = false;
      refreshAccount().then(() => { if (screens.top() === 'account') renderSummary(); });
    },
  });

  $('pwform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('pwform').querySelector('button');
    if ($('pwnew').value !== $('pwconfirm').value) { setMsg('pwmsg', "The new passwords don't match."); return; }
    btn.disabled = true;
    try {
      await changePassword($('pwcur').value, $('pwnew').value);
      $('pwform').reset();
      setMsg('pwmsg', 'Password changed. Other devices have been signed out.', true);
    } catch (err) {
      setMsg('pwmsg', err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $('emailform').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('emailnew').value.trim();
    if (!email) { setMsg('emailmsg', 'Type an email address first.'); return; }
    saveEmail(email);
  });
  $('emailremove').onclick = () => saveEmail('');

  $('delform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('delform').querySelector('button');
    btn.disabled = true;
    try {
      const v = $('delpw').value;
      await deleteAccount(v, v);
      $('delform').reset();
      screens.reset('menu');
      notify('Your account and stats have been deleted.', { type: 'success' });
    } catch (err) {
      setMsg('delmsg', err.message);
    } finally {
      btn.disabled = false;
    }
  });
}
