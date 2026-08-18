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

function extractScripts(html) {
  const scripts = [];
  const open = /<script(?:[^>]*)>/gi;
  let match;
  while ((match = open.exec(html)) !== null) {
    const start = match.index + match[0].length;
    const end = html.toLowerCase().indexOf('</script>', start);
    if (end < 0) throw new Error('Unclosed <script> tag');
    const source = html.slice(start, end);
    if (source.trim()) scripts.push(source);
    open.lastIndex = end + '</script>'.length;
  }
  return scripts;
}

function assertSyntax(html, name) {
  const scripts = extractScripts(html);
  for (let i = 0; i < scripts.length; i++) {
    try {
      new Function(scripts[i]);
    } catch (e) {
      throw new Error(`${name}: script ${i + 1} syntax error: ${e.message}`);
    }
  }
  return scripts.length;
}

const oldScriptCount = assertSyntax(oldHtml, 'old');
const newScriptCount = assertSyntax(newHtml, 'new');

const browser = await chromium.launch({ headless: true });
const report = { syntax: { old: 'PASS', new: 'PASS', oldScriptCount, newScriptCount }, cases: [], summary: {} };

async function load(page, url) {
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
}

const oldPage = await browser.newPage();
const newPage = await browser.newPage();
await load(oldPage, oldUrl);
await load(newPage, pathToFileURL(newPath).href);

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
  syntax: 'PASS', generatedCases: report.cases.length,
  newEngineCallable: report.newEngine.status === 'PASS', oldEngineCallable: report.oldEngine.status === 'PASS',
  numericalParity: 'NOT_EXECUTED: old/new DOM schemas expose different result interfaces; no false PASS is reported'
};
fs.writeFileSync('regression-report.json', JSON.stringify(report, null, 2));
await browser.close();
if (report.newEngine.status !== 'PASS' || report.oldEngine.status !== 'PASS' || report.cases.some(c => c.new.status !== 'PASS')) process.exit(1);
console.log(JSON.stringify(report.summary, null, 2));
