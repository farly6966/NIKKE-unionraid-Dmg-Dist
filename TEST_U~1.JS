// UI 回歸測試（v3 戰力段制 + 多期）
//   期望值來源：ur43_jp_benchmark.csv，由 Python 獨立算出，不得由前端反推。
//   Fire / 不分刀序 / 40B → 等效段 801–820（該段中位 37.4B，下一段 40.6B）
//   Lv 722 落在 721–740 段，n=255，百分位 97.6
const { JSDOM } = require('jsdom');
const fs = require('fs');

const errs = [];
function mkCtx() {
  const g = { addColorStop() {} };
  return new Proxy({}, {
    get: (t, p) => {
      if (p === 'canvas') return { width: 400, height: 340 };
      if (['createLinearGradient', 'createRadialGradient', 'createPattern'].includes(p)) return () => g;
      if (p === 'measureText') return () => ({ width: 10 });
      if (typeof p === 'string') return t[p] !== undefined ? t[p] : () => {};
      return undefined;
    },
    set: (t, p, v) => { t[p] = v; return true; }
  });
}

const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  runScripts: 'dangerously', resources: 'usable',
  url: 'file:///tmp/index.html', pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => mkCtx();
    w.onerror = (m, s, l, c) => errs.push(`onerror: ${m} @${l}:${c}`);
    w.console.error = (...a) => errs.push('console.error: ' + a.join(' '));
  }
});

const W = dom.window, D = W.document;
let ok = 0, bad = 0;
const chk = (n, g, x) => {
  const p = String(g) === String(x); p ? ok++ : bad++;
  console.log(` ${p ? '✅' : '❌'} ${n.padEnd(42)} ${p ? g : `got=${g} exp=${x}`}`);
};
const txt = id => { const e = D.getElementById(id); return e ? e.textContent.trim().replace(/\s+/g, ' ') : '(無)'; };
const set = (el, v, ev) => { el.value = v; el.dispatchEvent(new W.Event(ev, { bubbles: true })); };

setTimeout(() => {
  console.log('=== 載入錯誤 ===\n' + (errs.length ? errs.join('\n') : ' ✅ 無'));

  D.querySelector('.tab-btn[data-tab="single"]').dispatchEvent(new W.Event('click', { bubbles: true }));
  const lv = D.getElementById('globalLevelInput');
  const dmg = D.getElementById('singleDamageInput');
  const pick = e => D.querySelector(`.elem-btn[data-elem="${e}"]`).dispatchEvent(new W.Event('click', { bubbles: true }));

  // 使用者最早回報的 bug：單位解析失敗時五個屬性同時歸零，看起來像整個工具壞掉
  console.log('\n=== 單位解析回歸（Lv 722 / Fire，全部應得同一答案）===');
  for (const inp of ['40b', '40', '400億', '40,000,000,000', '4e10', '40G', '0.04兆']) {
    set(lv, '722', 'change'); pick('Fire'); set(dmg, inp, 'input');
    chk(`輸入 "${inp}" → 等效段`, txt('valEqLevel'), '801–820 段');
  }
  set(lv, '722', 'change'); pick('Fire'); set(dmg, '３６Ｂ', 'input');
  chk('全形 "３６Ｂ" 可解析', /\d+–\d+ 段/.test(txt('valEqLevel')), true);

  console.log('\n=== 百分位 ===');
  set(dmg, '40B', 'input');
  chk('Lv722 Fire 40B 百分位', txt('valPercentile'), '97.6%');

  console.log('\n=== 錯誤輸入必須出聲 ===');
  for (const inp of ['40M', '40萬', 'abc']) {
    set(dmg, inp, 'input');
    const n = D.getElementById('singleDmgNote');
    const shown = n && n.style.display !== 'none' && n.textContent.trim();
    console.log(` ${shown ? '✅' : '❌'} "${inp}" → ${shown ? n.textContent.trim().slice(0, 46) : '(無提示)'}`);
    shown ? ok++ : bad++;
  }

  console.log('\n=== 等級範圍：夾在「有資料」而非「樣本充足」 ===');
  set(lv, '2000', 'change'); chk('2000 夾到 DATA_HI', lv.value, '1120');
  set(lv, '100', 'change'); chk('100 夾到 DATA_LO', lv.value, '301');
  set(lv, '1050', 'change'); chk('1050 可查詢（不再拒答）', lv.value, '1050');

  console.log('\n=== 高等級：有資料就給數字，樣本少就標示 ===');
  pick('Iron'); set(dmg, '90B', 'input');
  chk('Iron 1041–1060 樣本充足', /樣本數 n = 55/.test(txt('badgeSampleInfo')), true);
  chk('  且未誤標樣本過少', /樣本過少/.test(txt('badgeSampleInfo')), false);
  pick('Wind'); set(dmg, '60B', 'input');
  chk('Wind 同段樣本少 → 仍給百分位', /\d+\.\d%/.test(txt('valPercentile')), true);
  chk('  並標示樣本過少', /樣本過少/.test(txt('badgeSampleInfo')), true);

  console.log('\n=== 隊伍功能 ===');
  set(lv, '755', 'change'); pick('Fire');
  chk('Fire 隊伍卡片數', D.querySelectorAll('#teamCardsList > *').length, 6);
  D.getElementById('btnScopeTeam').dispatchEvent(new W.Event('click', { bubbles: true }));
  chk('切到同隊比無錯誤', errs.length, 0);

  console.log('\n=== 執行期錯誤 ===\n' + (errs.length ? errs.join('\n') : ' ✅ 無'));
  if (errs.length) bad++; else ok++;
  console.log(`\n════════  通過 ${ok} ／ 失敗 ${bad}  ════════`);
}, 2500);
