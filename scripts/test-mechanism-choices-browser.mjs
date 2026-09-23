import fs from 'node:fs';
import {resolve} from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import webpack from 'webpack';
import * as sass from 'sass';
import WebSocket from 'ws';
const dir=resolve('tmp/mechanism-choices-visual');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(resolve(dir,'entry.ts'),`import $ from 'jquery'; window['$']=$;
import {CardSystem} from '../../src/fish/combat/cardSystem';
import {cardPaymentPlans} from '../../src/game-core/cardPayment';
import {TavernEffectChoicePresenter} from '../../src/fish/ui/effectChoicePresenter';
import {GameStateManager} from '../../src/fish/core/gameStateManager';
import {convertMvuCards} from '../../src/fish/core/mvuBattleAdapter';
const store=GameStateManager.getInstance();
const cards=convertMvuCards(Array.from({length:6},(_,i)=>({id:'card_'+i,name:i?'月光献物'+i:'月蚀仪式',type:'Skill',rarity:'Rare',cost:1,quantity:1,effects:{block:4},payment:i?undefined:{additional:{hp:3,discard:{count:2},sacrifice:{count:1}},alternatives:[{id:'moon',name:'以月华替代全部通常费用',cost:{moon:2},hp:2}]}})));
store.updatePlayer({hand:cards,currentHp:20,energy:3,resources:{moon:{id:'moon',name:'月华',emoji:'🌙',current:3,max:9,refresh:'retain'}}});
store.spawnSummons('player',{id:'familiar',name:'月光使魔',emoji:'🐈',maxHp:10,attack:1},2);
window['openPayment']=()=>{window['answer']='pending';CardSystem.getInstance()['choosePayment'](cardPaymentPlans(cards[0],{hp:20,hand:cards,summons:store.getSummons(),resources:{energy:3,moon:3}})).then(v=>window['answer']=v,e=>window['answer']=e.code);};
window['openStatus']=()=>{window['answer']='pending';TavernEffectChoicePresenter.getInstance().choose({op:'choose_one',choiceId:'status',count:1,options:[{id:'ritual',label:'🕯 黑暗仪式 · 3层 · 2回合',effects:[{op:'narrate',text:'结算前拦截：持有者受到伤害时，将本次伤害改为本次待结算伤害减去层数；优先级0，每回合最多1次（格挡前）。'}]},{id:'moon',label:'🌙 月之誓 · 2层',effects:[{op:'narrate',text:'转移时保留状态身份和期限，只移除对方实际接收的层数。'}]}]}).then(v=>window['answer']=v);};
window['ready']=true;`);
if(!process.argv.includes('--reuse')) await new Promise((yes,no)=>{const c=webpack({mode:'development',entry:resolve(dir,'entry.ts'),output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.ts','.js'],alias:{'@':resolve('src')}},module:{rules:[{test:/\.ts$/,exclude:/node_modules/,use:{loader:'ts-loader',options:{transpileOnly:true}}},{test:/\.scss$/,type:'asset/source'}]},plugins:[new webpack.ProvidePlugin({$:'jquery',jQuery:'jquery',_:'lodash'})],devtool:false});c.run((e,s)=>c.close(()=>e||s.hasErrors()?no(e||s.toString({all:false,errors:true})):yes()));});
fs.writeFileSync(resolve(dir,'style.css'),sass.compile('src/fish/index.scss',{silenceDeprecations:['legacy-js-api','import','global-builtin','color-functions']}).css);
fs.writeFileSync(resolve(dir,'index.html'),'<!doctype html><meta charset="UTF-8"><link rel="stylesheet" href="style.css"><style>body{margin:0}#battle-scene{height:100vh;min-height:0;position:relative}</style><div id="battle-scene"></div><script src="bundle.js"></script>');
const server=http.createServer((req,res)=>{const name=(req.url||'/').slice(1)||'index.html';if(!['bundle.js','style.css','index.html'].includes(name)){res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(resolve(dir,name)));});await new Promise(r=>server.listen(18248,'127.0.0.1',r));
const browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=18247',`--user-data-dir=${resolve(dir,'profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try{
 let pages;for(let i=0;i<100;i++){try{pages=await(await fetch('http://127.0.0.1:18247/json/list')).json();if(pages?.length)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(pages?.length);ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
 let sequence=0;const pending=new Map;ws.on('message',raw=>{const v=JSON.parse(raw);if(v.id){const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(v.error):p.resolve(v.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const js=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await call('Page.enable');await call('Runtime.enable');const evidence=[];
 for(const width of [390,1000]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:'http://127.0.0.1:18248/'});
  for(let i=0;i<60&&!await js('window.ready===true');i++)await new Promise(r=>setTimeout(r,100));assert.equal(await js('window.ready'),true);
  const inspect=async name=>{await new Promise(r=>setTimeout(r,450));const r=await js(`(()=>{const m=document.querySelector('.modal-content'),b=m.querySelector('.modal-body'),f=m.querySelector('.modal-footer'),rect=m.getBoundingClientRect(),foot=f.getBoundingClientRect();return {transform:getComputedStyle(m).transform,parentHeight:m.parentElement.getBoundingClientRect().height,hostHeight:document.getElementById('battle-scene').getBoundingClientRect().height,scroll:scrollY,align:getComputedStyle(m.parentElement).alignItems,parentTop:m.parentElement.getBoundingClientRect().top,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,footerBottom:foot.bottom,bodyHeight:b.getBoundingClientRect().height,text:m.textContent}})()`);assert.ok(r.left>=-1&&r.right<=width+1&&r.top>=-1&&r.bottom<=801&&r.footerBottom<=801&&r.bodyHeight>=60,JSON.stringify(r));fs.writeFileSync(resolve(dir,`${name}-${width}.png`),Buffer.from((await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));evidence.push({name,width,...r});};
  await js('window.openPayment();void 0');await inspect('payment');assert.match(await js('document.querySelector(".modal-content").textContent'),/月华/);
  await js('document.querySelector("[data-option-id=normal]").click();document.querySelector(".confirm-effect-choice").click();void 0');await inspect('discard');
  await js('document.querySelector(".cancel-selection").click();void 0');assert.equal(await js('window.answer'),'CHOICE_CANCELLED');await new Promise(r=>setTimeout(r,250));
  await js('window.openPayment();void 0');await js('document.querySelector("[data-option-id=normal]").click();document.querySelector(".confirm-effect-choice").click();void 0');
  await js('const cards=document.querySelectorAll(".selection-card");cards[0].click();cards[1].click();document.querySelector(".confirm-selection").click();void 0');await inspect('sacrifice');
  await js('document.querySelector(".summon-choice-option").click();document.querySelector(".summon-choice-confirm").click();void 0');const answer=await js('window.answer');assert.equal(answer.discardIds.length,2);assert.equal(answer.sacrificeIds.length,1);
  await js('window.openStatus();void 0');await inspect('status');await js('document.querySelector(".cancel-effect-choice").click();void 0');assert.equal(await js('window.answer'),null);
 }
 fs.writeFileSync(resolve(dir,'evidence.json'),JSON.stringify(evidence,null,2));console.log('PASS isolated 390/1000 UI: payment options, full discard card faces, sacrifice selection, status choice, cancellation and visible footer');
}finally{ws?.close();browser.kill();await new Promise(r=>server.close(r));}
