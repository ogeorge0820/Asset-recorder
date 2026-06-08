# 未來支出規劃 (Future Expense Planning) — 設計文件

**日期：** 2026-06-08
**狀態：** 已核准，待實作（Phase 1 MVP）
**作者：** George + Claude（brainstorming session）

---

## 背景與動機

個人資產追蹤 PWA 目前的「生活支出預算」(`expense_budget`) 只反映「現在」每月固定/浮動支出，無法預先記錄已知會發生的未來支出（例：3 年後換房子要開始付房租）。

缺少這個功能會造成兩個問題：
1. **DWZ 財務存活模擬不準確** — 模擬器假設每月支出恆定，無法呈現「3 年後支出階梯上升」對存活月數的真實衝擊
2. **重要規劃只能存腦袋裡** — 未來支出規劃散在腦中或 Notes，APP 內無法集中管理

本功能新增「未來支出規劃」區塊，讓使用者記錄已知會在某個月開始的支出，並在 DWZ 模擬中正確呈現階梯式變化。日期到了之後自動活化成正式支出，不需手動操作。

---

## 解決方案總覽

三件事：
1. **新增規劃** — UI 在「生活支出預算」hero card 內折疊區塊，新增 / 編輯 / 刪除未來月固定支出
2. **DWZ 整合** — 模擬器逐月查表，從 `start_date` 那個月起把該筆支出算進每月扣款
3. **自動活化** — APP 開啟時檢查是否有到期項目，自動寫進 `expense_budget`，顯示 toast 通知

---

## 範圍切割（Phased Delivery）

本文件僅規範 **Phase 1 MVP**。Phase 2/3 為未來工作，待 MVP 上線驗證後再規劃。

### ✅ Phase 1 In Scope（本次實作）

| 模組 | 內容 |
|---|---|
| 資料層 | 新增 Google Sheets 工作表 `expense_planned`（7 欄）|
| Code 層 | `SCHEMAS` / `S.data` / `loadAll` / `rows` / `_track` 整合 |
| UI | hero card 內折疊區塊「未來規劃 (N)」+ `+NT$XX,XXX/月` 預告 |
| 操作 | 新增 / 編輯 / 刪除 + modal `type: 'month'` 新欄位類型 |
| 模擬 | `simulateMonthly()` 內部升級成 `budgetAtYM(ym)` 逐月查表 |
| 活化 | `_checkAndActivatePlanned()` 於 `initApp` 中執行 + toast |

### ❌ Phase 2（之後做，本次不碰）

- 一次性支出（kind='onetime'，如：3 年後買車 200 萬一筆扣）
- 結束日期（end_date 欄位 — 月固定支出可設「付到 2032/12」）
- DWZ tab 加 toggle「包含 / 排除未來規劃」

### ❌ Phase 3（之後做）

- 取代既有項目（replaces_id 邏輯 — 新房租取代舊房租，活化時舊項目同步下架）
- 時間軸視覺化（horizontal timeline 或 stepped chart）

---

## 資料模型

### Google Sheets 工作表 `expense_planned`（7 欄）

| 欄位索引 | 欄位名稱 | 說明 |
|---|---|---|
| 0 | `id` | 唯一識別碼（`'p_' + Date.now()` 字串），Phase 3「取代」邏輯預留 |
| 1 | `item_name` | 項目名稱（例：「新房租」） |
| 2 | `amount` | 金額（台幣整數，跟 `expense_budget` 同單位）|
| 3 | `category` | `'固定'` 或 `'浮動'`（跟 `expense_budget` 同類別系統）|
| 4 | `payment_source` | 扣款帳戶名稱（選填，跟 `expense_budget` 一致）|
| 5 | `start_date` | 開始月份（`YYYY-MM` 格式，月精度即可） |
| 6 | `notes` | 備註（選填） |

### `SCHEMAS` 宣告（約 `app.js:153`）

```js
expense_planned: ['id','item_name','amount','category','payment_source','start_date','notes'],
```

### `S.data` 初始（約 `app.js:186`）

```js
expense_planned: [],
```

