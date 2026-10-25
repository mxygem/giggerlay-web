// Settings: zone size and spoken numbers. Saved as soon as they change.
import { h, clear, textOn } from './dom.js';
import { loadSettings, saveSettings, loadRoute, saveRoute } from '../storage.js';
import { ZONE_COLORS } from '../contracts.js';

export function renderSettings(el, ctx) {
  let settings = loadSettings();
  const sizeOut = h('output.size-val', { 'aria-live': 'polite' });
  const preview = h('div.zones');

  function drawSize() {
    sizeOut.textContent = String(settings.zoneSize);
    clear(preview);
    const route = loadRoute();
    const first = route && route.stops.length ? Math.min(...route.stops.map((s) => s.number)) : 2;
    for (let i = 0; i < 4; i++) {
      const c = ZONE_COLORS[i % ZONE_COLORS.length];
      const from = first + i * settings.zoneSize;
      const to = from + settings.zoneSize - 1;
      preview.append(h('span.zone', { style: { background: c.hex, color: textOn(c.hex) } },
        from === to ? `${from}` : `${from}-${to}`));
    }
  }

  function setSize(n) {
    settings = { ...settings, zoneSize: Math.max(1, Math.min(99, n)) };
    saveSettings(settings);
    drawSize();
  }

  const speak = h('input#speak', {
    type: 'checkbox',
    role: 'switch',
    checked: settings.speak,
    onchange() {
      settings = { ...settings, speak: speak.checked };
      saveSettings(settings);
    },
  });

  function testVoice() {
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      synth.speak(new SpeechSynthesisUtterance('12'));
    } catch {
      alert('This browser can\'t speak.');
    }
  }

  function clearRoute() {
    const r = loadRoute();
    if (!r) return;
    if (!confirm(`Delete your saved route (${r.stops.length} stops)?`)) return;
    saveRoute(null);
    ctx.navigate('route');
  }

  el.append(
    h('section.screen.settings',
      h('h1', 'Settings'),
      h('div.card',
        h('h2', 'Zone size'),
        h('p.muted', 'The color changes every this many stops, from the first delivery stop.'),
        h('div.stepper',
          h('button.btn.big', { type: 'button', 'aria-label': 'Smaller zones', onclick: () => setSize(settings.zoneSize - 1) }, '−'),
          sizeOut,
          h('button.btn.big', { type: 'button', 'aria-label': 'Bigger zones', onclick: () => setSize(settings.zoneSize + 1) }, '+')),
        preview),
      h('div.card',
        h('label.switch-row', { for: 'speak' },
          h('span', h('strong', 'Speak numbers'), h('span.muted.small.block', 'Say the stop number out loud for each package.')),
          speak),
        'speechSynthesis' in window &&
          h('button.btn', { type: 'button', onclick: testVoice }, 'Test voice')),
      loadRoute() && h('div.card',
        h('button.btn.danger', { type: 'button', onclick: clearRoute }, 'Delete saved route')),
      h('p.footer', 'giggerlay keeps everything on this phone.'),
    ),
  );
  drawSize();
}
