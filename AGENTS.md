# AGENTS.md — 給 AI coding agent 的工作守則

本檔規範**任何** AI agent（Claude / Codex / 其他）在此 repo 的行為。動工前先讀完這份。

---

## 1. 工作流（必遵守）

- **語言**：所有對使用者的回覆、commit message、code 註解都用**繁體中文**。
- **時區**：UTC+8（Asia/Taipei）。
- **BUILD_DATE**（[app.js:5](app.js#L5)）：每次 commit **必須**改成執行當下的台北時間（執行 `date '+%Y/%m/%d %H:%M'` 取得，**絕對不要編造或沿用舊值**）。格式：`YYYY/MM/DD HH:MM`。
- **Cache-buster**：[index.html](index.html) 中 `theme.css?v=` / `style.css?v=` / `app.js?v=` 三處的 query string 必須同步更新為 `vYYYYMMDDHHMM`，與 BUILD_DATE 對應。手機驗證仰賴此值刷新 PWA cache。
- **Commit & Push**：commit 完直接 `git push`，不需等使用者確認（使用者習慣立即在手機 GitHub Pages 驗證）。
- **Commit message 格式**：`type(scope): 中文描述`，footer 加 `Co-Authored-By:` 行（Claude 用 `Claude Opus 4.7 ...`、Codex 用 `Codex ...`）。
- **不要 force-push、不要動 git config、不要 `--no-verify`、不要 amend 已 push 的 commit**。

---

## 2. 危險區 — 動之前必讀

這些檔案/函式背後有血淚教訓。重構前先讀對應 commit 與這份說明，**不要為了「簡化」拆掉防線**。

### `loadAll()` / `rows()` / `saveSheet()` ([app.js:496+](app.js#L496))
- 2026/05/04 發生過 daily_snapshots 整片被抹掉的事故（commit `0db7b51` 為修補）。
- `rows(settled, label)` 對 rejected Promise **不能靜默回 `[]`**，必須帶 `_failed` 旗標讓 `loadAll` 末段偵測到並 `throw`。
- `saveSheet` 內部維護 `_SHEET_HIGH_WATER`，若記憶體陣列比本 session 看過的最大列數縮水超過一半就 throw 拒寫——**不要拿掉這個 guard**。
- `loadAll` 末段會 seed 16 張 Sheet 的初始 size 到 high-water，加新 sheet 時記得補進去。

### `doSaveDailySnapshot()` ([app.js:3424+](app.js#L3424))
- 兩道 guard 不可拿掉：（1）有持倉但投資總值 = 0 跳過；（2）`usdtwd < 10` 跳過。
- 寫入時 col[9] 必塞 `priceSnap` JSON（per-symbol 原幣別價格），這是次日漲跌計算的唯一來源。

### `getYesterdayPriceSnap()` ([app.js:1480+](app.js#L1480))
- 1 秒 cache 是刻意的，不要拿掉。

---

## 3. Sheet Schema（不要動欄位順序）

- **snapshots** 月度：`[YYYY/MM, cash_total, stock_tw_total, stock_us_total, crypto_total, insurance_total, realestate_total, debt, net_assets]` — 9 欄。Key 是 `YYYY/MM` **斜線**格式（不是 dash）。
- **daily_snapshots** 每日：上述 9 欄 + `prices_json`（col[9]）= 10 欄。Key 是 `YYYY/MM/DD` 斜線。
- 其他 Sheet 的 schema 看 [app.js](app.js) 中 `HEADERS` 常數，那是唯一 source of truth。
- 新增欄位：先擴 `HEADERS` → 同步 `sheetGet` range（如 `A:J` → `A:K`） → 處理舊資料相容（缺欄回傳 undefined 不要炸）。

---

## 4. 程式碼風格

- **單檔架構**：app.js 約 5000 行是刻意的，不要拆分成 modules。
- **註解節制**：多數情況不寫註解。只在 WHY 不明顯時寫 1 行（hidden constraint、workaround、防呆理由）。不解釋 WHAT。
- **數字字型**：DWZ 參數輸入框 `.dwz-param-input` 與 KPI 標籤 `.dwz-kpi-tag b` 用 `Inter 14px / 500 weight`，搭配 `tabular-nums`。
- **金額顯示**：用 `fmtWan()`（萬為單位）；TWD 與 USD 換算到小數點後兩位。
- **Mobile-first**：CSS 預設手機，桌機用 `@media (min-width: 769px)` 加強。
- **CSS**：vanilla CSS（`style.css` + `theme.css`）。**沒有 Tailwind**（舊版 CLAUDE.md 那行是誤植，請忽略）。
- **不要新增 README / docs / planning files**，除非使用者明確要求。

---

## 5. 不要碰

- `*.backup`（`app.js.backup`、`index.html.backup`、`style.css.backup`）— 使用者手動備份，不要刪除/重命名/視為過期。
- `design-test.html` — 視覺原型沙盒，使用者保留。不要套到正式 index.html，除非使用者要求。
- `.claude/` 整個目錄 — Claude Code 的記憶/設定，Codex 不要動。
- `SPREADSHEET_ID` / `CLIENT_ID`（[app.js:7-8](app.js#L7)）— 使用者環境參數。

---

## 6. 驗證流程

無自動測試。每次改完使用者會在手機開 GitHub Pages 驗證：
1. 確認 header 顯示新 BUILD_DATE
2. 確認手機下拉刷新後拉到新版（cache-buster 對應）
3. 走過受影響的 UI flow

如果改動會影響資料寫入（CRUD、snapshot、Sheet 寫入），先在說明裡提醒使用者「先觀察一次再大量操作」。

---

## 7. 與使用者的對話風格

- **簡潔**：短句、直接、不要結尾總結（diff 自己會說話）。
- **不要堆 emoji**。
- **每次回覆結尾**附一行：`BUILD_DATE YYYY/MM/DD HH:MM · commit XXXXXXX`，方便使用者對照手機看到的版本。
- **不要主動建議 force-push、reset --hard、刪 branch、跳過 hook**——除非使用者明確要求。
