import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const OLD='https://raw.githubusercontent.com/oppominami8670/Simulator202603/main/index.html';
const NEW=pathToFileURL(path.join(process.cwd(),'phase9.html')).href;
const CASES=100;
const report={cases:[],summary:{}};

async function load(p,u,n){
  const e=[],c=[],f=[];
  p.on('pageerror',x=>e.push(x.message));
  p.on('console',m=>{if(m.type()==='error')c.push(m.text())});
  p.on('requestfailed',r=>f.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText||'unknown'}`));
  if(n==='old'){
    const html=await (await fetch(OLD)).text();
    await p.setContent(html,{waitUntil:'domcontentloaded'});
  }else await p.goto(u,{waitUntil:'domcontentloaded',timeout:30000});
  await p.waitForTimeout(1200);
  return{name:n,status:e.length||c.length||f.length?'FAIL':'PASS',errors:e,consoleErrors:c,failed:f};
}

async function initLegacy(p){
  await p.evaluate(async()=>{
    const wait=m=>new Promise(r=>setTimeout(r,m));
    for(let i=0;i<100;i++){
      if(typeof GLOBAL_DATA!=='undefined'&&GLOBAL_DATA&&Object.keys(GLOBAL_DATA).length>=6)break;
      await wait(100);
    }
    if(typeof GLOBAL_DATA==='undefined'||!GLOBAL_DATA||Object.keys(GLOBAL_DATA).length<6)throw Error('legacy master data did not load');
    if(!document.querySelector('.sim-card')&&typeof addSimulator==='function')addSimulator();
    for(let i=0;i<50&&!document.querySelector('.sim-card');i++)await wait(100);
    if(!document.querySelector('.sim-card')||!Array.isArray(instances)||!instances[0])throw Error('legacy calculator could not be initialized');
  });
}

async function runCase(page,caseData,isOld){
  return page.evaluate(({c,isOld})=>{
    const pick=(e,value,name)=>{
      if(!e)throw Error(`${name} element missing`);
      const s=String(value);
      if(![...e.options].some(o=>String(o.value)===s))throw Error(`legacy ${name} option not found: ${s}`);
      e.value=s;
    };
    if(isOld){
      const inst=instances[0],root=inst.root||document.querySelector('.sim-card');
      if(!root)throw Error('legacy card missing');
      pick(inst.dom.carrier,c.carrier,'carrier');
      if(typeof inst.loadCarrier==='function')inst.loadCarrier();
      const cat=root.querySelector(`.cat-btns .btn[data-cat="${CSS.escape(c.category)}"]`);
      if(!cat)throw Error(`legacy category button missing: ${c.category}`);
      cat.click();
      pick(inst.dom.device,c.device,'device');
      if(typeof inst.loadIns==='function')inst.loadIns();
      pick(inst.dom.ins,c.ins,'ins');
      if(typeof inst.loadCon==='function')inst.loadCon();
      pick(inst.dom.con,c.con,'con');
      if(typeof inst.loadOptions==='function')inst.loadOptions();
      pick(inst.dom.plan,c.plan,'plan');
      if(typeof inst.loadData==='function')inst.loadData();
      pick(inst.dom.data,c.data,'data');
      if(inst.dom.devDisc)inst.dom.devDisc.value=String(c.devDisc);
      inst.calc();
      const first=Number(String(root.querySelector('.final-1')?.textContent||'').replace(/[^0-9.-]/g,''));
      const later=Number(String(root.querySelector('.final-2')?.textContent||'').replace(/[^0-9.-]/g,''));
      return{first,later};
    }
    const set=(id,value)=>{
      const e=document.getElementById(id);if(!e)throw Error(`new ${id} missing`);
      const s=String(value);
      if(![...e.options].some(o=>String(o.value)===s)){e.innerHTML='';e.appendChild(new Option(s,s));}
      e.value=s;
    };
    set('carrier',c.carrier);set('category',c.category);set('device',c.device);set('ins',c.ins);set('con',c.con);set('plan',c.plan);set('data',c.data);
    $('devDisc').value=String(c.devDisc);
    const r=window.calc();
    return{first:r?.first,later:r?.later};
  },{c:caseData,isOld});
}

const b=await chromium.launch({headless:true});
const op=await b.newPage(),np=await b.newPage();
try{
  report.oldLoad=await load(op,OLD,'old');
  report.newLoad=await load(np,NEW,'new');
  await np.waitForFunction(()=>typeof GLOBAL_DATA!=='undefined'&&GLOBAL_DATA&&Object.keys(GLOBAL_DATA).length===6,null,{timeout:15000});
  const master=await np.evaluate(()=>GLOBAL_DATA);
  report.master=Object.keys(master).length;
  await initLegacy(op);
  const candidates=[];
  for(const carrier of Object.keys(master))for(const row of(master[carrier].devices||[])){
    if(row[3]){
      const plans=(master[carrier].plans||[]).filter(x=>x[0]&&x[2]!==undefined);
      if(plans.length)candidates.push({carrier,category:row[0],device:row[1],ins:String(row[2]),con:String(row[3]),plan:String(plans[0][0]),data:String(plans[0][2]),devDisc:0});
    }
  }
  if(!candidates.length)throw Error('no valid parity candidates');
  for(let i=1;i<=CASES;i++){
    try{
      const c={...candidates[(i*37)%candidates.length],devDisc:(i%7)*5000};
      const old=await runCase(op,c,true),fresh=await runCase(np,c,false);
      const diff={first:fresh.first-old.first,later:fresh.later-old.later};
      const item={index:i,status:diff.first===0&&diff.later===0?'PASS':'FAIL',input:c,old,new:fresh,diff};
      report.cases.push(item);
      if(item.status==='FAIL')console.error(`[PARITY] case ${i}: ${JSON.stringify(item)}`);
    }catch(e){
      const item={index:i,status:'FAIL',reason:e.stack||e.message};
      report.cases.push(item);
      console.error(`[PARITY] case ${i}: FAIL - ${item.reason}`);
    }
  }
}catch(e){report.fatal=e.stack||e.message}
finally{await b.close()}

const passed=report.cases.filter(x=>x.status==='PASS').length;
const failed=report.cases.length-passed;
report.summary={generatedCases:report.cases.length,passedCases:passed,failedCases:failed,numericalParity:!report.fatal&&report.cases.length===CASES&&failed===0?'PASS':'FAIL',oldLoad:report.oldLoad?.status||'FAIL',newLoad:report.newLoad?.status||'FAIL',masterCarriers:report.master||0};
fs.writeFileSync('numerical-parity-report.json',JSON.stringify(report,null,2));
console.log('[PARITY] SUMMARY');
console.log(JSON.stringify(report.summary,null,2));
if(report.fatal)console.error(`[PARITY] FATAL: ${report.fatal}`);
process.exit(report.summary.numericalParity==='PASS'&&report.summary.oldLoad==='PASS'&&report.summary.newLoad==='PASS'&&report.summary.masterCarriers===6?0:1);
