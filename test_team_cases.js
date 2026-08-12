if (typeof window === "undefined") global.window = {};
// 隊伍維度測試（v3 戰力段制 · 多期）
//
// 自足：只依賴同資料夾的 data_multi.js，不讀外部路徑。
// 期望值不是寫死的數字，而是「從 RAW_HITS 逐刀重算應該等於 TEAM_BENCHMARK」——
// 這樣換期、換資料都不用改測試，但仍能抓出查表邏輯與資料不一致。
require('./data_multi.js');

const MIN_N = 30;
const BAND = 20;
const band_of = lv => Math.floor((lv - 1) / BAND) * BAND + 1;
const quantile = (sp, f) => sp[Math.floor(f * sp.length)];

let ok = 0, bad = 0;
const chk = (n, g, x) => {
  const p = JSON.stringify(g) === JSON.stringify(x); p ? ok++ : bad++;
  console.log(` ${p ? '✅' : '❌'} ${n}` + (p ? '' : `\n       got=${JSON.stringify(g)}\n       exp=${JSON.stringify(x)}`));
};

const periods = window.UR_PERIODS;
console.log(`資料包期數：${periods.join('、')}\n`);

for (const ur of periods) {
  const D = window.UR_DATA[ur];
  const TB = D.TEAM_BENCHMARK, TI = D.TEAM_INDEX, RAW = D.RAW_HITS;
  const elemId = D.elem_ids;
  console.log(`━━━━━━━━ ${ur} ━━━━━━━━`);

  // 1. 隊伍索引與基準表互相對得上
  let missing = 0, teamCount = 0;
  for (const elem of Object.keys(TI.elements)) {
    for (const t of TI.elements[elem].teams) {
      teamCount++;
      const anyRow = Object.keys(TB).some(k => k.startsWith(`${elem}_${t.team_key}_`));
      if (!anyRow) missing++;
    }
  }
  chk(`合格隊伍全部在基準表裡（共 ${teamCount} 隊）`, missing, 0);

  // 2. 逐刀重算 vs 基準表（只驗 tier 1，其餘牽涉併段）
  let checked = 0, diff = 0;
  for (const key of Object.keys(TB)) {
    const r = TB[key];
    if (r.tier !== 1) continue;
    const eid = elemId[r.elem];
    const pool = RAW
      .filter(h => h[0] === eid && band_of(h[2]) === r.band_start
                && h[4] === window.UR_TEAM_ID[r.team_key])
      .map(h => h[3]).sort((a, b) => a - b);
    checked++;
    if (pool.length !== r.n || quantile(pool, 0.5) !== r.p50) diff++;
  }
  chk(`tier1 列逐刀重算一致（抽驗 ${checked} 列）`, diff, 0);

  // 3. tier 語意：1 = 未併段，2/3 = 有併段，且樣本都達門檻
  let tierBad = 0;
  for (const key of Object.keys(TB)) {
    const r = TB[key];
    if (r.tier === 1 && (r.spread !== 0 || r.n < MIN_N)) tierBad++;
    if (r.tier === 2 && (r.spread !== 1 || r.n < MIN_N)) tierBad++;
    if (r.tier === 3 && (r.spread !== 2 || r.n < MIN_N)) tierBad++;
    if (r.tier === 4 && r.n >= MIN_N) tierBad++;
  }
  chk('tier 與 spread / n 的語意一致', tierBad, 0);

  // 4. 中位曲線單調，且 tier4 不參與（避免稀疏雜訊往上污染）
  const byTeam = {};
  for (const key of Object.keys(TB)) {
    const r = TB[key];
    (byTeam[`${r.elem}_${r.team_key}`] ||= []).push(r);
  }
  let nonMono = 0, t4curve = 0;
  for (const k of Object.keys(byTeam)) {
    const rows = byTeam[k].sort((a, b) => a.band_start - b.band_start);
    const mcs = rows.filter(r => r.mc != null).map(r => r.mc);
    for (let i = 1; i < mcs.length; i++) if (mcs[i] < mcs[i - 1]) nonMono++;
    t4curve += rows.filter(r => r.tier === 4 && r.mc != null).length;
  }
  chk('中位曲線單調遞增', nonMono, 0);
  chk('tier4 不進入中位曲線', t4curve, 0);

  // 5. core4 / flex：自由位必須恰好是隊伍扣掉核心四人
  let c4bad = 0, c4n = 0;
  for (const key of Object.keys(TB)) {
    const r = TB[key];
    if (!r.core4_key) continue;
    c4n++;
    const core = r.core4_key.split('|');
    const rest = r.team_key.split('|').filter(u => !core.includes(u));
    if (rest.length !== 1 || rest[0] !== r.flex_unit) c4bad++;
  }
  chk(`core4 + flex 拼回原隊伍（${c4n} 列）`, c4bad, 0);

  // 6. 卡片排序是等級相關的，不能寫死。
  //    只要「存在某兩個段，順序不同」就足以證明 —— 不能只抽兩個段來比，
  //    因為相鄰段的順序常常剛好一樣，會誤判成可以寫死。
  const bands = [...new Set(Object.values(TB).map(r => r.band_start))].sort((a, b) => a - b);
  const orderAt = (e, b) => TI.elements[e].teams
    .map(t => { const r = TB[`${e}_${t.team_key}_${b}`]; return r && r.mc ? [r.mc, t.team_key] : null; })
    .filter(Boolean).sort((x, y) => y[0] - x[0]).map(x => x[1]);

  let anyDiff = false, witness = '';
  for (const e of Object.keys(TI.elements)) {
    if (TI.elements[e].teams.length < 3) continue;
    const seen = new Map();
    for (const b of bands) {
      const o = orderAt(e, b);
      if (o.length < 3) continue;
      const sig = JSON.stringify(o);
      for (const [b2, s2] of seen) {
        if (s2 !== sig) { anyDiff = true; witness = `${e}：${b2} 段與 ${b} 段順序不同`; break; }
      }
      if (anyDiff) break;
      seen.set(b, sig);
    }
    if (anyDiff) break;
  }
  chk(`卡片排序隨戰力段變動${witness ? '（' + witness + '）' : ''}`, anyDiff, true);

  // 7. 查無隊伍時不可回傳假資料
  chk('不存在的隊伍鍵查不到', TB['Fire_不存在的隊伍_741'] === undefined, true);
  console.log('');
}

console.log(`════════  通過 ${ok} ／ 失敗 ${bad}  ════════`);
process.exit(bad ? 1 : 0);
