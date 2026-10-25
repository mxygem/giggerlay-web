// Route (home) screen: summary of the saved route and the big Start button.
import { h, lazy, rangeLabel, textOn } from './dom.js';
import { loadRoute, loadSettings } from '../storage.js';
import { zoneColor } from '../contracts.js';

export function renderRoute(el, ctx) {
  const route = loadRoute();
  const settings = loadSettings();

  if (!route || !route.stops.length) {
    el.append(
      h('section.screen.home',
        h('h1.brand', 'giggerlay'),
        h('div.card',
          h('h2', 'No route yet'),
          h('p.muted', 'Take screenshots or a screen recording of Flex: Itinerary > List, then import them here.'),
        ),
        h('div.actions',
          h('button.btn.big.primary', { type: 'button', onclick: () => ctx.navigate('import') }, 'Import itinerary'),
        ),
      ),
    );
    return;
  }

  // Warm the camera module so Start opens fast (failure is handled on Start).
  lazy('../load/screen.js');

  const stops = route.stops;
  const pkgs = stops.reduce((n, s) => n + (s.packages || 1), 0);
  const guessed = stops.filter((s) => s.guessed).length;
  const checkBtn = h('button.btn.big', { type: 'button', onclick: () => ctx.navigate('review') }, 'Check these');
  const issueLine = h('p.issues.muted', guessed ? `${guessed} number${guessed > 1 ? 's' : ''} guessed` : '');

  lazy('../review.js').then((mod) => {
    if (!mod || !checkBtn.isConnected) return;
    try {
      const r = mod.reviewIssues(stops);
      const n = r.missing.length + r.duplicates.length + r.guessed.length;
      if (n) {
        checkBtn.textContent = `Check these (${n})`;
        checkBtn.classList.add('warn');
        const parts = [];
        if (r.missing.length) parts.push(`missing ${r.missing.map((m) => m.label).join(', ')}`);
        if (r.duplicates.length) parts.push(`${r.duplicates.length} shared address${r.duplicates.length > 1 ? 'es' : ''}`);
        if (r.guessed.length) parts.push(`${r.guessed.length} guessed`);
        issueLine.textContent = parts.join(' · ');
      } else {
        issueLine.textContent = 'Nothing to check.';
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Zone chips: which numbers go with which color.
  const zones = [];
  for (const s of stops) {
    const z = zoneColor(s.number, stops, settings);
    if (!zones.length || zones[zones.length - 1].index !== z.index) zones.push({ ...z, last: s.number });
    else zones[zones.length - 1].last = s.number;
  }

  const when = route.createdAt
    ? new Date(route.createdAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : '';

  el.append(
    h('section.screen.home',
      h('h1.brand', 'giggerlay'),
      h('div.card.summary',
        route.header && h('p.header', route.header),
        h('p.range', rangeLabel(stops)),
        h('p.stats', `${stops.length} stop${stops.length === 1 ? '' : 's'} · ${pkgs} package${pkgs === 1 ? '' : 's'}`),
        h('div.zones', zones.map((z) =>
          h('span.zone', { style: { background: z.color.hex, color: textOn(z.color.hex) } },
            z.from === z.last ? `${z.from}` : `${z.from}-${z.last}`))),
        when && h('p.muted.small', `${route.source === 'typed' ? 'Typed' : 'Imported'} ${when}`),
        issueLine,
      ),
      h('div.actions',
        checkBtn,
        h('button.btn.big', { type: 'button', onclick: () => ctx.navigate('import') }, 'Import'),
        h('button.btn.huge.primary#start', { type: 'button', onclick: () => ctx.startLoad() }, 'Start loading'),
      ),
    ),
  );
}
