// Smoke test: load the app, visit every country and every tab, fail on any page error.
// Usage: PW=<path to playwright> [LEAFLET_JS=<local leaflet.js>] [CHROMIUM=<path>] node tests/smoke.js
// LEAFLET_JS serves Leaflet locally when cdnjs is unreachable; all other outside requests are blocked,
// so the run also checks that the page degrades cleanly without the network.
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // start on the map, not the Today home screen, so the tab buttons can be clicked
  await p.addInitScript(() => { try { localStorage.setItem('osap-home', '"map"'); } catch (e) {} });
  await p.route(/^https?:\/\//, r => {
    if (process.env.LEAFLET_JS && /leaflet\.js$/.test(r.request().url()))
      return r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(process.env.LEAFLET_JS, 'utf8') });
    return r.abort();
  });
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  let failed = false;
  for (const cc of ['th','vn','kh','la','mm','ph','my','sg','id','bn','tl','cn','tw','kp','kr','jp','oki','mn','au','nz','pg','in','pk','np','bt','bd','lk','mv']) {
    await p.goto('about:blank'); await p.goto(url + '#' + (cc === 'th' ? '' : cc + '/') + 'timeline'); await p.waitForTimeout(1200);
    const n = await p.evaluate(() => window.TSAP ? TSAP.records.length : -1);
    const views = await p.$$eval('#view-seg button', bs => bs.map(x => x.dataset.view));
    for (const v of views) { await p.click(`button[data-view="${v}"]`); await p.waitForTimeout(120); }
    console.log(cc.padEnd(4), String(n).padStart(4), 'records,', views.length, 'tabs', errs.length ? '| ERRORS: ' + errs.join('; ') : '');
    if (n < 0 || errs.length) failed = true; errs.length = 0;
  }
  // the United States, a state opened as a sub-area, and the region drop-downs
  for (const u of ['#us/timeline', '?st=TX#us/timeline', '?st=AK#us/timeline']) {
    await p.goto('about:blank'); await p.goto(url + u); await p.waitForTimeout(1200);
    const r = await p.evaluate(() => ({ n: window.TSAP ? TSAP.records.length : -1, states: document.querySelectorAll('#country-seg button[data-st]').length,
      menus: document.querySelectorAll('#country-seg .cdrop').length, cur: (document.querySelector('#country-seg .cdrop.cur b') || {}).textContent || '' }));
    const bad = r.n < 0 || r.states !== 52 || r.menus < 10 || !r.cur || (/st=/.test(u) && !/Texas|Alaska/.test(r.cur));
    console.log(u.padEnd(20), String(r.n).padStart(4), 'records,', r.menus, 'region menus,', r.states - 1, 'states, open:', r.cur, errs.length ? '| ERRORS: ' + errs.join('; ') : '');
    if (bad || errs.length) failed = true; errs.length = 0;
  }
  await b.close();
  process.exit(failed ? 1 : 0);
})();
