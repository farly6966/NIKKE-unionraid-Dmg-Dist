// NIKKE UR43 Damage Analyzer & Diagnostic Engine
// Specification v2 compliant

(function () {
  'use strict';

  // Constants
  const ELEM_NAMES = ['Electric', 'Fire', 'Water', 'Wind', 'Iron'];
  const ELEM_CONFIG = {
    'Electric': { nameZh: '電擊 (Electric)', color: '#b38800', icon: '', id: 0 },
    'Fire':     { nameZh: '燃燒 (Fire)',     color: '#d32f2f', icon: '', id: 1 },
    'Water':    { nameZh: '水冷 (Water)',    color: '#0071e3', icon: '', id: 2 },
    'Wind':     { nameZh: '風壓 (Wind)',     color: '#2e7d32', icon: '', id: 3 },
    'Iron':     { nameZh: '鐵甲 (Iron)',     color: '#455a64', icon: '', id: 4 }
  };

  const WIDTHS = [10, 20, 30, 40, 60, 80, 100, 150, 200];
  const MIN_N = 10;

  // 基準曲線全頻譜區間（Lv 310 ~ 1119）
  const LV_MIN = 310;
  const LV_MAX = 1119;

  // App State
  const state = {
    currentTab: 'multi', // 'multi' | 'single' | 'docs'
    syncLv: 755,
    
    // 5-Element Diagnostic State
    multiDamages: {
      'Electric': '44B',
      'Fire': '29B',
      'Water': '36B',
      'Wind': '40B',
      'Iron': '52B'
    },

    // Single Element Deep Dive State
    singleElem: 'Water',
    singleHitIndex: 'all', // 'all', '1', '2', '3'
    singleDamageInput: '36B',
    singleIsKill: false
  };

  // UR 傷害的合理範圍：資料中實際觀測到的區間約 1.4e8 ~ 2.5e11
  const PLAUSIBLE_MIN = 1e9;      // 低於 1B 幾乎確定是單位打錯
  const PLAUSIBLE_MAX = 5e11;     // 高於 500B 超出本期資料上限

  // 全形數字/英數 → 半形
  function toHalfWidth(str) {
    return String(str)
      .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ');
  }

  // 解析使用者手打的傷害字串。
  // 回傳 { value, inferred, error }：
  //   value    解析後的傷害（數字）或 null
  //   inferred true 表示原輸入沒帶單位、由數量級推斷而來
  //   error    'empty' | 'nan' | null
  // 支援：36B / 36.5b / 360億 / 36兆 / 36000M / 36,000,000,000 / 3.6e10 / ３６Ｂ / 36（推斷為 36B）
  function parseDamageEx(input) {
    if (input === null || input === undefined) return { value: null, inferred: false, error: 'empty' };
    let s = toHalfWidth(input).trim().replace(/[,\s_]/g, '').toUpperCase();
    if (!s) return { value: null, inferred: false, error: 'empty' };

    // 科學記號直接放行（3.6E10），避免被下面的 E 規則干擾
    const sci = /^[0-9]*\.?[0-9]+E[+-]?[0-9]+$/.test(s);

    let multiplier = null;   // null = 沒有明確單位
    if (!sci) {
      if (/兆|T$/.test(s))                        { multiplier = 1e12; s = s.replace(/兆|T/g, ''); }
      else if (/B$|G$|十億/.test(s))              { multiplier = 1e9;  s = s.replace(/B|G|十億/g, ''); }
      else if (/億/.test(s))                      { multiplier = 1e8;  s = s.replace(/億/g, ''); }
      else if (/M$|百萬/.test(s))                 { multiplier = 1e6;  s = s.replace(/M|百萬/g, ''); }
      else if (/萬$|W$/.test(s))                  { multiplier = 1e4;  s = s.replace(/萬|W/g, ''); }
      else if (/K$/.test(s))                      { multiplier = 1e3;  s = s.replace(/K/g, ''); }
    }

    const val = parseFloat(s);
    if (isNaN(val) || val <= 0) return { value: null, inferred: false, error: 'nan' };

    // 沒帶單位時依數量級推斷：UR 傷害不可能是個位數到六位數，
    // 使用者打「40」意思是 40B。這樣推斷後在 UI 上會明白標示出來。
    let inferred = false;
    if (multiplier === null) {
      if (val < 1e6) { multiplier = 1e9; inferred = true; }
      else           { multiplier = 1; }
    }

    return { value: Math.round(val * multiplier), inferred, error: null };
  }

  // 相容舊呼叫端：只要數字
  function parseDamage(input) {
    return parseDamageEx(input).value;
  }

  // 產生輸入提示訊息，沒問題時回傳 null
  function getDamageNote(rawInput, parsed) {
    if (!parsed) return null;
    if (parsed.error === 'nan') {
      return { level: 'error', text: '看不懂這個輸入。可用格式：40B、400億、40,000,000,000、3.6e10' };
    }
    if (!parsed.value) return null;
    const v = parsed.value;

    if (v < PLAUSIBLE_MIN) {
      // 把輸入裡的數字當成「以 B 為單位」重新解讀，當作建議值
      const lead = parseFloat(toHalfWidth(rawInput).replace(/[,\s_]/g, ''));
      const guess = (!isNaN(lead) && lead > 0 && lead * 1e9 <= PLAUSIBLE_MAX) ? lead * 1e9 : null;
      return {
        level: 'error',
        text: `解析為 ${Number(v).toLocaleString()} 傷害，遠低於 UR 的合理範圍。` +
              (guess ? `是不是要輸入 ${formatDmg(guess, true)}？` : '請確認單位。') +
              `（可用格式：40B、400億、40,000,000,000）`
      };
    }
    if (v > PLAUSIBLE_MAX) {
      return { level: 'error', text: `解析為 ${formatDmg(v, true)}，超出本期資料的觀測上限（約 221 B），請確認單位。` };
    }
    if (parsed.inferred) {
      return { level: 'info', text: `輸入未帶單位，已推斷為 ${formatDmg(v, true)}。` };
    }
    return null;
  }

  // Helper: Format damage to readable string (with optional decoupled unit HTML)
  function formatDmg(val, compact = true, htmlWrap = false) {
    if (val === null || val === undefined || isNaN(val)) return '-';
    if (compact) {
      if (val >= 1e9) {
        const numStr = (val / 1e9).toFixed(2).replace(/\.00$/, '');
        return htmlWrap ? `<span class="tnum">${numStr}</span><span class="num-unit">B</span>` : `${numStr} B`;
      }
      if (val >= 1e6) {
        const numStr = (val / 1e6).toFixed(1);
        return htmlWrap ? `<span class="tnum">${numStr}</span><span class="num-unit">M</span>` : `${numStr} M`;
      }
      if (val >= 1e4) {
        const numStr = (val / 1e4).toFixed(1);
        return htmlWrap ? `<span class="tnum">${numStr}</span><span class="num-unit">萬</span>` : `${numStr} 萬`;
      }
    }
    const loc = Number(val).toLocaleString();
    return htmlWrap ? `<span class="tnum">${loc}</span>` : loc;
  }

  // Core Math Engine: Build Sliding Window Sample Pool
  function buildPool(elem, syncLv, hitIndexNum = null) {
    const elemId = ELEM_CONFIG[elem].id;
    const hits = window.RAW_HITS || [];
    
    let matched = [];
    let usedWidth = 100;

    for (let i = 0; i < WIDTHS.length; i++) {
      const w = WIDTHS[i];
      const p = [];
      for (let j = 0; j < hits.length; j++) {
        const row = hits[j]; // [elemId, hitIndex(0..2), syncLv, damage]
        if (row[0] === elemId) {
          if (Math.abs(row[2] - syncLv) <= w) {
            if (hitIndexNum === null || row[1] === hitIndexNum) {
              p.push(row[3]);
            }
          }
        }
      }
      const targetMinN = (w <= 30) ? 30 : MIN_N;
      if (p.length >= targetMinN) {
        matched = p;
        usedWidth = w;
        break;
      }
      matched = p;
    }

    matched.sort((a, b) => a - b);
    
    let confidence = '高';
    if (matched.length < 15) confidence = '低 (僅供參考)';
    else if (matched.length < 50) confidence = '中';

    return {
      pool: matched,
      n: matched.length,
      width: usedWidth,
      confidence
    };
  }

  // Core Math Engine: Nearest-Rank Quantile
  function getQuantile(sortedPool, q) {
    if (!sortedPool || sortedPool.length === 0) return 0;
    let idx = Math.floor(q * sortedPool.length);
    if (idx >= sortedPool.length) idx = sortedPool.length - 1;
    return sortedPool[idx];
  }

  // Core Math Engine: Strict Percentile (< my_damage)
  function getPercentile(sortedPool, damage) {
    if (!sortedPool || sortedPool.length === 0 || damage <= 0) return 0;
    let count = 0;
    for (let i = 0; i < sortedPool.length; i++) {
      if (sortedPool[i] < damage) count++;
      else break;
    }
    return (count / sortedPool.length) * 100;
  }

  // Core Math Engine: Monotonic Median Curve Equivalent Level Look-up
  function getEquivalentLevel(elem, damage, hitIndexStr = 'all') {
    const key = `${elem}_${hitIndexStr}`;
    const curve = (window.BENCHMARK && window.BENCHMARK[key]) || [];
    if (!curve || curve.length === 0 || damage <= 0) return 'N/A';

    if (damage <= curve[0].mc) return 'BELOW_RANGE';
    if (damage >= curve[curve.length - 1].mc) return 'ABOVE_RANGE';

    for (let i = 1; i < curve.length; i++) {
      if (curve[i].mc >= damage) {
        const x0 = curve[i - 1].lv;
        const x1 = curve[i].lv;
        const y0 = curve[i - 1].mc;
        const y1 = curve[i].mc;
        if (y1 === y0) return x0;
        const eq = x0 + ((damage - y0) / (y1 - y0)) * (x1 - x0);
        return Math.round(eq);
      }
    }
    return 'N/A';
  }

  // 等效等級的顯示文字。已擴充至全頻譜 Lv 310 ~ 1120
  const EQ_LABEL = {
    BELOW_RANGE: '<310 (低於底限)',
    ABOVE_RANGE: '>1120 (突破天花板)',
    'N/A': 'N/A'
  };
  function formatEqLevel(eqLv) {
    if (typeof eqLv === 'number') return `Lv ${eqLv}`;
    return EQ_LABEL[eqLv] || String(eqLv);
  }
  function formatEqDelta(eqLv, syncLv) {
    if (typeof eqLv === 'number') {
      const d = eqLv - syncLv;
      return (d >= 0 ? `+${d}` : `${d}`) + ' 級';
    }
    if (eqLv === 'BELOW_RANGE') return '低於 Lv 310 的資料底限';
    if (eqLv === 'ABOVE_RANGE') return '高於 Lv 1120 的資料上限';
    return '-';
  }

  // Helper: Rank Tier Assessment
  function getRankBadge(percentile) {
    if (percentile >= 90) return { label: 'S+ 頂尖', cls: 'rank-s-plus' };
    if (percentile >= 75) return { label: 'S 優秀', cls: 'rank-s' };
    if (percentile >= 50) return { label: 'A 良好', cls: 'rank-a' };
    if (percentile >= 25) return { label: 'B 一般', cls: 'rank-b' };
    return { label: 'C 偏低', cls: 'rank-c' };
  }

  // 在輸入框下方顯示解析結果與提示。noteHost 是要掛提示訊息的容器元素。
  function refreshDamageInputUI(rawValue, previewEl, noteHost) {
    const parsed = parseDamageEx(rawValue);
    if (previewEl) {
      previewEl.textContent = parsed.value ? formatDmg(parsed.value, true) : '-';
    }
    if (!noteHost) return parsed;

    let noteEl = noteHost.querySelector(':scope > .dmg-note');
    const note = getDamageNote(rawValue, parsed);
    if (!note) {
      if (noteEl) noteEl.remove();
      return parsed;
    }
    if (!noteEl) {
      noteEl = noteHost.ownerDocument.createElement('div');
      noteEl.className = 'dmg-note';
      noteHost.appendChild(noteEl);
    }
    noteEl.textContent = note.text;
    noteEl.style.cssText =
      'margin-top:6px;font-size:12px;line-height:1.5;padding:6px 8px;border-radius:6px;' +
      (note.level === 'error'
        ? 'color:#ff8a80;background:rgba(255,138,128,.10);border:1px solid rgba(255,138,128,.35);'
        : 'color:#ffd54f;background:rgba(255,213,79,.10);border:1px solid rgba(255,213,79,.30);');
    return parsed;
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
    }, 3000);
  }

  // DOM Elements initialization
  function initDOM() {
    // Level controls
    const levelSlider = document.getElementById('globalLevelSlider');
    const levelInput = document.getElementById('globalLevelInput');
    const levelMinusBtn = document.getElementById('btnLevelMinus');
    const levelPlusBtn = document.getElementById('btnLevelPlus');

    // 中位曲線只在 Lv 660~1000 有足夠樣本，夾在這個區間內，
    // 避免在資料稀薄處給出看似精確、實則無意義的結果。
    function updateLevel(newLv) {
      newLv = Math.max(LV_MIN, Math.min(LV_MAX, parseInt(newLv) || 755));
      state.syncLv = newLv;
      levelSlider.value = newLv;
      levelInput.value = newLv;
      renderActiveView();
    }

    levelSlider.addEventListener('input', (e) => updateLevel(e.target.value));
    levelInput.addEventListener('change', (e) => updateLevel(e.target.value));
    levelMinusBtn.addEventListener('click', () => updateLevel(state.syncLv - 5));
    levelPlusBtn.addEventListener('click', () => updateLevel(state.syncLv + 5));

    // Nav tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentTab = btn.dataset.tab;
        
        document.getElementById('viewMulti').style.display = (state.currentTab === 'multi') ? 'block' : 'none';
        document.getElementById('viewSingle').style.display = (state.currentTab === 'single') ? 'block' : 'none';
        document.getElementById('viewDocs').style.display = (state.currentTab === 'docs') ? 'block' : 'none';
        
        renderActiveView();
      });
    });

    // 5-Element Input Listeners
    ELEM_NAMES.forEach(elem => {
      const input = document.getElementById(`input_multi_${elem}`);
      const preview = document.getElementById(`preview_multi_${elem}`);
      if (input) {
        const noteHost = input.closest('.form-group') || (preview && preview.parentElement) || null;
        input.value = state.multiDamages[elem] || '';
        input.addEventListener('input', (e) => {
          state.multiDamages[elem] = e.target.value;
          refreshDamageInputUI(e.target.value, preview, noteHost);
          renderMultiDiagnostic();
        });
        refreshDamageInputUI(input.value, preview, noteHost);
      }
    });

    // Single Element View Listeners
    const singleElemBtns = document.querySelectorAll('.elem-btn');
    singleElemBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        singleElemBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.singleElem = btn.dataset.elem;
        renderSingleDiagnostic();
      });
    });

    const hitIndexSelect = document.getElementById('singleHitIndex');
    if (hitIndexSelect) {
      hitIndexSelect.addEventListener('change', (e) => {
        state.singleHitIndex = e.target.value;
        renderSingleDiagnostic();
      });
    }

    const singleDamageInput = document.getElementById('singleDamageInput');
    const singleDmgPreview = document.getElementById('singleDmgPreview');
    if (singleDamageInput) {
      const singleNoteHost = singleDamageInput.closest('.form-group')
        || (singleDmgPreview && singleDmgPreview.parentElement) || null;
      singleDamageInput.value = state.singleDamageInput;
      singleDamageInput.addEventListener('input', (e) => {
        state.singleDamageInput = e.target.value;
        refreshDamageInputUI(e.target.value, singleDmgPreview, singleNoteHost);
        renderSingleDiagnostic();
      });
      refreshDamageInputUI(singleDamageInput.value, singleDmgPreview, singleNoteHost);
    }

    const killCheckbox = document.getElementById('singleIsKill');
    if (killCheckbox) {
      killCheckbox.addEventListener('change', (e) => {
        state.singleIsKill = e.target.checked;
        renderSingleDiagnostic();
      });
    }

    // Presets
    document.getElementById('btnClearInputs').addEventListener('click', () => {
      state.multiDamages = { 'Electric': '', 'Fire': '', 'Water': '', 'Wind': '', 'Iron': '' };
      ELEM_NAMES.forEach(elem => {
        const inp = document.getElementById(`input_multi_${elem}`);
        if (inp) inp.value = '';
        const pv = document.getElementById(`preview_multi_${elem}`);
        if (pv) pv.textContent = '-';
      });
      showToast('已清空輸入欄位');
      renderActiveView();
    });

    document.getElementById('btnCopyReport').addEventListener('click', () => {
      copyMarkdownReport();
    });

    // Verification suite preset buttons inside docs tab
    document.querySelectorAll('.btn-run-verify').forEach(btn => {
      btn.addEventListener('click', () => {
        const testId = btn.dataset.test;
        if (testId === '1') {
          // Water, 755, 36B, all
          updateLevel(755);
          state.singleElem = 'Water';
          state.singleHitIndex = 'all';
          state.singleDamageInput = '36000000000';
          state.singleIsKill = false;
        } else if (testId === '2') {
          // Iron, 755, 52B, all
          updateLevel(755);
          state.singleElem = 'Iron';
          state.singleHitIndex = 'all';
          state.singleDamageInput = '52000000000';
          state.singleIsKill = false;
        } else if (testId === '3') {
          // Iron, 755, 52B, hit 3
          updateLevel(755);
          state.singleElem = 'Iron';
          state.singleHitIndex = '3';
          state.singleDamageInput = '52000000000';
          state.singleIsKill = false;
        }
        
        // Switch to single view
        document.querySelector('.tab-btn[data-tab="single"]').click();
        
        // Update inputs
        document.querySelectorAll('.elem-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.elem === state.singleElem);
        });
        if (hitIndexSelect) hitIndexSelect.value = state.singleHitIndex;
        if (singleDamageInput) singleDamageInput.value = state.singleDamageInput;
        if (killCheckbox) killCheckbox.checked = false;
        
        showToast(`已載入測資 #${testId} 並執行即時運算！`);
        renderSingleDiagnostic();
      });
    });
  }

  // Render Multi-Element Diagnostic Table & Radar Chart
  function renderMultiDiagnostic() {
    const tableBody = document.getElementById('multiResultsBody');
    if (!tableBody) return;

    const results = [];
    let radarUserVals = [];
    let totalDelta = 0;
    let validCount = 0;
    let bestElem = null, worstElem = null;
    let maxDelta = -999, minDelta = 999;

    ELEM_NAMES.forEach(elem => {
      const dmgRaw = parseDamage(state.multiDamages[elem]);
      const poolObj = buildPool(elem, state.syncLv, null);
      const p50 = getQuantile(poolObj.pool, 0.5);

      if (dmgRaw && dmgRaw > 0) {
        const pct = getPercentile(poolObj.pool, dmgRaw);
        const eqLv = getEquivalentLevel(elem, dmgRaw, 'all');
        let delta = 0;
        let deltaStr = formatEqDelta(eqLv, state.syncLv);
        let deltaCls = 'delta-zero';

        if (typeof eqLv === 'number') {
          delta = eqLv - state.syncLv;
          deltaCls = delta > 0 ? 'delta-positive' : (delta < 0 ? 'delta-negative' : 'delta-zero');
          totalDelta += delta;
          validCount++;

          if (delta > maxDelta) { maxDelta = delta; bestElem = elem; }
          if (delta < minDelta) { minDelta = delta; worstElem = elem; }
        } else {
          deltaCls = 'delta-negative';
        }

        const rank = getRankBadge(pct);
        results.push({
          elem,
          damage: dmgRaw,
          p50,
          pct,
          eqLv,
          deltaStr,
          deltaCls,
          rank
        });

        // Relative ratio vs median for radar (capped between 0.2 and 1.8)
        const ratio = p50 > 0 ? (dmgRaw / p50) : 1;
        radarUserVals.push(Math.min(1.8, Math.max(0.2, ratio)));
      } else {
        results.push({
          elem,
          damage: 0,
          p50,
          pct: 0,
          eqLv: '-',
          deltaStr: '-',
          deltaCls: 'delta-zero',
          rank: { label: '未填寫', cls: 'rank-c' }
        });
        radarUserVals.push(1.0);
      }
    });

    // Render Table Rows
    tableBody.innerHTML = results.map(r => {
      const zh = ELEM_CONFIG[r.elem].nameZh;
      const dmgStr = r.damage > 0 ? formatDmg(r.damage, true, true) : '<span style="color: var(--text-muted)">-</span>';
      const p50Str = formatDmg(r.p50, true, true);
      const pctStr = r.damage > 0 ? `${r.pct.toFixed(1)}%` : '-';
      const eqStr = r.damage > 0 ? formatEqLevel(r.eqLv) : '-';

      return `
        <tr>
          <td class="align-left"><span class="elem-badge ${r.elem}">${zh}</span></td>
          <td class="align-right"><strong>${dmgStr}</strong></td>
          <td class="align-right">${p50Str}</td>
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

    // Verdict Summary Banner
    const verdictEl = document.getElementById('multiVerdictText');
    if (verdictEl) {
      if (validCount >= 3) {
        const avgDelta = (totalDelta / validCount).toFixed(1);
        const sign = avgDelta >= 0 ? '+' : '';
        // 強項與弱項要分別成立才提，兩者都不顯著時才說「均衡」，
        // 避免湊出「X 發揮卓越…各屬性發揮均衡」這種自相矛盾的句子。
        const parts = [];
        const hasStrong = bestElem && maxDelta >= 15;
        const hasWeak = worstElem && minDelta <= -15 && worstElem !== bestElem;

        if (hasStrong) {
          parts.push(`<strong>${ELEM_CONFIG[bestElem].nameZh}</strong> 相對最強（等效 +${maxDelta} 級）`);
        }
        if (hasWeak) {
          parts.push(`<strong>${ELEM_CONFIG[worstElem].nameZh}</strong> 相對最弱（${minDelta} 級），是最值得補強的方向`);
        }

        let verdictAdvice;
        if (parts.length) {
          verdictAdvice = parts.join('；') + '。';
        } else {
          verdictAdvice = '五個屬性的等效等級都落在 ±15 級內，練度相當平均。';
        }
        verdictAdvice += '（跨屬性比強弱請以百分位為準：各屬性的傷害成長斜率不同，等級差距不完全等價。）';

        verdictEl.innerHTML = `
          <h4>綜合戰術評級：平均超越同級 ${sign}${avgDelta} 級 (${validCount}/5 屬性已登錄)</h4>
          <p>${verdictAdvice}</p>
        `;
      } else {
        verdictEl.innerHTML = `
          <h4>五屬性綜合練度診斷</h4>
          <p>請在左側依序填入各屬性傷害（支援 36B、360億、36,000,000,000 等格式），系統將即時生成五維雷達圖與綜合評比。</p>
        `;
      }
    }

    // Animate Radar Chart smoothly
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

  // Draw High-DPI Canvas Radar Chart
  function drawRadarChart(userRatios) {
    const canvas = document.getElementById('radarCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Scale for Retina / High DPI
    const width = 360;
    const height = 320;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2 + 10;
    const radius = 105;
    const numSides = 5;
    const angleStep = (Math.PI * 2) / numSides;
    const startAngle = -Math.PI / 2; // Top vertex

    // Draw concentric polygon grid
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

    // Draw Axis lines & Labels
    ELEM_NAMES.forEach((elem, i) => {
      const angle = startAngle + i * angleStep;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;

      // Axis line
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Vertex Label
      const labelRadius = radius + 22;
      const lx = centerX + Math.cos(angle) * labelRadius;
      const ly = centerY + Math.sin(angle) * labelRadius;

      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ELEM_CONFIG[elem].color;
      ctx.fillText(`${elem}`, lx, ly);
    });

    // Draw Baseline 1.0 (Median Polygon)
    ctx.beginPath();
    for (let i = 0; i < numSides; i++) {
      const angle = startAngle + i * angleStep;
      const r = (1.0 / 1.66) * radius;
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw User Data Polygon (Apple Blue Solid Clean Fill)
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

    // Polygon Fill
    ctx.fillStyle = 'rgba(0, 113, 227, 0.16)';
    ctx.fill();

    // Polygon Stroke
    ctx.strokeStyle = '#0071e3';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw Data Point Nodes
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

  // Render Single Element Deep Dive
  function renderSingleDiagnostic() {
    const elem = state.singleElem;
    const hitIdxStr = state.singleHitIndex;
    const hitIdxNum = (hitIdxStr === 'all') ? null : (parseInt(hitIdxStr) - 1);
    const isKill = state.singleIsKill;
    const dmg = parseDamage(state.singleDamageInput);

    const killWarningBox = document.getElementById('killWarningBox');
    const heroStatsContainer = document.getElementById('heroStatsContainer');

    if (isKill) {
      if (killWarningBox) killWarningBox.style.display = 'block';
      if (heroStatsContainer) heroStatsContainer.style.opacity = '0.35';
      return;
    } else {
      if (killWarningBox) killWarningBox.style.display = 'none';
      if (heroStatsContainer) heroStatsContainer.style.opacity = '1';
    }

    const poolObj = buildPool(elem, state.syncLv, hitIdxNum);
    const pool = poolObj.pool;

    const p10 = getQuantile(pool, 0.10);
    const p25 = getQuantile(pool, 0.25);
    const p50 = getQuantile(pool, 0.50);
    const p75 = getQuantile(pool, 0.75);
    const p90 = getQuantile(pool, 0.90);

    let pct = 0;
    let eqLv = 'N/A';
    let deltaStr = '-';

    if (dmg && dmg > 0) {
      pct = getPercentile(pool, dmg);
      eqLv = getEquivalentLevel(elem, dmg, hitIdxStr);
      deltaStr = formatEqDelta(eqLv, state.syncLv);
    }

    // Update Hero Cards
    const valPercentile = document.getElementById('valPercentile');
    const valEqLevel = document.getElementById('valEqLevel');
    const valMedian = document.getElementById('valMedian');
    const badgeSampleInfo = document.getElementById('badgeSampleInfo');
    const subtextPercentile = document.getElementById('subtextPercentile');
    const subtextEqLevel = document.getElementById('subtextEqLevel');

    if (valPercentile) valPercentile.textContent = dmg ? `${pct.toFixed(1)}%` : '-';
    if (subtextPercentile) {
      const beatCount = dmg ? Math.round((pct / 100) * poolObj.n) : 0;
      subtextPercentile.textContent = dmg ? `同級 ${poolObj.n} 人中贏過 ${beatCount} 人` : '請輸入傷害值';
    }

    if (valEqLevel) valEqLevel.textContent = dmg ? formatEqLevel(eqLv) : '-';
    if (subtextEqLevel) {
      subtextEqLevel.textContent = dmg
        ? (typeof eqLv === 'number' ? `等級差距：${deltaStr}` : deltaStr)
        : '-';
    }

    if (valMedian) valMedian.innerHTML = formatDmg(p50, true, true);
    if (badgeSampleInfo) {
      const minLv = state.syncLv - poolObj.width;
      const maxLv = state.syncLv + poolObj.width;
      badgeSampleInfo.innerHTML = `
        基準窗口: Lv ${minLv} ~ ${maxLv} (±${poolObj.width}) ｜ 樣本數 n = ${poolObj.n} ｜ 可信度: <strong>${poolObj.confidence}</strong>
      `;
    }

    // Update Quantile Pills with decoupled unit typography
    document.getElementById('pill_p10').innerHTML = formatDmg(p10, true, true);
    document.getElementById('pill_p25').innerHTML = formatDmg(p25, true, true);
    document.getElementById('pill_p50').innerHTML = formatDmg(p50, true, true);
    document.getElementById('pill_p75').innerHTML = formatDmg(p75, true, true);
    document.getElementById('pill_p90').innerHTML = formatDmg(p90, true, true);

    // Draw Distribution Curve
    drawDistributionCurve(pool, dmg, p10, p25, p50, p75, p90);
  }

  // Draw Distribution Bell Curve Canvas
  function drawDistributionCurve(pool, myDamage, p10, p25, p50, p75, p90) {
    const canvas = document.getElementById('distCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const width = canvas.parentElement.clientWidth || 580;
    const height = 240;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    if (!pool || pool.length < 5) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '13px Inter, sans-serif';
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

    // Estimate KDE or Smooth Curve using 40 bins
    const numBins = 40;
    const binCounts = new Array(numBins).fill(0);
    pool.forEach(v => {
      let b = Math.floor(((v - minDmg) / rangeDmg) * numBins);
      if (b >= numBins) b = numBins - 1;
      binCounts[b]++;
    });

    // Smooth bins with Gaussian kernel
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

    // Draw Smooth Area Under Curve
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

    // Baseline X-Axis
    ctx.beginPath();
    ctx.moveTo(paddingX, height - paddingBottom);
    ctx.lineTo(paddingX + plotW, height - paddingBottom);
    ctx.strokeStyle = '#e5e5ea';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw Quantile Markers (p10, p25, p50, p75, p90)
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

      // Label below axis
      ctx.fillStyle = q.col;
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(q.label, qx, height - paddingBottom + 16);
    });

    // Draw User Damage Marker Line (Apple Red Solid Clean)
    if (myDamage && myDamage > 0) {
      const userX = getX(myDamage);
      
      ctx.beginPath();
      ctx.moveTo(userX, paddingTop - 8);
      ctx.lineTo(userX, height - paddingBottom);
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Pin indicator circle on top
      ctx.beginPath();
      ctx.arc(userX, paddingTop - 8, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3b30';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Pin text
      ctx.fillStyle = '#ff3b30';
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`你的傷害: ${formatDmg(myDamage, true)}`, userX, paddingTop - 16);
    }
  }

  // Copy Markdown / Text Report to Clipboard
  function copyMarkdownReport() {
    let md = `##  NIKKE UR43 傷害體檢報告\n`;
    md += `**同步器等級**：Lv ${state.syncLv} ｜ **區服**：JP 日服\n\n`;
    md += `| 屬性 | 你的傷害 | 同級中位 p50 | 百分位 | 等效等級 | 領先差距 |\n`;
    md += `|---|---|---|---|---|---|\n`;

    ELEM_NAMES.forEach(elem => {
      const dmgRaw = parseDamage(state.multiDamages[elem]);
      const poolObj = buildPool(elem, state.syncLv, null);
      const p50 = getQuantile(poolObj.pool, 0.5);

      if (dmgRaw && dmgRaw > 0) {
        const pct = getPercentile(poolObj.pool, dmgRaw);
        const eqLv = getEquivalentLevel(elem, dmgRaw, 'all');
        const deltaStr = formatEqDelta(eqLv, state.syncLv);
        md += `| ${elem} | ${formatDmg(dmgRaw, true)} | ${formatDmg(p50, true)} | ${pct.toFixed(1)}% | ${formatEqLevel(eqLv)} | ${deltaStr} |\n`;
      } else {
        md += `| ${elem} | - | ${formatDmg(p50, true)} | - | - | - |\n`;
      }
    });

    md += `\n*分析器基準：日服 UR43 滿功率刀統計（排除擊殺刀）*`;

    navigator.clipboard.writeText(md).then(() => {
      showToast('體檢報告已複製為 Markdown 格式！可直接貼上 Discord / Line 群組');
    }).catch(() => {
      showToast('複製失敗，請手動選取');
    });
  }

  function renderActiveView() {
    if (state.currentTab === 'multi') {
      renderMultiDiagnostic();
    } else if (state.currentTab === 'single') {
      renderSingleDiagnostic();
    }
  }

  // Window resize handler
  window.addEventListener('resize', () => {
    renderActiveView();
  });

  // Initialization when DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    initDOM();
    renderActiveView();
  });

})();