### `loadAll()` 整合（約 `app.js:528`）

新增一行 `sheetGet`：
```js
sheetGet('expense_planned!A:G'),
```

並對應地在 `rows()` 解析後 `_track('expense_planned', ...)`。

### Sheet 不存在的優雅降級

`expense_planned` 工作表**不要求 George 手動建立**。`loadAll()` 抓不到此 sheet 時，視為空陣列（try/catch fallback）。使用者第一次新增項目並儲存時，Google Sheets API 會自動建立此 tab。

---

## UI 結構

### 位置：總覽頁「生活支出預算」hero card 展開後

維持現有「固定/浮動 + 比例條 + 新增按鈕」結構不動，**底部追加**一個同階折疊區塊：

```
┌─ 生活支出預算 hero card ────────────────────┐
│ (top, 常駐)                                  │
│  生活支出預算 / MONTHLY BUDGET               │
│  8 項                            NT$XX,XXX  │
│  月支出總額                                  │
├──────────────────────────────────────────────┤
│ (展開後)                                      │
│  ▓▓▓▓▓▓▓░░  固定 70% · 浮動 30%             │
│                                              │
│  ▾ 固定支出 (3)                  NT$XX,XXX  │
│  ▾ 浮動支出 (5)                  NT$XX,XXX  │
│  + 新增支出項目                              │
│                                              │
│  ─────────────────────────────────────       │
│  ▾ 未來規劃 (2)               +NT$26,500/月  │
│  ┌────────────────────────────────────────┐ │
│  │ 新房租               NT$25,000        │ │
│  │ 固定 · 玉山活存                       │ │
│  │ 2029/06 起（3年後）   [✏] [✕]         │ │
│  ├────────────────────────────────────────┤ │
│  │ 健身房                NT$1,500        │ │
│  │ 浮動                                  │ │
│  │ 2026/09 起（4個月後）  [✏] [✕]        │ │
│  └────────────────────────────────────────┘ │
│  + 新增未來支出                              │
└──────────────────────────────────────────────┘
```

### 設計準則

| 元素 | 規則 |
|---|---|
| Hero card 頂部 `8 項 NT$XX,XXX` | **不含**未來規劃。「月支出總額」保持「現在每月實際支出」語意 |
| 區塊標頭 `未來規劃 (2)` 右側 `+NT$26,500/月` | 預告所有未來項目活化後月支出會增加的總額 |
| 每項日期欄 `2029/06 起（3年後）` | 顯示絕對日期 + 相對時間（一眼看出距離）|
| 排序 | 按 `start_date` 由近到遠 |
| 空狀態 | 顯示「+ 新增未來支出」單一按鈕，不顯空清單 |
| 過去日期項目 | 不應出現（自動活化會清除）。若異常出現，顯示紅字「待活化」 |
| Emoji | **不使用**。沿用既有 codebase 無 emoji 慣例 |

### HTML 容器

在 `index.html` 的 `#hb-budget` 區塊內、`budget-add-btn`（「+ 新增支出項目」按鈕）**之後**，加：

```html
<div class="budget-planned-section" id="budget-planned-section">
  <!-- 由 renderPlannedSection() 動態填入 -->
</div>
```

實際 selector / class 名稱在 writing-plans 階段細化。

---

## 互動 — 新增 / 編輯 / 刪除

### Modal 結構

沿用既有 `openModal(title, fields, onSubmit)` helper：

```
新增未來支出
├─ 項目名稱       [新房租                 ]   type: text
├─ 金額 (TWD)     [25000                  ]   type: number
├─ 類別           [固定 ▾]                    type: select [固定, 浮動]
├─ 扣款帳戶（選填） [玉山活存              ]   type: text, opt
├─ 開始日期       [2029-06                ]   type: month  ← 新增
├─ 備註（選填）   [搬到台北市區後          ]   type: text, opt
└─                       [取消] [儲存]
```

### `openModal()` 擴充

新增 `'month'` 類型，渲染為 `<input type="month">`。最小改動：modal helper 內 type switch 加一個 case。

### 驗證規則（在 onSubmit 內）

