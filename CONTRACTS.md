# Shared contracts

Every module is a plain browser ES module (`import`/`export`, relative paths
ending in `.js`). No bundler, no build step: GitHub Pages serves the repo root.
Logic modules must not touch the DOM so `node --test` can run them. Types are
defined as JSDoc in `src/contracts.js`; import shared constants from there.

## Types (see src/contracts.js for the JSDoc)
- `OCRLine` `{text, midY, minX, height}` — all 0-1, top-origin, relative to the
  image (or crop) that was OCR'd. Optional `maxX`. Arrays of lines are sorted by
  `midY`.
- `StreetAddress` `{number, direction?, name, type, unit?}` — uppercase.
  `number` is a digit string ("10635"), `direction` one of N S E W NE NW SE SW,
  `name` space-joined tokens ("HAMPTON", "GROSSE POINTE"), `type` the
  normalized suffix ("AVE", "ST", "RD", ...), `unit` digits/letters ("3056").
- `RouteStop` `{number, address, packages?, guessed}`.
- `Route` `{stops, header?, createdAt, source}` — stops sorted by number.
- `MatchResult` — one of
  - `{kind:'stop', stop, score, address}`
  - `{kind:'ambiguous', stops, score, address}` (best first)
  - `{kind:'notOnRoute', address}`
  - `{kind:'noAddress'}`
- `PageReading` `{stops: PageStop[], pickups: Pickup[], header?}` — one page
  (screenshot, slice or video frame) parsed on its own.
  - `PageStop` `{number|null, address, packages?, midY, pinFilled?}`
  - `Pickup` `{number?, address?}`
- `ReviewIssues` `{missing: {from,to,label}[], duplicates: {numbers, address}[],
  guessed: number[]}`
- `Settings` `{zoneSize: 10, speak: true}`

## Module APIs (owner in brackets)
`src/street.js` [A]
- `parseStreet(text) -> StreetAddress|null` — one line.
- `isRejectedLine(text) -> boolean` — times, prices, dates, counts, weights.
- `formatStreet(addr) -> string` — "10635 E HAMPTON AVE APT 3056".
- `normalizeType(word) -> string|null`, `STREET_TYPES`, `DIRECTIONS`.

`src/matcher.js` [A]
- `labelAddresses(lines: OCRLine[]) -> StreetAddress[]` — candidates on a
  label, with APT units joined from later lines.
- `scoreAddress(found, stopAddr) -> number` — 0 when the house number differs.
- `matchLabel(lines, stops) -> MatchResult`.
- `trackingFromBarcode(text) -> string|null` — TBA + 9-15 digits.
- `ACCEPT = 0.7`, `AMBIGUOUS_GAP = 0.15`.

`src/itinerary.js` [B]
- `parsePage(lines) -> PageReading`.
- `mergePages(pages: PageReading[]) -> {stops: RouteStop[], header?}`.
- `parseTypedAddresses(text) -> {stops: RouteStop[], errors: string[]}` —
  one address per line, numbered from 1.

`src/review.js` [B]
- `reviewIssues(stops) -> ReviewIssues`.

`src/import/` [C]
- `slice.js` `slicePlan(width, height) -> {x,y,w,h}[]`.
- `sharpness.js` `sharpness(imageData) -> number` (mean |vertical diff| of gray).
- `fingerprint.js` `fingerprint(imageData) -> Float32Array` (24 wide x 52 tall
  gray), `fingerprintDiff(a, b) -> number` (mean abs diff, 0-255 scale).
- `frames.js` `pickFrames(samples) -> {times, skippedBlurry}` — pure selection
  over `{t, sharpness}` samples.
- `importer.js` `importFiles(files, {ocr, onProgress}) -> {pages, stops,
  header?, warnings}` (browser; uses canvas/video). `ocr` defaults to
  `src/ocr.js`.
`src/ocr.js` [C]
- `recognize(source, {crop?}) -> Promise<OCRLine[]>` — source is a canvas,
  ImageBitmap, image or Blob. One shared Tesseract worker, created lazily.
- `terminate()`.

`src/load/` [E]
- `session.js` `createLoadSession(route, settings, {now}) ->
  {onFrame({lines, barcodes}) -> LoadState, counts()}` — pure state machine.
- `screen.js` `mountLoadScreen(el, route, settings, {onDone})` — camera UI.

`src/app.js`, `src/ui/*`, `src/storage.js`, `index.html`, `styles.css`,
`manifest.webmanifest`, `sw.js`, `icons/` [D]
- `storage.js` `loadRoute()`, `saveRoute(route)`, `loadSettings()`,
  `saveSettings(s)`.

`src/contracts.js` [lead] — typedefs, `ZONE_COLORS`, `zoneColor(n, stops,
settings)`, `DEFAULT_SETTINGS`.

## Tests
- Unit: `test/<module>.test.js`, run with `node --test test/`. No test deps.
- Browser/e2e: `e2e/` with Playwright (installed), run by the lead.
- Owners only edit their own files. Don't edit package.json or contracts.js;
  ask the lead (put a note in your final report) if a contract must change.
