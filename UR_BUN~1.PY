#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 ur_pipeline.py 產出的一或多期資料打包成前端用的 data.js。

用法:
    python3 ur_bundle.py --period UR43:./ur43 --period UR42:./ur42 --out data.js

產出的全域變數：
    window.UR_PERIODS   期數清單，新到舊，[0] 為預設
    window.UR_DATA      每期一組，形狀與前端現行的 BENCHMARK_V3 / TEAM_BENCHMARK_V3 /
                        TEAM_INDEX_V3 / RAW_HITS 完全相同，切期時直接指過去即可
    window.UR_TEAMS     共用隊伍字串陣列
    window.UR_TEAM_ID   隊伍字串 → 索引，供 O(1) 反查
                        RAW_HITS 與玩家逐刀的隊伍欄位都是這個索引
    window.UR_PLAYERS   玩家索引：user_id → 每期的等級、各刀、以及算好的百分位
                        逐刀欄位縮寫：e=屬性 h=第幾刀(0..2) d=傷害 t=隊伍索引 p=百分位
    window.UR_CROSS     跨期成長的「全體分布」，供前端定位個人落點。
                        個人數值由前端從 UR_PLAYERS 兩期的 avg_pct / lv 相減即可，
                        不重複存一份。

玩家索引的百分位在這裡就算好，前端只負責顯示 —— 沿用整個專案的原則：
會靜默算錯的東西不交給前端。
"""
import argparse, csv, json, os, statistics as st
from collections import defaultdict

BAND_SIZE = 20
MIN_N = 30


def band_of(lv):
    return ((lv - 1) // BAND_SIZE) * BAND_SIZE + 1


def read_csv(p):
    return list(csv.DictReader(open(p, encoding='utf-8-sig')))


def num(v):
    if v == '' or v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


def load_period(ur, region, d):
    tag = f'{ur.lower()}_{region.lower()}'
    hits = read_csv(os.path.join(d, f'{tag}_hits.csv'))
    bm = read_csv(os.path.join(d, f'{tag}_benchmark.csv'))
    tb = read_csv(os.path.join(d, f'{tag}_team_benchmark.csv'))
    idx = json.load(open(os.path.join(d, f'{tag}_team_index.json'), encoding='utf-8'))
    consts = json.load(open(os.path.join(d, f'{tag}_frontend_consts.json'), encoding='utf-8'))

    def row(r):
        return dict(elem=r['elem'],
                    band_start=int(r['band_start']), band_end=int(r['band_end']),
                    merged_from=int(r['merged_from']), merged_to=int(r['merged_to']),
                    spread=int(r['spread']), tier=int(r['tier']), n=int(r['n']),
                    p10=num(r['p10']), p25=num(r['p25']), p50=num(r['p50']),
                    p75=num(r['p75']), p90=num(r['p90']), mc=num(r['median_curve']))

    # 扁平字典，鍵為 elem_hitindex_bandstart / elem_teamkey_bandstart
    # 只丟掉「完全沒有樣本」的列。tier 4（樣本少）仍然送出去，
    # 讓高等級玩家至少看得到數字，品質由 tier 標示，不是整段拒答。
    BM = {f"{r['elem']}_{r['hit_index']}_{r['band_start']}":
          {**row(r), 'hit_index': r['hit_index']} for r in bm if int(r['n']) > 0}
    TB = {f"{r['elem']}_{r['team_key']}_{r['band_start']}":
          {**row(r), 'team_key': r['team_key'], 'core4_key': r['core4_key'],
           'flex_unit': r['flex_unit']} for r in tb if int(r['n']) > 0}

    live = [r for r in hits if r['is_kill'] == '0' and r['team_size'] == '5' and r['sync_lv']]
    elem_ids = {e: i for i, e in enumerate(consts['ELEMS'])}
    return dict(ur=ur, region=region, hits=hits, live=live, elem_ids=elem_ids,
                benchmark=BM, team_benchmark=TB, team_index=idx, consts=consts)


def player_index(P, team_pool):
    """每位玩家在該期的等級、逐刀、以及該刀在 (屬性,戰力段) 內的百分位。

    team_pool: 共用的隊伍字串字典 {字串: 索引}，避免同一組隊伍重複存上千次。
    """
    pool = defaultdict(list)
    for r in P['live']:
        pool[(r['elem'], band_of(int(r['sync_lv'])))].append(int(r['damage']))
    for k in pool:
        pool[k].sort()

    out = {}
    for r in P['live']:
        uid = r['user_id']
        lv = int(r['sync_lv'])
        b = band_of(lv)
        p = pool[(r['elem'], b)]
        pct = (sum(1 for x in p if x < int(r['damage'])) / len(p) * 100) if len(p) >= MIN_N else None
        e = out.setdefault(uid, dict(name=r['user_name'], union=r['union_name'],
                                     lv=lv, band=b, hits=[]))
        e['lv'] = max(e['lv'], lv)
        e['band'] = band_of(e['lv'])
        ti = team_pool.setdefault(r['team'], len(team_pool))
        e['hits'].append(dict(e=r['elem'], h=int(r['hit_index']), d=int(r['damage']),
                              t=ti, p=round(pct, 1) if pct is not None else None))
    for uid, e in out.items():
        v = [h['p'] for h in e['hits'] if h['p'] is not None]
        e['avg_pct'] = round(st.mean(v), 1) if v else None
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--period', action='append', required=True,
                    help='UR43:./ur43 或 UR43:JP:./ur43，可重複；先寫的視為較新')
    ap.add_argument('--region', default='JP')
    ap.add_argument('--out', default='data.js')
    args = ap.parse_args()

    periods = []
    for spec in args.period:
        parts = spec.split(':')
        if len(parts) == 2:
            ur, d = parts[0], parts[1]
            region = args.region
        else:
            ur, region, d = parts[0], parts[1], parts[2]
        periods.append(load_period(ur, region, d))

    order = [p['ur'] for p in periods]
    print('期數（新→舊）:', ' → '.join(order))

    UR_DATA, UR_PLAYERS = {}, {}
    team_pool = {}       # 隊伍字串 → 索引，全期共用
    for P in periods:
        pi = player_index(P, team_pool)
        # RAW_HITS 的隊伍也用索引，避免同一組隊伍重複存上萬次
        P['raw'] = [[P['elem_ids'][r['elem']], int(r['hit_index']), int(r['sync_lv']),
                     int(r['damage']),
                     team_pool.setdefault('|'.join(sorted(u.strip() for u in r['team'].split('|'))),
                                          len(team_pool))]
                    for r in P['live']]
        UR_PLAYERS[P['ur']] = pi
        UR_DATA[P['ur']] = dict(
            meta={**P['team_index']['meta'], 'ur': P['ur'], 'region': P['region'],
                  'band_rule': 'band_start = floor((lv-1)/20)*20+1'},
            consts=P['consts'],
            elem_ids=P['elem_ids'],
            BENCHMARK=P['benchmark'],
            TEAM_BENCHMARK=P['team_benchmark'],
            TEAM_INDEX={k: v for k, v in P['team_index'].items() if k != 'meta'},
            RAW_HITS=P['raw'])
        print(f"  {P['ur']}: 有效刀 {len(P['live'])}｜玩家 {len(pi)}｜"
              f"基準列 {len(P['benchmark'])}｜隊伍列 {len(P['team_benchmark'])}")

    # ---- 跨期成長 ----
    UR_CROSS = {}
    for i in range(len(order) - 1):
        cur, prev = order[i], order[i + 1]
        A, B = UR_PLAYERS[prev], UR_PLAYERS[cur]
        both = [u for u in B if u in A and A[u]['avg_pct'] is not None
                and B[u]['avg_pct'] is not None]
        rec = {}
        for u in both:
            rec[u] = dict(
                prev_lv=A[u]['lv'], cur_lv=B[u]['lv'],
                lv_gain=B[u]['lv'] - A[u]['lv'],
                band_gain=(B[u]['band'] - A[u]['band']) // BAND_SIZE,
                prev_pct=A[u]['avg_pct'], cur_pct=B[u]['avg_pct'],
                pct_delta=round(B[u]['avg_pct'] - A[u]['avg_pct'], 1))
        deltas = sorted(r['pct_delta'] for r in rec.values())
        gains = sorted(r['lv_gain'] for r in rec.values())
        UR_CROSS[f'{prev}->{cur}'] = dict(
            prev=prev, cur=cur, n=len(rec),
            dist=dict(
                pct_delta={q: deltas[int(f * len(deltas))] for q, f in
                           [('p05', .05), ('p25', .25), ('p50', .5), ('p75', .75), ('p95', .95)]},
                lv_gain={q: gains[int(f * len(gains))] for q, f in
                         [('p25', .25), ('p50', .5), ('p75', .75)]},
                improved_pct=round(sum(1 for d in deltas if d > 0) / len(deltas) * 100, 1)))
        print(f"  跨期 {prev}→{cur}: {len(rec)} 人可比對"
              f"（等級中位 +{UR_CROSS[f'{prev}->{cur}']['dist']['lv_gain']['p50']}，"
              f"百分位中位 {UR_CROSS[f'{prev}->{cur}']['dist']['pct_delta']['p50']:+}）")

    j = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    with open(args.out, 'w', encoding='utf-8') as f:
        f.write('// NIKKE Union Raid 分析器資料包 — 由 ur_bundle.py 產生，請勿手改\n')
        f.write(f'window.UR_PERIODS={j(order)};\n')
        f.write(f'window.UR_DATA={j(UR_DATA)};\n')
        f.write(f'window.UR_TEAMS={j(list(team_pool))};\n')
        f.write(f'window.UR_TEAM_ID={j(team_pool)};\n')
        f.write(f'window.UR_PLAYERS={j(UR_PLAYERS)};\n')
        f.write(f'window.UR_CROSS={j(UR_CROSS)};\n')
    print(f'\n✅ {args.out}  ({os.path.getsize(args.out)/1e6:.1f} MB)')


if __name__ == '__main__':
    main()
