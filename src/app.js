// giggerlay web: app shell, hash routing, load overlay, service worker.
// Screens only import our own UI modules statically; every other agent's
// module (OCR, camera, parsing) is loaded lazily so the home screen still
// works if one of them fails.
import { h, clear, lazy } from './ui/dom.js';
import { loadRoute, loadSettings } from './storage.js';
import { renderRoute } from './ui/route.js';
import { renderImport } from './ui/import.js';
import { renderReview } from './ui/review.js';
import { renderSettings } from './ui/settings.js';

const SCREENS = {
  route: { render: renderRoute, title: 'Route' },
  import: { render: renderImport, title: 'Import' },
  review: { render: renderReview, title: 'Check these' },
  settings: { render: renderSettings, title: 'Settings' },
};

const main = document.getElementById('main');
const loadEl = document.getElementById('load');
let cleanup = null;
let busy = 0; // > 0 while an import is running: don't reload under it
let loading = false;
let pendingReload = false;

function screenName() {
  const name = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return SCREENS[name] ? name : 'route';
}

export function navigate(name) {
  const target = `#/${name}`;
  if (location.hash === target) render();
  else location.hash = target;
}

const ctx = {
  navigate,
  startLoad,
  setBusy(on) {
    busy = Math.max(0, busy + (on ? 1 : -1));
    maybeReload();
  },
};

function render() {
  if (maybeReload()) return;
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch (err) { console.error(err); }
  }
  cleanup = null;
  const name = screenName();
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.screen === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = name === 'route' ? 'giggerlay' : `${SCREENS[name].title} · giggerlay`;
  clear(main);
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  try {
    cleanup = SCREENS[name].render(main, ctx) || null;
  } catch (err) {
    console.error(err);
    main.append(h('div.card.error', 'Something went wrong on this screen. ', String(err && err.message || err)));
  }
}

// ---- Load (camera) overlay -------------------------------------------------

/** Must run inside the Start tap: iOS only allows speech after a gesture. */
function unlockSpeech() {
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance !== 'function') return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.cancel();
    synth.speak(u);
  } catch {
    /* no speech on this browser; the load screen still works */
  }
}

let loadCleanup = null;

function closeLoad() {
  const fn = loadCleanup;
  loadCleanup = null;
  if (typeof fn === 'function') {
    try { fn(); } catch (err) { console.error(err); }
  }
  clear(loadEl);
  loadEl.hidden = true;
  document.body.classList.remove('loading');
  main.inert = false;
  loading = false;
  navigate('route');
}

function loadMessage(text, withClose) {
  clear(loadEl);
  loadEl.append(
    h('div.load-msg',
      h('p', text),
      withClose && h('button.btn.big', { type: 'button', onclick: closeLoad }, 'Back')),
  );
}

/** Called from the Start loading button's click handler (the user gesture). */
export function startLoad() {
  if (loading) return;
  const route = loadRoute();
  if (!route || !route.stops.length) {
    navigate('import');
    return;
  }
  const settings = loadSettings();
  if (settings.speak) unlockSpeech(); // synchronously, still inside the tap
  loading = true;
  loadEl.hidden = false;
  document.body.classList.add('loading');
  main.inert = true;
  loadMessage('Starting camera…', false);

  let finished = false;
  const onDone = () => {
    if (finished) return;
    finished = true;
    closeLoad();
  };

  lazy('../load/screen.js').then(async (mod) => {
    if (finished) return;
    if (!mod || typeof mod.mountLoadScreen !== 'function') {
      loadMessage('The camera screen could not be loaded. Check your signal and try again.', true);
      return;
    }
    clear(loadEl);
    try {
      const ret = await mod.mountLoadScreen(loadEl, route, settings, { onDone });
      if (typeof ret === 'function') {
        if (finished) ret();
        else loadCleanup = ret;
      }
    } catch (err) {
      console.error(err);
      if (!finished) loadMessage(`The camera didn't start: ${err && err.message || err}`, true);
    }
  });
}

// ---- Service worker: offline after first use, pick up new deploys ----------

function maybeReload() {
  if (!pendingReload || busy || loading) return false;
  pendingReload = false;
  location.reload();
  return true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // First install takes control without needing a reload.
    if (!hadController) return;
    pendingReload = true;
    // Reload right away only on the home screen; elsewhere wait for the next
    // screen change so we never yank an edit or an import away.
    if (screenName() === 'route') maybeReload();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((err) => console.warn('giggerlay: service worker not registered', err));
}

window.addEventListener('hashchange', render);
render();
registerServiceWorker();
