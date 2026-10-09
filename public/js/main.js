// Entry point: boots the game behind the loading screen, then runs the main loop.
// Gameplay runs at a fixed 20 ticks per second (like the classic game); rendering runs every
// frame and interpolates between the last two ticks so motion stays smooth at any frame rate.
import { $, sleep, store } from './core/util.js';
import { game } from './core/state.js';
import { settings } from './core/settings.js';
import { initInput } from './core/input.js';
import { renderer, scene, camera, updateSky } from './render/scene.js';
import { vmScene, vmCam, updateViewmodel } from './render/viewmodel.js';
import { updateCamera, rodTip } from './render/camera-rig.js';
import { flushDirty } from './world/mesher.js';
import { updatePlacedBlocks } from './world/placed.js';
import { TICK } from './game/physics.js';
import { drawTag } from './game/characters.js';
import { player, bots, createBots } from './game/entities.js';
import { tickBots, renderBots } from './game/bots.js';
import { tickProjectiles, renderProjectiles } from './game/projectiles.js';
import { updateEffects } from './game/effects.js';
import { tickSession } from './game/session.js';
import { loadMode, MODE_KEY } from './game/mode-loader.js';
import { session, refreshAccount, loginWithCrazyGames } from './net/account.js';
import { cg, initCrazyGames, loadingStart, loadingStop } from './net/crazygames.js';
import { screens, initScreens } from './ui/screens.js';
import { initHud, updateHud } from './ui/hud.js';
import { initMenus } from './ui/menu.js';
import { initOptions, applyAllSettings } from './ui/options.js';
import { initAuth } from './ui/auth.js';
import { initLeaderboard } from './ui/leaderboard.js';
import { initAccountPanel } from './ui/account-panel.js';
import { initLocker } from './ui/locker.js';
import { initTablist } from './ui/tablist.js';
import { initChat } from './ui/chat.js';
import { initNudge } from './ui/nudge.js';
import { initTouch } from './ui/touch.js';

const BOT_COUNT = 7;
const MAX_FRAME = 0.25; // never simulate more than this much catch-up after a stall

function progress(fraction, text) {
  $('loadbar').style.width = `${Math.round(fraction * 100)}%`;
  if (text) $('loadtext').textContent = text;
}

// ---------------------------------------------------------------- main loop
let last = performance.now(), acc = 0, fpsFrames = 0, fpsTime = 0;

function tick() {
  game.time += TICK;
  tickSession();
  tickBots();
  tickProjectiles(TICK);
  updatePlacedBlocks(TICK);
}

function frame(now) {
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    if (settings.showFps) $('fps').textContent = `${Math.round(fpsFrames / fpsTime)} FPS`;
    fpsFrames = 0;
    fpsTime = 0;
  }

  acc += dt;
  while (acc >= TICK) { tick(); acc -= TICK; }
  const alpha = acc / TICK;

  flushDirty();
  updateSky(dt);
  updateEffects(dt);
  renderBots(alpha, dt);
  updateCamera(dt, alpha);
  renderProjectiles(alpha, rodTip);
  if (game.state === 'playing') {
    updateHud(dt);
    updateViewmodel(dt);
  }

  renderer.clear();
  renderer.render(scene, camera);
  if (game.state === 'playing' && player.alive && game.view === 0) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCam);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
/** Sign in: the saved session, or (on CrazyGames) the player's CrazyGames account. */
async function signIn() {
  await refreshAccount();
  if (cg.active && !session.user) await loginWithCrazyGames().catch(() => {});
}

async function boot() {
  const platform = initCrazyGames().then((on) => { if (on) loadingStart(); });
  progress(0.15, 'Building the arena…');
  await sleep(0); // let the loader paint
  loadMode(store.get(MODE_KEY, 'arena'));

  progress(0.5, 'Summoning fighters…');
  await sleep(0);
  createBots(BOT_COUNT);

  progress(0.7, 'Setting up…');
  initScreens();
  initInput();
  initHud();
  initOptions();
  initAuth();
  initLeaderboard();
  initAccountPanel();
  initLocker();
  initTablist();
  initChat();
  initNudge();
  initTouch();
  initMenus();
  applyAllSettings();

  progress(0.85, 'Connecting…');
  await Promise.all([
    Promise.race([document.fonts.ready, sleep(2500)]).then(() => bots.forEach(drawTag)),
    Promise.race([platform.then(signIn), sleep(6000)]),
  ]);
  loadingStop();

  progress(1, 'Ready');
  last = performance.now();
  requestAnimationFrame(frame);
  screens.open('menu');
  await sleep(150);
  $('loader').classList.add('done');
  setTimeout(() => $('loader').remove(), 600);
}

boot().catch((err) => {
  console.error(err);
  progress(1, 'Something went wrong while loading. Please refresh the page.');
  $('loader').classList.add('failed');
});
