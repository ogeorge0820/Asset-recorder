---
description: Execute a goal autonomously, self-iterating until acceptance criteria pass. Unlike /execute-plan, does NOT pause for review every step — only stops when stuck or done.
allowed-tools: all
---

# /goal — 自動迭代到滿意為止

執行一個目標，**不每步暫停問你**。自我驗收 + 自我迭代到符合驗收條件才停。
適合：UI tweak、視覺類迭代、明確驗收條件的小型~中型改動。

## 啟動參數
`$ARGUMENTS`：plan 檔路徑 **或** 自然語言目標描述。

## 強制工作流程

### Phase 1 — 解析目標 & 拉出驗收條件
1. 若 `$ARGUMENTS` 像檔案路徑（`/` 開頭、`~` 開頭、`.md` 結尾），用 Read 載入
2. 否則視為直接目標描述
3. 從中提取三件事：
   - **WHAT**：要改什麼／加什麼功能
   - **ACCEPTANCE CRITERIA**：明確的 ✓/✗ checklist（必須能客觀驗證）
   - **OUT OF SCOPE**：明確點名不可動的部分
4. **若驗收條件模糊** → 問使用者一次（用 AskUserQuestion）後再開始。這是**唯一允許的中途提問**

### Phase 2 — 實作迭代迴圈
拆成 step（如果 plan 已拆好就照走，否則自己 plan）。每個 step 進入以下迴圈：

```
iteration = 1
while iteration ≤ 5:
    1. 實作此 step（Edit / Write 程式碼）
    2. 自我驗收 — 對照每條 ACCEPTANCE CRITERIA：
       • Code 層：node --check / grep 確認 selector 存在 / 對應 spec 比對
       • UI 層：呼叫 mcp__Claude_Preview__preview_screenshot 截圖
                 → 視覺判讀有沒有達標
       • Behavior 層：preview_eval / preview_console_logs 驗證互動
    3. 結果分類：
       ✓ 全 pass → 進入下一個 step
       ✗ 部分 fail → 分析根因 → 修正 → iteration += 1
       ✗ 持平 5 次 → 觸發 STOP 條件
    4. 通過後才 bump BUILD_DATE + cache-buster、commit、push
       （iteration 中失敗的版本不 commit，避免 git history 雜訊）
```

### Phase 3 — 整體驗收
所有 step 完成後：
1. preview_start 啟動 server
2. 跑 final smoke test：preview_screenshot 主畫面、所有 tab 點過
3. 對照原始 ACCEPTANCE CRITERIA 列 ✓/✗ 總表
4. 全 ✓ 才視為「滿意」

### Phase 4 — 回報摘要
- 總改動：N commits / M files
- 通過的 criteria ✓
- 未通過的（如果有）+ 建議下一步
- 提供本次 iteration 詳細 log（存到 `/tmp/goal-iterations-<timestamp>.md`）

## 中止規則（STOP 條件）— 觸發即無條件停下

任何一條觸發 → 立即停、回報使用者、不繼續：

1. **同一 step iteration 5 次仍未 pass**
2. **動到 plan 沒寫的檔案／跨大模組**（scope creep）
3. **觸碰 danger zone**：
   - `loadAll()` / `rows()` / `saveSheet()` 的核心邏輯
   - `doSaveDailySnapshot()` / `getYesterdayPriceSnap()` 的防護機制
   - `*.backup` 檔案、`design-test.html`、`.claude/` 設定
   - `SPREADSHEET_ID` / `CLIENT_ID` 等常數
4. **Google Sheets schema 變動**（新增欄位、改 column 順序）
5. **BUILD_DATE / cache-buster 規則違反**（AGENTS.md 規範）
6. **驗收條件本身產生歧義**（例如「保留還是刪除舊功能」這種要使用者拍板）
7. **任何破壞性 git 操作**：force push、reset --hard、--no-verify、改 git config

## 與 /execute-plan 的差別

| 維度 | /execute-plan | /goal |
|---|---|---|
| 每步驟暫停 | ✓ 必停 | ✗ 自動跑（除非 STOP 觸發）|
| 驗收方式 | 使用者目視 | 自我驗收（截圖 + criteria 比對）|
| iteration | 1 次／step | 最多 5 次／step |
| 中途互動 | 頻繁 | 只在卡住／歧義時 |
| 適合 | 多功能獨立 step | 視覺迭代、tweak |

## 規則繼承（強制遵守，與 AGENTS.md 同步）

- 通過驗收的 commit 才 bump `BUILD_DATE`（用實際系統時間，**禁止編造**）
- `index.html` 三個 cache-buster 必須同步更新到同一個時間戳
- commit + push 直接到 main，不需等使用者確認（per user memory）
- 用繁體中文寫 commit message、code comment、UI string
- 時區永遠用 UTC+8 (`TZ='Asia/Taipei' date`)

## 使用範例

```
/goal /tmp/dwz-v1.1-plan.md
```
或：
```
/goal 把 DWZ 頁面參數欄改成可摺疊群組，預設只展開「時間軸+報酬通膨+生活支出」，
其他兩段預設折疊，狀態存 localStorage。驗收：(1) 桌機看到摺疊箭頭可點 
(2) reload 後狀態保留 (3) 三個 KPI pill 仍正常顯示
```

## 結束時你會得到

- 一系列 commits 在 main 上（每 step 一個、都已驗收）
- 完整的 iteration log（含每次失敗原因、修正方式）
- 通過的 criteria 表 + 任何待補項目
- 可在手機直接刷新看到結果（每 commit 都 push 過）
