import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const file = path.join(process.cwd(), 'phase9.html');
const html = fs.readFileSync(file, 'utf8');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push({ message: e.message, stack: e.stack }));
await page.goto(pathToFileURL(file).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1000);

const result = await page.evaluate(() => {
  const script = [...document.scripts].map(s => s.textContent || '').find(s => s.includes('function calc')) || '';
  const marker = script.indexOf('function calc');
  const calcSource = typeof calc === 'function' ? calc.toString() : '';
  let runtime = null;
  try { if (typeof calc === 'function') calc(); }
  catch (e) { runtime = { name: e.name, message: e.message, stack: e.stack || null }; }
  return {
    scriptLength: script.length,
    calcMarker: marker,
    calcSourceLength: calcSource.length,
    runtime,
    scriptAroundRuntimeColumn: script.slice(Math.max(0, 14053 - 700), 14053 + 700),
    calcSourceAroundRuntimeColumn: marker >= 0 ? script.slice(Math.max(marker, 14053 - 700), 14053 + 700) : '',
    calcHead: calcSource.slice(0, 500),
    calcTail: calcSource.slice(-500)
  };
});

console.log('[DIAG] page errors:', JSON.stringify(errors, null, 2));
console.log('[DIAG] runtime:', JSON.stringify(result.runtime, null, 2));
console.log('[DIAG] scriptLength:', result.scriptLength);
console.log('[DIAG] calcMarker:', result.calcMarker);
console.log('[DIAG] calcSourceLength:', result.calcSourceLength);
console.log('[DIAG] script around column 14053:\n' + result.scriptAroundRuntimeColumn);
console.log('[DIAG] calc source head:\n' + result.calcHead);
console.log('[DIAG] calc source tail:\n' + result.calcTail);
fs.writeFileSync('calc-diagnostic.json', JSON.stringify({ errors, ...result }, null, 2));
await browser.close();
