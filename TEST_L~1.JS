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
  w.onerror=(m,s,l,c)=>errs.push(`onerror: ${m} @${l}:${c}`);w.console.error=(...a)=>errs.push('err: '+a.join(' '));}});
const W=dom.window,D=W.document;
let ok=0,bad=0;
const chk=(n,g,x)=>{const p=String(g)===String(x);p?ok++:bad++;
 console.log(` ${p?'✅':'❌'} ${n.padEnd(44)} ${p?g:`got=${g} exp=${x}`}`);};
const txt=id=>{const e=D.getElementById(id);return e?e.textContent.trim().replace(/\s+/g,' '):'(無)';};
const set=(el,v,ev)=>{el.value=v;el.dispatchEvent(new W.Event(ev,{bubbles:true}));};
setTimeout(()=>{
 D.querySelector('.tab-btn[data-tab="single"]').dispatchEvent(new W.Event('click',{bubbles:true}));
 const lv=D.getElementById('globalLevelInput');
 const pick=e=>D.querySelector(`.elem-btn[data-elem="${e}"]`).dispatchEvent(new W.Event('click',{bubbles:true}));
 const dmg=D.getElementById('singleDamageInput');

 console.log('=== 1000 以上：樣本足夠的屬性（Iron 1041-1060, n=55）===');
 set(lv,'1050','change'); pick('Iron'); set(dmg,'90B','input');
 chk('等級沒有被夾掉',lv.value,'1050');
 chk('百分位有算出來',/\d+\.\d%/.test(txt('valPercentile')),true);
 chk('基準資訊有樣本數',/n = \d+/.test(txt('badgeSampleInfo')),true);
 console.log('    ',txt('badgeSampleInfo'));

 console.log('\n=== 1000 以上：樣本很少的屬性（Wind 1041-1060, n=7）===');
 pick('Wind'); set(dmg,'60B','input');
 chk('仍然給出百分位',/\d+\.\d%/.test(txt('valPercentile')),true);
 chk('標示樣本過少',/樣本過少/.test(txt('badgeSampleInfo')),true);
 chk('橫幅說明抽樣誤差',/只有 \d+ 筆樣本/.test(txt('teamTierText')),true);
 console.log('    ',txt('badgeSampleInfo'));
 console.log('    ',txt('teamTierText').slice(0,70));

 console.log('\n=== 真正超出資料範圍 ===');
 set(lv,'1120','change'); chk('1120 可設定',lv.value,'1120');
 set(lv,'2000','change'); chk('2000 夾到 1120',lv.value,'1120');
 set(lv,'100','change');  chk('100 夾到 301',lv.value,'301');

 console.log('\n=== 低段仍正常 ===');
 set(lv,'755','change'); pick('Fire'); set(dmg,'35B','input');
 chk('Lv755 百分位',/\d+\.\d%/.test(txt('valPercentile')),true);
 chk('沒有誤標樣本過少',/樣本過少/.test(txt('badgeSampleInfo')),false);

 console.log('\n=== 執行期錯誤 ===\n'+(errs.length?errs.join('\n'):' ✅ 無'));
 if(errs.length)bad++;else ok++;
 console.log(`\n════════  通過 ${ok} ／ 失敗 ${bad}  ════════`);
},2500);
