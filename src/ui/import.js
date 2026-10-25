// Import screen: read Flex screenshots / screen recordings on the phone, or
// build a route from typed addresses.
import { h, clear, lazy, rangeLabel, warningText } from './dom.js';
import { loadRoute, saveRoute } from '../storage.js';

// The import keeps running if the user leaves this screen; the state lives
// here so coming back shows where it got to.
const job = {
  running: false,
  fraction: null, // 0-1 or null when unknown
  message: '',
  result: null, // {saved, stops, header, warnings, pages, error?}
  previous: undefined, // route before the last successful import (for Undo)
};
let view = null; // re-render hook of the mounted screen

function notify() {
  if (view) view();
}

const PHASES = {
  skim: 'Finding sharp frames',
  read: 'Reading',
};

const skimmed = new Set();

function readProgress(p, total) {
  let fraction = null;
  let message = '';
  if (typeof p === 'number') {
    if (typeof total === 'number' && total > 0) fraction = p / total;
    else fraction = p > 1 ? p / 100 : p;
  } else if (p && typeof p === 'object') {
    if (typeof p.fraction === 'number') fraction = p.fraction;
    else if (typeof p.progress === 'number') fraction = p.progress > 1 ? p.progress / 100 : p.progress;
    else if (typeof p.done === 'number' && p.total > 0) fraction = p.done / p.total;
    // A video is skimmed first, then read: count skimming as the first 30%.
    if (p.phase === 'skim') skimmed.add(p.file);
    if (fraction != null && skimmed.has(p.file)) {
      fraction = p.phase === 'skim' ? fraction * 0.3 : 0.3 + fraction * 0.7;
    }
    // importer.js reports per file: {done, total, phase, file, files}.
    if (fraction != null && p.files > 1 && typeof p.file === 'number') {
      fraction = (p.file + fraction) / p.files;
    }
    const phase = PHASES[p.phase] || p.phase || '';
    const counts = typeof p.done === 'number' && p.total > 0 ? ` ${p.done} of ${p.total}` : '';
    const file = p.files > 1 && typeof p.file === 'number' ? `File ${p.file + 1} of ${p.files} · ` : '';
    message = p.message || p.label || (phase ? `${file}${phase}${counts}` : '');
  } else if (typeof p === 'string') {
    message = p;
  }
  if (fraction != null) fraction = Math.max(0, Math.min(1, fraction));
  return { fraction, message: String(message || '') };
}

async function runImport(files, ctx) {
  if (job.running || !files.length) return;
  job.running = true;
  job.fraction = 0;
  job.message = `Reading ${files.length} file${files.length > 1 ? 's' : ''}…`;
  job.result = null;
  skimmed.clear();
  ctx.setBusy(true);
  notify();
  try {
    const mod = await lazy('../import/importer.js');
    if (!mod || typeof mod.importFiles !== 'function') {
      throw new Error('The importer could not be loaded. Check your signal and try again.');
    }
    const out = await mod.importFiles(files, {
      onProgress(p, total) {
        const r = readProgress(p, total);
        if (r.fraction != null) job.fraction = r.fraction;
        if (r.message) job.message = r.message;
        notify();
      },
    });
    const stops = (out && Array.isArray(out.stops) ? out.stops : []).slice().sort((a, b) => a.number - b.number);
    const warnings = (out && out.warnings ? out.warnings : []).map(warningText)
      .filter((w) => w && !(stops.length === 0 && /^no stops found\b/i.test(w)));
    let saved = false;
    if (stops.length > 0) {
      job.previous = loadRoute();
      saved = saveRoute({
        stops,
        ...(out.header ? { header: out.header } : {}),
        createdAt: Date.now(),
        source: 'import',
      });
    }
    job.result = {
      saved,
      stops,
      header: out && out.header,
      warnings,
      pages: out && Array.isArray(out.pages) ? out.pages.length : null,
      files: files.length,
    };
  } catch (err) {
    console.error(err);
    job.result = { error: String((err && err.message) || err), stops: [], warnings: [] };
  } finally {
    job.running = false;
    job.fraction = null;
    ctx.setBusy(false);
    notify();
  }
}

function resultCard(ctx) {
  const r = job.result;
  if (!r) return null;
  if (r.error) {
    return h('div.card.error',
      h('h2', 'Import failed'),
      h('p', r.error),
      h('p.muted', 'Your saved route wasn\'t changed.'));
  }
  const warnings = r.warnings.length
    ? h('ul.warnings', r.warnings.map((w) => h('li', w)))
    : null;
  if (!r.stops.length) {
    return h('div.card.error',
      h('h2', 'No stops found'),
      h('p', 'No stops found — your saved route wasn\'t changed.'),
      h('p.muted', 'Use screenshots of Flex: Itinerary > List, with the stop numbers showing.'),
      warnings);
  }
  if (!r.saved) {
    return h('div.card.error',
      h('h2', `Found ${r.stops.length} stops, but couldn't save them`),
      h('p', 'This browser wouldn\'t let giggerlay save. If you\'re in a private tab, open it in a normal tab.'),
      warnings);
  }
  const guessed = r.stops.filter((s) => s.guessed).length;
  const pages = r.pages != null ? ` from ${r.pages} page${r.pages === 1 ? '' : 's'}` : '';
  const card = h('div.card.ok',
    h('h2', `Saved ${r.stops.length} stop${r.stops.length === 1 ? '' : 's'}`),
    r.header && h('p.header', r.header),
    h('p', `${rangeLabel(r.stops)}${pages}${guessed ? ` · ${guessed} number${guessed > 1 ? 's' : ''} guessed` : ''}`),
    warnings,
    h('div.row',
      h('button.btn.primary', { type: 'button', onclick: () => ctx.navigate('review') }, 'Check these'),
      h('button.btn', { type: 'button', onclick: () => ctx.navigate('route') }, 'Done')),
    job.previous !== undefined && h('button.btn.link', {
      type: 'button',
      onclick() {
        saveRoute(job.previous || null);
        job.previous = undefined;
        job.result = null;
        ctx.navigate('route');
      },
    }, job.previous ? 'Undo — keep my old route' : 'Undo'),
  );
  return card;
}

