import fs from 'node:fs';
import {resolve} from 'node:path';
import webpack from 'webpack';
import * as sass from 'sass';
const dir=resolve('tmp/shop-fixed-visual');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(resolve(dir,'entry.ts'),`import {renderShopMarket} from '../../src/common/shopMarket';
const root=document.getElementById('choice-container')!;
const cards=Array.from({length:20},(_,i)=>({id:'c'+i,name:'测试牌'+i,type:'攻击',cost:1,description:'测试',runInstanceId:'instance-'+i}));
cards[19].lifecycle={removable:false};
window['removed']=[];window['purchased']=[];
renderShopMarket({root,stat:{battle:{cards},reward:{card:[cards[0]],artifact:[],item:[]}},run:{gold:999,act:1} as any,enabled:true,renderCard:c=>'<div class="mwg-card" style="height:180px;padding:12px;border:1px solid gray">'+c.name+'</div>',renderSupport:()=>'',purchase:async(...args)=>{window['purchased'].push(args)},removeCard:async id=>{window['removed'].push(id)},leave:async()=>{}});`);
await new Promise((yes,no)=>{const c=webpack({mode:'development',entry:resolve(dir,'entry.ts'),output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.ts','.js']},module:{rules:[{test:/\.ts$/,exclude:/node_modules/,use:{loader:'ts-loader',options:{transpileOnly:true}}},{test:/\.scss$/,type:'asset/source'}]},devtool:false});c.run((e,s)=>c.close(()=>e||s.hasErrors()?no(e||s.toString({all:false,errors:true})):yes()));});
fs.writeFileSync(resolve(dir,'style.css'),sass.compile('src/common/shopMarket.scss').css);
fs.writeFileSync(resolve(dir,'inner.html'),'<!doctype html><meta charset="UTF-8"><link rel="stylesheet" href="style.css"><style>body{margin:0;background:#202632;color:white}*{box-sizing:border-box}</style><div id="choice-container" class="is-shop-market"></div><script src="bundle.js"></script>');
fs.writeFileSync(resolve(dir,'index.html'),'<!doctype html><meta charset="UTF-8"><style>body{margin:0}iframe{border:0;width:100%;height:2800px}</style><div style="height:900px">模拟酒馆前文</div><iframe src="inner.html"></iframe><div style="height:800px"></div>');


import http from 'node:http';


import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import WebSocket from 'ws';

const out=resolve(dir,'evidence');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const name=(req.url||'/').slice(1)||'index.html';if(name==='favicon.ico'){res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(resolve(dir,name)))});await new Promise(r=>server.listen(18188,'127.0.0.1',r));
const port=18187;
const edge=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${resolve(dir,'profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try{
 let pages;for(let i=0;i<100;i++){try{pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(pages?.length)break}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(pages?.length,'isolated Edge starts');ws=new WebSocket(pages.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
 let id=0;const waiters=new Map;ws.on('message',raw=>{const x=JSON.parse(raw);if(x.id){const p=waiters.get(x.id);waiters.delete(x.id);x.error?p.reject(x.error):p.resolve(x.result)}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;waiters.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
 const evalJs=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 const shot=async name=>fs.writeFileSync(resolve(out,`${name}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
 await call('Page.enable');await call('Runtime.enable');const evidence=[];
 for(const width of [390,1000]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://127.0.0.1:18188/'});await new Promise(r=>setTimeout(r,650));
  await evalJs(`(()=>{const f=document.querySelector('iframe'),b=f.contentDocument.querySelector('[data-shop-remove]');window.scrollTo(0,900+b.getBoundingClientRect().top-450);window.beforeScroll=scrollY;b.click()})()`);await new Promise(r=>setTimeout(r,120));
  const inspect=()=>evalJs(`(()=>{const f=document.querySelector('iframe'),d=f.contentDocument,m=d.querySelector('dialog'),r=m.getBoundingClientRect(),h=d.querySelector('.shop-remove-confirm').getBoundingClientRect(),offset=f.getBoundingClientRect().top;return {top:r.top+offset,bottom:r.bottom+offset,left:r.left,right:r.right,confirmTop:h.top+offset,confirmBottom:h.bottom+offset,scroll:scrollY,before:window.beforeScroll,open:m.open,removed:f.contentWindow.removed}})()`);
  let state=await inspect();assert.ok(state.open);assert.ok(state.top>=0&&state.bottom<=800&&state.left>=0&&state.right<=width,JSON.stringify(state));assert.equal(state.scroll,state.before,'opening must not scroll parent');assert.ok(state.confirmTop>=0&&state.confirmBottom<=800);await shot('removal-'+width);
  assert.equal(await evalJs('document.querySelector("iframe").contentDocument.querySelectorAll("[data-remove-index]").length'),19,'bound card excluded from shop choices');
  await evalJs(`(()=>{const d=document.querySelector('iframe').contentDocument;d.querySelector('[data-remove-index="0"]').click();d.querySelector('.shop-detail-close').click()})()`);
  assert.deepEqual(await evalJs('document.querySelector("iframe").contentWindow.removed'),[]);
  await evalJs(`(()=>{const d=document.querySelector('iframe').contentDocument;d.querySelector('[data-shop-remove]').click();d.querySelector('[data-remove-index="1"]').click();d.querySelector('.shop-remove-confirm').click()})()`);await new Promise(r=>setTimeout(r,50));
  assert.deepEqual(await evalJs('document.querySelector("iframe").contentWindow.removed'),['instance-1']);
  await call('Emulation.setDeviceMetricsOverride',{width:540,height:650,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,100));const resized=await inspect();assert.ok(resized.top>=0&&resized.bottom<=650&&resized.right<=540,JSON.stringify(resized));await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,100));
  await evalJs('window.scrollBy(0,100)');await new Promise(r=>setTimeout(r,80));const afterScroll=await inspect();assert.ok(afterScroll.top>=0&&afterScroll.bottom<=800,JSON.stringify(afterScroll));
  await evalJs(`(()=>{const d=document.querySelector('iframe').contentDocument;d.querySelector('.shop-detail-close').click();d.querySelector('[data-shop-inspect]').click()})()`);
  assert.equal(await evalJs('document.querySelector("iframe").contentDocument.querySelector(".shop-detail-host").classList.contains("is-product-detail")'),true);
  assert.equal(await evalJs('document.querySelector("iframe").contentDocument.querySelector("dialog")'),null);
  evidence.push({width,state,afterScroll});
 }
 fs.writeFileSync(resolve(out,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{ws?.terminate();edge.kill();server.close();}




