// Smoke test for src/ocr.js + src/import/importer.js in headless Chromium:
// renders the fixture Flex list as a long screenshot, OCRs one tile with
// several PSMs, then runs the full image import. Run: node e2e/ocr-smoke.js [psm...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { flexListHTML } from './flex-list.js';

// Runs in the page: scroll the screenshot on a phone-sized canvas and record it.
async function recordScroll(png) {
  const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
  const vw = 860, vh = 1864, c = document.createElement('canvas');
  c.width = vw; c.height = vh;
  const ctx = c.getContext('2d'), scale = vw / bmp.width, maxY = bmp.height * scale - vh, segs = 5, dur = 9000;
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(100);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const k = (performance.now() - t0) / dur, seg = Math.floor(k * segs), f = Math.max(0, Math.min(1, (((k * segs) % 1) - 0.45) / 0.55));
      const y = Math.min(maxY, ((seg + f) / segs) * maxY);
      ctx.drawImage(bmp, 0, y / scale, bmp.width, vh / scale, 0, 0, vw, vh);
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    step();
  });
  rec.stop(); await stopped;
  const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8124;
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) return res.writeHead(403).end();
  if (p === root + path.sep || p === root) return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>smoke</title>');
  fs.readFile(p, (err, buf) => err ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }).end(buf));
}).listen(PORT);

const psms = process.argv.slice(2).length ? process.argv.slice(2) : ['11', '3', '6'];
const browser = await chromium.launch();
try {
  const shotPage = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 });
  await shotPage.setContent(flexListHTML());
  const png = (await shotPage.screenshot({ fullPage: true })).toString('base64');
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  const out = await page.evaluate(async ({ png, psms }) => {
    const { recognize, terminate } = await import('/src/ocr.js');
    const { importFiles } = await import('/src/import/importer.js');
    const { slicePlan } = await import('/src/import/slice.js');
    const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
    const bmp = await createImageBitmap(blob);
    const tiles = slicePlan(bmp.width, bmp.height);
    const res = { size: [bmp.width, bmp.height], tiles: tiles.length, psm: {} };
    { // prepared first tile, for OCR_DUMP
      const { prepare } = await import('/src/ocr.js');
      const c = document.createElement('canvas'), t = tiles[0];
      c.width = t.w; c.height = t.h;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
      prepare(ctx, t.w, t.h);
      res.prepared = c.toDataURL('image/png');
    }
    for (const psm of psms) {
      const t0 = performance.now();
      const lines = await recognize(bmp, { crop: tiles[0], psm });
      res.psm[psm] = { ms: Math.round(performance.now() - t0), lines: lines.map((l) => `${l.midY.toFixed(3)} ${l.minX.toFixed(2)}-${l.maxX.toFixed(2)} h${l.height.toFixed(3)} | ${l.text}`) };
    }
    const t0 = performance.now();
    const file = new File([blob], 'list.png', { type: 'image/png' });
    const phases = [];
    const imp = await importFiles([file], { onProgress: (p) => phases.push(`${p.phase}:${p.done}/${p.total}`) });
    res.import = { ms: Math.round(performance.now() - t0), pages: imp.pages.length, warnings: imp.warnings, phases,
      stops: imp.stops.map((s) => `${s.number}${s.guessed ? '?' : ''} ${s.address.number} ${s.address.direction ?? ''} ${s.address.name} ${s.address.type}${s.address.unit ? ' #' + s.address.unit : ''} x${s.packages ?? '-'}`) };
    await terminate();
    return res;
  }, { png, psms });
  if (process.env.OCR_DUMP) {
    fs.writeFileSync(path.join(process.env.OCR_DUMP, 'prepared.png'), Buffer.from(out.prepared.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(process.env.OCR_DUMP, 'list.png'), Buffer.from(png, 'base64'));
  }
  console.log(`image ${out.size.join('x')}, ${out.tiles} tiles`);
  for (const [psm, r] of Object.entries(out.psm)) {
    console.log(`\n== PSM ${psm}: ${r.lines.length} lines, ${r.ms} ms (tile 1)`);
    for (const l of r.lines) console.log('  ' + l);
  }
  console.log(`\n== importFiles: ${out.import.pages} pages, ${out.import.stops.length} stops, ${out.import.ms} ms, warnings ${JSON.stringify(out.import.warnings)}`);
  console.log('  progress: ' + out.import.phases.join(' '));
  for (const s of out.import.stops) console.log('  ' + s);

  // Video: record the long screenshot scrolling (0.8s hold, then 1s scroll) with
  // MediaRecorder, remux with ffmpeg so the WebM gets a seek index (MediaRecorder
  // output has none; iPhone MP4/MOV recordings do), then import it.
  let webm = Buffer.from(await page.evaluate(recordScroll, png), 'base64');
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-smoke-'));
    fs.writeFileSync(path.join(dir, 'in.webm'), webm);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(dir, 'in.webm'), '-c', 'copy', path.join(dir, 'out.webm')]);
    webm = fs.readFileSync(path.join(dir, 'out.webm'));
    fs.rmSync(dir, { recursive: true });
  } catch (e) { console.log('(ffmpeg remux failed, seeking may not work:', e.message, ')'); }
  const v = await page.evaluate(async (b64) => {
    const { importFiles } = await import('/src/import/importer.js');
    const { terminate } = await import('/src/ocr.js');
    const blob = await (await fetch(`data:video/webm;base64,${b64}`)).blob();
    const t0 = performance.now(), ph = [];
    const r = await importFiles([new File([blob], 'rec.webm', { type: 'video/webm' })], { onProgress: (p) => ph.push(`${p.phase}:${p.done}/${p.total}`) });
    await terminate();
    return { ms: Math.round(performance.now() - t0), pages: r.pages.length, warnings: r.warnings,
      phases: ph.filter((x, i, a) => i === a.length - 1 || x.split(':')[0] !== a[i + 1].split(':')[0]),
      stops: r.stops.map((s) => `${s.number}${s.guessed ? '?' : ''} ${s.address.number} ${s.address.name} ${s.address.type}`) };
  }, webm.toString('base64'));
  console.log(`\n== video importFiles: ${v.pages} frames OCR'd, ${v.stops.length} stops, ${v.ms} ms, warnings ${JSON.stringify(v.warnings)}`);
  console.log('  progress (last per phase): ' + v.phases.join(' '));
  console.log('  ' + v.stops.join(' | '));
} finally {
  await browser.close();
  server.close();
}
