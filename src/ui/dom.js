// Tiny DOM helpers shared by the screens. No framework.

/**
 * h('div.card#id', {onclick, class, style, ...attrs}, ...children)
 * Children may be strings, nodes, arrays, null/false (skipped).
 */
export function h(tag, props, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') { if (v) el.className += (el.className ? ' ' : '') + v; }
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value' || (k in el && typeof v !== 'string')) el[k] = v;
    else if (v !== false) el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Fallback address text when src/street.js can't be loaded. */
export function plainStreet(a) {
  if (!a) return '';
  return [a.number, a.direction, a.name, a.type, a.unit && `APT ${a.unit}`]
    .filter(Boolean)
    .join(' ');
}

/** "Stops 2-31" for a list of stops. */
export function rangeLabel(stops) {
  if (!stops || !stops.length) return 'No stops';
  const nums = stops.map((s) => s.number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi ? `Stop ${lo}` : `Stops ${lo}-${hi}`;
}

/** Lazy-load another agent's module; resolves null (and logs) on failure. */
const cache = new Map();
export function lazy(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      import(path).catch((err) => {
        console.warn(`giggerlay: could not load ${path}`, err);
        cache.delete(path);
        return null;
      }),
    );
  }
  return cache.get(path);
}

/** Pick a readable text color (black/white) for a background hex. */
export function textOn(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#000' : '#fff';
}

export function warningText(w) {
  if (w == null) return '';
  if (typeof w === 'string') return w;
  return w.message || w.text || JSON.stringify(w);
}
