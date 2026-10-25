// End-to-end import test. Renders the synthetic 30-stop Flex list as a long
// screenshot and as a scrolling screen recording, runs the app's real import
// (Tesseract.js in headless Chromium) on each, and reports correct, missing,
// guessed and wrong stops.
//
// Usage: node e2e/run.js            (writes e2e/out/)
import { chromium } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { serve } from './serve.js';
import { flexListHTML } from './flex-list.js';
import { fixtureRows } from './route-fixture.js';

const out = new URL('./out/', import.meta.url);
const PORT = 8124;

async function render(browser) {
  await mkdir(out, { recursive: true });
  // Long screenshot at the iPhone 15 Pro Max's 3x scale (1290 px wide).
  const shot = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 });
  await shot.setContent(flexListHTML());
  await shot.screenshot({ path: new URL('list-long.png', out).pathname, fullPage: true });

  // Screen recording: scroll at a steady thumb-flick speed, 30 fps, 2x scale.
  const rec = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  await rec.setContent(flexListHTML());
  const frames = new URL('frames/', out);
  await rm(frames, { recursive: true, force: true });
  await mkdir(frames, { recursive: true });
  const max = await rec.evaluate(() => document.body.scrollHeight - innerHeight);
  const step = 14; // css px per frame = 420 px/s
  let i = 0;
  for (let y = 0; ; y = Math.min(max, y + step)) {
    await rec.evaluate((v) => scrollTo(0, v), y);
    await rec.screenshot({ path: new URL(`f${String(i++).padStart(4, '0')}.png`, frames).pathname });
    if (y === max) break;
  }
  for (let k = 0; k < 15; k++) await rec.screenshot({ path: new URL(`f${String(i++).padStart(4, '0')}.png`, frames).pathname });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', new URL('f%04d.png', frames).pathname,
    '-c:v', 'libvpx', '-b:v', '4M', '-pix_fmt', 'yuv420p', new URL('list-recording.webm', out).pathname]);
  await shot.close();
  await rec.close();
  return i;
}

function score(result) {
  const want = new Map(fixtureRows().filter((r) => !r.pickup).map((r) => [r.number, r]));
  const got = new Map(result.stops.map((s) => [s.number, s]));
  const rep = { correct: [], wrong: [], missing: [], guessed: [], extra: [], packagesWrong: [] };
  for (const [n, w] of want) {
    const g = got.get(n);
    if (!g) { rep.missing.push(n); continue; }
    if (g.guessed) rep.guessed.push(n);
    if (g.street === w.street) rep.correct.push(n);
    else rep.wrong.push(`${n}: got "${g.street}" want "${w.street}"`);
    if ((g.packages ?? 1) !== w.packages) rep.packagesWrong.push(`${n}: got ${g.packages} want ${w.packages}`);
  }
  for (const n of got.keys()) if (!want.has(n)) rep.extra.push(`${n}: ${got.get(n).street}`);
  return rep;
}

const server = await serve(PORT);
const browser = await chromium.launch();
try {
  const nframes = await render(browser);
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
  await page.goto(`http://localhost:${PORT}/e2e/harness.html`);
  await page.waitForFunction(() => window.harnessReady);
  const report = {};
  for (const [name, file] of [['long screenshot', 'list-long.png'], ['screen recording', 'list-recording.webm']]) {
    const res = await page.evaluate((u) => window.runImport(u), [`/e2e/out/${file}`]);
    const s = score(res);
    report[name] = { ms: res.ms, pages: res.pages, warnings: res.warnings, header: res.header, ...s, stops: res.stops };
    console.log(`\n== ${name} (${file}${name.includes('recording') ? `, ${nframes} frames` : ''})`);
    console.log(`  import took ${(res.ms / 1000).toFixed(1)}s over ${res.pages} OCR pages; warnings: ${JSON.stringify(res.warnings)}`);
    console.log(`  correct ${s.correct.length}/29  missing ${s.missing.length} ${JSON.stringify(s.missing)}`);
    console.log(`  guessed ${s.guessed.length} ${JSON.stringify(s.guessed)}`);
    console.log(`  wrong ${s.wrong.length} ${JSON.stringify(s.wrong)}`);
    console.log(`  extra ${s.extra.length} ${JSON.stringify(s.extra)}`);
    console.log(`  package counts wrong ${s.packagesWrong.length} ${JSON.stringify(s.packagesWrong)}`);
  }
  await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.close();
}
