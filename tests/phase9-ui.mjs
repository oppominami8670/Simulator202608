import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const url = pathToFileURL(path.join(process.cwd(), 'phase9.html')).href;
const gasUrl = 'https://script.google.com/macros/s/AKfycbxUj8Ojmgq2H-weGZRui_rdi9W6_y6QSUjbjKY1Lr89IsErmVNqxYZx_walEIs3QoaA/exec';
const fixture = {
  TestCarrier:{devices:[['Android','Test Phone',24,'mnp',48000,0,990],['Android','Test Phone',24,'new',48000,0,990],['Android','Test Phone',24,'standalone',48000,0,990],['Android','Second Phone',36,'mnp',72000,2000,990]],plans:[['Test Plan','~20GB',3000]],discounts:[],internets:[['固定回線A','タイプA',5000,0,'セット割',1100]],options:[['通話オプション',880]]},
  docomo:{devices:[],plans:[],discounts:[],internets:[],options:[]},au:{devices:[],plans:[],discounts:[],internets:[],options:[]},SoftBank:{devices:[],plans:[],discounts:[],internets:[],options:[]},UQ:{devices:[],plans:[],discounts:[],internets:[],options:[]},'Y!mobile':{devices:[],plans:[],discounts:[],internets:[],options:[]}
};

const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
const errors=[];
page.on('dialog', async d=>await d.dismiss());
page.on('pageerror',e=>errors.push(`pageerror: ${e.message}`));
page.on('console',m=>{if(m.type()==='error')errors.push(`console: ${m.text()}`)});

try{
  await page.addInitScript(({gasUrl,fixture})=>{
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const u=typeof input==='string'?input:input?.url;
      if(u===gasUrl||u?.startsWith(gasUrl+'?')) return new Response(JSON.stringify(fixture),{status:200,headers:{'Content-Type':'application/json'}});
      return originalFetch(input,init);
    };
  },{gasUrl,fixture});
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('.cell',{state:'visible',timeout:5000});
  await page.waitForSelector('#carrier option[value="TestCarrier"]',{state:'attached',timeout:5000});
  await page.locator('.cell').first().click();
  await page.waitForSelector('#modalBg.open',{state:'visible',timeout:3000});
  await page.click('.modebtn[data-mode="engine"]');
  await page.waitForSelector('#engineArea',{state:'visible',timeout:3000});
  await page.selectOption('#carrier','TestCarrier');
  await page.selectOption('#category','Android');
  await page.waitForFunction(()=>document.querySelectorAll('#device option').length>1,{timeout:3000});
  await page.selectOption('#device','Test Phone');
  await page.waitForFunction(()=>document.querySelectorAll('#ins option').length>1,{timeout:3000});
  await page.selectOption('#ins','24');
  await page.waitForFunction(()=>document.querySelectorAll('#con option').length>1,{timeout:3000});
  await page.selectOption('#con','mnp');
  await page.waitForFunction(()=>document.querySelectorAll('#options .opt').length>=1,{timeout:3000});
  const result=await page.evaluate(()=>({deviceOptions:document.querySelectorAll('#device option').length-1,installmentOptions:document.querySelectorAll('#ins option').length-1,contractOptions:document.querySelectorAll('#con option').length-1,optionButtons:document.querySelectorAll('#options .opt').length,selected:{carrier:$('#carrier').value,category:$('#category').value,device:$('#device').value,ins:$('#ins').value,con:$('#con').value}}));
  if(result.deviceOptions<1)throw new Error('Device selection produced no device options');
  if(result.installmentOptions<1)throw new Error('Device selection produced no installment options');
  if(result.contractOptions<1)throw new Error('Installment selection produced no contract options');
  if(result.optionButtons<1)throw new Error('Contract selection produced no option buttons');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('[PHASE9 UI] PASS',JSON.stringify(result));
}catch(e){console.error('[PHASE9 UI] FAIL',`${e.message}\nCaptured errors: ${errors.join(' | ')}`);process.exitCode=1}finally{await browser.close()}