| 欄位 | 規則 | 違反時 |
|---|---|---|
| `item_name` | 必填、非空白 | 不關閉 modal，顯示錯誤訊息 |
| `amount` | > 0 | 同上 |
| `start_date` | 必填，必須為**未來月份**（> 當月）| 顯示「過去日期不能規劃，請選擇未來月份」 |
| `category` | 必為 `'固定'` 或 `'浮動'` | select 強制限定 |

### 函式骨架

```js
function addPlannedExpense() {
  openModal('新增未來支出', [...], async (vals) => {
    const id = 'p_' + Date.now();
    S.data.expense_planned.push([id, vals.name, String(vals.amount), vals.cat, vals.source || '', vals.start_date, vals.notes || '']);
    await saveSheet('expense_planned', S.data.expense_planned);
    renderBudget(); // 內含 renderPlannedSection
    renderKPIs();
    showToast(`已新增未來支出（${vals.start_date} 起）`, 'ok');
  });
}

function editPlannedExpense(idx) { /* 同上但預填值 + replace */ }
function deletePlannedExpense(idx) { /* openConfirm → splice → saveSheet → render */ }

function renderPlannedSection() {
  // 排序 S.data.expense_planned by start_date
  // 計算 +NT$XX,XXX/月（活化後月增加總額）
  // 渲染折疊區塊 HTML 至 #budget-planned-section
}
```

### renderBudget() 整合

`renderBudget()` 末尾呼叫 `renderPlannedSection()` 一行即可，主流程不變。

---

## DWZ 模擬整合

### 現況

`simulateMonthly(monthlyBudget)`（`app.js:936`）把 `monthlyBudget` 當常數，每月固定扣相同金額。

### 修改

在 `simulateMonthly()` **內部**新增「逐月查表」，仿照既有 `incomeByYM` / `expByYM` 模式：

```js
// 內部新增（位置：函式頂部、迴圈前）
const baseBudget = monthlyBudget;
const sortedPlanned = [...(S.data.expense_planned || [])]
  .sort((a, b) => (a[5] || '').localeCompare(b[5] || ''));

// budgetAtYM: 第 ym 月時，effective budget = base + 所有 start_date <= ym 的 planned 加總
const budgetAtYM = (ym) => {
  let total = baseBudget;
  for (const r of sortedPlanned) {
    if ((r[5] || '') <= ym) total += parseFloat(r[2]) || 0;
    else break; // sorted，後面更晚的不會再加
  }
  return total;
};

// 迴圈內：把 monthlyBudget 替換成 budgetAtYM(ym)
const netChange = (incomeByYM.get(ym) || 0) - budgetAtYM(ym) - (expByYM.get(ym) || 0);
```

### Caller 影響

`simulateMonthly()` signature **不變**（caller 不用改）。其他叫到此函式的位置（`app.js:1146-1156` 等）全部維持原樣，自然受益於新邏輯。

### UX 結果

DWZ 折線在 `start_date` 那個月**斜率變陡**，視覺化呈現「未來支出對財務存活的衝擊」— 這正是 George 想看到的關鍵資訊。

---

## 自動活化機制

### 時機

`initApp()` 內、`loadAll()` 完成之後、第一次 `renderAll()` **之前**。確保使用者第一眼看到的就是活化後狀態。

### 演算法

```js
async function _checkAndActivatePlanned() {
  // 1. 取台北時區當月 YYYY-MM
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const todayYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  // 2. 找出到期項目（start_date <= 當月）
  const due = (S.data.expense_planned || []).filter(r => (r[5] || '') <= todayYM);
  if (!due.length) return;

  // 3. 寫進 expense_budget（追加，不覆寫既有）
  due.forEach(([id, name, amount, cat, source, start, notes]) => {
    S.data.expense_budget.push([cat, name, amount, source]);
  });

  // 4. 從 expense_planned 移除已活化項目
  S.data.expense_planned = S.data.expense_planned.filter(r => (r[5] || '') > todayYM);

  // 5. 兩張表都存（順序：先 budget 後 planned）
  try {
    await saveSheet('expense_budget', S.data.expense_budget);
    await saveSheet('expense_planned', S.data.expense_planned);
  } catch (e) {
    console.error('[planned activate] save failed:', e);
    showToast('未來規劃自動活化儲存失敗，請手動檢查', 'err');
    return;
  }

  // 6. Toast 通知（停留 6 秒，比一般 toast 長）
  const names = due.map(r => `${r[1]} (NT$${fmt(parseFloat(r[2]) || 0)})`).join('、');
  showToast(`已啟用 ${due.length} 筆未來規劃：${names}`, 'ok', 6000);
}
```

