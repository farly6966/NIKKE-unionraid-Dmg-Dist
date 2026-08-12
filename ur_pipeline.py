#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NIKKE Union Raid 傷害分析 — 通用資料管線

用法:
    python3 ur_pipeline.py <users.html> --region JP --ur UR44 [--out ./out]

設計原則：**不寫死任何一期專屬的資訊**。以下全部從 HTML 自動推導：
  - 關卡 → 屬性的對應（每期王不同）
  - ∞ 關卡是哪一關，以及它該併進哪個屬性
  - 等級涵蓋範圍（玩家等級逐期上升）
  - 傷害的合理區間（用於輸入防呆）

固定不變的只有遊戲機制本身：
  - 戰力段 = 每 20 級一段，格線在 x00 → x01（band_start = floor((lv-1)/20)*20+1）
  - 擊殺刀（HTML class 含 ur-dmk）傷害被血量截斷，必須排除
  - 同一角色不能跨刀重複使用，所以刀序是干擾項，需保留為維度
"""
import argparse, csv, html as htmllib, json, math, os, re, statistics as st, sys
from collections import Counter, defaultdict
from itertools import combinations

MIN_N = 30
BAND_SIZE = 20


def band_of(lv):
    """戰力段起始級。遊戲機制：x00 → x01 有戰力大提升。"""
    return ((lv - 1) // BAND_SIZE) * BAND_SIZE + 1


# ────────────────────────────── 解析 ──────────────────────────────

def parse_html(path):
    raw = open(path, encoding='utf-8').read()

    guilds = {}
    for m in re.finditer(
            r'<details class=ur-gd id=guild-(\d+)><summary class=ur-gs>'
            r'<div class=ur-rk>(\d+)</div><div>(.*?)<a class=ur-pl', raw, re.S):
        guilds[m.group(1)] = (int(m.group(2)), htmllib.unescape(m.group(3)).strip())

    users = {}
    for m in re.finditer(
            r'<details class=ur-sp id=guild-(\d+)-user-(\d+)><summary class=ur-spt>'
            r'<span class=ur-spl>(.*?)<a class=ur-pl', raw, re.S):
        users[(m.group(1), m.group(2))] = htmllib.unescape(m.group(3)).strip()

    # 原站的每位玩家摘要，用來做完整性核對
    summary = {}
    for m in re.finditer(
            r'<details class=ur-sp id=guild-(\d+)-user-(\d+)><summary class=ur-spt>(.*?)</summary>',
            raw, re.S):
        s = re.search(r'<span class=ur-sps>(\d+) hits &mdash; ([\d,]+)'
                      r'(?: &mdash; (\d+) kills?)?</span>', m.group(3))
        if s:
            summary[(m.group(1), m.group(2))] = (
                int(s.group(1)), int(s.group(2).replace(',', '')), int(s.group(3) or 0))

    rows = []
    for m in re.finditer(r'<tr id=guild-(\d+)-user-(\d+)-hit-(\d+)>(.*?)</tr>', raw, re.S):
        g, u, hi, t = m.group(1), m.group(2), int(m.group(3)), m.group(4)
        date, time = re.search(r'<span>(\d\d-\d\d)</span><span>(\d\d:\d\d)</span>', t).groups()
        step = re.search(r'<td>(Step \d+[^<]*)<span class=ur-bs>', t).group(1).strip()
        weak = re.search(r'\(Weakness: (\w+)\)', t).group(1)
        boss_lv = int(re.search(r'</span></td><td>(\d+)</td><td class=ur-tm>', t).group(1))
        units = re.findall(
            r'<span class=ur-tmu>.*?<span class=ur-p>LB(\d+)</span>\|'
            r'<span class=ur-p>Lv ([\d,]+)</span>\|<span class=ur-p>CP ([\d,]+)</span></span>'
            r'\s*<span class=ur-un>(.*?)</span>', t, re.S)
        dm = re.search(r'<td class="?ur-dm( ur-dmk)?"?>([\d,]+)', t)
        lvs = [int(x[1].replace(',', '')) for x in units]
        rows.append(dict(
            union_id=g, union_rank=guilds[g][0], union_name=guilds[g][1],
            user_id=u, user_name=users[(g, u)], hit_index=hi,
            date=date, time_utc=time, step=step,
            step_num=int(re.match(r'Step (\d+)', step).group(1)),
            weakness=weak, boss_lv=boss_lv,
            sync_lv=max(lvs) if lvs else None,
            team_size=len(units), team_cp=sum(int(x[2].replace(',', '')) for x in units),
            damage=int(dm.group(2).replace(',', '')), is_kill=1 if dm.group(1) else 0,
            team='|'.join(htmllib.unescape(x[3]).strip() for x in units),
            team_lb='|'.join(x[0] for x in units)))
    return rows, summary


def derive_schema(rows):
    """從資料推導這一期的關卡結構。回傳 (step→elem 對應, ∞ 關卡編號, 說明字串)。"""
    step_weak = {}
    for r in rows:
        step_weak.setdefault(r['step_num'], (r['step'], r['weakness']))

    inf_steps = [n for n, (name, _) in step_weak.items() if '∞' in name or 'inf' in name.lower()]
    step_elem = {n: w for n, (_, w) in step_weak.items()}

    notes = []
    for n in sorted(step_weak):
        name, w = step_weak[n]
        tag = '  ← ∞ 關卡，併入同屬性' if n in inf_steps else ''
        notes.append(f'    Step {n} ({name}) → {w}{tag}')
    return step_elem, inf_steps, '\n'.join(notes)


# ────────────────────────────── 統計 ──────────────────────────────

def quantile(sp, f):
    return sp[int(f * len(sp))]


def resolve(rows, band):
    """回傳 (pool, spread, tier)。tier 1/2/3 = 本段 / 併±1 / 併±2；4 = 仍不足。"""
    last = []
    for spread in (0, 1, 2):
        lo, hi = band - BAND_SIZE * spread, band + BAND_SIZE * spread
        p = sorted(r['damage'] for r in rows if lo <= r['band'] <= hi)
        if len(p) >= MIN_N:
            return p, spread, spread + 1
        last = p
    return last, 2, 4


def curve_median(rec):
    """只有 tier<=3（樣本達標）的段才進入中位曲線。

    tier 4 的段可能只有個位數樣本，其中位數是雜訊；若讓它參與單調化，
    一個偏高的雜訊值會透過 cummax 往上污染所有更高的段，
    使等效段查詢整體偏移。
    """
    return st.median(rec['pool']) if rec['pool'] and rec['tier'] <= 3 else None


def monotonic(seq):
    out, prev = [], None
    for v in seq:
        if v is None:
            out.append(None)
            continue
        if prev is not None:
            v = max(v, prev)
        out.append(v)
        prev = v
    return out


def verify_band_effect(live):
    """在新資料上重新確認「每 20 級一段」仍成立。回傳診斷字串。"""
    resid = defaultdict(list)
    for e in sorted({r['elem'] for r in live}):
        d = [(r['sync_lv'], math.log(r['damage'])) for r in live if r['elem'] == e]
        if len(d) < 100:
            continue
        n = len(d)
        mx = sum(x for x, _ in d) / n
        my = sum(y for _, y in d) / n
        den = sum((x - mx) ** 2 for x, _ in d)
        if den == 0:
            continue
        b = sum((x - mx) * (y - my) for x, y in d) / den
        a = my - b * mx
        for lv, y in d:
            resid[lv].append(y - (a + b * lv))

    def gap(offset, W=3):
        gs = []
        for b0 in range(min(resid, default=0), max(resid, default=0) + 1):
            if (b0 - 1) % BAND_SIZE != (offset - 1) % BAND_SIZE:
                continue
            before = [x for l in range(b0 - W, b0) for x in resid.get(l, [])]
            after = [x for l in range(b0, b0 + W) for x in resid.get(l, [])]
            if len(before) >= 40 and len(after) >= 40:
                gs.append(st.median(after) - st.median(before))
        return gs

    real = gap(1)
    placebo = [g for off in (6, 11, 16) for g in gap(off)]
    if not real:
        return '  ⚠ 樣本不足以驗證段界效應，沿用機制假設'
    rm = st.mean(real)
    pm = st.mean(placebo) if placebo else 0.0
    verdict = '成立' if rm > 0 and rm > abs(pm) * 3 else '⚠ 不明顯，請人工檢查'
    return (f'  真實段界（x00→x01）平均跳幅 {(math.exp(rm)-1)*100:+.1f}%（{len(real)} 處）\n'
            f'  對照組（格線平移）平均 {(math.exp(pm)-1)*100:+.1f}%（{len(placebo)} 處）\n'
            f'  → 段界效應{verdict}')


# ────────────────────────────── 主流程 ──────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('html')
    ap.add_argument('--region', required=True)
    ap.add_argument('--ur', required=True)
    ap.add_argument('--out', default='.')
    ap.add_argument('--band-range', default=None,
                    help='手動指定 UI 等級範圍，例如 661-1000；省略則自動判定')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    O = lambda f: os.path.join(args.out, f)
    tag = f'{args.ur.lower()}_{args.region.lower()}'

    print(f'▸ 解析 {args.html}')
    rows, summary = parse_html(args.html)
    print(f'  逐刀紀錄 {len(rows)} 筆，玩家 {len(summary)} 人')

    # ---- 完整性核對（對照原站摘要）----
    agg = defaultdict(lambda: [0, 0, 0])
    for r in rows:
        a = agg[(r['union_id'], r['user_id'])]
        a[0] += 1
        a[1] += r['damage']
        a[2] += r['is_kill']
    mismatch = [k for k in summary if tuple(agg[k]) != summary[k]]
    print(f'  對照原站摘要：{len(summary)-len(mismatch)}/{len(summary)} 吻合'
          + ('' if not mismatch else f'  ❌ {len(mismatch)} 人不符'))
    if mismatch:
        sys.exit('解析與原站資料不一致，中止。')

    # ---- 推導這一期的關卡結構 ----
    step_elem, inf_steps, schema_note = derive_schema(rows)
    print('▸ 自動推導關卡結構')
    print(schema_note)
    for r in rows:
        r['elem'] = step_elem[r['step_num']]
        r['is_infinite'] = 1 if r['step_num'] in inf_steps else 0
        r['band'] = band_of(r['sync_lv']) if r['sync_lv'] else None

    # ---- 有效樣本 ----
    live = [r for r in rows if not r['is_kill'] and r['team_size'] == 5 and r['sync_lv']]
    print(f'  排除擊殺刀 {sum(r["is_kill"] for r in rows)} 筆'
          f'（{sum(r["is_kill"] for r in rows)/len(rows)*100:.1f}%）'
          f'、殘缺 {len(rows)-len(live)-sum(r["is_kill"] for r in rows)} 筆 → 有效 {len(live)}')

    elems = sorted({r['elem'] for r in live})
    print(f'  屬性池：' + '｜'.join(f'{e} {sum(1 for r in live if r["elem"]==e)}' for e in elems))

    # ---- 等級範圍：分成「分析範圍」與「UI 範圍」兩種 ----
    #
    # 分析範圍 = 只要該段有任何資料就收進基準表，品質交給 tier 欄位表達。
    # UI 範圍   = 至少半數屬性在該段都有 MIN_N 筆，適合當等級滑桿的上下限。
    #             太寬會讓使用者選到一個只會回傳「樣本不足」的等級，體驗差。
    per = defaultdict(Counter)
    for r in live:
        per[r['band']][r['elem']] += 1
    all_bands = sorted(per)
    BANDS = list(range(all_bands[0], all_bands[-1] + 1, BAND_SIZE))

    need = max(1, len(elems) // 2)
    ui = sorted(b for b in all_bands if sum(1 for e in elems if per[b][e] >= MIN_N) >= need)
    if args.band_range:
        lo, hi = (int(x) for x in args.band_range.split('-'))
        ui = [b for b in BANDS if lo <= b <= hi]
        print(f'▸ 等級範圍：使用 --band-range 指定值')
    UI_LO, UI_HI = ui[0], ui[-1] + BAND_SIZE - 1
    print(f'▸ 等級範圍  分析 Lv {BANDS[0]}~{BANDS[-1]+BAND_SIZE-1}（{len(BANDS)} 段）'
          f'｜UI Lv {UI_LO}~{UI_HI}（{len(ui)} 段，至少 {need} 個屬性樣本足夠）')

    print('▸ 重新驗證戰力段機制')
    print(verify_band_effect(live))

    # ---- 逐刀 CSV ----
    cols = ['region', 'ur', 'union_id', 'union_rank', 'union_name', 'user_id', 'user_name',
            'hit_index', 'date', 'time_utc', 'step', 'step_num', 'elem', 'is_infinite',
            'weakness', 'boss_lv', 'sync_lv', 'band', 'team_size', 'team_cp', 'damage',
            'is_kill', 'team', 'team_lb']
    for r in rows:
        r['region'], r['ur'] = args.region, args.ur
    with open(O(f'{tag}_hits.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)

    # ---- 全體基準（含刀序維度）----
    out = []
    for e in elems:
        for hl, hf in [('all', None), ('1', 0), ('2', 1), ('3', 2)]:
            sub = [r for r in live if r['elem'] == e and (hf is None or r['hit_index'] == hf)]
            recs = [dict(band=b, **dict(zip(('pool', 'spread', 'tier'), resolve(sub, b))))
                    for b in BANDS]
            meds = monotonic([curve_median(r) for r in recs])
            for r, mc in zip(recs, meds):
                p = r['pool']
                out.append(dict(elem=e, hit_index=hl, band_start=r['band'],
                                band_end=r['band'] + BAND_SIZE - 1,
                                merged_from=r['band'] - BAND_SIZE * r['spread'],
                                merged_to=r['band'] + BAND_SIZE * (r['spread'] + 1) - 1,
                                spread=r['spread'], tier=r['tier'], n=len(p),
                                p10=quantile(p, .10) if p else '', p25=quantile(p, .25) if p else '',
                                p50=quantile(p, .50) if p else '', p75=quantile(p, .75) if p else '',
                                p90=quantile(p, .90) if p else '', median_curve=mc if mc else ''))
    with open(O(f'{tag}_benchmark.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    print(f'▸ 全體基準 {len(out)} 列  tier 分布 {dict(sorted(Counter(r["tier"] for r in out).items()))}')

    # ---- 隊伍基準 ----
    for r in live:
        r['tkey'] = '|'.join(sorted(u.strip() for u in r['team'].split('|')))
    BY = defaultdict(list)
    for r in live:
        BY[r['elem']].append(r)

    qualified, core4 = {}, {}
    for e in elems:
        tc = Counter(r['tkey'] for r in BY[e])
        qualified[e] = [t for t, v in tc.most_common() if v >= MIN_N]
        c4 = Counter()
        for r in BY[e]:
            for c in combinations(r['tkey'].split('|'), 4):
                c4[c] += 1
        core4[e] = [(c, v) for c, v in c4.most_common() if v >= MIN_N]

    def assign_core4(e, units):
        for comb, _ in core4[e]:
            if set(comb).issubset(units):
                flex = [u for u in units if u not in comb]
                if len(flex) == 1:
                    return '|'.join(comb), flex[0]
        return '', ''

    trows = []
    for e in elems:
        for tk in qualified[e]:
            sub = [r for r in BY[e] if r['tkey'] == tk]
            c4k, flex = assign_core4(e, set(tk.split('|')))
            recs = [dict(band=b, **dict(zip(('pool', 'spread', 'tier'), resolve(sub, b))))
                    for b in BANDS]
            meds = monotonic([curve_median(r) for r in recs])
            for r, mc in zip(recs, meds):
                p = r['pool']
                trows.append(dict(elem=e, team_key=tk, core4_key=c4k, flex_unit=flex,
                                  band_start=r['band'], band_end=r['band'] + BAND_SIZE - 1,
                                  merged_from=r['band'] - BAND_SIZE * r['spread'],
                                  merged_to=r['band'] + BAND_SIZE * (r['spread'] + 1) - 1,
                                  spread=r['spread'], tier=r['tier'], n=len(p),
                                  p10=quantile(p, .10) if p else '', p25=quantile(p, .25) if p else '',
                                  p50=quantile(p, .50) if p else '', p75=quantile(p, .75) if p else '',
                                  p90=quantile(p, .90) if p else '', median_curve=mc if mc else ''))
    with open(O(f'{tag}_team_benchmark.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=list(trows[0].keys()))
        w.writeheader()
        w.writerows(trows)
    print(f'▸ 隊伍基準 {len(trows)} 列  合格隊伍 '
          + '｜'.join(f'{e} {len(qualified[e])}' for e in elems))

    # ---- 索引 ----
    idx = {'meta': {'region': args.region, 'ur': args.ur, 'min_n': MIN_N,
                    'band_rule': 'band_start = floor((lv-1)/20)*20+1',
                    'analysis_range': [BANDS[0], BANDS[-1] + BAND_SIZE - 1],
                    'ui_range': [UI_LO, UI_HI],
                    'step_elem': {str(k): v for k, v in step_elem.items()},
                    'infinite_steps': inf_steps,
                    'note': '卡片排序須依使用者所在段查 team_benchmark 的 median_curve，不可寫死'},
           'bands': [{'start': b, 'end': b + BAND_SIZE - 1} for b in BANDS],
           'elements': {}}
    for e in elems:
        tc = Counter(r['tkey'] for r in BY[e])
        idx['elements'][e] = {
            'total_hits': len(BY[e]), 'distinct_teams': len(tc),
            'qualified_teams': len(qualified[e]),
            'coverage_pct': round(sum(tc[t] for t in qualified[e]) / len(BY[e]) * 100, 1),
            'roster': [u for u, _ in Counter(
                u for r in BY[e] for u in r['tkey'].split('|')).most_common(16)],
            'teams': [{'team_key': t, 'units': t.split('|'), 'total_n': tc[t],
                       'core4_key': assign_core4(e, set(t.split('|')))[0],
                       'flex_unit': assign_core4(e, set(t.split('|')))[1]}
                      for t in qualified[e]]}
    json.dump(idx, open(O(f'{tag}_team_index.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    # ---- 前端常數 ----
    dmgs = sorted(r['damage'] for r in live)
    consts = {'BAND_LO': UI_LO, 'BAND_HI': UI_HI,
              # 有任何資料的完整範圍。前端的等級選擇器用這個，
              # 品質高低交給 tier 表達，而不是整段拒答。
              'DATA_LO': BANDS[0], 'DATA_HI': BANDS[-1] + BAND_SIZE - 1,
              'PLAUSIBLE_MIN': 10 ** math.floor(math.log10(dmgs[int(.01 * len(dmgs))])),
              'PLAUSIBLE_MAX': 10 ** math.ceil(math.log10(dmgs[-1])),
              'OBSERVED_MAX_B': round(dmgs[-1] / 1e9, 1),
              'ELEMS': elems}
    json.dump(consts, open(O(f'{tag}_frontend_consts.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f'▸ 前端常數 BAND {consts["BAND_LO"]}~{consts["BAND_HI"]}  '
          f'傷害合理區間 {consts["PLAUSIBLE_MIN"]:.0e}~{consts["PLAUSIBLE_MAX"]:.0e}')

    # ---- 自檢 ----
    print('▸ 自檢')
    bad = 0
    mono = defaultdict(list)
    for r in out:
        if r['median_curve'] != '':
            mono[(r['elem'], r['hit_index'])].append(r['median_curve'])
    nm = sum(1 for v in mono.values() if any(v[i] < v[i - 1] for i in range(1, len(v))))
    print(f'  中位曲線單調性：{"通過" if nm==0 else f"❌ {nm} 條不單調"}')
    bad += nm
    for e in elems:
        for b in BANDS:
            r = [x for x in out if x['elem'] == e and x['hit_index'] == 'all'
                 and x['band_start'] == b][0]
            if r['tier'] == 1:
                p = sorted(x['damage'] for x in live if x['elem'] == e and x['band'] == b)
                if len(p) != r['n'] or quantile(p, .5) != r['p50']:
                    bad += 1
    print(f'  tier1 逐刀重算：{"通過" if bad==nm else "❌ 有分歧"}')
    w = Counter(r['tier'] for r in out)
    cover = sum(1 for r in live if UI_LO <= r['sync_lv'] <= UI_HI) / len(live) * 100
    print(f'  UI 範圍涵蓋率：{cover:.1f}% 的刀落在 Lv {UI_LO}~{UI_HI} 內')
    print(f'\n{"✅ 全部完成" if bad==0 else "⚠ 有問題，請檢查上方輸出"}  →  {os.path.abspath(args.out)}')


if __name__ == '__main__':
    main()
