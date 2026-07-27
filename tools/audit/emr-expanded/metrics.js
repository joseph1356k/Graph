const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const OUT=__dirname,BASE='http://127.0.0.1:4173',TOKEN=fs.readFileSync(path.join(OUT,'token.txt'),'utf8').trim();
(async()=>{
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const c=await b.newContext({viewport:{width:1440,height:900}});
await c.addCookies([{name:'miracle_admin_session',value:TOKEN,domain:'127.0.0.1',path:'/'}]);
await c.addInitScript((t)=>localStorage.setItem('miracle-admin-session-v1',JSON.stringify({accessToken:t,user:{email:'a@b.c'}})),TOKEN);
const p=await c.newPage();
await p.goto(`${BASE}/emr-workspace.html`,{waitUntil:'load'});await p.waitForTimeout(2500);
const r=await p.evaluate(()=>{
 const vis=(el)=>{const x=el.getBoundingClientRect();return x.width>0&&x.height>0;};
 const panel=document.querySelector('.main-panel');
 const inputs=[...panel.querySelectorAll('input,select')].filter(vis);
 const tas=[...panel.querySelectorAll('textarea')].filter(vis);
 const view=document.querySelector('[data-view="intake"]');
 const header=document.querySelector('.view-header').getBoundingClientRect().height;
 const ribbon=document.querySelector('.patient-ribbon').getBoundingClientRect().height;
 const tabbar=document.querySelector('.tabbar').getBoundingClientRect().height;
 const topbar=document.querySelector('.topbar').getBoundingClientRect().height;
 const cards=[...view.querySelectorAll('.form-card')].map(x=>Math.round(x.getBoundingClientRect().height));
 const cardHeads=[...view.querySelectorAll('.form-card-head')].map(x=>Math.round(x.getBoundingClientRect().height));
 return {
  alturaMediaInput:Math.round(inputs.reduce((a,e)=>a+e.getBoundingClientRect().height,0)/inputs.length),
  numInputsVisibles:inputs.length,
  alturaMediaTextarea:Math.round(tas.reduce((a,e)=>a+e.getBoundingClientRect().height,0)/tas.length),
  numTextareasVisibles:tas.length,
  pxTopbar:Math.round(topbar), pxRibbon:Math.round(ribbon), pxTabbar:Math.round(tabbar), pxViewHeader:Math.round(header),
  pxCabecerasDeTarjeta:cardHeads.reduce((a,x)=>a+x,0),
  pxTarjetas:cards, pxVistaIntake:Math.round(view.getBoundingClientRect().height),
  pxDocumento:document.documentElement.scrollHeight,
  pxCromoNoCampos:Math.round(topbar+ribbon+tabbar+header)+cardHeads.reduce((a,x)=>a+x,0),
  paletaTabs:[...document.querySelectorAll('.tab-btn')].map(x=>getComputedStyle(x).backgroundColor),
  coloresDeAcentoDistintos:[...new Set([...document.querySelectorAll('.main-panel *,.topbar *')].map(e=>getComputedStyle(e).backgroundColor).filter(x=>x!=='rgba(0, 0, 0, 0)'))].length
 };
});
console.log(JSON.stringify(r,null,2));
fs.writeFileSync(path.join(OUT,'metrics.json'),JSON.stringify(r,null,2));
await b.close();})();
