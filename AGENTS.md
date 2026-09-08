# AGENTS.md — 給 AI coding agent 的工作守則

本檔規範**任何** AI agent（Claude / Codex / 其他）在此 repo 的行為。動工前先讀完這份。

> 最後校訂：2026/09/08。文中行號是當日快照——app.js 會長大，**動手前先用 `grep -n` 確認現行位置**，不要盲信行號。

---

## 1. 工作流（必遵守）

- **語言**：所有對使用者的回覆、commit message、code 註解都用**繁體中文**。
- **時區**：UTC+8（Asia/Taipei）。
- **BUILD_DATE**（[app.js:7](app.js#L7)）：每次 commit **必須**改成執行當下的台北時間，用 `TZ=Asia/Taipei date '+%Y/%m/%d %H:%M'` 取得——**絕對不要編造、不要沿用對話裡出現過的舊值**。格式：`YYYY/MM/DD HH:MM`。
- **Cache-buster**：[index.html](index.html) 中 `theme.css?v=` / `style.css?v=` / `app.js?v=` **三處**（行 19、20、803 附近）必須同步更新為 `?v=YYYYMMDDHHMM`，與 BUILD_DATE 來自**同一次**取時。三處字串恆相同，用全域取代一次換掉，最容易漏的是最下面的 `app.js?v=`——漏了它整次更新對手機端等於不存在。
- **順序**：bump 版本 → `git add` → `git commit` → `git push`。bump 沒進 commit 就白工。
- **Commit & Push**：commit 完直接 `git push`，不需等使用者確認（使用者習慣立即在手機 GitHub Pages 驗證）。
- **Commit message**：中文描述「為什麼改」（現行風格如 `修：…`、`新增：…`、`改：…`）。footer 署名：Claude 用 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`，Codex / 其他 agent 用各自慣例。
- **不要 force-push、不要動 git config、不要 `--no-verify`、不要 amend 已 push 的 commit**。

---

## 2. 危險區 — 動之前必讀

這些檔案/函式背後有血淚教訓。重構前先讀對應 commit 與這份說明，**不要為了「簡化」拆掉防線**。函式內任何看似冗餘的 if / try / guard 都不可刪；要動先向使用者說明並取得同意。

### `loadAll()` / `rows()` / `saveSheet()`（app.js 約 542 / 661 / 674 行）
- 2026/05/04 發生過 daily_snapshots 整片被抹掉的事故（commit `0db7b51` 為修補）。
- `rows(settled, label)` 對 rejected Promise **不能靜默回 `[]`**，必須帶 `_failed` 旗標讓 `loadAll` 末段偵測到並 `throw`。
- `saveSheet` 內部維護 `_SHEET_HIGH_WATER`，若記憶體陣列比本 session 看過的最大列數縮水超過一半就 throw 拒寫——**不要拿掉這個 guard**。
- `loadAll` 末段會 seed 16 張 Sheet 的初始 size 到 high-water，加新 sheet 時記得補進去。

### `doSaveDailySnapshot()`（app.js 約 4684 行）
- 兩道 guard 不可拿掉：（1）有持倉但投資總值 = 0 跳過；（2）`usdtwd < 10` 跳過。
- 寫入時 col[9] 必塞 `priceSnap` JSON（per-symbol 原幣別價格），這是次日漲跌計算的唯一來源。

### `getYesterdayPriceSnap()`（app.js 約 1754 行）
- 1 秒 cache 是刻意的，不要拿掉。

### 價格抓取三層防線（app.js 約 831 / 861 / 878 行 + `PRICE_API_URL` app.js:20）
- 台美股/匯率走 `fetchYahooViaCloud()`（Apps Script `/exec` 雲端代抓）為主線；失敗時 `fetchFXFallbackErApi()` 補匯率、`applySnapshotPriceFallback()` 用近 7 日快照價墊底。加密幣走 Binance 等原生 CORS 直連。
- **免費 CORS proxy（corsproxy.io / allorigins / codetabs）2026/08/24 實測全滅**，corsproxy.io 已永久停用免費版。不要「簡化」回舊 proxy 或 Yahoo 直連——瀏覽器端連 Yahoo 沒有 CORS，必失敗。
- `PRICE_API_URL` 是正式部署的 Apps Script 網址，**不要改動**；換網址的唯一正當時機見下一節。

---

## 3. Apps Script 雲端腳本（repo 內的 .gs 不會自動部署）

- [apps-script/nightly-snapshot.gs](apps-script/nightly-snapshot.gs) 只是**鏡像**。`git push` 不會部署——必須由使用者手動把新程式碼貼進試算表的 Apps Script 編輯器（試算表 → 擴充功能 → Apps Script）並儲存。改了 .gs 就明確告訴使用者「需要你手動貼上部署」，附逐步指引。
- 同一腳本身兼兩職：（1）**夜間快照** `nightlySnapshot`，觸發器台北時間每晚 22:00 與 23:00；（2）**即時價格 API** `doGet`，即 app.js 的 `PRICE_API_URL`。
- ⚠ 改完 .gs 重新部署時必走「**部署 → 管理部署 → 編輯（鉛筆）→ 版本選『新版本』→ 部署**」讓 `/exec` 網址沿用；若走「新增部署」會產生**新網址**，app.js 的 `PRICE_API_URL` 就要跟著換並重新 commit。
- 改 app.js 計價邏輯（`calcTotals`、`COIN_MAP`、`STABLECOINS`、daily_snapshots 欄位）時，同步檢查 .gs 是否需要跟改。
- Apps Script 環境限制（實測）：Binance / CryptoCompare / CoinGecko 對 Google 機房限流（429），Yahoo 暢通——所以 .gs 加密幣價以 `YAHOO_CRYPTO` 驗證代號表優先。Yahoo 加密代號有同名幣陷阱：SUI/TAO/APT/IMX 正確代號是 `SUI20947-USD`、`TAO22974-USD`、`APT21794-USD`、`IMX10603-USD`，新增幣種必先人工驗證。

---

## 4. Sheet Schema（不要動欄位順序）

**這張 Google Sheet 是使用者的真實財務資料，不是測試資料。** 任何會寫入 Sheet 的一次性腳本、資料修復、批次操作——先說明打算做什麼、取得使用者同意再執行。

- **snapshots** 月度：`[YYYY/MM, cash_total, stock_tw_total, stock_us_total, crypto_total, insurance_total, realestate_total, debt, net_assets]` — 9 欄。Key 是 `YYYY/MM` **斜線**格式（不是 dash）。
- **daily_snapshots** 每日：上述 9 欄 + `prices_json`（col[9]）= 10 欄。Key 是 `YYYY/MM/DD` 斜線。
- 其他 Sheet 的 schema 看 [app.js](app.js) 中 `HEADERS` 常數，那是唯一 source of truth。
- 新增欄位：先擴 `HEADERS` → 同步 `sheetGet` range（如 `A:J` → `A:K`）→ 處理舊資料相容（缺欄回傳 undefined 不要炸）。

---

## 5. 口徑差異是刻意設計，不是 bug

看到下列「不一致」不要動手「修」——它們是刻意的，曾被誤判為資料錯誤：

- **USDT 視覺歸現金、帳本歸加密**：畫面上 USDT 顯示在「流動現金」（renderCash / renderPie / 財務存活模擬），但 Sheet `holdings_crypto` 與快照欄位一律把 USDT 算進加密貨幣。現金幣別選單沒有 USDT 是刻意的。
- **保險單位**：`settings.insurance_total` 存**美元**（如 22,455），快照 `insurance_total` 欄存**台幣**（×usdtwd）——差 30 幾倍是匯率換算，不是壞資料。
- 比對快照 vs 畫面時先統一口徑；app 內建的資料健檢徽章（`runDataHealthCheck`，app.js 約 4743 行）已按帳本口徑比對，不受此影響。
- **現金跑道（保守）vs 財務存活（樂觀）兩張卡數字不同是刻意的區間對照**，不是計算 bug。

---

## 6. 程式碼風格

- **單檔架構**：app.js 7,700+ 行是刻意的，**不要拆分成 modules**。部署是手機直抓 GitHub Pages 單檔、無 build step，拆檔會破壞 cache-buster 策略。「太大」是已知狀態，不是 tech debt。
- **註解節制**：多數情況不寫註解。只在 WHY 不明顯時寫 1 行（hidden constraint、workaround、防呆理由）。不解釋 WHAT。
- **數字字型**：DWZ 參數輸入框 `.dwz-param-input` 與 KPI 標籤 `.dwz-kpi-tag b` 用 `Inter 14px / 500 weight`，搭配 `tabular-nums`。
- **金額顯示**：用 `fmtWan()`（萬為單位）；TWD 與 USD 換算到小數點後兩位。
- **Mobile-first**：CSS 預設手機，桌機用 `@media (min-width: 769px)` 加強。
- **CSS**：vanilla CSS（`style.css` + `theme.css`）。**沒有 Tailwind**（CLAUDE.md 那行是誤植，請忽略）。
- **不要新增 README / docs / planning files**，除非使用者明確要求。

---

## 7. 不要碰

- `*.backup`（`app.js.backup`、`index.html.backup`、`style.css.backup`）— 使用者手動備份，不要刪除/重命名/視為過期。
- `design-test.html` — 視覺原型沙盒，使用者保留。不要套到正式 index.html，除非使用者要求。
- `.claude/` 整個目錄 — Claude Code 的設定與 skills，其他 agent 不要動（`.claude/skills/` 內容與本檔一致，本檔已涵蓋重點）。
- `SPREADSHEET_ID` / `CLIENT_ID`（[app.js:9-10](app.js#L9)）— 接到使用者真實 Google Sheet 的環境參數。
- `FIRE-ADVISOR.md` / `ADVISOR-LOG.md` — 顧問模式的個人財務脈絡，**刻意不入版控**（cloud 環境看不到是正常的）；使用者說「顧問」「FIRE」「Die with Zero」時讀它照做（純對話，不寫 code）。

---

## 8. 驗證流程

無自動測試。每次改完使用者會在手機開 GitHub Pages 驗證：
1. 確認 header 顯示新 BUILD_DATE
2. 確認手機下拉刷新後拉到新版（cache-buster 對應）
3. 走過受影響的 UI flow

如果改動會影響資料寫入（CRUD、snapshot、Sheet 寫入），先在說明裡提醒使用者「先觀察一次再大量操作」。

---

## 9. 與使用者的對話風格

- 使用者是 15 年科技業 PM、非工程師——技術概念**先比喻再講細節**。
- **簡潔**：短句、直接。**不要堆 emoji**。
- 一次只問一個問題；給選項時 2–4 個、首選標「（推薦）」附理由。
- 解釋過後直接動手，不要過度確認；但**對外發布、花錢、刪資料、寫入 Sheet、不可逆動作**先問。
- **每次回覆結尾**附一行：`BUILD_DATE YYYY/MM/DD HH:MM · commit XXXXXXX`，方便使用者對照手機看到的版本。
- **不要主動建議 force-push、reset --hard、刪 branch、跳過 hook**——除非使用者明確要求。
