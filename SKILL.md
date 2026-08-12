---
name: nikke-ur-analysis
description: 分析 NIKKE Union Raid（公會戰）從 oooooo.rip 匯出的 Users 頁面 HTML，產生戰力段基準表、隊伍維度分析與跨期成長追蹤，並更新前端分析器。當使用者提到 UR44、UR45、新一期公會戰資料、oooooo.rip 的 HTML 檔、或要更新傷害分析器／體檢儀時使用。
---

# NIKKE Union Raid 資料分析管線

腳本與資料都在這個 repo 的根目錄。詳細流程、設計理由與踩過的坑見
[`新一期資料處理手冊.md`](新一期資料處理手冊.md) —— **動手前先讀那份**。

## 三個指令

```bash
# 1. 解析（每期各跑一次）
python3 ur_pipeline.py "oooooo.rip - UR44 JP Users.html" --region JP --ur UR44 --out ./ur44

# 2. 打包（新舊期一起，先寫的視為較新）
python3 ur_bundle.py --period UR44:./ur44 --period UR43:./ur43 --out data_multi.js

# 3. 驗證（四支都要全綠，否則不要交付）
npm install jsdom --silent
node test_multi_period.js && node test_ui_regression.js \
  && node test_level_range.js && node test_team_cases.js
```

`index.html`、`app.js`、`style.css` 不需要改 —— 期數選單會自動列出資料包裡的所有期數。

## 跑管線時必須確認的四行輸出

| 輸出 | 不對時 |
|---|---|
| `對照原站摘要：N/N 吻合` | 不吻合會自動中止，多半是站方改版，需調整 regex |
| `自動推導關卡結構` | 確認 ∞ 關卡有被標記並併入同屬性（每期王不同） |
| `段界效應成立` | 顯示「不明顯」就**停下來人工檢查**，不要直接出貨 |
| `UI 範圍涵蓋率` | 低於 85% 時用 `--band-range 661-1000` 手動指定 |

## 這個專案的四條鐵則

踩過三次坑，**沒有一次是演算法錯**，全部是靜默失敗 —— 錯誤不出聲，看起來像整個工具壞掉。

- **每一個 fallback 都必須在畫面上出聲**（併段、退回全體、超出範圍、查無 ID、樣本過少）
- **會靜默算錯的東西不交給前端**：門檻判定、隊伍正規化、併段階梯全部在管線算好，寫進 `tier` 欄位
- **驗證的期望值不能由被測實作產生**，否則只是在確認「實作等於實作」
- **測資裡失敗路徑要比成功路徑多**

輸入檢查還有一條：**只檢查「解析失敗」不夠**。`40M`、`40萬` 都能解析成功，只是數值遠低於合理範圍，必須同時檢查數值區間。
