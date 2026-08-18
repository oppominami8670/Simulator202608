import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const oldUrl = 'https://raw.githubusercontent.com/oppominami8670/Simulator202603/main/index.html';
const newPath = path.join(repoRoot, 'phase9.html');
const oldHtml = await (await fetch(oldUrl)).text();
const newHtml = fs.readFileSync(newPath, 'utf8');

function assertSyntax(html, name) {
  const scripts = [...html.matchAll(/<script(?:[^>]*)>([\\s\\S]*?)<\\/script>/gi)].map(m => m[1]).filter(Boolean);
  for (let i = 0; i < scripts.length; i++) {
    try { new Function(scripts[i]); }
    catch (e) { throw new Error(`${name}: script ${i + 1} syntax error: ${e.message}`); }
  }
}
assertSyntax(oldHtml, 'old');
assertSyntax(newHtml, 'new');

const browser = await chromium.launch({ headless: true });
const report = { syntax: { old: 'PASS', new: 'PASS' }, cases: [], summary: {} };

async function load(page, html, label) {
  const urls = [...html.matchAll(/https:\\/\\/script\.google\.com\\/macros\\/s\\/[^"'\\s]+/g)].map(m => m[0]);
  await page.route('https://script.google.com/**', async route => {
    try {
      const r = await fetch(route.request().url(), { redirect: 'follow' });
      await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' }, body: await r.text() });
    } catch (e) { await route.abort(); }
  });
  await page.goto(label === 'old' ? oldUrl : pathToFileURL(newPath).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

// Smoke/regression harness: execute each page in Chromium, verify its calculation function is callable,
// and run deterministic randomized UI states where the new engine exposes its first/later result.
// Full numerical parity is recorded only when both pages expose a comparable numeric result.
const oldPage = await browser.newPage();
const newPage = await browser.newPage();
await load(oldPage, oldHtml, 'old');
await load(newPage, newHtml, 'new');

const newState = await newPage.evaluate(() => {
  const r = typeof calc === 'function' ? calc() : null;
  return r && typeof r.first === 'number' && typeof r.later === 'number' ? r : null;
});
report.newEngine = newState ? { status: 'PASS', first: newState.first, later: newState.later } : { status: 'FAIL' };

const oldCalc = await oldPage.evaluate(() => typeof calc === 'function');
report.oldEngine = { status: oldCalc ? 'PASS' : 'FAIL' };

// 100 deterministic cases. New engine cases are generated from currently available controls.
const rng = (() => { let x = 0x9e3779b9; return () => ((x = Math.imul(x ^ x >>> 16, 2246822507) ^ Math.imul(x ^ x >>> 13, 3266489909)) >>> 0) / 4294967296; }; })();
for (let i = 0; i < 100; i++) {
  const result = await newPage.evaluate((seed) => {
    const pick = s => { if (!s || !s.options.length) return; const enabled = [...s.options].filter(o => !o.disabled); if (enabled.length) s.value = enabled[Math.floor(seed * enabled.length)].value; s.dispatchEvent(new Event('change', { bubbles: true })); };
    const sels = ['carrier','category','device','ins','con','plan','data','net','netType'].map(id => document.getElementById(id)).filter(Boolean);
    for (const s of sels) pick(s);
    const d = document.getElementById('devDisc'); if (d) { d.value = String(Math.floor(seed * 6) * 5000); d.dispatchEvent(new Event('input', { bubbles: true })); }
    const r = typeof calc === 'function' ? calc() : null;
    return r && Number.isFinite(r.first) && Number.isFinite(r.later) ? r : null;
  }, rng());
  report.cases.push({ case: i + 1, new: result ? { status: 'PASS', first: result.first, later: result.later } : { status: 'FAIL' } });
}

report.summary = {
  syntax: 'PASS',
  generatedCases: report.cases.length,
  newEngineCallable: report.newEngine.status === 'PASS',
  oldEngineCallable: report.oldEngine.status === 'PASS',
  numericalParity: 'NOT_EXECUTED: old/new DOM schemas expose different result interfaces; no false PASS is reported'
};
fs.writeFileSync('regression-report.json', JSON.stringify(report, null, 2));
await browser.close();

if (report.newEngine.status !== 'PASS' || report.oldEngine.status !== 'PASS' || report.cases.some(c => c.new.status !== 'PASS')) process.exit(1);
console.log(JSON.stringify(report.summary, null, 2));
