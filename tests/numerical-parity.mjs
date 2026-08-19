import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OLD = 'https://raw.githubusercontent.com/oppominami8670/Simulator202603/main/index.html';
const NEW = pathToFileURL(path.join(process.cwd(), 'phase9.html')).href;
const N = 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { cases: [], summary: {} };

async function pageLoad(page, url, name) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  if (errors.length) throw new Error(`${name} page errors: ${errors.join(' | ')}`);
}

const rng = (() => { let x = 0x6d2b79f5; return () => { x |= 0; x = Math.imul(x + 0x6d2b79f5, 1); let t = x; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();

async function legacyCase(page, seed) {
  return page.evaluate(async seed => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const pick = (s, ratio) => {
      const a = [...s.options].filter(o => !o.disabled && o.value !== '');
      if (!a.length) throw new Error(`no options: ${s.className || s.id}`);
      const o = a[Math.min(a.length - 1, Math.floor(ratio * a.length))];
      s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
      return { value: o.value, text: o.textContent.trim() };
    };
    const money = x => { const n = Number(String(x ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; };
    const card = document.querySelector('.sim-card');
    if (!card || typeof updateCalculations !== 'function') throw new Error('legacy calculation interface unavailable');
    const carrier = pick(card.querySelector('.carrier-sel'), seed);
    const cats = [...card.querySelectorAll('.cat-btns .btn')];
    const cat = cats[Math.min(cats.length - 1, Math.floor(seed * cats.length))];
    cat.click();
    await wait(30);
    const category = cat.dataset.cat;
    const device = pick(card.querySelector('.dev-name'), seed * 1.31 % 1);
    await wait(30);
    const ins = pick(card.querySelector('.ins-count'), seed * 1.71 % 1);
    await wait(30);
    const con = pick(card.querySelector('.con-type'), seed * 2.13 % 1);
    await wait(30);
    const plan = pick(card.querySelector('.plan-sel'), seed * 2.71 % 1);
    await wait(30);
    const data = pick(card.querySelector('.data-sel'), seed * 3.17 % 1);
    const disc = card.querySelector('.dev-disc-input');
    disc.value = String(Math.floor(seed * 6) * 5000);
    disc.dispatchEvent(new Event('input', { bubbles: true }));
    disc.dispatchEvent(new Event('change', { bubbles: true }));
    updateCalculations();
    await wait(80);
    const first = money(card.querySelector('.final-1')?.textContent);
    const later = money(card.querySelector('.final-2')?.textContent);
    if (!Number.isFinite(first) || !Number.isFinite(later)) throw new Error(`legacy result invalid: ${first}/${later}`);
    return { carrier, category, device, ins, con, plan, data, devDisc: Number(disc.value || 0), first, later };
  }, seed);
}

async function newCase(page, state) {
  return page.evaluate(async state => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const set = (id, value) => {
      const s = document.getElementById(id);
      if (!s) throw new Error(`missing #${id}`);
      const o = [...s.options].find(o => o.value === value) || [...s.options].find(o => o.textContent.trim() === value);
      if (!o) throw new Error(`#${id} no option ${JSON.stringify(value)}`);
      s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('carrier', state.carrier.value); await wait(40);
    set('category', state.category); await wait(40);
    set('device', state.device.value); await wait(40);
    set('ins', state.ins.value); await wait(40);
    set('con', state.con.value); await wait(40);
    set('plan', state.plan.value); await wait(40);
    set('data', state.data.value); await wait(40);
    const d = document.getElementById('devDisc'); d.value = String(state.devDisc); d.dispatchEvent(new Event('input', { bubbles: true }));
    const r = calc();
    if (!r || !Number.isFinite(r.first) || !Number.isFinite(r.later)) throw new Error('new calc result invalid');
    return { first: r.first, later: r.later };
  }, state);
}

const browser = await chromium.launch({ headless: true });
const oldPage = await browser.newPage();
const newPage = await browser.newPage();
try {
  await pageLoad(oldPage, OLD, 'legacy');
  await pageLoad(newPage, NEW, 'new');
  await newPage.waitForFunction(() => typeof GLOBAL_DATA !== 'undefined' && GLOBAL_DATA, null, { timeout: 15000 });
  const carriers = await newPage.evaluate(() => Object.keys(GLOBAL_DATA || {}));
  if (!carriers.length) throw new Error('new master data is empty');

  for (let i = 1; i <= N; i++) {
    try {
      const old = await legacyCase(oldPage, rng());
      const fresh = await newCase(newPage, old);
      const diff = { first: fresh.first - old.first, later: fresh.later - old.later };
      const item = { index: i, status: diff.first === 0 && diff.later === 0 ? 'PASS' : 'FAIL', input: { carrier: old.carrier.value, category: old.category, device: old.device.value, ins: old.ins.value, con: old.con.value, plan: old.plan.value, data: old.data.value, devDisc: old.devDisc }, old: { first: old.first, later: old.later }, new: fresh, diff };
      report.cases.push(item);
      if (item.status === 'FAIL') console.error(`[PARITY] case ${i}:`, JSON.stringify(item));
    } catch (e) {
      report.cases.push({ index: i, status: 'FAIL', reason: e.stack || e.message });
      console.error(`[PARITY] case ${i}: FAIL - ${e.message}`);
    }
  }
} catch (e) {
  report.fatal = e.stack || e.message;
} finally {
  await browser.close();
}

const passed = report.cases.filter(x => x.status === 'PASS').length;
const failed = report.cases.length - passed;
report.summary = { generatedCases: report.cases.length, passedCases: passed, failedCases: failed, numericalParity: !report.fatal && report.cases.length === N && failed === 0 ? 'PASS' : 'FAIL' };
fs.writeFileSync('numerical-parity-report.json', JSON.stringify(report, null, 2));
console.log('[PARITY] SUMMARY');
console.log(JSON.stringify(report.summary, null, 2));
if (report.fatal) console.error(`[PARITY] FATAL: ${report.fatal}`);
process.exit(report.summary.numericalParity === 'PASS' ? 0 : 1);
