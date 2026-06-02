---
name: pwa-danger-zones
description: Before editing, refactoring, moving, splitting, or "cleaning up" code in George's 資產追蹤 PWA at /Users/george/VS Code/My Project/, consult this skill to identify the untouchable functions, files, and architectural decisions. INVOKE THIS whenever the user asks for refactoring, code cleanup, dead-code removal, file splitting, "整理一下", "重構", "拆檔", "移除", "簡化結構", or any sweeping multi-area change in this repo. Also invoke when about to delete a function/file or rename anything used by the Google Sheets sync layer. Skipping this check has historically caused data loss in George's actual asset tracking — these zones exist for hard-earned reasons.
---

# pwa-danger-zones

George 的「資產追蹤」是真實在跑、記錄真實資產的 PWA — 不是 demo、不是 toy project。某些區域的 bug 會直接導致他的歷史資產紀錄丟失或錯亂。這個 skill 列出**不能動 / 動了要極度小心**的禁區，讓我在每次重構/清理/搬動程式碼前先檢查一次。

## 為什麼這份清單存在

每一條都是過去踩過的坑。看起來是「冗餘 / 可以簡化」的程式碼，其實是用真實事故換來的防護欄。在你看不出某段 code 為什麼存在時 — **默認它有理由**，去問，不要動。

## 🔴 不可碰的函式（資料層）

| 函式 | 在哪 | 為什麼不能碰 |
|---|---|---|
| `loadAll()` / `rows()` / `saveSheet()` | `app.js` 資料同步層 | Google Sheets 讀寫的唯一入口 — 改了會直接影響歷史資料完整性 |
| `doSaveDailySnapshot()` | `app.js` | 每日 snapshot 寫入 — 漏寫一天歷史就斷一天，且不可回填 |
| `getYesterdayPriceSnap()` | `app.js` | 跨日比對的核心邏輯，guard 條件很細，移除任一條都可能算錯損益 |

**規則**：這些函式內若有看起來「冗餘」的 if / try / fallback / guard，**不可刪**。要動就先在這對話裡跟 George 確認。

## 🔴 不可動的檔案

| 檔案 / 路徑 | 為什麼 |
|---|---|
| `*.backup` | 緊急回滾用的歷史快照，不是冗餘檔 |
| `design-test.html` | UI 實驗沙箱，George 私人用，不要去調樣式或刪掉 |
| `.claude/settings.json`、`settings.local.json`、`launch.json`、`commands/` | 工具鏈設定，不可修改（但 `.claude/skills/` 是這個 skill 自己住的地方，可以加新 skill）|
| `SPREADSHEET_ID`、`CLIENT_ID` 常數 | 接到真實 Google Sheet，亂改 → 寫不進去或寫錯人 |

## 🔴 不可改的架構決策

**單檔 6000+ 行的 `app.js` 是刻意的，不要拆檔。**

我（之前的 Claude）很容易想說「這檔太大了，幫你拆成 modules 吧」— 不要這樣做。George 的部署流程是手機端直接從 GitHub Pages 抓單檔 → 拆檔會破壞 cache-buster 策略、增加部署複雜度、且這專案沒有 build step（沒有 bundler）。

「太大」是已知狀態、刻意決策，不是 tech debt。

## ✅ 安全操作模式

碰禁區函式的任何修改之前，做這 4 步：

1. **`grep` 確認影響範圍**
   ```bash
   grep -n "<函式名>" "/Users/george/VS Code/My Project/app.js" | head
   ```
   先看這函式在哪幾個地方被呼叫，再評估改動的擴散面。

2. **提出最小改動 diff，先 show George 看**
   不要直接 Edit 完才講。先用文字（或 diff 片段）描述「我想改什麼、為什麼、可能影響什麼」，等他點頭再動手。

3. **保留所有看不出用途的 guard**
   `if (!x) return;`、`try {} catch {}`、看起來重複的 null check — 全部保留。它們很可能是過去某次 production bug 留下的圍欄。

4. **不確定就問**
   「這段我看不出為什麼存在，要動之前想跟你確認一下」比「我覺得可以簡化所以刪了」好太多。

## 自我檢查清單

在你執行 Edit/Write 之前，問自己這幾題：

- [ ] 改動是否觸碰上面表格中的任何函式？ → 是 → 先 grep + 確認
- [ ] 是否在動 `*.backup`、`design-test.html`、`.claude/settings*` 等？ → 是 → 停手，這些不該被改
- [ ] 是否在「為 George 的程式碼瘦身」？ → 是 → 停手，先問他要不要瘦
- [ ] 是否要建立新檔來分擔 `app.js` 的內容？ → 是 → 停手，單檔是刻意的
- [ ] 我是否能用一句話解釋「為什麼這個改動是安全的」？ → 不能 → 先想清楚再動

## 與其他 skills 的關係

- 改完之後，commit 前用 `bump-build-version` 同步 BUILD_DATE 與 cache-buster
- 若改動牽涉 UI 視覺問題，搭配 `visual-vs-data-divergence` 的診斷流程
