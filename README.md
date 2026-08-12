# NIKKE Union Raid 傷害分析與練度體檢儀

以 [oooooo.rip](https://oooooo.rip) 匯出的公會戰實戰資料為基準，讓玩家用自己的傷害數字查出在**同戰力段**中的排名。

目前收錄日服（JP）UR42、UR43 兩期，共約 24,000 刀、4,700 名玩家。

## 功能

- **五屬性綜合體檢** — 一次填五個屬性，看出哪個練得好、哪個偏弱
- **單刀深度診斷** — 百分位、等效戰力段、分布曲線，可切換「跟全體比」或「跟同隊比」
- **隊伍維度** — 列出該屬性樣本足夠的隊伍組合與各自的中位傷害，兼作換隊建議
- **跨期成長追蹤** — 輸入玩家 ID，比對兩期的相對名次變化

## 直接使用

用瀏覽器開 `index.html` 即可，不需要伺服器。

## 更新新一期資料

```bash
# 0. 各期 CSV 不在 repo 裡，需要先跑管線產生（或用本機已有的）
# 1. 解析（每期各跑一次）
python3 ur_pipeline.py "oooooo.rip - UR44 JP Users.html" --region JP --ur UR44 --out ./ur44

# 2. 打包（新舊期一起，先寫的視為較新）
python3 ur_bundle.py --period UR44:./ur44 --period UR43:./ur43 --out data_multi.js

# 3. 驗證
npm install jsdom --silent
node test_multi_period.js && node test_ui_regression.js \
  && node test_level_range.js && node test_team_cases.js
```

`index.html`、`app.js`、`style.css` 都不需要改 —— 期數選單會自動列出資料包裡的所有期數。

詳細說明見 [`新一期資料處理手冊.md`](新一期資料處理手冊.md)。

## 分析方法

**戰力段**：同步器等級每跨過 x00 → x01 會有一次戰力大提升，所以以 20 級為一段
（`band_start = floor((lv-1)/20)*20+1`）。實測段內傷害幾乎不成長（−3.7%），
段界一次跳 +10~11%，且此效應在 UR42 與 UR43 各自獨立驗證成立。
對照組（把格線平移 5/10/15 級）的跳幅為 0，確認不是隨機起伏。

**排除擊殺刀**：打死王的那一刀傷害被剩餘血量截斷，約佔 14~15%，不是滿功率輸出。

**刀序**：同一角色不能跨刀重複使用，第 3 刀是挑剩的隊伍，傷害系統性低 7~11%，因此保留為可選維度。

**跨期比較**：傷害不能跨期直接比（每期王不同），可比的是同戰力段內的百分位 —— 那是排名，會自動抵消王的難度差異。

## 檔案結構

```
index.html / app.js / style.css   網頁本體
data_multi.js                     多期資料包（由 ur_bundle.py 產生）
ur_pipeline.py                    單期解析與統計
ur_bundle.py                      多期打包
test_*.js                         回歸測試，共 100 項
```

各期的中間產物（`ur42/`、`ur43/` 等 CSV 資料夾）**不在版控內** —— 它們每期約 3.4 MB，
而且能從原始 HTML 用 `ur_pipeline.py` 重新產生。要更新資料時在本機保留即可。

## 資料來源與授權

實戰資料來自 oooooo.rip 的公開排行頁面，著作權歸原站所有。本專案僅做統計彙整。

`data_multi.js` 內含玩家 ID、暱稱、公會名稱與逐刀傷害，用於跨期查詢。
這些都是原站已公開的資訊，但若不希望再散布，可以移除 `ur_bundle.py` 裡的
`UR_PLAYERS`（跨期成長功能會失效，其餘功能不受影響）。
