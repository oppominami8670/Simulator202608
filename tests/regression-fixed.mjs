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
    await page.waitForTimeout(1200);
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
  familyBody: !!document.getElementById('family-body'),
  card: !!document.querySelector('.sim-card')
}));
report.oldEngine = {
  status: oldProbe.updateCalculations && oldProbe.card ? 'PASS' : 'FAIL',
  reason: oldProbe.updateCalculations ? undefined : 'legacy updateCalculations() is unavailable',
  ...oldProbe
};
console.log(`[REGRESSION] old engine interface: ${report.oldEngine.status}`);

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
  const result = await newPage.evaluate(() => {
    const r = typeof calc === 'function' ? calc() : null;
    return r && Number.isFinite(r.first) && Number.isFinite(r.later) ? r : null;
  });
  report.newEngine = result ? { status: 'PASS', first: result.first, later: result.later } : { status: 'FAIL', reason: 'calc() did not return numeric first/later' };
} catch (e) {
  report.newEngine = { status: 'FAIL', reason: e.stack || e.message };
}
console.log(`[REGRESSION] new calc(): ${report.newEngine.status}`);

const parseMoney = text => {
  const n = Number(String(text ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const seedRng = (() => {
  let x = 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17; x >>>= 0;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
})();

async function parityCase(index, seed) {
  const oldState = await oldPage.evaluate(({ seed }) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pick = (s, ratio) => {
      if (!s) return null;
      const options = [...s.options].filter(o => !o.disabled && o.value !== '');
      if (!options.length) return null;
      const o = options[Math.min(options.length - 1, Math.floor(ratio * options.length))];
      s.value = o.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return { value: o.value, text: o.textContent.trim() };
    };
    const card = document.querySelector('.sim-card');
    if (!card) throw new Error('legacy simulator card not found');
    const carrier = pick(card.querySelector('.carrier-sel'), seed);
    if (!carrier) throw new Error('legacy carrier options unavailable');
    const cats = [...card.querySelectorAll('.cat-btns .btn')];
    const cat = cats[Math.min(cats.length - 1, Math.floor(seed * cats.length))];
    if (!cat) throw new Error('legacy category buttons unavailable');
    cat.click();
    const category = cat.dataset.cat;
    const device = pick(card.querySelector('.dev-name'), (seed * 1.37) % 1);
    const ins = pick(card.querySelector('.ins-count'), (seed * 1.73) % 1);
    const con = pick(card.querySelector('.con-type'), (seed * 2.11) % 1);
    const plan = pick(card.querySelector('.plan-sel'), (seed * 2.71) % 1);
    const data = pick(card.querySelector('.data-sel'), (seed * 3.17) % 1);
    const disc = card.querySelector('.dev-disc-input');
    if (disc) {
      disc.value = String(Math.floor(seed * 6) * 5000);
      disc.dispatchEvent(new Event('input', { bubbles: true }));
      disc.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof updateCalculations !== 'function') throw new Error('legacy updateCalculations() unavailable');
    updateCalculations();
    return sleep(120).then(() => ({
      carrier, category, device, ins, con, plan, data,
      devDisc: Number(disc?.value || 0),
      first: parseMoney(card.querySelector('.final-1')?.textContent),
      later: parseMoney(card.querySelector('.final-2')?.textContent),
      planAmount: parseMoney(card.querySelector('.res-plan')?.textContent),
      deviceAmount: parseMoney(card.querySelector('.res-dev')?.textContent)
    }));
  }, { seed });

  if (!Number.isFinite(oldState.first) || !Number.isFinite(oldState.later)) {
    throw new Error(`legacy result is not numeric: first=${oldState.first}, later=${oldState.later}`);
  }

  const newState = await newPage.evaluate(async ({ state }) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const setSelect = (id, wanted) => {
      const s = document.getElementById(id);
      if (!s) throw new Error(`new selector #${id} not found`);
      const options = [...s.options];
      const match = options.find(o => o.value === wanted) || options.find(o => o.textContent.trim() === wanted);
      if (!match) throw new Error(`new #${id} has no matching option for ${JSON.stringify(wanted)}`);
      s.value = match.value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setSelect('carrier', state.carrier.value);
    await sleep(60);
    setSelect('category', state.category);
    await sleep(60);
    setSelect('device', state.device.value);
    await sleep(60);
    setSelect('ins', state.ins.value);
    await sleep(60);
    setSelect('con', state.con.value);
    await sleep(60);
    setSelect('plan', state.plan.value);
    await sleep(60);
    setSelect('data', state.data.value);
    const disc = document.getElementById('devDisc');
    if (disc) {
      disc.value = String(state.devDisc);
      disc.dispatchEvent(new Event('input', { bubbles: true }));
      disc.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const r = typeof calc === 'function' ? calc() : null;
    if (!r || !Number.isFinite(r.first) || !Number.isFinite(r.later)) throw new Error('new calc() did not return numeric first/later');
    return { first: r.first, later: r.later };
  }, { state: oldState });

  const firstDiff = newState.first - oldState.first;
  const laterDiff = newState.later - oldState.later;
  const pass = firstDiff === 0 && laterDiff === 0;
  return {
    index,
    status: pass ? 'PASS' : 'FAIL',
    input: { carrier: oldState.carrier.value, category: oldState.category, device: oldState.device.value, ins: oldState.ins.value, con: oldState.con.value, plan: oldState.plan.value, data: oldState.data.value, devDisc: oldState.devDisc },
    old: { first: oldState.first, later: oldState.later },
    new: { first: newState.first, later: newState.later },
    diff: { first: firstDiff, later: laterDiff }
  };
}

const parityCount = 100;
for (let i = 0; i < parityCount; i++) {
  try {
    const item = await parityCase(i + 1, seedRng());
    report.cases.push(item);
    if (item.status === 'FAIL') console.error(`[REGRESSION] parity case ${item.index}: FAIL`, JSON.stringify(item));
  } catch (e) {
    const item = { index: i + 1, status: 'FAIL', reason: e.stack || e.message };
    report.cases.push(item);
    console.error(`[REGRESSION] parity case ${item.index}: FAIL - ${item.reason}`);
  }
}

const parityPassed = report.cases.filter(x => x.status === 'PASS').length;
const parityFailed = report.cases.length - parityPassed;
report.summary = {
  oldLoad: oldOk ? 'PASS' : 'FAIL',
  newLoad: newOk ? 'PASS' : 'FAIL',
  oldEngine: report.oldEngine.status,
  newMaster: report.newReadiness?.status || 'FAIL',
  newCalc: report.newEngine?.status || 'FAIL',
  generatedCases: report.cases.length,
  passedCases: parityPassed,
  failedCases: parityFailed,
  oldCalc: report.oldEngine.status,
  numericalParity: parityFailed === 0 && report.cases.length === parityCount ? 'PASS' : 'FAIL'
};
fs.writeFileSync('regression-report.json', JSON.stringify(report, null, 2));
console.log('[REGRESSION] SUMMARY');
console.log(JSON.stringify(report.summary, null, 2));
await browser.close();

const failed = report.summary.oldLoad !== 'PASS' || report.summary.newLoad !== 'PASS' || report.summary.oldEngine !== 'PASS' || report.summary.newMaster !== 'PASS' || report.summary.newCalc !== 'PASS' || report.summary.failedCases > 0 || report.summary.numericalParity !== 'PASS';
process.exit(failed ? 1 : 0);
