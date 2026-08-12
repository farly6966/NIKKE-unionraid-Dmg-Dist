const {JSDOM}=require('jsdom');const fs=require('fs');
const errs=[];
function mkCtx(){const g={addColorStop(){}};return new Proxy({},{get:(t,p)=>{
 if(p==='canvas')return{width:400,height:340};
 if(['createLinearGradient','createRadialGradient','createPattern'].includes(p))return()=>g;
 if(p==='measureText')return()=>({width:10});
 if(typeof p==='string')return t[p]!==undefined?t[p]:()=>{};return undefined;},set:(t,p,v)=>{t[p]=v;return true;}});}
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'dangerously',resources:'usable',
 url:'file:///tmp/index.html',pretendToBeVisual:true,
 beforeParse(w){w.HTMLCanvasElement.prototype.getContext=()=>mkCtx();
  w.onerror=(m,s,l,c)=>errs.push(`onerror: ${m} @${l}:${c}`);
  w.console.error=(...a)=>errs.push('console.error: '+a.join(' '));}});
const W=dom.window,D=W.document;
let ok=0,bad=0;
const chk=(n,g,x)=>{const p=String(g)===String(x);p?ok++:bad++;
 console.log(` ${p?'✅':'❌'} ${n.padEnd(42)} ${p?g:`got=${g} exp=${x}`}`);};
const txt=id=>{const e=D.getElementById(id);return e?e.textContent.trim().replace(/\s+/g,' '):'(無)';};
const set=(el,v,ev)=>{el.value=v;el.dispatchEvent(new W.Event(ev,{bubbles:true}));};
const tab=t=>D.querySelector(`.tab-btn[data-tab="${t}"]`).dispatchEvent(new W.Event('click',{bubbles:true}));
setTimeout(()=>{
 console.log('=== 載入 ===\n'+(errs.length?errs.join('\n'):' ✅ 無錯誤'));
 const sel=D.getElementById('periodSelect');
 chk('期數選單選項數',sel.options.length,2);
 chk('預設為最新期',sel.value,'UR43');
 chk('狀態列顯示期數與範圍',/UR43.*621.*920/.test(txt('dbRangeTag')),true);

 console.log('\n=== 五屬性分頁（UR43）===');
 set(D.getElementById('globalLevelInput'),'755','change');
 set(D.getElementById('input_multi_Fire'),'35B','input');
 const row=[...D.querySelectorAll('#multiResultsBody tr')].find(r=>r.textContent.includes('燃燒'));
 chk('Fire 列有百分位',/\d+\.\d%/.test(row.textContent),true);

 console.log('\n=== 切換到 UR42 ===');
 set(sel,'UR42','change');
 chk('狀態列改為 UR42',/UR42/.test(txt('dbRangeTag')),true);
 chk('切期後無錯誤',errs.length,0);
 const cards=D.querySelectorAll('#teamCardsList > *');
 tab('single');
 D.querySelector('.elem-btn[data-elem="Wind"]').dispatchEvent(new W.Event('click',{bubbles:true}));
 set(D.getElementById('singleDamageInput'),'40B','input');
 chk('UR42 單刀百分位有值',/\d/.test(txt('valPercentile')),true);
 chk('UR42 隊伍卡片數 (Wind=10)',D.querySelectorAll('#teamCardsList > *').length,10);
 set(sel,'UR43','change');
 tab('single');
 D.querySelector('.elem-btn[data-elem="Wind"]').dispatchEvent(new W.Event('click',{bubbles:true}));
 chk('切回 UR43 Wind 卡片數 (=3)',D.querySelectorAll('#teamCardsList > *').length,3);

 console.log('\n=== 跨期成長追蹤 ===');
 tab('growth');
 chk('比對範圍標示',/UR42 → UR43.*4190/.test(txt('growthScopeTag')),true);
 const inp=D.getElementById('growthPlayerId');
 // 找一個兩期都有的 ID
 const A=W.UR_PLAYERS.UR42,B=W.UR_PLAYERS.UR43;
 const uid=Object.keys(B).find(u=>A[u]&&A[u].avg_pct!==null&&B[u].avg_pct!==null);
 set(inp,uid,'change');
 chk('查得到玩家',D.getElementById('growthResult').style.display,'block');
 const exp=+(B[uid].avg_pct-A[uid].avg_pct).toFixed(1);
 chk('百分位變化正確',txt('growthPctDelta'),`${exp>=0?'+':''}${exp} pt`);
 chk('等級成長正確',txt('growthLvGain'),`${B[uid].lv-A[uid].lv>=0?'+':''}${B[uid].lv-A[uid].lv} 級`);
 chk('明細兩列',D.querySelectorAll('#growthDetailBody tr').length,2);

 console.log('\n=== 失敗路徑 ===');
 set(inp,'99999999','change');
 chk('查無 ID 時隱藏結果',D.getElementById('growthResult').style.display,'none');
 chk('查無 ID 有提示',/查不到/.test(txt('growthNote')),true);
 set(sel,'UR42','change'); tab('growth');
 chk('最舊一期無法比對時提示',/沒有更早的期數/.test(txt('growthScopeTag')),true);

 console.log('\n=== 執行期錯誤 ===\n'+(errs.length?errs.join('\n'):' ✅ 無'));
 if(errs.length)bad++;else ok++;
 console.log(`\n════════  通過 ${ok} ／ 失敗 ${bad}  ════════`);
},2500);
