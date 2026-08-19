import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const file = path.join(process.cwd(), 'phase9.html');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push({ message: e.message, stack: e.stack }));
await page.goto(pathToFileURL(file).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1200);

const result = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const script = [...document.scripts].map(s => s.textContent || '').find(s => s.includes('function calc')) || '';
  const marker = script.indexOf('function calc');
  const calcSource = typeof calc === 'function' ? calc.toString() : '';
  const setFirst = id => {
    const s = document.getElementById(id);
    if (!s) throw new Error(`missing #${id}`);
    const o = [...s.options].find(x => !x.disabled && x.value !== '');
    if (!o) throw new Error(`#${id} has no usable option`);
    s.value = o.value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const carriers = Object.keys(GLOBAL_DATA || {});
  let runtime = null;
  try {
    if (!carriers.length) throw new Error('GLOBAL_DATA is empty');
    setFirst('carrier'); await wait(50);
    setFirst('category'); await wait(50);
    setFirst('device'); await wait(50);
    setFirst('ins'); await wait(50);
    setFirst('con'); await wait(50);
    setFirst('plan'); await wait(50);
    setFirst('data'); await wait(50);
    const r = calc();
    if (!r || !Number.isFinite(r.first) || !Number.isFinite(r.later)) throw new Error('calc() did not return numeric first/later');
    runtime = { status: 'PASS', result: r };
  } catch (e) {
    runtime = { status: 'FAIL', name: e.name, message: e.message, stack: e.stack || null };
  }
  return { carriers, scriptLength: script.length, calcMarker: marker, calcSourceLength: calcSource.length, runtime, calcHead: calcSource.slice(0, 500), calcTail: calcSource.slice(-500) };
});

console.log('[DIAG] page errors:', JSON.stringify(errors, null, 2));
console.log('[DIAG] runtime:', JSON.stringify(result.runtime, null, 2));
console.log('[DIAG] carriers:', result.carriers.length);
console.log('[DIAG] calcMarker:', result.calcMarker);
console.log('[DIAG] calcSourceLength:', result.calcSourceLength);
fs.writeFileSync('calc-diagnostic.json', JSON.stringify({ errors, ...result }, null, 2));
await browser.close();
if (errors.length || result.runtime.status !== 'PASS' || result.carriers.length !== 6) process.exit(1);
