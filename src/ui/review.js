// Review ("Check these"): problems with the saved route, and the stop list
// where any stop can be fixed or deleted. Every change saves right away.
import { h, clear, lazy, plainStreet, rangeLabel, textOn } from './dom.js';
import { loadRoute, saveRoute, loadSettings } from '../storage.js';
import { zoneColor } from '../contracts.js';

export function renderReview(el, ctx) {
  const root = h('section.screen.review');
  el.append(root);
  let alive = true;
  let open = null; // stop number being edited, or 'new'
  let street = null; // src/street.js once loaded
  let review = null; // src/review.js once loaded

  const fmt = (a) => {
    try {
      return street ? street.formatStreet(a) : plainStreet(a);
    } catch {
      return plainStreet(a);
    }
  };

  function persist(route) {
    route.stops.sort((a, b) => a.number - b.number);
    if (!saveRoute(route)) alert('Couldn\'t save. This browser blocked storage.');
  }

  function issuesCard(stops) {
    if (!review) return h('div.card.muted', 'Checking…');
    let r;
    try {
      r = review.reviewIssues(stops);
    } catch (err) {
      console.error(err);
      return h('div.card.error', 'Couldn\'t check this route.');
    }
    const jump = (n) => h('button.chip', { type: 'button', onclick: () => openStop(n) }, String(n));
    const parts = [];
    if (r.missing.length) {
      parts.push(h('div.issue',
        h('h3', 'Missing'),
        h('p', r.missing.map((m) => m.label).join(', ')),
        h('button.btn.small', { type: 'button', onclick: () => openStop('new', r.missing[0].from) }, 'Add a stop')));
    }
    for (const d of r.duplicates) {
      parts.push(h('div.issue',
        h('h3', 'Same address'),
        h('p', fmt(d.address)),
        h('div.chips', d.numbers.map(jump))));
    }
    if (r.guessed.length) {
      parts.push(h('div.issue',
        h('h3', 'Number guessed'),
        h('p.muted.small', 'Check these against Flex.'),
        h('div.chips', r.guessed.map(jump))));
    }
    if (!parts.length) return h('div.card.ok', h('p', 'Nothing to check.'));
    return h('div.card.issues-card', parts);
  }

  function editor(route, stop, defaultNumber) {
    const isNew = !stop;
    const num = h('input.num', {
      type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off',
      value: String(stop ? stop.number : defaultNumber || ''), 'aria-label': 'Stop number',
    });
    const addr = h('input.addr', {
      type: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off',
      spellcheck: false, value: stop ? fmt(stop.address) : '', placeholder: '1007 ANITA AVE',
      'aria-label': 'Address',
    });
    const pk = h('input.pk', {
      type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off',
      value: String(stop && stop.packages ? stop.packages : 1), 'aria-label': 'Packages',
    });
    const err = h('p.error-text', { 'aria-live': 'polite' });

    function save(e) {
      e.preventDefault();
      err.textContent = '';
      if (!street) {
        err.textContent = 'The address checker could not be loaded.';
        return;
      }
      const n = Number(num.value.trim());
      if (!Number.isInteger(n) || n < 1 || n > 999) {
        err.textContent = 'Stop number must be a whole number.';
        return;
      }
      if (route.stops.some((s) => s !== stop && s.number === n)) {
        err.textContent = `Stop ${n} already exists.`;
        return;
      }
      let parsed = null;
      try {
        parsed = street.parseStreet(addr.value.trim().toUpperCase());
      } catch (ex) {
        console.error(ex);
      }
      if (!parsed) {
        err.textContent = 'That isn\'t a street address. Try like 1007 ANITA AVE or 10635 E HAMPTON AVE APT 3056.';
        addr.focus();
        return;
      }
      const p = Math.floor(Number(pk.value.trim()));
      const next = { number: n, address: parsed, guessed: false };
      if (Number.isFinite(p) && p > 1) next.packages = Math.min(p, 99);
      else if (Number.isFinite(p) && p === 1) next.packages = 1;
      if (isNew) route.stops.push(next);
      else route.stops[route.stops.indexOf(stop)] = next;
      persist(route);
      open = null;
      draw(n);
    }

    function del() {
      if (!confirm(`Delete stop ${stop.number} (${fmt(stop.address)})?`)) return;
      route.stops.splice(route.stops.indexOf(stop), 1);
      persist(route);
      open = null;
      draw();
    }

    return h('form.editor', { onsubmit: save },
      h('div.edit-grid',
        h('label', h('span', 'Stop'), num),
        h('label', h('span', 'Pkgs'), pk)),
      h('label.full', h('span', 'Address'), addr),
      err,
      h('div.row',
        h('button.btn.primary', { type: 'submit' }, 'Save'),
        h('button.btn', { type: 'button', onclick: () => { open = null; draw(); } }, 'Cancel'),
        !isNew && h('button.btn.danger', { type: 'button', onclick: del }, 'Delete')),
    );
  }

  let newDefault = null;
  function openStop(n, def) {
    open = n;
    newDefault = def ?? null;
    draw(n === 'new' ? 'new' : n, true);
  }

  function draw(scrollTo, focus) {
    if (!alive) return;
    const route = loadRoute();
    clear(root);
    if (!route || !route.stops.length) {
      root.append(
        h('h1', 'Check these'),
        h('div.card', h('p', 'No route saved yet.')),
        h('button.btn.big.primary', { type: 'button', onclick: () => ctx.navigate('import') }, 'Import'));
      return;
    }
    const settings = loadSettings();
    const stops = route.stops;
    const list = h('ol.stops');
    for (const s of stops) {
      const z = zoneColor(s.number, stops, settings);
      const isOpen = open === s.number;
      const li = h('li.stop', { id: `stop-${s.number}`, class: isOpen ? 'open' : '' },
        h('button.stop-row', {
          type: 'button',
          'aria-expanded': String(isOpen),
          onclick: () => { open = isOpen ? null : s.number; draw(s.number, !isOpen); },
        },
        h('span.stop-num', { style: { background: z.color.hex, color: textOn(z.color.hex) } }, String(s.number)),
        h('span.stop-body',
          h('span.stop-addr', fmt(s.address)),
          (s.guessed || s.packages > 1) && h('span.tags',
            s.guessed && h('span.tag.guess', 'Number guessed'),
            s.packages > 1 && h('span.tag', `${s.packages} pkgs`)))),
        isOpen && editor(route, s));
      list.append(li);
    }

    root.append(
      h('h1', 'Check these'),
      h('p.muted', `${rangeLabel(stops)} · ${stops.length} stops`),
      issuesCard(stops),
      h('h2', 'Stops'),
      h('p.muted.small', 'Tap a stop to fix it.'),
      open === 'new'
        ? h('div.card#stop-new', h('h3', 'New stop'), editor(route, null, newDefault))
        : h('button.btn', { type: 'button', onclick: () => openStop('new', null) }, 'Add a stop'),
      list,
    );

    if (scrollTo != null) {
      const target = document.getElementById(scrollTo === 'new' ? 'stop-new' : `stop-${scrollTo}`);
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
        if (focus) {
          const input = target.querySelector('input.addr');
          if (input) input.focus({ preventScroll: true });
        }
      }
    }
  }

  draw();
  Promise.all([lazy('../street.js'), lazy('../review.js')]).then(([s, r]) => {
    street = s && typeof s.parseStreet === 'function' ? s : null;
    review = r && typeof r.reviewIssues === 'function' ? r : { reviewIssues: () => { throw new Error('review.js missing'); } };
    draw();
  });

  return () => {
    alive = false;
  };
}
