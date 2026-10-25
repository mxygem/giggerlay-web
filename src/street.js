// Street-line parsing for labels and itineraries. Pure logic, no DOM.

/** Direction words -> abbreviation. */
const DIRECTION_WORDS = {
  N: 'N', S: 'S', E: 'E', W: 'W', NE: 'NE', NW: 'NW', SE: 'SE', SW: 'SW',
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
};
export const DIRECTIONS = Object.freeze(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

/** USPS suffix variants -> normalized abbreviation. */
const TYPE_VARIANTS = {
  AVE: ['AVE', 'AVENUE', 'AV', 'AVN', 'AVNUE', 'AVEN'],
  ST: ['ST', 'STREET', 'STR', 'STRT'],
  RD: ['RD', 'ROAD'],
  DR: ['DR', 'DRIVE', 'DRV', 'DRIV'],
  LN: ['LN', 'LANE'],
  CT: ['CT', 'COURT', 'CRT'],
  CIR: ['CIR', 'CIRCLE', 'CIRC', 'CRCL', 'CIRCL'],
  BLVD: ['BLVD', 'BOULEVARD', 'BOUL', 'BOULV', 'BLV'],
  WAY: ['WAY', 'WY'],
  PL: ['PL', 'PLACE'],
  TER: ['TER', 'TERRACE', 'TERR'],
  PKWY: ['PKWY', 'PARKWAY', 'PKY', 'PARKWY', 'PKWAY'],
  HWY: ['HWY', 'HIGHWAY', 'HIWAY', 'HWAY'],
  TRL: ['TRL', 'TRAIL', 'TR', 'TRAILS', 'TRLS'],
  LOOP: ['LOOP', 'LP'],
  SQ: ['SQ', 'SQUARE', 'SQR'],
  PATH: ['PATH', 'PATHS'],
  RUN: ['RUN'],
  XING: ['XING', 'CROSSING', 'CRSSNG'],
  ALY: ['ALY', 'ALLEY', 'ALLY'],
  BND: ['BND', 'BEND'],
  CV: ['CV', 'COVE'],
  CRES: ['CRES', 'CRESCENT', 'CRSNT'],
  EXPY: ['EXPY', 'EXPRESSWAY', 'EXPWY'],
  FWY: ['FWY', 'FREEWAY'],
  GRV: ['GRV', 'GROVE'],
  HTS: ['HTS', 'HEIGHTS'],
  HOLW: ['HOLW', 'HOLLOW'],
  LNDG: ['LNDG', 'LANDING'],
  MDW: ['MDW', 'MEADOW', 'MDWS', 'MEADOWS'],
  PARK: ['PARK', 'PRK'],
  PASS: ['PASS'],
  PIKE: ['PIKE', 'PIKES'],
  PLZ: ['PLZ', 'PLAZA'],
  PT: ['PT', 'POINT'],
  RDG: ['RDG', 'RIDGE'],
  ROW: ['ROW'],
  SPUR: ['SPUR'],
  TPKE: ['TPKE', 'TURNPIKE'],
  VW: ['VW', 'VIEW'],
  VIS: ['VIS', 'VISTA'],
  WALK: ['WALK'],
  CTR: ['CTR', 'CENTER'],
  CMN: ['CMN', 'COMMON', 'COMMONS'],
  EST: ['EST', 'ESTATE', 'ESTATES'],
  GLN: ['GLN', 'GLEN'],
  GRN: ['GRN', 'GREEN'],
  HL: ['HL', 'HILL'],
  KNL: ['KNL', 'KNOLL'],
  MNR: ['MNR', 'MANOR'],
  OVAL: ['OVAL'],
  PNES: ['PNES', 'PINES'],
  RTE: ['RTE', 'ROUTE'],
  TRCE: ['TRCE', 'TRACE'],
  VLY: ['VLY', 'VALLEY'],
};
const TYPE_MAP = new Map();
for (const [norm, vs] of Object.entries(TYPE_VARIANTS)) for (const v of vs) TYPE_MAP.set(v, norm);
export const STREET_TYPES = Object.freeze(Object.keys(TYPE_VARIANTS));

/** Unit markers ("AP" is OCR of APT). */
const UNIT_MARKERS = new Set([
  'APT', 'AP', 'APARTMENT', 'UNIT', 'STE', 'SUITE', '#', 'BLDG', 'BLD', 'LOT',
  'SPC', 'SPACE', 'RM', 'ROOM', 'FLOOR', 'TRLR', 'DEPT',
]);
const UNIT_GLUED = /^(APT|AP|UNIT|STE|BLDG|LOT|SPC|RM|#)([0-9][0-9A-Z-]*)$/;
const UNIT_VALUE = /^(?=.*\d)[0-9A-Z][0-9A-Z-]{0,6}$|^[A-Z]$/;

/** Normalized street type for a word ("Avenue" -> "AVE"), or null. */
export function normalizeType(word) {
  if (!word) return null;
  return TYPE_MAP.get(String(word).toUpperCase().replace(/\.$/, '')) ?? null;
}

const REJECT = [
  /\d{1,2}\s*:\s*\d{2}/, // times "05:00", "3:00"
  /\$\s*\d/, // prices
  /\b\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\b/, // dates "10/23"
  /\b\d+\s+OF\s+\d+\b/i, // "2 OF 3"
  /\b\d+(\.\d+)?\s*(HR|HRS|HOURS?|MIN|MINS|MINUTES?|SEC|SECS|LB|LBS|KG|KGS|OZ)\b/i,
  /\b(LBS?|KGS?|OZ|MINS|HRS|POUNDS?|PACKAGES?|PKGS?|PARCELS?|ITEMS?)\b/i,
];

/** True for times, prices, dates, counts and weights — never an address. */
export function isRejectedLine(text) {
  const t = String(text ?? '');
  return REJECT.some((re) => re.test(t));
}

/** Digit string for an OCR'd house number (O->0, I/l->1), or null. */
function houseNumber(tok) {
  if (!/^[0-9OoIl|]{1,6}$/.test(tok) || !/\d/.test(tok)) return null;
  const n = tok.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
  return n[0] === '0' ? null : n;
}

const isNameToken = (t) => /^[A-Z][A-Z'-]*$/.test(t) || /^\d{1,3}(ST|ND|RD|TH)$/.test(t);

/** Try to read an address starting at token i. */
function parseAt(raw, up, i) {
  const number = houseNumber(raw[i]);
  if (!number) return null;
  // Try with a leading direction first, then without (e.g. "100 E ST").
  const dir = DIRECTION_WORDS[up[i + 1]];
  for (const start of dir ? [i + 2, i + 1] : [i + 1]) {
    const r = parseRest(up, start);
    if (r) return { number, ...(start === i + 2 ? { direction: dir } : {}), ...r };
  }
  return null;
}

/** Name (1-3 tokens) + type + optional trailing direction + optional unit. */
function parseRest(up, s) {
  let best = null;
  for (let n = 1; n <= 3 && s + n < up.length; n++) {
    const name = up.slice(s, s + n);
    const nameOk = name.every(isNameToken) ||
      (n === 1 && /^\d{1,3}$/.test(name[0])); // "1007 5 ST"
    if (!nameOk) break;
    const type = normalizeType(up[s + n]);
    if (type) best = { name: name.join(' '), type, next: s + n + 1 }; // longest wins
  }
  if (!best) return null;
  const out = { name: best.name, type: best.type };
  let k = best.next;
  // Trailing direction only when nothing but a unit (or the end) follows it.
  const tdir = DIRECTION_WORDS[up[k]];
  if (tdir && (k + 1 >= up.length || UNIT_MARKERS.has(up[k + 1]))) {
    out.trailingDirection = tdir;
    k++;
  }
  if (UNIT_MARKERS.has(up[k])) {
    const v = up[k + 1]?.replace(/^#/, '');
    if (v && UNIT_VALUE.test(v)) out.unit = v;
    else if (k + 1 >= up.length) out.bareUnit = true; // "... AVE APT" — unit on a later line
  } else if (up[k] && UNIT_GLUED.test(up[k])) {
    out.unit = up[k].match(UNIT_GLUED)[2];
  }
  return out;
}

function tokenize(text) {
  return String(text ?? '')
    .replace(/#/g, ' # ')
    .replace(/[.,;]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Parse with extra detail: {address, bareUnit} where bareUnit means the
 * street ended in a unit marker with no value ("... AVE APT").
 * @returns {{address: import('./contracts.js').StreetAddress, bareUnit: boolean}|null}
 */
export function parseStreetDetail(text) {
  if (isRejectedLine(text)) return null;
  const raw = tokenize(text);
  const up = raw.map((t) => t.toUpperCase());
  for (let i = 0; i < raw.length; i++) {
    const r = parseAt(raw, up, i);
    if (!r) continue;
    const address = { number: r.number, name: r.name, type: r.type };
    const direction = r.direction ?? r.trailingDirection;
    if (direction) address.direction = direction;
    if (r.unit) address.unit = r.unit;
    return { address, bareUnit: !!r.bareUnit };
  }
  return null;
}

/** Parse one line into a StreetAddress, or null. */
export function parseStreet(text) {
  return parseStreetDetail(text)?.address ?? null;
}

/** "10635 E HAMPTON AVE APT 3056". */
export function formatStreet(addr) {
  if (!addr) return '';
  const parts = [addr.number, addr.direction, addr.name, addr.type];
  if (addr.unit) parts.push('APT', addr.unit);
  return parts.filter(Boolean).join(' ');
}
