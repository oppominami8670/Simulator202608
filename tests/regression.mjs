import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const oldUrl = 'https://raw.githubusercontent.com/oppominami8670/Simulator202603/main/index.html';
const newPath = path.join(repoRoot, 'phase9.html');

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText} (${url})`);
  return await response.text();
}

const oldHtml = await fetchText(oldUrl);
const newHtml = fs.readFileSync(newPath, 'utf8');

function countScripts(html) {
  return (html.match(/<script(?:[^>]*)>/gi) || []).length;
}

const browser = await chromium.launch({ headless: true });
const report = { syntax: {}, cases: [], summary: {} };

async function load(page, url, name) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.route('https://script.google.com/**', async route => {
    try {
      const r = await fetch(route.request().url(), { redirect: 'follow' });
      await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' }, body: await r.text() });
    } catch (e) {
      await route.abort();
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  report.syntax[name] = { status: errors.length ? 'FAIL' : 'PASS', scriptCount: name === 'old' ? countScripts(oldHtml) : countScripts(newHtml), errors };
  return errors;
}

const oldPage = await browser.newPage();
const newPage = await browser.newPage();
const oldErrors = await load(oldPage, oldUrl, 'old');
const newErrors = await load(newPage, pathToFileURL(newPath).href, 'new');

const newState = await newPage.evaluate(() => {
  const r = typeof calc === 'function' ? calc() : null;
  return r && typeof r.first === 'number' && typeof r.later === 'number' ? r : null;
});
report.newEngine = newState ? { status: 'PASS', first: newState.first, later: newState.later } : { status: 'FAIL' };
const oldCalc = await oldPage.evaluate(() => typeof calc === 'function');
report.oldEngine = { status: oldCalc ? 'PASS' : 'FAIL' };

const rng = (() => { let x = 0x9e3779b9; return () => ((x = Math.imul(x ^ x >>> 16, 2246822507) ^ Math.imul(x ^ x >>> 13, 3266489909)) >>> 0) / 4294967296; })();
for (let i = 0; i < 100; i++) {
  const result = await newPage.evaluate((seed) => {
    const pick = s => { if (!s || !s.options.length) return; const enabled = [...s.options].filter(o => !o.disabled); if (enabled.length) s.value = enabled[Math.floor(seed * enabled.length)].value; s.dispatchEvent(new Event('change', { bubbles: true })); };
    const sels = ['carrier', 'category', 'device', 'ins', 'con', 'plan', 'data', 'net', 'netType'].map(id => document.getElementById(id)).filter(Boolean);
    for (const s of sels) pick(s);
    const d = document.getElementById('devDisc');
    if (d) { d.value = String(Math.floor(seed * 6) * 5000); d.dispatchEvent(new Event('input', { bubbles: true })); }
    const r = typeof calc === 'function' ? calc() : null;
    return r && Number.isFinite(r.first) && Number.isFinite(r.later) ? r : null;
  }, rng());
  report.cases.push({ case: i + 1, new: result ? { status: 'PASS', first: result.first, later: result.later } : { status: 'FAIL' } });
}

report.summary = {
  syntaxOld: report.syntax.old.status,
  syntaxNew: report.syntax.new.status,
  generatedCases: report.cases.length,
  newEngineCallable: report.newEngine.status === 'PASS',
  oldEngineCallable: report.oldEngine.status === 'PASS',
  numericalParity: 'NOT_EXECUTED: old/new result interfaces are not yet wired for direct numerical comparison'
};
fs.writeFileSync('regression-report.json', JSON.stringify(report, null, 2));
await browser.close();
if (oldErrors.length || newErrors.length || report.newEngine.status !== 'PASS' || report.oldEngine.status !== 'PASS' || report.cases.some(c => c.new.status !== 'PASS')) process.exit(1);
console.log(JSON.stringify(report.summary, null, 2));