function typedSection(ctx) {
  const area = h('textarea#typed', {
    rows: 6,
    placeholder: '1007 ANITA AVE\n10635 E HAMPTON AVE APT 3056\n…',
    autocapitalize: 'characters',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: false,
    'aria-label': 'Addresses, one per line',
  });
  const out = h('div.typed-out', { 'aria-live': 'polite' });

  async function build(force) {
    clear(out);
    const mod = await lazy('../itinerary.js');
    if (!mod || typeof mod.parseTypedAddresses !== 'function') {
      out.append(h('p.error-text', 'The address reader could not be loaded.'));
      return;
    }
    let res;
    try {
      res = mod.parseTypedAddresses(area.value);
    } catch (err) {
      out.append(h('p.error-text', String(err && err.message || err)));
      return;
    }
    const stops = res.stops || [];
    const errors = res.errors || [];
    if (!stops.length) {
      out.append(h('p.error-text', 'No addresses read — your saved route wasn\'t changed.'),
        errors.length && h('ul.warnings', errors.map((e) => h('li', e))));
      return;
    }
    if (errors.length && !force) {
      out.append(
        h('p.error-text', `${errors.length} line${errors.length > 1 ? 's' : ''} couldn't be read:`),
        h('ul.warnings', errors.map((e) => h('li', e))),
        h('button.btn', { type: 'button', onclick: () => build(true) },
          `Save the ${stops.length} that worked`),
      );
      return;
    }
    const prev = loadRoute();
    if (prev && prev.stops.length &&
        !confirm(`Replace your saved route (${prev.stops.length} stops) with these ${stops.length}?`)) {
      return;
    }
    const ok = saveRoute({ stops, createdAt: Date.now(), source: 'typed' });
    if (!ok) {
      out.append(h('p.error-text', 'This browser wouldn\'t let giggerlay save.'));
      return;
    }
    area.value = '';
    out.append(
      h('p.ok-text', `Saved ${stops.length} stop${stops.length === 1 ? '' : 's'} (${rangeLabel(stops)}).`),
      h('div.row',
        h('button.btn.primary', { type: 'button', onclick: () => ctx.navigate('route') }, 'Done'),
        h('button.btn', { type: 'button', onclick: () => ctx.navigate('review') }, 'Check these')),
    );
  }

  return h('details.card.typed',
    h('summary', 'Type addresses'),
    h('p.muted', 'One address per line, in stop order. The first line is stop 1.'),
    area,
    h('button.btn.big', { type: 'button', onclick: () => build(false) }, 'Make route'),
    out);
}

export function renderImport(el, ctx) {
  const input = h('input#files', {
    type: 'file',
    accept: 'image/*,video/*',
    multiple: true,
    class: 'visually-hidden',
    onchange() {
      const files = Array.from(input.files || []);
      input.value = '';
      runImport(files, ctx);
    },
  });

  const status = h('div.import-status', { 'aria-live': 'polite' });
  const pick = h('label.btn.huge.primary.file-pick', { for: 'files' }, 'Choose screenshots or recording');

  function update() {
    clear(status);
    pick.classList.toggle('disabled', job.running);
    input.disabled = job.running;
    if (job.running) {
      const bar = h('progress', { max: 1 });
      if (job.fraction != null) bar.value = job.fraction;
      else bar.removeAttribute('value');
      status.append(
        h('div.card',
          h('p', job.message || 'Reading…'),
          bar,
          h('p.muted.small', 'Keep this screen open.')),
      );
    } else {
      const card = resultCard(ctx);
      if (card) status.append(card);
    }
  }

  const typed = typedSection(ctx);
  el.append(
    h('section.screen.import',
      h('h1', 'Import'),
      h('p.muted', 'Flex: Itinerary > List. Screenshots (long ones are fine) or a slow screen recording scrolling the list.'),
      input,
      pick,
      status,
      typed,
      h('p.footer', 'Everything is read on this phone. Nothing is uploaded.'),
    ),
  );

  view = update;
  update();
  return () => {
    if (view === update) view = null;
    // Once the result has been seen and the user moved on, forget it (and
    // its Undo) so a later visit can't undo edits made since.
    if (!job.running) {
      job.result = null;
      job.previous = undefined;
    }
  };
}
