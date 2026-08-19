import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Keep the parity test focused: legacy initialization + identical user inputs + exact totals.
const OLD = 'https://raw.githubusercontent.com/oppominami8670/Simulator202603/main/index.html';
const NEW = pathToFileURL(path.join(process.cwd(), 'phase9.html')).href;
const CASES = 100;
const report = { cases: [], summary: {} };
const money = x => Number(String(x ?? '').replace(/[^0-9.-]/g, ''));
const rng = (() => { let x = 0x6d2b79f5; return () => { x |= 0; x = Math.imul(x + 0x6d2b79f5, 1); let t=x; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; })();

async function load(page, url, name) {
  const errors = [], consoleErrors = [], failed = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => failed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText || 'unknown'}`));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  return { name, status: errors.length || consoleErrors.length || failed.length ? 'FAIL' : 'PASS', errors, consoleErrors, failed };
}

async function initLegacy(page) {
  return page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (!document.querySelector('.sim-card') && typeof addSimulator === 'function') addSimulator();
    for (let i=0; i<50 && !document.querySelector('.sim-card'); i++) await wait(100);
    const card = document.querySelector('.sim-card');
    if (!card || typeof updateCalculations !== 'function') throw new Error('legacy calculator could not be initialized');
    return true;
  });
}

async function legacyCase(page, seed) {
  return page.evaluate(async seed => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const pick = (selector, ratio) => {
      const s = document.querySelector(`.sim-card ${selector}`);
      if (!s) throw new Error(`legacy selector missing: ${selector}`);
      const a = [...s.options].filter(o => !o.disabled && o.value !== '');
      if (!a.length) throw new Error(`legacy selector has no options: ${selector}`);
      const o = a[Math.min(a.length - 1, Math.floor(ratio * a.length))];
      s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
      return { value: o.value, text: o.textContent.trim() };
    };
    const cats = [...document.querySelectorAll('.sim-card .cat-btns .btn')];
    const cat = cats[Math.min(cats.length - 1, Math.floor(seed * cats.length))];
    if (!cat) throw new Error('legacy category unavailable');
    const carrier = pick('.carrier-sel', seed);
    cat.click(); await wait(50);
    const category = cat.dataset.cat;
    const device = pick('.dev-name', seed * 1.31 % 1); await wait(50);
    const ins = pick('.ins-count', seed * 1.71 % 1); await wait(50);
    const con = pick('.con-type', seed * 2.13 % 1); await wait(50);
    const plan = pick('.plan-sel', seed * 2.71 % 1); await wait(50);
    const data = pick('.data-sel', seed * 3.17 % 1); await wait(50);
    const disc = document.querySelector('.sim-card .dev-disc-input');
    const devDisc = Math.floor(seed * 6) * 5000;
    disc.value = String(devDisc); disc.dispatchEvent(new Event('input', { bubbles: true })); disc.dispatchEvent(new Event('change', { bubbles: true }));
    updateCalculations(); await wait(100);
    const first = money(document.querySelector('.sim-card .final-1')?.textContent);
    const later = money(document.querySelector('.sim-card .final-2')?.textContent);
    if (!Number.isFinite(first) || !Number.isFinite(later)) throw new Error(`legacy result invalid: ${first}/${later}`);
    return { carrier, category, device, ins, con, plan, data, devDisc, first, later };
  }, seed);
}

async function newCase(page, input) {
  return page.evaluate(async input => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const set = (id, value, text) => {
      const s = document.getElementById(id); if (!s) throw new Error(`new selector missing: #${id}`);
      const o = [...s.options].find(x => x.value === value) || [...s.options].find(x => x.textContent.trim() === text);
      if (!o) throw new Error(`new #${id}: no matching option value=${JSON.stringify(value)} text=${JSON.stringify(text)}`);
      s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('carrier', input.carrier.value, input.carrier.text); await wait(50);
    set('category', input.category, input.category); await wait(50);
    set('device', input.device.value, input.device.text); await wait(50);
    set('ins', input.ins.value, input.ins.text); await wait(50);
    set('con', input.con.value, input.con.text); await wait(50);
    set('plan', input.plan.value, input.plan.text); await wait(50);
    set('data', input.data.value, input.data.text); await wait(50);
    const d = document.getElementById('devDisc'); d.value = String(input.devDisc); d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true }));
    const r = calc();
    if (!r || !Number.isFinite(r.first) || !Number.isFinite(r.later)) throw new Error('new calc result invalid');
    return { first: r.first, later: r.later };
  }, input);
}

const browser = await chromium.launch({ headless: true });
const oldPage = await browser.newPage();
const newPage = await browser.newPage();
try {
  report.oldLoad = await load(oldPage, OLD, 'old');
  report.newLoad = await load(newPage, NEW, 'new');
  await initLegacy(oldPage);
  await newPage.waitForFunction(() => typeof GLOBAL_DATA !== 'undefined' && GLOBAL_DATA !== null && Object.keys(GLOBAL_DATA).length > 0, null, { timeout: 15000 });
  report.master = await newPage.evaluate(() => ({ carriers: Object.keys(GLOBAL_DATA || {}), count: Object.keys(GLOBAL_DATA || {}).length }));
  for (let i = 1; i <= CASES; i++) {
    try {
      const old = await legacyCase(oldPage, rng());
      const fresh = await newCase(newPage, old);
      const diff = { first: fresh.first - old.first, later: fresh.later - old.later };
      const item = { index: i, status: diff.first === 0 && diff.later === 0 ? 'PASS' : 'FAIL', input: { carrier: old.carrier, category: old.category, device: old.device, ins: old.ins, con: old.con, plan: old.plan, data: old.data, devDisc: old.devDisc }, old: { first: old.first, later: old.later }, new: fresh, diff };
      report.cases.push(item);
      if (item.status === 'FAIL') console.error(`[PARITY] case ${i}: ${JSON.stringify(item)}`);
    } catch (e) {
      const item = { index: i, status: 'FAIL', reason: e.stack || e.message };
      report.cases.push(item); console.error(`[PARITY] case ${i}: FAIL - ${item.reason}`);
    }
  }
} catch (e) {
  report.fatal = e.stack || e.message;
} finally { await browser.close(); }

const passed = report.cases.filter(x => x.status === 'PASS').length;
const failed = report.cases.length - passed;
report.summary = { generatedCases: report.cases.length, passedCases: passed, failedCases: failed, numericalParity: !report.fatal && report.cases.length === CASES && failed === 0 ? 'PASS' : 'FAIL', oldLoad: report.oldLoad?.status || 'FAIL', newLoad: report.newLoad?.status || 'FAIL', masterCarriers: report.master?.count || 0 };
fs.writeFileSync('numerical-parity-report.json', JSON.stringify(report, null, 2));
console.log('[PARITY] SUMMARY'); console.log(JSON.stringify(report.summary, null, 2));
if (report.fatal) console.error(`[PARITY] FATAL: ${report.fatal}`);
process.exit(report.summary.numericalParity === 'PASS' && report.summary.oldLoad === 'PASS' && report.summary.newLoad === 'PASS' && report.summary.masterCarriers === 6 ? 0 : 1);
