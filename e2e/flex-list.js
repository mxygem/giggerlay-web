// Renders the fixture route as an HTML page laid out like Flex's
// Itinerary > List screen: a header row, then one block per stop with the
// numbered pin on the left of the street line, the city, and the package line.
import { fixtureRows, HEADER } from './route-fixture.js';

export function flexListHTML() {
  const rows = fixtureRows().map((r) => `
    <div class="stop">
      <div class="pin"><span>${r.number}</span></div>
      <div class="body">
        <div class="street">${r.street}</div>
        <div class="city">${r.city}</div>
        <div class="pkgs">${r.pickup ? 'Pick up' : `Deliver ${r.packages} package${r.packages > 1 ? 's' : ''}`}</div>
      </div>
      <div class="chev">›</div>
    </div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin: 0; font: 16px -apple-system, "Helvetica Neue", Arial, sans-serif; background: #fff; color: #0f1111; }
  .bar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ddd; padding: 54px 16px 10px; }
  .tabs { display: flex; gap: 24px; font-weight: 600; color: #565959; margin-top: 8px; }
  .tabs .on { color: #0f1111; border-bottom: 3px solid #007185; }
  .header { padding: 14px 16px; font-weight: 700; font-size: 17px; border-bottom: 1px solid #eee; }
  .stop { display: flex; align-items: flex-start; padding: 14px 16px; border-bottom: 1px solid #eee; }
  .pin { width: 34px; height: 34px; border-radius: 50%; background: #232f3e; color: #fff;
         display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px;
         flex: none; margin-right: 18px; }
  .body { flex: 1; }
  .street { font-weight: 700; font-size: 17px; line-height: 34px; }
  .city { color: #565959; font-size: 15px; line-height: 20px; }
  .pkgs { font-size: 15px; line-height: 22px; margin-top: 2px; }
  .chev { color: #888; font-size: 26px; line-height: 34px; }
</style></head><body>
  <div class="bar"><div style="font-size:20px;font-weight:700">Itinerary</div>
    <div class="tabs"><span>Map</span><span class="on">List</span></div></div>
  <div class="header">${HEADER}</div>
  ${rows}
  <div style="height:120px"></div>
</body></html>`;
}
