import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OLD = 'https://raw.githubusercontent.com/oppominami8670/Simulator202603/main/index.html';
const NEW = pathToFileURL(path.join(process.cwd(), 'phase9.html')).href;
const report = { pages: {}, oldInterface: {}, newInterface: {} };

async function load(page, url, name) {
  const errors = [], consoleErrors = [], failedRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText || 'unknown'}`));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    report.pages[name] = { status: 'FAIL', navigationError: e.message, errors, consoleErrors, failedRequests };
    return false;
  }
  report.pages[name] = { status: errors.length || consoleErrors.length || failedRequests.length ? 'FAIL' : 'PASS', errors, consoleErrors, failedRequests };
  console.log(`[REGRESSION] ${name} load: ${report.pages[name].status}`);
  return report.pages[name].status === 'PASS';
}

const browser = await chromium.launch({ headless: true });
const oldPage = await browser.newPage();
const newPage = await browser.newPage();
const oldLoad = await load(oldPage, OLD, 'old');
const newLoad = await load(newPage, NEW, 'new');

// Simulator202603 creates the first card through addSimulator(). Initialize it explicitly
// so the test checks the real legacy calculator instead of an empty container.
const oldReady = await oldPage.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  if (!document.querySelector('.sim-card') && typeof addSimulator === 'function') addSimulator();
  for (let i = 0; i < 40 && !document.querySelector('.sim-card'); i++) await wait(100);
  const card = document.querySelector('.sim-card');
  return {
    card: !!card,
    updateCalculations: typeof updateCalculations === 'function',
    controls: !!card?.querySelector('.carrier-sel') && !!card?.querySelector('.dev-name') && !!card?.querySelector('.plan-sel')
  };
});
report.oldInterface = { ...oldReady, status: oldReady.card && oldReady.updateCalculations && oldReady.controls ? 'PASS' : 'FAIL' };
console.log(`[REGRESSION] old interface: ${report.oldInterface.status}`);

const newReady = await newPage.evaluate(() => ({
  globalData: typeof GLOBAL_DATA !== 'undefined' && GLOBAL_DATA !== null,
  carriers: Object.keys(GLOBAL_DATA || {}).length,
  calc: typeof calc === 'function',
  controls: ['carrier','category','device','ins','con','plan','data','devDisc'].every(id => !!document.getElementById(id))
}));
report.newInterface = { ...newReady, status: newReady.globalData && newReady.carriers === 6 && newReady.calc && newReady.controls ? 'PASS' : 'FAIL' };
console.log(`[REGRESSION] new interface/master: ${report.newInterface.status} (${newReady.carriers} carriers)`);

// Smoke-test a valid new-engine path using the first available selections.
try {
  const result = await newPage.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const setFirst = id => {
      const s = document.getElementById(id);
      const o = [...s.options].find(x => !x.disabled && x.value !== '');
      if (!o) throw new Error(`#${id}: no usable option`);
      s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setFirst('carrier'); await wait(50); setFirst('category'); await wait(50); setFirst('device'); await wait(50);
    setFirst('ins'); await wait(50); setFirst('con'); await wait(50); setFirst('plan'); await wait(50); setFirst('data'); await wait(50);
    const r = calc();
    if (!r || !Number.isFinite(r.first) || !Number.isFinite(r.later)) throw new Error('calc() did not return numeric first/later');
    return r;
  });
  report.newInterface.calcResult = result;
  report.newInterface.calc = 'PASS';
  console.log('[REGRESSION] new calc(): PASS');
} catch (e) {
  report.newInterface.calc = 'FAIL';
  report.newInterface.calcError = e.stack || e.message;
  console.error(`[REGRESSION] new calc(): FAIL - ${e.message}`);
}

report.summary = {
  oldLoad: oldLoad ? 'PASS' : 'FAIL',
  newLoad: newLoad ? 'PASS' : 'FAIL',
  oldInterface: report.oldInterface.status,
  newInterface: report.newInterface.status,
  newCalc: report.newInterface.calc || 'FAIL'
};
fs.writeFileSync('regression-report.json', JSON.stringify(report, null, 2));
console.log('[REGRESSION] SUMMARY');
console.log(JSON.stringify(report.summary, null, 2));
await browser.close();
process.exit(Object.values(report.summary).every(v => v === 'PASS') ? 0 : 1);
