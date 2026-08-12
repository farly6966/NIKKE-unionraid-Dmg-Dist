/**
 * NIKKE UNION RAID UR43 — 傷害分析與練度體檢儀 (前端規格 v3 戰力段架構)
 * 取代 v2 之滑動窗與插值式等效等級；嚴格依據 20 級固定戰力段 (x00→x01 跳躍) 與預算好的 v3 資料檔查表
 */

(function () {
  'use strict';

  // Constants
  const ELEMS = ['Electric', 'Fire', 'Water', 'Wind', 'Iron'];
  const ELEM_CONFIG = {
    'Electric': { nameZh: '電擊 (Electric)', color: '#b38800', id: 0 },
    'Fire':     { nameZh: '燃燒 (Fire)',     color: '#d32f2f', id: 1 },
    'Water':    { nameZh: '水冷 (Water)',    color: '#0071e3', id: 2 },
    'Wind':     { nameZh: '風壓 (Wind)',     color: '#2e7d32', id: 3 },
    'Iron':     { nameZh: '鐵甲 (Iron)',     color: '#455a64', id: 4 }
  };

  const BAND_LO = 661;
  const BAND_HI = 1000;
  const BANDS = [];
  for (let b = BAND_LO; b <= BAND_HI; b += 20) {
    BANDS.push(b);
  }

  // App State
  const state = {
    syncLv: 755,
    activeTab: 'multi',
    multiDamages: {
      'Electric': '',
      'Fire': '',
      'Water': '',
      'Wind': '',
      'Iron': ''
    },
    singleElem: 'Water',
    singleHitIndex: 'all',
    singleDamageInput: '36B',
    singleIsKill: false,
    
    // Team Dimension State
    singleScope: 'global', // 'global' (default) or 'team'
    selectedTeamKeys: {
      'Electric': null,
      'Fire': null,
      'Water': null,
      'Wind': null,
      'Iron': null
    },
    customUnits: {
      'Electric': [],
      'Fire': [],
      'Water': [],
      'Wind': [],
      'Iron': []
    },
    isCustomRosterOpen: false
  };

  // Helper: Calculate Band Start (D4': band_start = floor((lv - 1) / 20) * 20 + 1)
  function band_of(lv) {
    return Math.floor((lv - 1) / 20) * 20 + 1;
  }

  // Helper: Check if level is within covered range (661 ~ 1000)
  function isLevelInRange(lv) {
    return lv >= BAND_LO && lv <= BAND_HI;
  }

  // Helper: Normalize team key by sorting 5 unit names alphabetically and joining with '|'
  function normalizeTeamKey(units) {
    if (!units || !Array.isArray(units)) return '';
    return units.map(u => String(u).trim()).sort().join('|');
  }

  // Initialize Default Teams from TEAM_INDEX_V3
  function initDefaultTeams() {
    const idx = window.TEAM_INDEX_V3 || window.TEAM_INDEX;
    if (!idx || !idx.elements) return;
    ELEMS.forEach(elem => {
      const elemData = idx.elements[elem];
      if (elemData && elemData.teams && elemData.teams.length > 0) {
        if (!state.selectedTeamKeys[elem]) {
          state.selectedTeamKeys[elem] = elemData.teams[0].team_key;
        }
        if (!state.customUnits[elem] || state.customUnits[elem].length === 0) {
          state.customUnits[elem] = [...elemData.teams[0].units];
        }
      }
    });
  }

  // Helper: Robust damage parser (Supports: 40b, 40, 400億, 40,000,000,000, 4e10, 40G, 0.04兆, ３６Ｂ)
  function parseDamage(inputStr) {
    if (!inputStr) return null;
    let s = String(inputStr).trim();
    // Normalize full-width ASCII characters (e.g. ３６Ｂ -> 36B)
    s = s.replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).trim();
    s = s.replace(/,/g, '').toUpperCase();
    if (!s) return null;

    // 1. 兆 (Trillion)
    const matchZhao = s.match(/^([\d.]+)\s*(兆|TRILLION)$/i);
    if (matchZhao) {
      const num = parseFloat(matchZhao[1]);
      return isNaN(num) ? null : Math.round(num * 1000000000000);
    }

    // 2. 億 (Hundred Million)
    const matchYi = s.match(/^([\d.]+)\s*(億|YI|E)$/i);
    if (matchYi) {
      const num = parseFloat(matchYi[1]);
      return isNaN(num) ? null : Math.round(num * 100000000);
    }

    // 3. 萬 (Ten Thousand)
    const matchWan = s.match(/^([\d.]+)\s*(萬|W|WAN)$/i);
    if (matchWan) {
      const num = parseFloat(matchWan[1]);
      return isNaN(num) ? null : Math.round(num * 10000);
    }

    // 4. B / G (Billion / Giga)
    const matchB = s.match(/^([\d.]+)\s*(B|G|BILLION|GIGA)$/i);
    if (matchB) {
      const num = parseFloat(matchB[1]);
      return isNaN(num) ? null : Math.round(num * 1000000000);
    }

    // 5. M (Million)
    const matchM = s.match(/^([\d.]+)\s*M$/i);
    if (matchM) {
      const num = parseFloat(matchM[1]);
      return isNaN(num) ? null : Math.round(num * 1000000);
    }

    // 6. K (Thousand)
    const matchK = s.match(/^([\d.]+)\s*K$/i);
    if (matchK) {
      const num = parseFloat(matchK[1]);
      return isNaN(num) ? null : Math.round(num * 1000);
    }

    // 7. Exponential e.g. 4e10
    if (/^[\d.]+E\+?\d+$/i.test(s)) {
      const num = Number(s);
      return isNaN(num) ? null : Math.round(num);
    }

    // 8. Plain Number
    const pureNum = Number(s);
    if (!isNaN(pureNum) && pureNum > 0) {
      // If user inputs e.g. '40' or '36.5' without unit, treat as Billions
      if (pureNum <= 1000) {
        return Math.round(pureNum * 1000000000);
      }
      return Math.round(pureNum);
    }

    return null;
  }

  // Helper: Format damage to readable string
  function formatDmg(val, compact = true, htmlWrap = false) {
    if (val === null || val === undefined || isNaN(val) || val === '') return '-';
    const num = Number(val);
    if (compact) {
      if (num >= 1e9) {
        const numStr = (num / 1e9).toFixed(2).replace(/\.00$/, '');
        return htmlWrap ? `<span class="tnum">${numStr}</span><span class="num-unit">B</span>` : `${numStr} B`;
      }
      if (num >= 1e6) {
        const numStr = (num / 1e6).toFixed(1);
        return htmlWrap ? `<span class="tnum">${numStr}</span><span class="num-unit">M</span>` : `${numStr} M`;
      }
      if (num >= 1e4) {
        const numStr = (num / 1e4).toFixed(1);
        return htmlWrap ? `<span class="tnum">${numStr}</span><span class="num-unit">萬</span>` : `${numStr} 萬`;
      }
    }
    const loc = num.toLocaleString();
    return htmlWrap ? `<span class="tnum">${loc}</span>` : loc;
  }

  // Core Math Engine: Gather Sample Pool for Band
  function pool_for(elem, band, spread, hlabel = 'all', teamKey = null) {
    const elemId = ELEM_CONFIG[elem].id;
    const hf = (hlabel === 'all') ? null : (parseInt(hlabel) - 1);
    const lo = band - 20 * spread;
    const hi = band + 20 * spread;
    const hits = window.RAW_HITS || [];

    const matched = hits.filter(h => {
      if (h[0] !== elemId) return false;
      const b = band_of(h[2]);
      if (b < lo || b > hi) return false;
      if (hf !== null && h[1] !== hf) return false;
      if (teamKey !== null && h[4] !== teamKey) return false;
      return true;
    });

    return matched.map(h => h[3]).sort((a, b) => a - b);
  }

  // Nearest-Rank Quantile Calculation (D3: floor(q * len))
  function getQuantile(sortedPool, q) {
    if (!sortedPool || sortedPool.length === 0) return 0;
    const idx = Math.floor(q * sortedPool.length);
    const clampedIdx = Math.min(sortedPool.length - 1, Math.max(0, idx));
    return sortedPool[clampedIdx];
  }

  // Strict Percentile Calculation (D4: count(x < myDamage) / len * 100)
  function getPercentile(sortedPool, myDamage) {
    if (!sortedPool || sortedPool.length === 0 || !myDamage) return 0;
    let countLess = 0;
    for (let i = 0; i < sortedPool.length; i++) {
      if (sortedPool[i] < myDamage) countLess++;
      else break;
    }
    return (countLess / sortedPool.length) * 100;
  }

  // D7': Equivalent Band Lookup (highest band with median_curve <= damage, no interpolation)
  function equiv_band(elem, hlabel, damage) {
    if (!damage || damage <= 0) return '-';
    let best = null;

    for (const b of BANDS) {
      const key = `${elem}_${hlabel}_${b}`;
      const r = window.BENCHMARK_V3 ? window.BENCHMARK_V3[key] : null;
      if (!r || r.mc === null || r.mc === undefined || r.mc === '') continue;
      if (parseFloat(r.mc) <= damage) {
        best = b;
      }
    }

    if (best === null) return 'BELOW_RANGE';

    const lastBand = BANDS[BANDS.length - 1];
    const lastKey = `${elem}_${hlabel}_${lastBand}`;
    const lastR = window.BENCHMARK_V3 ? window.BENCHMARK_V3[lastKey] : null;
    if (best === lastBand && lastR && lastR.mc && damage > parseFloat(lastR.mc)) {
      return 'ABOVE_RANGE';
    }

    return best;
  }

  // Equivalent Band Lookup for Team Dimension
  function equiv_band_team(elem, teamKey, damage) {
    if (!damage || damage <= 0) return '-';
    let best = null;

    for (const b of BANDS) {
      const key = `${elem}_${teamKey}_${b}`;
      const r = window.TEAM_BENCHMARK_V3 ? window.TEAM_BENCHMARK_V3[key] : null;
      if (!r || r.mc === null || r.mc === undefined || r.mc === '') continue;
      if (parseFloat(r.mc) <= damage) {
        best = b;
      }
    }

    if (best === null) return 'BELOW_RANGE';

    const lastBand = BANDS[BANDS.length - 1];
    const lastKey = `${elem}_${teamKey}_${lastBand}`;
    const lastR = window.TEAM_BENCHMARK_V3 ? window.TEAM_BENCHMARK_V3[lastKey] : null;
    if (best === lastBand && lastR && lastR.mc && damage > parseFloat(lastR.mc)) {
      return 'ABOVE_RANGE';
    }

    return best;
  }

  // Format Equivalent Band string
  function formatEqBand(eqB) {
    if (eqB === 'BELOW_RANGE') return '< 661 級 (低於下限)';
    if (eqB === 'ABOVE_RANGE') return '> 1000 級 (頂尖超群)';
    if (typeof eqB === 'number') return `${eqB}–${eqB + 19} 段`;
    return eqB || '-';
  }

  // Format Band Delta string
  function formatBandDelta(eqB, userBand) {
    if (typeof eqB === 'number') {
      const delta = (eqB - userBand) / 20;
      if (delta > 0) return `領先 +${delta} 段`;
      if (delta < 0) return `落後 ${delta} 段`;
      return '同段 ±0 段';
    }
    if (eqB === 'BELOW_RANGE') return '低於常模下限';
    if (eqB === 'ABOVE_RANGE') return '遠超常模上限';
    return '-';
  }

  // Rank Tier Badge
  function getRankBadge(pct) {
    if (pct >= 90) return { label: 'S+ 頂尖極限', cls: 'rank-s-plus' };
    if (pct >= 75) return { label: 'S 卓越發揮', cls: 'rank-s' };
    if (pct >= 50) return { label: 'A 達標主力', cls: 'rank-a' };
    if (pct >= 25) return { label: 'B 仍需補強', cls: 'rank-b' };
    return { label: 'C 嚴重落後', cls: 'rank-c' };
  }

  // Toast Notification
  function showToast(msg) {
    let toast = document.getElementById('appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appToast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span>${msg}</span>`;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  // Render View 1: 5-Element Diagnostic Matrix
  function renderMultiDiagnostic() {
    const tableBody = document.getElementById('multiResultsBody');
    if (!tableBody) return;

    const userBand = band_of(state.syncLv);
    const inRange = isLevelInRange(state.syncLv);

    let totalDelta = 0;
    let validCount = 0;
    let maxDelta = -999;
    let minDelta = 999;
    let bestElem = null;
    let worstElem = null;

    const radarUserVals = [];
    const results = [];

    ELEMS.forEach(elem => {
      const inpVal = state.multiDamages[elem];
      const dmgRaw = parseDamage(inpVal);
      const key = `${elem}_all_${userBand}`;
      const row = window.BENCHMARK_V3 ? window.BENCHMARK_V3[key] : null;

      let p50 = row && row.p50 ? row.p50 : 0;
      let pool = [];
      if (row) {
        pool = pool_for(elem, userBand, row.spread, 'all');
      }

      if (dmgRaw && dmgRaw > 0 && inRange && row) {
        const pct = getPercentile(pool, dmgRaw);
        const eqB = equiv_band(elem, 'all', dmgRaw);
        const deltaStr = formatBandDelta(eqB, userBand);

        let deltaCls = 'delta-zero';
        if (typeof eqB === 'number') {
          const delta = (eqB - userBand) / 20;
          totalDelta += delta;
          validCount++;
          if (delta > 0) deltaCls = 'delta-positive';
          else if (delta < 0) deltaCls = 'delta-negative';

          if (delta > maxDelta) { maxDelta = delta; bestElem = elem; }
          if (delta < minDelta) { minDelta = delta; worstElem = elem; }
        } else if (eqB === 'ABOVE_RANGE') {
          deltaCls = 'delta-positive';
        } else {
          deltaCls = 'delta-negative';
        }

        const rank = getRankBadge(pct);
        results.push({
          elem,
          damage: dmgRaw,
          p50,
          pct,
          eqB,
          deltaStr,
          deltaCls,
          rank
        });

        const ratio = p50 > 0 ? (dmgRaw / p50) : 1;
        radarUserVals.push(Math.min(1.8, Math.max(0.2, ratio)));
      } else {
        results.push({
          elem,
          damage: dmgRaw || 0,
          p50,
          pct: 0,
          eqB: '-',
          deltaStr: '-',
          deltaCls: 'delta-zero',
          rank: { label: '未填寫', cls: 'rank-c' }
        });
        radarUserVals.push(1.0);
      }
    });

    tableBody.innerHTML = results.map(r => {
      const zh = ELEM_CONFIG[r.elem].nameZh;
      const dmgStr = r.damage > 0 ? formatDmg(r.damage, true, true) : '<span style="color: var(--text-muted)">-</span>';
      const p50Str = formatDmg(r.p50, true, true);
      const pctStr = r.damage > 0 ? `${r.pct.toFixed(1)}%` : '-';
      const eqStr = r.damage > 0 ? formatEqBand(r.eqB) : '-';

      return `
        <tr>
          <td class="align-left"><span class="elem-badge ${r.elem}">${zh}</span></td>
          <td class="align-right"><strong>${dmgStr}</strong></td>
          <td class="align-right" style="color: var(--text-secondary);">${p50Str}</td>
          <td class="align-center">
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
              <span style="font-weight: 600;" class="tnum">${pctStr}</span>
              <span class="rank-badge ${r.rank.cls}">${r.rank.label}</span>
            </div>
            ${r.damage > 0 ? `<div class="mini-bar-bg" style="max-width: 100px; margin: 4px auto 0 auto;"><div class="mini-bar-fill" style="width: ${r.pct}%;"></div></div>` : ''}
          </td>
          <td class="align-right"><strong class="tnum">${eqStr}</strong></td>
          <td class="align-center"><span class="${r.deltaCls}">${r.deltaStr}</span></td>
        </tr>
      `;
    }).join('');

    const verdictEl = document.getElementById('multiVerdictText');
    if (verdictEl) {
      if (!inRange) {
        verdictEl.innerHTML = `
          <h4>等級超出資料涵蓋範圍</h4>
          <p>當前設定等級 Lv ${state.syncLv} 超出資料庫涵蓋範圍（661–1000），無法進行常模比較。</p>
        `;
      } else if (validCount >= 3) {
        const avgDelta = (totalDelta / validCount).toFixed(1);
        const sign = avgDelta >= 0 ? '+' : '';
        const parts = [];
        if (bestElem && maxDelta >= 1) {
          parts.push(`<strong>${ELEM_CONFIG[bestElem].nameZh}</strong> 相對最強（領先 +${maxDelta} 段）`);
        }
        if (worstElem && minDelta <= -1 && worstElem !== bestElem) {
          parts.push(`<strong>${ELEM_CONFIG[worstElem].nameZh}</strong> 相對最弱（落後 ${minDelta} 段），是最值得補強的方向`);
        }

        let advice = parts.length ? parts.join('；') + '。' : '五個屬性的戰力段水準相當平均。';
        advice += '（跨屬性比強弱請以百分位為準：各屬性的段間成長斜率不同。）';

        verdictEl.innerHTML = `
          <h4>綜合戰術評級：平均超越同段 ${sign}${avgDelta} 段 (${validCount}/5 屬性已登錄)</h4>
          <p>${advice}</p>
        `;
      } else {
        verdictEl.innerHTML = `
          <h4>五屬性綜合練度診斷</h4>
          <p>請在左側填入各屬性傷害（支援 36B、360億、40,000,000,000 等），系統將即時以 <strong>${userBand}–${userBand + 19} 戰力段</strong> 基準生成雷達圖與評比。</p>
        `;
      }
    }

    animateRadarChart(radarUserVals);
  }

  // Smooth animation controller for Radar Chart
  let radarAnimId = null;
  let radarCurrentRatios = [1.0, 1.0, 1.0, 1.0, 1.0];
  let radarTargetRatios = [1.0, 1.0, 1.0, 1.0, 1.0];

  function animateRadarChart(targetRatios) {
    radarTargetRatios = targetRatios;
    if (radarAnimId) cancelAnimationFrame(radarAnimId);

    function step() {
      let diff = 0;
      for (let i = 0; i < 5; i++) {
        const d = radarTargetRatios[i] - radarCurrentRatios[i];
        radarCurrentRatios[i] += d * 0.25;
        diff += Math.abs(d);
      }
      drawRadarChart(radarCurrentRatios);
      if (diff > 0.005) {
        radarAnimId = requestAnimationFrame(step);
      } else {
        radarCurrentRatios = [...radarTargetRatios];
        drawRadarChart(radarCurrentRatios);
        radarAnimId = null;
      }
    }
    radarAnimId = requestAnimationFrame(step);
  }

  function drawRadarChart(userRatios) {
    const canvas = document.getElementById('radarCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // ⚠ 佈局熱點：這裡不可寫死尺寸。
    // 曾經寫死 360×320 再配上 CSS 的 max-width:100%，
    // 在窄容器下 CSS 盒子被縮到 320 而繪圖底圖仍是 360，整張圖被橫向壓扁。
    const host = canvas.parentElement;
    const avail = (host && host.clientWidth) ? host.clientWidth : 360;
    const width = Math.max(240, Math.min(360, avail));
    const height = Math.round(width * 0.89);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2 + 10;
    const radius = Math.min(width, height) * 0.328;
    const numSides = 5;
    const angleStep = (Math.PI * 2) / numSides;
    const startAngle = -Math.PI / 2;

    const levels = [0.33, 0.66, 1.0, 1.33, 1.66];
    levels.forEach(lvl => {
      ctx.beginPath();
      for (let i = 0; i < numSides; i++) {
        const angle = startAngle + i * angleStep;
        const r = (lvl / 1.66) * radius;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = lvl === 1.0 ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.06)';
      ctx.lineWidth = lvl === 1.0 ? 1.2 : 1;
      ctx.setLineDash(lvl === 1.0 ? [3, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    ELEMS.forEach((elem, i) => {
      const angle = startAngle + i * angleStep;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const labelRadius = radius + 22;
      const lx = centerX + Math.cos(angle) * labelRadius;
      const ly = centerY + Math.sin(angle) * labelRadius;

      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ELEM_CONFIG[elem].color;
      ctx.fillText(`${elem}`, lx, ly);
    });

    ctx.beginPath();
    for (let i = 0; i < numSides; i++) {
      const angle = startAngle + i * angleStep;
      const ratio = userRatios[i] || 1.0;
      const r = (Math.min(1.66, ratio) / 1.66) * radius;
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 113, 227, 0.16)';
    ctx.fill();
    ctx.strokeStyle = '#0071e3';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let i = 0; i < numSides; i++) {
      const angle = startAngle + i * angleStep;
      const ratio = userRatios[i] || 1.0;
      const r = (Math.min(1.66, ratio) / 1.66) * radius;
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;

      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#0071e3';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Render Team Selection Cards (Sorted at runtime by median_curve of current band)
  function renderTeamCards(elem) {
    const listEl = document.getElementById('teamCardsList');
    if (!listEl) return;

    const idx = window.TEAM_INDEX_V3 || window.TEAM_INDEX;
    const elemData = idx ? idx.elements[elem] : null;
    if (!elemData || !elemData.teams || elemData.teams.length === 0) {
      listEl.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 8px;">暫無隊伍資料</div>';
      return;
    }

    const userBand = band_of(state.syncLv);

    // Query each team's median_curve at current userBand and sort descending (B2 test requirement)
    const teamsWithMedians = elemData.teams.map(t => {
      const bmKey = `${elem}_${t.team_key}_${userBand}`;
      const record = window.TEAM_BENCHMARK_V3 ? window.TEAM_BENCHMARK_V3[bmKey] : null;
      const medianVal = record && record.mc ? parseFloat(record.mc) : 0;
      return {
        ...t,
        medianAtBand: medianVal
      };
    });

    teamsWithMedians.sort((a, b) => b.medianAtBand - a.medianAtBand);

    const selectedKey = state.selectedTeamKeys[elem];

    listEl.innerHTML = teamsWithMedians.map((t, idxNum) => {
      const isActive = (t.team_key === selectedKey);
      const medianStr = t.medianAtBand > 0 ? formatDmg(t.medianAtBand, true, true) : '樣本不足';
      
      const unitsHtml = t.units.map(u => {
        const isFlex = (u === t.flex_unit);
        return `<span class="unit-chip ${isFlex ? 'flex-chip' : ''}">${u}</span>`;
      }).join('');

      return `
        <div class="team-card ${isActive ? 'active' : ''}" data-elem="${elem}" data-teamkey="${t.team_key}">
          <div class="team-card-header">
            <span class="team-card-rank">#${idxNum + 1}</span>
            <div class="team-card-median">中位 ${medianStr}</div>
          </div>
          <div class="team-card-units">
            ${unitsHtml}
          </div>
          <div class="team-card-footer">
            <span>樣本數 n = ${t.total_n}</span>
            ${isActive ? '<span style="color: var(--accent-blue); font-weight: 600;">已選擇</span>' : '<span>點擊選擇</span>'}
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.team-card').forEach(card => {
      card.addEventListener('click', () => {
        const tkey = card.getAttribute('data-teamkey');
        state.selectedTeamKeys[elem] = tkey;
        const matchingTeam = elemData.teams.find(t => t.team_key === tkey);
        if (matchingTeam) {
          state.customUnits[elem] = [...matchingTeam.units];
        }
        renderActiveView();
      });
    });

    const hintEl = document.getElementById('teamListOrderHint');
    if (hintEl) {
      hintEl.textContent = `依 ${userBand}–${userBand + 19} 段中位降序`;
    }
  }

  // Render Custom Roster Checkbox Selector (16 characters)
  function renderCustomRoster(elem) {
    const gridEl = document.getElementById('rosterGrid');
    if (!gridEl) return;

    const idx = window.TEAM_INDEX_V3 || window.TEAM_INDEX;
    const elemData = idx ? idx.elements[elem] : null;
    if (!elemData || !elemData.roster) {
      gridEl.innerHTML = '';
      return;
    }

    const selectedUnits = state.customUnits[elem] || [];

    gridEl.innerHTML = elemData.roster.map(unitName => {
      const isSelected = selectedUnits.includes(unitName);
      return `
        <label class="roster-checkbox-label ${isSelected ? 'selected' : ''}">
          <input type="checkbox" class="roster-chk" data-unit="${unitName}" ${isSelected ? 'checked' : ''}>
          <span>${unitName}</span>
        </label>
      `;
    }).join('');

    const countTag = document.getElementById('rosterSelectedCountTag');
    if (countTag) {
      countTag.textContent = `已選 ${selectedUnits.length}/5`;
      if (selectedUnits.length === 5) countTag.classList.add('valid');
      else countTag.classList.remove('valid');
    }

    const normKey = normalizeTeamKey(selectedUnits);
    const elemId = ELEM_CONFIG[elem].id;
    let matchCount = 0;
    if (selectedUnits.length === 5) {
      matchCount = (window.RAW_HITS || []).filter(h => h[0] === elemId && h[4] === normKey).length;
    }

    const liveNEl = document.getElementById('customRosterN');
    if (liveNEl) {
      liveNEl.textContent = selectedUnits.length === 5 ? matchCount : '-';
    }

    gridEl.querySelectorAll('.roster-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const u = chk.getAttribute('data-unit');
        let current = [...(state.customUnits[elem] || [])];
        if (chk.checked) {
          if (current.length >= 5) {
            chk.checked = false;
            showToast('最多只能勾選 5 位角色');
            return;
          }
          if (!current.includes(u)) current.push(u);
        } else {
          current = current.filter(x => x !== u);
        }
        state.customUnits[elem] = current;
        if (current.length === 5) {
          state.selectedTeamKeys[elem] = normalizeTeamKey(current);
        }
        renderActiveView();
      });
    });
  }

  // Render Team Switch Advice Box (R1: Based on core4_key flex unit ranking in current band)
  function renderTeamSwitchAdvice(elem, currentTeamKey) {
    const boxEl = document.getElementById('teamSwitchBox');
    const tableBody = document.getElementById('teamSwitchTableBody');
    const core4Text = document.getElementById('textCore4Key');
    if (!boxEl || !tableBody) return;

    if (!currentTeamKey) {
      boxEl.style.display = 'none';
      return;
    }

    const userBand = band_of(state.syncLv);
    const bmKey = `${elem}_${currentTeamKey}_${userBand}`;
    const currentBm = window.TEAM_BENCHMARK_V3 ? window.TEAM_BENCHMARK_V3[bmKey] : null;
    const idx = window.TEAM_INDEX_V3 || window.TEAM_INDEX;
    const elemData = idx ? idx.elements[elem] : null;

    if (!currentBm || !currentBm.core4_key || !elemData || !elemData.teams) {
      boxEl.style.display = 'none';
      return;
    }

    const core4Key = currentBm.core4_key;
    if (core4Text) core4Text.textContent = core4Key.split('|').join(' / ');

    const siblings = [];
    elemData.teams.forEach(t => {
      if (t.core4_key === core4Key) {
        const sKey = `${elem}_${t.team_key}_${userBand}`;
        const sRecord = window.TEAM_BENCHMARK_V3 ? window.TEAM_BENCHMARK_V3[sKey] : null;
        let sMedian = 0;
        let sN = t.total_n;
        if (sRecord && sRecord.mc) {
          sMedian = parseFloat(sRecord.mc);
          sN = sRecord.n || t.total_n;
        }
        siblings.push({
          team_key: t.team_key,
          flex_unit: t.flex_unit,
          total_n: sN,
          median: sMedian
        });
      }
    });

    if (siblings.length <= 1) {
      boxEl.style.display = 'none';
      return;
    }

    siblings.sort((a, b) => b.median - a.median);

    const currentMedian = siblings.find(s => s.team_key === currentTeamKey)?.median || 0;

    tableBody.innerHTML = siblings.map(s => {
      const isCurrent = (s.team_key === currentTeamKey);
      const medianStr = s.median > 0 ? formatDmg(s.median, true, true) : '-';
      
      let diffHtml = '<span style="color: var(--text-muted);">-</span>';
      if (isCurrent) {
        diffHtml = '<span class="badge-tag current">目前配置</span>';
      } else if (currentMedian > 0 && s.median > 0) {
        const diffPct = ((s.median - currentMedian) / currentMedian) * 100;
        if (diffPct > 0) {
          diffHtml = `<span style="color: var(--accent-green); font-weight: 600;">用這個配置的人中位高 +${diffPct.toFixed(1)}%</span>`;
        } else {
          diffHtml = `<span style="color: var(--accent-red); font-weight: 600;">用這個配置的人中位低 ${diffPct.toFixed(1)}%</span>`;
        }
      }

      return `
        <tr class="${isCurrent ? 'current-row' : ''}">
          <td class="align-left">
            <strong>${s.flex_unit}</strong>
            ${isCurrent ? ' <span style="font-size: 11px; color: var(--accent-blue);">(你)</span>' : ''}
          </td>
          <td class="align-right tnum">${s.total_n}</td>
          <td class="align-right">${medianStr}</td>
          <td class="align-right">${diffHtml}</td>
        </tr>
      `;
    }).join('');

    boxEl.style.display = 'block';
  }

  // Render Single Element Deep Dive (v3 Band Architecture with D5' Tier Fallbacks)
  function renderSingleDiagnostic() {
    const elem = state.singleElem;
    const hitIdxStr = state.singleHitIndex;
    const isKill = state.singleIsKill;
    const dmg = parseDamage(state.singleDamageInput);

    const killWarningBox = document.getElementById('killWarningBox');
    const heroStatsContainer = document.getElementById('heroStatsContainer');
    const teamTierBanner = document.getElementById('teamTierBanner');
    const teamTierText = document.getElementById('teamTierText');

    if (isKill) {
      if (killWarningBox) killWarningBox.style.display = 'block';
      if (heroStatsContainer) heroStatsContainer.style.opacity = '0.35';
      return;
    } else {
      if (killWarningBox) killWarningBox.style.display = 'none';
      if (heroStatsContainer) heroStatsContainer.style.opacity = '1';
    }

    renderTeamCards(elem);
    renderCustomRoster(elem);

    const userBand = band_of(state.syncLv);
    const inRange = isLevelInRange(state.syncLv);

    // Range Check Protection (F2 / F3 in testcases)
    if (!inRange) {
      if (teamTierBanner && teamTierText) {
        teamTierBanner.className = 'tier-banner tier-banner-3';
        teamTierBanner.style.display = 'flex';
        teamTierText.innerHTML = '等級超出資料涵蓋範圍（661–1000），無法比較';
      }
      document.getElementById('valPercentile').textContent = '-';
      document.getElementById('subtextPercentile').textContent = '超出資料庫涵蓋範圍';
      document.getElementById('valEqLevel').textContent = '-';
      document.getElementById('subtextEqLevel').textContent = '-';
      document.getElementById('valMedian').textContent = '-';
      document.getElementById('badgeSampleInfo').textContent = '無法比較 (需介於 Lv 661 ~ 1000)';
      return;
    }

    let pool = [];
    let p50 = 0;
    let pct = 0;
    let eqB = 'BELOW_RANGE';
    let deltaStr = '-';
    let currentTeamKey = state.selectedTeamKeys[elem] || '';

    if (state.singleScope === 'team') {
      // TEAM SCOPE COMPARISON (D9~D12 with v3 Band Architecture)
      const idx = window.TEAM_INDEX_V3 || window.TEAM_INDEX;
      const isQualified = idx?.elements[elem]?.teams?.some(t => t.team_key === currentTeamKey);

      if (!isQualified) {
        // TM1: 隊伍不在合格清單 -> 退回全體基準
        const gKey = `${elem}_${hitIdxStr}_${userBand}`;
        const gRow = window.BENCHMARK_V3 ? window.BENCHMARK_V3[gKey] : null;
        pool = gRow ? pool_for(elem, userBand, gRow.spread, hitIdxStr) : [];
        p50 = gRow && gRow.p50 ? gRow.p50 : 0;

        if (teamTierBanner && teamTierText) {
          teamTierBanner.className = 'tier-banner tier-banner-3';
          teamTierBanner.style.display = 'flex';
          teamTierText.innerHTML = '查無此隊伍組合，已改用全體基準';
        }

        if (dmg && dmg > 0 && pool.length > 0) {
          pct = getPercentile(pool, dmg);
          eqB = equiv_band(elem, hitIdxStr, dmg);
          deltaStr = formatBandDelta(eqB, userBand);
        }
      } else {
        // Team is qualified -> Check team benchmark row
        const tKey = `${elem}_${currentTeamKey}_${userBand}`;
        const tRow = window.TEAM_BENCHMARK_V3 ? window.TEAM_BENCHMARK_V3[tKey] : null;

        if (!tRow || tRow.tier === 4) {
          // TM2: 隊伍在此戰力段樣本不足 (tier 4) -> 退回全體基準
          const gKey = `${elem}_${hitIdxStr}_${userBand}`;
          const gRow = window.BENCHMARK_V3 ? window.BENCHMARK_V3[gKey] : null;
          pool = gRow ? pool_for(elem, userBand, gRow.spread, hitIdxStr) : [];
          p50 = gRow && gRow.p50 ? gRow.p50 : 0;

          if (teamTierBanner && teamTierText) {
            teamTierBanner.className = 'tier-banner tier-banner-3';
            teamTierBanner.style.display = 'flex';
            teamTierText.innerHTML = '同隊伍在此戰力段樣本不足，已改用全體基準';
          }

          if (dmg && dmg > 0 && pool.length > 0) {
            pct = getPercentile(pool, dmg);
            eqB = equiv_band(elem, hitIdxStr, dmg);
            deltaStr = formatBandDelta(eqB, userBand);
          }
        } else if (tRow.tier === 1) {
          // Tier 1: 本段樣本充足 (spread = 0)
          pool = pool_for(elem, userBand, 0, hitIdxStr, currentTeamKey);
          p50 = tRow.p50;

          if (teamTierBanner && teamTierText) {
            teamTierBanner.className = 'tier-banner tier-banner-1';
            teamTierBanner.style.display = 'flex';
            teamTierText.innerHTML = `同隊伍基準 ｜ 基準：${tRow.band_start}–${tRow.band_end} 段，n=${tRow.n}`;
          }

          if (dmg && dmg > 0 && pool.length > 0) {
            pct = getPercentile(pool, dmg);
            eqB = equiv_band_team(elem, currentTeamKey, dmg);
            deltaStr = formatBandDelta(eqB, userBand);
          }
        } else {
          // Tier 2 or 3: 併入 ±1 或 ±2 段
          pool = pool_for(elem, userBand, tRow.spread, hitIdxStr, currentTeamKey);
          p50 = tRow.p50;

          if (teamTierBanner && teamTierText) {
            teamTierBanner.className = 'tier-banner tier-banner-2';
            teamTierBanner.style.display = 'flex';
            teamTierText.innerHTML = `已併入 ${tRow.merged_from}–${tRow.merged_to} 段（跨戰力層，僅供參考） ｜ n=${tRow.n}`;
          }

          if (dmg && dmg > 0 && pool.length > 0) {
            pct = getPercentile(pool, dmg);
            eqB = equiv_band_team(elem, currentTeamKey, dmg);
            deltaStr = formatBandDelta(eqB, userBand);
          }
        }
      }
    } else {
      // GLOBAL SCOPE COMPARISON (v3 Global Band)
      const gKey = `${elem}_${hitIdxStr}_${userBand}`;
      const gRow = window.BENCHMARK_V3 ? window.BENCHMARK_V3[gKey] : null;

      if (gRow) {
        pool = pool_for(elem, userBand, gRow.spread, hitIdxStr);
        p50 = gRow.p50;

        if (gRow.tier === 1) {
          if (teamTierBanner) teamTierBanner.style.display = 'none';
        } else if (gRow.tier === 2 || gRow.tier === 3) {
          // F1 in testcases: tier 2 / 3 must show banner
          if (teamTierBanner && teamTierText) {
            teamTierBanner.className = 'tier-banner tier-banner-2';
            teamTierBanner.style.display = 'flex';
            teamTierText.innerHTML = `已併入 ${gRow.merged_from}–${gRow.merged_to} 段（跨戰力層，僅供參考） ｜ n=${gRow.n}`;
          }
        } else {
          if (teamTierBanner && teamTierText) {
            teamTierBanner.className = 'tier-banner tier-banner-3';
            teamTierBanner.style.display = 'flex';
            teamTierText.innerHTML = '此戰力段樣本不足';
          }
        }

        if (dmg && dmg > 0 && pool.length > 0) {
          pct = getPercentile(pool, dmg);
          eqB = equiv_band(elem, hitIdxStr, dmg);
          deltaStr = formatBandDelta(eqB, userBand);
        }
      }
    }

    const p10 = getQuantile(pool, 0.10);
    const p25 = getQuantile(pool, 0.25);
    const p75 = getQuantile(pool, 0.75);
    const p90 = getQuantile(pool, 0.90);

    const valPercentile = document.getElementById('valPercentile');
    const valEqLevel = document.getElementById('valEqLevel');
    const valMedian = document.getElementById('valMedian');
    const badgeSampleInfo = document.getElementById('badgeSampleInfo');
    const subtextPercentile = document.getElementById('subtextPercentile');
    const subtextEqLevel = document.getElementById('subtextEqLevel');

    if (valPercentile) valPercentile.textContent = dmg ? `${pct.toFixed(1)}%` : '-';
    if (subtextPercentile) {
      const beatCount = dmg ? Math.round((pct / 100) * pool.length) : 0;
      subtextPercentile.textContent = dmg ? `同段 ${pool.length} 人中贏過 ${beatCount} 人` : '請輸入傷害值';
    }

    if (valEqLevel) valEqLevel.textContent = dmg ? formatEqBand(eqB) : '-';
    if (subtextEqLevel) {
      subtextEqLevel.textContent = dmg
        ? (typeof eqB === 'number' ? `段差：${deltaStr}` : deltaStr)
        : '-';
    }

    if (valMedian) valMedian.innerHTML = formatDmg(p50, true, true);
    if (badgeSampleInfo) {
      const scopeLabel = state.singleScope === 'team' ? '同隊基準' : '全體基準';
      badgeSampleInfo.innerHTML = `
        ${scopeLabel}：${userBand}–${userBand + 19} 段 ｜ 樣本數 n = ${pool.length}
      `;
    }

    document.getElementById('pill_p10').innerHTML = formatDmg(p10, true, true);
    document.getElementById('pill_p25').innerHTML = formatDmg(p25, true, true);
    document.getElementById('pill_p50').innerHTML = formatDmg(p50, true, true);
    document.getElementById('pill_p75').innerHTML = formatDmg(p75, true, true);
    document.getElementById('pill_p90').innerHTML = formatDmg(p90, true, true);

    drawDistributionCurve(pool, dmg, p10, p25, p50, p75, p90);
    renderTeamSwitchAdvice(elem, currentTeamKey);
  }

  function drawDistributionCurve(pool, myDamage, p10, p25, p50, p75, p90) {
    const canvas = document.getElementById('distCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // 同上：尺寸一律由容器決定。窄畫面時同時降低高度，避免圖形被拉長。
    const width = canvas.parentElement.clientWidth || 580;
    const height = width < 420 ? 190 : 240;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    if (!pool || pool.length < 5) {
      ctx.fillStyle = '#86868b';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('樣本數不足，無法繪製分布曲線', width / 2, height / 2);
      return;
    }

    const minDmg = pool[0];
    const maxDmg = pool[pool.length - 1];
    const rangeDmg = Math.max(1, maxDmg - minDmg);

    const paddingX = 40;
    const paddingBottom = 35;
    const paddingTop = 30;
    const plotW = width - paddingX * 2;
    const plotH = height - paddingTop - paddingBottom;

    function getX(val) {
      const clamp = Math.max(minDmg, Math.min(maxDmg, val));
      return paddingX + ((clamp - minDmg) / rangeDmg) * plotW;
    }

    const numBins = 40;
    const binCounts = new Array(numBins).fill(0);
    pool.forEach(v => {
      let b = Math.floor(((v - minDmg) / rangeDmg) * numBins);
      if (b >= numBins) b = numBins - 1;
      binCounts[b]++;
    });

    const smoothed = [];
    let maxCount = 0;
    for (let i = 0; i < numBins; i++) {
      let sum = 0, weightSum = 0;
      for (let j = -3; j <= 3; j++) {
        if (i + j >= 0 && i + j < numBins) {
          const w = Math.exp(-(j * j) / 2);
          sum += binCounts[i + j] * w;
          weightSum += w;
        }
      }
      const val = sum / weightSum;
      smoothed.push(val);
      if (val > maxCount) maxCount = val;
    }

    ctx.beginPath();
    ctx.moveTo(paddingX, height - paddingBottom);
    for (let i = 0; i < numBins; i++) {
      const x = paddingX + (i / (numBins - 1)) * plotW;
      const y = (height - paddingBottom) - (smoothed[i] / (maxCount || 1)) * plotH;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(paddingX + plotW, height - paddingBottom);
    ctx.closePath();

    ctx.fillStyle = 'rgba(0, 113, 227, 0.10)';
    ctx.fill();
    ctx.strokeStyle = '#0071e3';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(paddingX, height - paddingBottom);
    ctx.lineTo(paddingX + plotW, height - paddingBottom);
    ctx.strokeStyle = '#e5e5ea';
    ctx.lineWidth = 1;
    ctx.stroke();

    const qMarkers = [
      { label: 'p10', val: p10, col: '#86868b' },
      { label: 'p25', val: p25, col: '#86868b' },
      { label: 'p50 中位', val: p50, col: '#ff9500' },
      { label: 'p75', val: p75, col: '#86868b' },
      { label: 'p90', val: p90, col: '#86868b' }
    ];

    qMarkers.forEach(q => {
      const qx = getX(q.val);
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(qx, paddingTop);
      ctx.lineTo(qx, height - paddingBottom);
      ctx.strokeStyle = q.col === '#ff9500' ? 'rgba(255, 149, 0, 0.6)' : 'rgba(0, 0, 0, 0.1)';
      ctx.lineWidth = q.col === '#ff9500' ? 1.5 : 1;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = q.col;
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(q.label, qx, height - paddingBottom + 16);
    });

    if (myDamage && myDamage > 0) {
      const userX = getX(myDamage);
      
      ctx.beginPath();
      ctx.moveTo(userX, paddingTop - 8);
      ctx.lineTo(userX, height - paddingBottom);
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(userX, paddingTop - 8, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3b30';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ff3b30';
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`你的傷害: ${formatDmg(myDamage, true)}`, userX, paddingTop - 16);
    }
  }

  function renderActiveView() {
    const curBand = band_of(state.syncLv);
    const bandTag = document.getElementById('currentBandTag');
    if (bandTag) {
      if (isLevelInRange(state.syncLv)) {
        bandTag.textContent = `${curBand}–${curBand + 19} 段`;
        bandTag.style.color = 'var(--accent-blue)';
      } else {
        bandTag.textContent = '超出範圍 (661–1000)';
        bandTag.style.color = 'var(--accent-red)';
      }
    }

    if (state.activeTab === 'multi') {
      renderMultiDiagnostic();
    } else if (state.activeTab === 'single') {
      renderSingleDiagnostic();
    }
  }

  // Automated v3 Test Suite Runner (12 testcases from testcases_v3.json)
  function runV3TestSuite() {
    const tableBody = document.getElementById('v3TestSuiteTableBody');
    if (!tableBody) return;

    const testcases = window.TESTCASES_V3 ? window.TESTCASES_V3.cases : [];
    if (!testcases || testcases.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="5">暫無測試案例資料</td></tr>';
      return;
    }

    const results = testcases.map(tc => {
      let passed = false;
      let actualDetail = '';

      if (tc.id === 'BD1') {
        const bands = tc.input.levels.map(l => band_of(l));
        passed = JSON.stringify(bands) === JSON.stringify(tc.expect.bands);
        actualDetail = `歸段結果: ${bands.join(', ')}`;
      } else if (tc.id === 'BD2') {
        const b760 = band_of(760);
        const b761 = band_of(761);
        const r760 = window.BENCHMARK_V3?.[`Fire_all_${b760}`];
        const r761 = window.BENCHMARK_V3?.[`Fire_all_${b761}`];
        const p760 = pool_for('Fire', b760, r760?.spread || 0);
        const p761 = pool_for('Fire', b761, r761?.spread || 0);
        const pct760 = +getPercentile(p760, tc.input.damage).toFixed(1);
        const pct761 = +getPercentile(p761, tc.input.damage).toFixed(1);
        passed = (b760 === tc.expect.band_760 && b761 === tc.expect.band_761 && pct760 === tc.expect.percentile_760 && pct761 === tc.expect.percentile_761 && pct760 !== pct761);
        actualDetail = `Lv760 (${b760}段) = ${pct760}%, Lv761 (${b761}段) = ${pct761}% (跨段公平性成立)`;
      } else if (tc.id === 'T1' || tc.id === 'T2') {
        const b = band_of(tc.input.sync_lv);
        const r = window.BENCHMARK_V3?.[`${tc.input.elem}_all_${b}`];
        const p = pool_for(tc.input.elem, b, r?.spread || 0);
        const p50Val = r?.p50;
        const pctVal = +getPercentile(p, tc.input.damage).toFixed(1);
        const eb = equiv_band(tc.input.elem, 'all', tc.input.damage);
        passed = (b === tc.expect.band_start && r?.tier === tc.expect.tier && r?.spread === tc.expect.spread && p.length === tc.expect.n && p50Val === tc.expect.p50 && pctVal === tc.expect.percentile && eb === tc.expect.equivalent_band);
        actualDetail = `段 ${b}–${b+19}, n=${p.length}, p50=${formatDmg(p50Val, true)}, pct=${pctVal}%, 等效段=${eb}–${eb+19}`;
      } else if (tc.id === 'F1') {
        const b = band_of(tc.input.sync_lv);
        const r = window.BENCHMARK_V3?.[`${tc.input.elem}_all_${b}`];
        const p = pool_for(tc.input.elem, b, r?.spread || 0);
        passed = (b === tc.expect.band_start && r?.tier === tc.expect.tier && r?.spread === tc.expect.spread && r?.merged_from === tc.expect.merged_from && r?.merged_to === tc.expect.merged_to && p.length === tc.expect.n);
        actualDetail = `tier=${r?.tier}, 併入 ${r?.merged_from}–${r?.merged_to} 段, n=${p.length}`;
      } else if (tc.id === 'F2' || tc.id === 'F3') {
        const inR = isLevelInRange(tc.input.sync_lv);
        passed = (inR === tc.expect.in_range);
        actualDetail = `Lv ${tc.input.sync_lv} 範圍檢驗: ${inR ? '合格' : '不合格 (明確拒答)'}`;
      } else if (tc.id === 'EB1') {
        const ub = band_of(tc.input.sync_lv);
        const eb = equiv_band(tc.input.elem, 'all', tc.input.damage);
        const delta = typeof eb === 'number' ? (eb - ub) / 20 : null;
        passed = (ub === tc.expect.user_band && eb === tc.expect.equivalent_band && delta === tc.expect.band_delta && typeof eb === 'number');
        actualDetail = `本段: ${ub}, 等效段: ${eb} (領先 ${delta} 段，無連續插值)`;
      } else if (tc.id === 'TM1') {
        const norm = normalizeTeamKey(tc.input.team_units);
        const isQ = window.TEAM_INDEX_V3?.elements[tc.input.elem]?.teams?.some(t => t.team_key === norm);
        passed = (!isQ && norm === tc.expect.team_key);
        actualDetail = `組合: ${norm.slice(0, 30)}... 合格: false (退回全體)`;
      } else if (tc.id === 'TM2') {
        const b = tc.input.band_start;
        const r = window.TEAM_BENCHMARK_V3?.[`${tc.input.elem}_${tc.input.team_key}_${b}`];
        passed = (r?.tier === tc.expect.tier);
        actualDetail = `隊伍於 ${b} 段 tier=${r?.tier} (退回全體)`;
      } else if (tc.id === 'B1') {
        const actualCounts = {};
        let allMatch = true;
        ELEMS.forEach(e => {
          const cnt = window.TEAM_INDEX_V3?.elements[e]?.qualified_teams || 0;
          actualCounts[e] = cnt;
          if (cnt !== tc.expect[e]) allMatch = false;
        });
        passed = allMatch;
        actualDetail = JSON.stringify(actualCounts);
      } else if (tc.id === 'B2') {
        function order(elem, b) {
          const teams = window.TEAM_INDEX_V3?.elements[elem]?.teams || [];
          const list = teams.map(t => {
            const r = window.TEAM_BENCHMARK_V3?.[`${elem}_${t.team_key}_${b}`];
            return { key: t.team_key, mc: r?.mc ? parseFloat(r.mc) : 0 };
          });
          list.sort((a, b) => b.mc - a.mc);
          return list.map(x => x.key);
        }
        const o701 = order('Iron', 701);
        const o881 = order('Iron', 881);
        const differ = JSON.stringify(o701) !== JSON.stringify(o881);
        passed = differ && (JSON.stringify(o701) === JSON.stringify(tc.expect.order_701)) && (JSON.stringify(o881) === JSON.stringify(tc.expect.order_881));
        actualDetail = `701段首位: ${o701[0].split('|')[0]}, 881段首位: ${o881[0].split('|')[0]} (順序不同: ${differ})`;
      }

      return `
        <tr>
          <td><strong class="tnum">${tc.id}</strong></td>
          <td>${tc.desc}</td>
          <td><code style="font-size: 11px;">${tc.input ? JSON.stringify(tc.input).slice(0, 45) + '...' : '-'}</code></td>
          <td style="font-size: 12px; color: var(--text-secondary);">${actualDetail}</td>
          <td>
            <span class="badge-tag" style="background: ${passed ? 'var(--accent-green)' : 'var(--accent-red)'}; color: #fff; padding: 4px 8px;">
              ${passed ? '✓ PASS 通過' : '✗ FAIL 失敗'}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    tableBody.innerHTML = results;
  }

  // Setup Event Handlers
  function setupEventListeners() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tab = btn.getAttribute('data-tab');
        state.activeTab = tab;

        document.getElementById('viewMulti').style.display = (tab === 'multi') ? 'block' : 'none';
        document.getElementById('viewSingle').style.display = (tab === 'single') ? 'block' : 'none';
        document.getElementById('viewDocs').style.display = (tab === 'docs') ? 'block' : 'none';

        if (tab === 'docs') {
          runV3TestSuite();
        }

        renderActiveView();
      });
    });

    const levelSlider = document.getElementById('globalLevelSlider');
    const levelInput = document.getElementById('globalLevelInput');
    const btnMinus = document.getElementById('btnLevelMinus');
    const btnPlus = document.getElementById('btnLevelPlus');

    function updateLevel(newLv) {
      let clamped = Math.round(newLv);
      // Clamp between 660 and 1000 for UI slider/input
      if (clamped < 660) clamped = 660;
      if (clamped > 1000) clamped = 1000;
      state.syncLv = clamped;
      if (levelSlider) levelSlider.value = clamped;
      if (levelInput) levelInput.value = clamped;
      renderActiveView();
    }

    if (levelSlider) {
      levelSlider.addEventListener('input', (e) => updateLevel(e.target.value));
    }
    if (levelInput) {
      levelInput.addEventListener('change', (e) => updateLevel(e.target.value));
    }
    if (btnMinus) {
      btnMinus.addEventListener('click', () => updateLevel(state.syncLv - 5));
    }
    if (btnPlus) {
      btnPlus.addEventListener('click', () => updateLevel(state.syncLv + 5));
    }

    // View 1 (Multi) Inputs
    ELEMS.forEach(elem => {
      const inp = document.getElementById(`input_multi_${elem}`);
      const preview = document.getElementById(`preview_multi_${elem}`);
      const note = document.getElementById(`note_multi_${elem}`);
      if (inp) {
        inp.addEventListener('input', (e) => {
          state.multiDamages[elem] = e.target.value;
          const parsed = parseDamage(e.target.value);
          if (preview) preview.innerHTML = formatDmg(parsed, true, true);
          if (note) {
            if (e.target.value.trim() && !parsed) {
              note.textContent = '請輸入十億級 (B) 傷害，如 35B 或 350億';
              note.style.display = 'block';
            } else {
              note.style.display = 'none';
            }
          }
          renderMultiDiagnostic();
        });
      }
    });

    const btnGlobal = document.getElementById('btnScopeGlobal');
    const btnTeam = document.getElementById('btnScopeTeam');
    if (btnGlobal && btnTeam) {
      btnGlobal.addEventListener('click', () => {
        btnGlobal.classList.add('active');
        btnTeam.classList.remove('active');
        state.singleScope = 'global';
        renderSingleDiagnostic();
      });
      btnTeam.addEventListener('click', () => {
        btnTeam.classList.add('active');
        btnGlobal.classList.remove('active');
        state.singleScope = 'team';
        renderSingleDiagnostic();
      });
    }

    const btnToggleRoster = document.getElementById('btnToggleCustomRoster');
    const rosterPanel = document.getElementById('customRosterPanel');
    const rosterChevron = document.getElementById('customRosterChevron');
    if (btnToggleRoster && rosterPanel) {
      btnToggleRoster.addEventListener('click', () => {
        state.isCustomRosterOpen = !state.isCustomRosterOpen;
        rosterPanel.style.display = state.isCustomRosterOpen ? 'block' : 'none';
        if (rosterChevron) rosterChevron.textContent = state.isCustomRosterOpen ? '▴' : '▾';
      });
    }

    document.querySelectorAll('.elem-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.elem-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const elem = btn.getAttribute('data-elem');
        state.singleElem = elem;
        renderSingleDiagnostic();
      });
    });

    const hitSelect = document.getElementById('singleHitIndex');
    if (hitSelect) {
      hitSelect.addEventListener('change', (e) => {
        state.singleHitIndex = e.target.value;
        renderSingleDiagnostic();
      });
    }

    const singleInp = document.getElementById('singleDamageInput');
    const singlePrev = document.getElementById('singleDmgPreview');
    const singleNote = document.getElementById('singleDmgNote');
    if (singleInp) {
      singleInp.addEventListener('input', (e) => {
        state.singleDamageInput = e.target.value;
        const parsed = parseDamage(e.target.value);
        if (singlePrev) singlePrev.innerHTML = formatDmg(parsed, true, true);
        if (singleNote) {
          if (e.target.value.trim() && !parsed) {
            singleNote.textContent = '請輸入十億級 (B) 傷害，如 36B 或 360億';
            singleNote.style.display = 'block';
          } else {
            singleNote.style.display = 'none';
          }
        }
        renderSingleDiagnostic();
      });
    }

    const chkKill = document.getElementById('singleIsKill');
    if (chkKill) {
      chkKill.addEventListener('change', (e) => {
        state.singleIsKill = e.target.checked;
        renderSingleDiagnostic();
      });
    }

    document.getElementById('btnClearInputs')?.addEventListener('click', () => {
      state.multiDamages = { 'Electric': '', 'Fire': '', 'Water': '', 'Wind': '', 'Iron': '' };
      ELEMS.forEach(elem => {
        const inp = document.getElementById(`input_multi_${elem}`);
        if (inp) inp.value = '';
        const pv = document.getElementById(`preview_multi_${elem}`);
        if (pv) pv.innerHTML = '-';
      });
      showToast('已清空所有屬性輸入');
      renderActiveView();
    });

    document.getElementById('btnCopyReport')?.addEventListener('click', () => {
      const ub = band_of(state.syncLv);
      let md = `## NIKKE UR43 傷害體檢報告 (v3 戰力段制)\n`;
      md += `> **同步器等級**：Lv ${state.syncLv} (${ub}–${ub + 19} 段) ｜ **資料庫**：日服 (JP) 實戰全樣本庫\n\n`;
      md += `| 屬性 | 你的單刀傷害 | 該段中位 (p50) | 百分位 | 等效戰力段 | 段差 |\n`;
      md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;

      ELEMS.forEach(elem => {
        const dmgRaw = parseDamage(state.multiDamages[elem]);
        const gKey = `${elem}_all_${ub}`;
        const gRow = window.BENCHMARK_V3 ? window.BENCHMARK_V3[gKey] : null;
        const p50 = gRow && gRow.p50 ? gRow.p50 : 0;
        const pool = gRow ? pool_for(elem, ub, gRow.spread, 'all') : [];
        const dmgStr = dmgRaw ? formatDmg(dmgRaw, true) : '未填寫';
        const p50Str = formatDmg(p50, true);
        const pct = (dmgRaw && pool.length) ? getPercentile(pool, dmgRaw).toFixed(1) + '%' : '-';
        const eqB = dmgRaw ? formatEqBand(equiv_band(elem, 'all', dmgRaw)) : '-';
        const delta = dmgRaw ? formatBandDelta(equiv_band(elem, 'all', dmgRaw), ub) : '-';
        md += `| ${ELEM_CONFIG[elem].nameZh} | **${dmgStr}** | ${p50Str} | ${pct} | ${eqB} | ${delta} |\n`;
      });

      navigator.clipboard.writeText(md).then(() => {
        showToast('已複製 Markdown 報告至剪貼簿！');
      }).catch(() => {
        showToast('複製失敗，請手動複製');
      });
    });

    document.getElementById('btnRunV3Tests')?.addEventListener('click', () => {
      runV3TestSuite();
      showToast('v3 全套自動測試已完成！');
    });

    window.addEventListener('resize', () => {
      if (state.activeTab === 'single') {
        const ub = band_of(state.syncLv);
        let pool = [];
        if (state.singleScope === 'team') {
          const tKey = `${state.singleElem}_${state.selectedTeamKeys[state.singleElem]}_${ub}`;
          const tRow = window.TEAM_BENCHMARK_V3 ? window.TEAM_BENCHMARK_V3[tKey] : null;
          pool = tRow ? pool_for(state.singleElem, ub, tRow.spread, state.singleHitIndex, state.selectedTeamKeys[state.singleElem]) : [];
        } else {
          const gKey = `${state.singleElem}_${state.singleHitIndex}_${ub}`;
          const gRow = window.BENCHMARK_V3 ? window.BENCHMARK_V3[gKey] : null;
          pool = gRow ? pool_for(state.singleElem, ub, gRow.spread, state.singleHitIndex) : [];
        }
        const dmg = parseDamage(state.singleDamageInput);
        drawDistributionCurve(
          pool,
          dmg,
          getQuantile(pool, 0.10),
          getQuantile(pool, 0.25),
          getQuantile(pool, 0.50),
          getQuantile(pool, 0.75),
          getQuantile(pool, 0.90)
        );
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initDefaultTeams();
    setupEventListeners();
    renderActiveView();
  });

})();
