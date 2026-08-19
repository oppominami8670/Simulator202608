import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const url = pathToFileURL(path.join(process.cwd(), 'phase9.html')).href;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.GLOBAL_DATA && Object.keys(window.GLOBAL_DATA).length === 6, { timeout: 20000 });
  await page.click('.modebtn[data-mode="engine"]');

  const target = await page.evaluate(() => {
    for (const [carrier, data] of Object.entries(GLOBAL_DATA)) {
      const devices = data.devices || [];
      const row = devices.find(x => x[0] && x[1] && x[2] && x[3]);
      if (row) return { carrier, category: row[0], device: row[1], ins: String(row[2]), con: row[3] };
    }
    return null;
  });
  if (!target) throw new Error('No valid device/contract row found in master data');

  await page.selectOption('#carrier', target.carrier);
  await page.selectOption('#category', target.category);
  await page.waitForFunction(() => document.querySelectorAll('#device option').length > 1, { timeout: 5000 });
  await page.selectOption('#device', target.device);
  await page.waitForFunction(() => document.querySelectorAll('#ins option').length > 1, { timeout: 5000 });
  await page.selectOption('#ins', target.ins);
  await page.waitForFunction(() => document.querySelectorAll('#con option').length > 1, { timeout: 5000 });
  await page.selectOption('#con', target.con);
  await page.waitForFunction(() => document.querySelectorAll('#options .opt').length > 0, { timeout: 5000 });

  const result = await page.evaluate(() => ({
    deviceOptions: document.querySelectorAll('#device option').length - 1,
    installmentOptions: document.querySelectorAll('#ins option').length - 1,
    contractOptions: document.querySelectorAll('#con option').length - 1,
    optionButtons: document.querySelectorAll('#options .opt').length,
    selected: { carrier: $('#carrier').value, category: $('#category').value, device: $('#device').value, ins: $('#ins').value, con: $('#con').value }
  }));

  if (result.deviceOptions < 1) throw new Error('Device selection produced no device options');
  if (result.installmentOptions < 1) throw new Error('Device selection produced no installment options');
  if (result.contractOptions < 1) throw new Error('Installment selection produced no contract options');
  if (result.optionButtons < 1) throw new Error('Contract selection produced no option buttons');
  if (errors.length) throw new Error(errors.join('\n'));

  console.log('[PHASE9 UI] PASS', JSON.stringify(result));
} catch (e) {
  console.error('[PHASE9 UI] FAIL', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
