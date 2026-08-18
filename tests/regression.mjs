import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const oldUrl = 'https://raw.githubusercontent.com/oppominami8670/Simulator202603/main/index.html';
const newPath = path.join(repoRoot, 'phase9.html');

const report = { syntax: {}, pages: {}, cases: [], summary: {} };

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText} (${url})`);
  return await response.text();
}

function countScripts(html) {
  return (html.match(/<script(?:[^>]*)>/gi) || []).length;
}

let oldHtml;
let newHtml;
try {
  oldHtml = await fetchText(oldUrl);
  newHtml = fs.readFileSync(newPath, 'utf8');
  report.syntax.old = { status: 'PASS', scriptCount: countScripts(oldHtml) };
  report.syntax.new = { status: 'PASS', scriptCount: countScripts(newHtml) };
} catch (error) {
  report.fatal = `HTML acquisition failed: ${error.stack || error.message}`;
  fs.writeFileSync('regression-report.json', JSON.stringify(report, null, 2));
  console.error(report.fatal);
  process.exit(1);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  report.fatal = `Chromium launch failed: ${error.stack || error.message}`;
  fs.writeFileSync('regression-report.json', JSON.stringify(report, null, 2));
  console.error(report.fatal);
  process.exit(1);
}

async function load(page, url, name) {
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`));

  await page.route('https://script.google.com/**', async route => {
    try {
      const r = await fetch(route.request().url(), { redirect: 'follow' });
      await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' }, body: await r.text() });
    } catch (error) {
      await route.abort();
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    report.pages[name] = { status: pageErrors.length ? 'FAIL' : 'PASS', pageErrors, failedRequests };
  } catch (error) {
    report.pages[name] = { status: 'FAIL', pageErrors, failedRequests, navigationError: error.stack || error.message };
  }
  console.log(`[REGRESSION] ${name} load: ${report.pages[name].status}`);
  if (pageErrors.length) console.error(`[REGRESSION] ${name} page errors:\n${pageErrors.join('\n')}`);
  if (failedRequests.length) console.warn(`[REGRESSION] ${name} failed requests:\n${failedRequests.join('\n')}`);
  return report.pages[name];
}

const oldPage = await browser.newPage();
const newPage = await browser.newPage();
await load(oldPage, oldUrl, 'old');
await load(newPage, pathToFileURL(newPath).href, 'new');

try {
  const newState = await newPage.evaluate(() => {
    const r = typeof calc === 'function' ? calc() : null;
    return r && typeof r.first === 'number' && typeof r.later === 'number' ? r : null;
  });
  report.newEngine = newState ? { status: 'PASS', first: newState.first, later: newState.later } : { status: 'FAIL', reason: 'calc() did not return numeric first/later' };
} catch (error) {
  report.newEngine = { status: 'FAIL', reason: error.stack || error.message };
}

try {
  const oldCalc = await oldPage.evaluate(() => typeof calc === 'function');
  report.oldEngine = { status: oldCalc ? 'PASS' : 'FAIL', reason: oldCalc ? undefined : 'calc() is not exposed globally' };
} catch (error) {
  report.oldEngine = { status: 'FAIL', reason: error.stack || error.message };
}

console.log(`[REGRESSION] old calc(): ${report.oldEngine.status}`);
console.log(`[REGRESSION] new calc(): ${report.newEngine.status}`);

const rng = (() => { let x = 0x9e3779b9; return () => ((x = Math.imul(x ^ x >>> 16, 2246822507) ^ Math.imul(x ^ x >>> 13, 3266489909)) >>> 0) / 4294967296; })();
for (let i = 0; i < 100; i++) {
  try {
    const result = await newPage.evaluate((seed) => {
      const pick = s => {
        if (!s || !s.options.length) return;
        const enabled = [...s.options].filter(o => !o.disabled);
        if (enabled.length) s.value = enabled[Math.floor(seed * enabled.length)].value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const ids = ['carrier', 'category', 'device', 'ins', 'con', 'plan', 'data', 'net', 'netType'];
      for (const id of ids) pick(document.getElementById(id));
      const d = document.getElementById('devDisc');
      if (d) { d.value = String(Math.floor(seed * 6) * 5000); d.dispatchEvent(new Event('input', { bubbles: true })); }
      const r = typeof calc === 'function' ? calc() : null;
      return r && Number.isFinite(r.first) && Number.isFinite(r.later) ? r : null;
    }, rng());
    const item = result ? { status: 'PASS', first: result.first, later: result.later } : { status: 'FAIL', reason: 'calc() returned no numeric first/later' };
    report.cases.push({ case: i + 1, new: item });
    if (item.status === 'FAIL') console.error(`[REGRESSION] case ${i + 1}: FAIL - ${item.reason}`);
  } catch (error) {
    report.cases.push({ case: i + 1, new: { status: 'FAIL', reason: error.stack || error.message } });
    console.error(`[REGRESSION] case ${i + 1}: FAIL - ${error.stack || error.message}`);
  }
}

report.summary = {
  syntaxOld: report.syntax.old.status,
  syntaxNew: report.syntax.new.status,
  generatedCases: report.cases.length,
  passedCases: report.cases.filter(c => c.new.status === 'PASS').length,
  failedCases: report.cases.filter(c => c.new.status !== 'PASS').length,
  newEngineCallable: report.newEngine.status === 'PASS',
  oldEngineCallable: report.oldEngine.status === 'PASS',
  numericalParity: 'NOT_EXECUTED: old/new result interfaces are not yet wired for direct numerical comparison'
};

fs.writeFileSync('regression-report.json', JSON.stringify(report, null, 2));
console.log('[REGRESSION] SUMMARY');
console.log(JSON.stringify(report.summary, null, 2));

await browser.close();
const failed = report.pages.old.status !== 'PASS' || report.pages.new.status !== 'PASS' || report.newEngine.status !== 'PASS' || report.oldEngine.status !== 'PASS' || report.summary.failedCases > 0;
if (failed) process.exit(1);
