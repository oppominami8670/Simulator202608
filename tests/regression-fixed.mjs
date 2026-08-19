import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const oldUrl = 'https://raw.githubusercontent.com/oppominami8670/Simulator202603/main/index.html';
const newPath = path.join(process.cwd(), 'phase9.html');
const report = { pages: {}, cases: [], summary: {} };

async function load(page, url, name) {
  const errors = [], consoleErrors = [], failedRequests = [];
  page.on('pageerror', e => errors.push({ message: e.message, stack: e.stack || null }));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText || 'unknown'}`));
  await page.route('https://script.google.com/**', async route => {
    try {
      const r = await fetch(route.request().url(), { redirect: 'follow' });
      await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' }, body: await r.text() });
    } catch { await route.abort(); }
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
  } catch (e) {
    report.pages[name] = { status: 'FAIL', navigationError: e.stack || e.message, errors, consoleErrors, failedRequests };
    return false;
  }
  report.pages[name] = { status: errors.length || consoleErrors.length || failedRequests.length ? 'FAIL' : 'PASS', errors, consoleErrors, failedRequests };
  console.log(`[REGRESSION] ${name} load: ${report.pages[name].status}`);
  return report.pages[name].status === 'PASS';
}

const browser = await chromium.launch({ headless: true });
const oldPage = await browser.newPage();
const newPage = await browser.newPage();
const oldOk = await load(oldPage, oldUrl, 'old');
const newOk = await load(newPage, pathToFileURL(newPath).href, 'new');

const oldProbe = await oldPage.evaluate(() => ({
  calc: typeof calc === 'function',
  updateCalculations: typeof updateCalculations === 'function',
  simulatorContainer: !!document.getElementById('sim-container'),
  familyBody: !!document.getElementById('family-body')
}));
report.oldEngine = { status: oldProbe.calc ? 'PASS' : 'SKIP', reason: oldProbe.calc ? undefined : 'legacy calc() is not exposed globally; legacy page load/DOM is used as the compatibility probe', ...oldProbe };
console.log(`[REGRESSION] old calc(): ${report.oldEngine.status}`);

try {
  await newPage.waitForFunction(() => typeof GLOBAL_DATA !== 'undefined' && GLOBAL_DATA !== null, null, { timeout: 15000 });
  const readiness = await newPage.evaluate(() => ({ carriers: Object.keys(GLOBAL_DATA || {}), carrier: document.getElementById('carrier')?.value ?? null }));
  report.newReadiness = { status: readiness.carriers.length ? 'PASS' : 'FAIL', ...readiness };
  console.log(`[REGRESSION] new master data: ${report.newReadiness.status} (${readiness.carriers.length} carriers)`);
} catch (e) {
  report.newReadiness = { status: 'FAIL', reason: e.stack || e.message };
  console.error(`[REGRESSION] new master data: FAIL - ${report.newReadiness.reason}`);
}

try {
  const result = await newPage.evaluate(() => { const r = typeof calc === 'function' ? calc() : null; return r && Number.isFinite(r.first) && Number.isFinite(r.later) ? r : null; });
  report.newEngine = result ? { status: 'PASS', first: result.first, later: result.later } : { status: 'FAIL', reason: 'calc() did not return numeric first/later' };
} catch (e) { report.newEngine = { status: 'FAIL', reason: e.stack || e.message }; }
console.log(`[REGRESSION] new calc(): ${report.newEngine.status}`);

const rng = (() => { let x = 0x9e3779b9; return () => ((x = Math.imul(x ^ x >>> 16, 2246822507) ^ Math.imul(x ^ x >>> 13, 3266489909)) >>> 0) / 4294967296; })();
for (let i = 0; i < 100; i++) {
  try {
    const result = await newPage.evaluate(seed => {
      if (!GLOBAL_DATA) throw new Error('GLOBAL_DATA is not ready');
      const pick = id => { const s = document.getElementById(id); if (!s?.options.length) return; const opts = [...s.options].filter(o => !o.disabled && o.value !== ''); if (opts.length) s.value = opts[Math.floor(seed * opts.length)].value; s.dispatchEvent(new Event('change', { bubbles: true })); };
      ['carrier','category','device','ins','con','plan','data','net','netType'].forEach(pick);
      const d = document.getElementById('devDisc'); if (d) { d.value = String(Math.floor(seed * 6) * 5000); d.dispatchEvent(new Event('input', { bubbles: true })); }
      const r = typeof calc === 'function' ? calc() : null;
      return r && Number.isFinite(r.first) && Number.isFinite(r.later) ? r : null;
    }, rng());
    const item = result ? { status: 'PASS', first: result.first, later: result.later } : { status: 'FAIL', reason: 'calc() returned no numeric first/later' };
    report.cases.push(item);
    if (item.status === 'FAIL') console.error(`[REGRESSION] case ${i + 1}: FAIL - ${item.reason}`);
  } catch (e) {
    const item = { status: 'FAIL', reason: e.stack || e.message };
    report.cases.push(item);
    console.error(`[REGRESSION] case ${i + 1}: FAIL - ${item.reason}`);
  }
}

report.summary = {
  oldLoad: oldOk ? 'PASS' : 'FAIL',
  newLoad: newOk ? 'PASS' : 'FAIL',
  newMaster: report.newReadiness?.status || 'FAIL',
  newCalc: report.newEngine?.status || 'FAIL',
  generatedCases: report.cases.length,
  passedCases: report.cases.filter(x => x.status === 'PASS').length,
  failedCases: report.cases.filter(x => x.status !== 'PASS').length,
  oldCalc: report.oldEngine.status,
  numericalParity: 'NOT_EXECUTED: legacy/new result interfaces are not directly comparable yet'
};
fs.writeFileSync('regression-report.json', JSON.stringify(report, null, 2));
console.log('[REGRESSION] SUMMARY');
console.log(JSON.stringify(report.summary, null, 2));
await browser.close();

const failed = report.summary.oldLoad !== 'PASS' || report.summary.newLoad !== 'PASS' || report.summary.newMaster !== 'PASS' || report.summary.newCalc !== 'PASS' || report.summary.failedCases > 0;
process.exit(failed ? 1 : 0);