### 不問直接寫的理由

選用「自動寫入 + toast 通知」而非「彈確認框」，因為：
- 確認框會中斷 APP 開啟流程（畫面卡住等使用者）
- 用戶當初就是設定「這個日期到了要開始算」，到了就照做，符合預期
- Toast 仍然可見，使用者能立即看到「啊原來多了這筆」
- 不爽可以立刻去主預算清單編輯/刪除

### 風險與防護

| 風險 | 防護 |
|---|---|
| 兩次 saveSheet 中間斷網 | budget 已存、planned 沒清 → 下次重複活化 → 用戶看到重複項手動刪除（可接受的失敗模式）|
| 同月有 5 筆要活化 | 全部一次活化、toast 列名稱（清單長但比靜默漏掉好）|
| 用戶設過去日期 | UI 端攔截。資料層繞過時，活化邏輯一樣處理（`<= todayYM` 條件）|
| `expense_planned` sheet 不存在 | `loadAll` try/catch fallback 視為空陣列 |
| 離線狀態活化 | save 失敗 → err toast → 下次連線時 `_checkAndActivatePlanned` 重新跑 |
| `S.data` 與 sheet 不同步（極端 race） | sheet 是真實來源，下次 `loadAll` 自動修正 |

### 冪等性

`_checkAndActivatePlanned()` 在同一個 session 內重複呼叫無害：
- 第一次：找到 N 筆 due，活化後 `S.data.expense_planned` 已過濾掉這些
- 第二次：filter 結果為空陣列，提前 return

---

## 邊界 / 開放問題

### 已決定的細節
- 單位：`amount` 用元（同 `expense_budget`），不用萬
- 日期精度：`YYYY-MM`（月），不到日
- 類別系統：沿用「固定 / 浮動」二分，不擴充
- Emoji：不使用
- 月支出總額：不含未來規劃

### 待 writing-plans 階段細化
- `openModal` 加 `'month'` 類型的具體實作位置
- `budget-planned-section` 的具體 CSS class 與 HTML 結構
- `+NT$XX,XXX/月` 預告的 selector / data-binding
- 「待活化」紅字異常顯示的具體樣式
- 自動活化 toast 訊息超長時的 truncation（如 10 筆活化）

### 暫不處理（將來才考慮）
- 多人協作（單人 APP）
- Undo 活化（活化後想還原 → 手動編輯）
- 通膨調整（金額會隨時間貶值，但本 APP 不考慮通膨）

---

## 部署清單（高階）

1. 程式碼變動：`app.js`、`index.html`、`theme.css`（或 `style.css`，看 CSS 放哪裡）
2. Google Sheets：**不需手動建表**（自動 fallback）
3. BUILD_DATE / cache-buster：bump（用 `bump-build-version` skill）
4. commit message：依專案慣例（「新增：未來支出規劃 Phase 1 MVP」之類）
5. push to GitHub Pages，手機驗證

---

## 與既有 skill 的關係

- 實作時：先看 `pwa-danger-zones` skill 確認沒踩到禁區（特別是 `simulateMonthly` 修改要小心）
- 若 UI 出現「擠在一起」「跑版」：套用 `visual-vs-data-divergence` 診斷順序
- commit 前：必跑 `bump-build-version`

---

## 核准記錄

- 2026-06-08：與 George 完成 brainstorming，三個 section（資料 / UI / DWZ+活化+邊界）逐段核准
- 待 George 看完本文件後核可 → 進入 writing-plans 階段
