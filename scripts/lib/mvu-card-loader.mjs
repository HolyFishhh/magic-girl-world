export function buildMvuCardLoader({ cardVersion, worldbookName, mvuUrl }) {
  return `(async()=>{
const g=globalThis,n=${JSON.stringify(worldbookName)},u=${JSON.stringify(mvuUrl)},v=${JSON.stringify(cardVersion)};
const k='__MAGIC_GIRL_WORLD_MVU_LOADER__'+v;
if(g[k]?.promise)return g[k].promise;
const s={status:'waiting',worldbook:n,presetMode:'builtin',lastError:''};
const configure=()=>{
  const t=g.SillyTavern;if(!t?.extensionSettings)return;
  const m=t.extensionSettings.mvu_settings??={},i=m.internal??={},e=m.额外模型解析配置??={},q=m.通知??={};
  if(i.魔法少女世界额外模型默认版本!==v){
    m.更新方式='额外模型解析';
    e.兼容假流式=true;e.关闭thinking=false;e.随机头部=false;
    e.模型来源='与插头相同';e.破限方案='使用内置破限';e.其他预设名称='';
    e.应答格式='聊天消息';e.启用自动请求=true;q.额外模型解析中=true;
    e.请求方式='依次请求，失败后重试';e.请求次数=2;e.max_chat_history=2;e.最大回复token数=20000;
    e.世界书条目白名单正则='^\\\\[mvu_update\\\\]';
    i.已开启默认不兼容假流式=true;i.魔法少女世界额外模型默认版本=v;
    t.saveSettingsDebounced?.();
  }
};
const p=(async()=>{for(;;){try{
  if(typeof g.getLorebookEntries!=='function'){s.status='waiting'}else{
    await g.getLorebookEntries(n);
    configure();s.status='loading';
    const importUrl=u+(u.includes('?')?'&':'?')+'mwg='+encodeURIComponent(v);
    await import(importUrl);s.status='ready';return true;
  }
}catch(e){s.status='waiting';s.lastError=String(e?.message||e)}await new Promise(r=>setTimeout(r,250))}})();
g[k]={promise:p,state:s};return p;
})()`;
}
