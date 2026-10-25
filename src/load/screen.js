// Load screen: camera + guide frame + big stop number. Loop: crop guide area
// -> barcodes -> OCR -> session -> render/speak. One OCR at a time.
import { createLoadSession } from './session.js';
import { openCamera, cameraErrorText, cssRectToVideo } from './camera.js';
import { detect } from './barcode.js';
import { say, cancel as cancelSpeech } from './voice.js';
import { recognize } from '../ocr.js';

const MAX_CROP_W = 1280; // downscale big crops: OCR cost grows with pixels
const CSS_URL = new URL('./load.css', import.meta.url).href;

function ensureCss() {
  if (document.querySelector(`link[href="${CSS_URL}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = CSS_URL;
  document.head.appendChild(l);
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/**
 * @param {HTMLElement} host
 * @param {import('../contracts.js').Route} route
 * @param {import('../contracts.js').Settings} settings
 * @param {{onDone?: () => void, ocr?: Function, barcodes?: Function}} [opts] ocr/barcodes override for tests
 * @returns {() => void} cleanup
 */
export function mountLoadScreen(host, route, settings, { onDone, ocr = recognize, barcodes = detect } = {}) {
  ensureCss();
  const session = createLoadSession(route, settings);
  let alive = true, cam = null, wakeLock = null, timer = 0, torchOn = false;

  // ---- DOM
  const root = el('div', 'ld');
  const video = el('video');
  const panel = el('div', 'ld-panel');
  const num = el('div', 'ld-num'), addr = el('div', 'ld-addr'), sub = el('div', 'ld-sub');
  const hint = el('div', 'ld-hint', 'Point at a label');
  panel.append(hint, num, addr, sub);
  const guide = el('div', 'ld-guide');
  const stats = el('div', 'ld-stats', 'starting…');
  const foot = el('div', 'ld-foot');
  const count = el('div', 'ld-count', '0 packages · 0 stops');
  const torchBtn = el('button', 'ld-btn ghost', 'Torch');
  const doneBtn = el('button', 'ld-btn', 'Done');
  torchBtn.type = doneBtn.type = 'button';
  torchBtn.hidden = true;
  foot.append(count, torchBtn, doneBtn);
  root.append(video, guide, panel, stats, foot);
  host.append(root);

  const done = () => { cleanup(); onDone?.(); };
  doneBtn.onclick = done;
  torchBtn.onclick = async () => {
    if (!cam) return;
    if (await cam.setTorch(!torchOn)) torchOn = !torchOn;
    torchBtn.classList.toggle('on', torchOn);
  };

  // ---- render
  let lastKey = '';
  function render(state) {
    const d = state.display;
    const c = state.counts;
    count.textContent = `${c.packages} package${c.packages === 1 ? '' : 's'} · ${c.stops} stop${c.stops === 1 ? '' : 's'}`;
    panel.classList.toggle('stale', !!d.stale);
    const key = `${d.kind}|${d.text}|${d.address}|${d.zoneLabel}|${d.packageLabel}`;
    if (key === lastKey) return;
    lastKey = key;
    hint.hidden = d.kind !== 'idle';
    panel.style.backgroundColor = d.kind === 'idle' ? '' : d.color;
    num.textContent = d.text;
    addr.textContent = d.address;
    sub.textContent = [d.zoneLabel, d.packageLabel].filter(Boolean).join(' · ');
    fitNumber();
  }
  // Number ~36% of screen height, shrunk to fit the width ("12 or 13", "188").
  function fitNumber() {
    const n = Math.max(1, num.textContent.length);
    const px = Math.min(innerHeight * 0.36, (innerWidth * 0.94) / (n * 0.6));
    num.style.fontSize = `${Math.floor(px)}px`;
  }
  addEventListener('resize', fitNumber);

  // ---- wake lock
  async function lockScreen() {
    try { if (!document.hidden && navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); } }
    catch { /* unsupported or denied: the screen may dim */ }
  }
  const onVis = () => { if (!document.hidden) { lockScreen(); schedule(0); } };
  document.addEventListener('visibilitychange', onVis);

  // ---- frame loop
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let busy = false, ocrMs = 0, bcMs = 0, frames = 0, t0 = performance.now(), fps = 0;

  function grabCrop() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    const vr = video.getBoundingClientRect(), gr = guide.getBoundingClientRect();
    const r = cssRectToVideo({ x: gr.left - vr.left, y: gr.top - vr.top, w: gr.width, h: gr.height }, vr.width, vr.height, vw, vh);
    if (r.w < 8 || r.h < 8) return false;
    const s = Math.min(1, MAX_CROP_W / r.w);
    canvas.width = Math.round(r.w * s);
    canvas.height = Math.round(r.h * s);
    ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
    return true;
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (alive) timer = setTimeout(tick, ms);
  }

  async function tick() {
    if (!alive || busy || document.hidden) return; // visibilitychange restarts us
    if (!grabCrop()) return schedule(100);
    busy = true;
    try {
      const a = performance.now();
      const codes = await barcodes(canvas).catch(() => []);
      const b = performance.now();
      const lines = await ocr(canvas);
      const c = performance.now();
      if (!alive) return;
      bcMs = bcMs ? bcMs * 0.7 + (b - a) * 0.3 : b - a;
      ocrMs = ocrMs ? ocrMs * 0.7 + (c - b) * 0.3 : c - b;
      const state = session.onFrame({ lines, barcodes: codes });
      render(state);
      if (state.announce && settings?.speak) say(state.announce);
      frames++;
      const now = performance.now();
      if (now - t0 > 1000) { fps = (frames * 1000) / (now - t0); frames = 0; t0 = now; }
      stats.textContent = `${fps.toFixed(1)} fps · ocr ${Math.round(ocrMs)}ms · bc ${Math.round(bcMs)}ms`;
      root.dataset.ocrMs = String(Math.round(c - b)); // for e2e checks
    } catch (e) {
      console.error('load frame failed', e);
      stats.textContent = `error: ${e?.message || e}`;
    } finally {
      busy = false;
    }
    // Next frame right away (we never queue: one OCR in flight). A short rest
    // proportional to OCR time keeps the UI responsive and the phone cooler.
    schedule(Math.min(150, ocrMs * 0.1));
  }

  // ---- start
  function showError(text) {
    const box = el('div', 'ld-error');
    const b = el('button', 'ld-btn', 'Done');
    b.type = 'button';
    b.onclick = done;
    box.append(el('p', '', text), b);
    root.append(box);
  }

  openCamera(video).then((c) => {
    if (!alive) { c.stop(); return; }
    cam = c;
    torchBtn.hidden = !c.hasTorch;
    lockScreen();
    schedule(0);
  }, (e) => { if (alive) showError(cameraErrorText(e)); });

  function cleanup() {
    if (!alive) return;
    alive = false;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
    removeEventListener('resize', fitNumber);
    if (torchOn) cam?.setTorch(false);
    cam?.stop();
    wakeLock?.release?.().catch?.(() => {});
    wakeLock = null;
    cancelSpeech();
    root.remove();
  }
  return cleanup;
}
