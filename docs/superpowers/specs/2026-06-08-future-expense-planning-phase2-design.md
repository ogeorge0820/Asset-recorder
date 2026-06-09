# 未來支出規劃 Phase 2 — 設計文件

**日期：** 2026-06-08
**狀態：** 已核准，待實作
**作者：** George + Claude（brainstorming session，承接 Phase 1）
**前置：** `docs/superpowers/specs/2026-06-08-future-expense-planning-design.md` (Phase 1)

---

## 背景

Phase 1 MVP 已上線：月固定支出規劃 + 自動活化 + DWZ 整合 + per-item toggle。實際使用後遇到兩個型態無法表達的需求：

1. **一次性大筆支出** — 例「3 年後買車 200 萬」、「2 年後裝潢 80 萬」 — 不是月經常性、發生一次就結束
2. **有結束日的月固定** — 例「5 年租約」、「1 年訂閱」 — 有明確終止月份

兩者皆會影響 DWZ 財務存活模擬與年度支出曲線，需要列入規劃。

---

## 解決方案總覽

1. **Schema 擴充**（向後相容）：`expense_planned` 加 `kind` + `end_date`；`expense_budget` 加 `end_date`
2. **行為分支**：依 kind/end_date 決定活化與結束時的行為
3. **UI 擴充**：Modal 加類型 select；列表分型態顯示；新增過期 reminder banner
4. **DWZ 整合**：onetime 透過擴充 `_allDWZExpenses` 自動納入；monthly 加 end_date 上限

---

## 範圍切割

### ✅ Phase 2 In Scope（本次實作）

| 模組 | 內容 |
|---|---|
| 資料層 | `expense_planned` schema 加 2 欄；`expense_budget` 加 1 欄；HEADERS / loadAll 範圍同步調整 |
| UI Modal | 「類型」select 控制條件式欄位顯示；月固定可選結束月、一次性隱藏類別與結束月 |
| 列表顯示 | Monthly / Monthly+end / Onetime 未到 / Onetime 已發生 — 四種顯示分支 |
| 自動活化 | Monthly w/ end_date 活化時帶 end_date 進 expense_budget；onetime 不活化 |
| 過期提示 | 啟動時掃 expense_budget 找 `r[4] < todayYM`，顯示 banner 提醒手動刪除 |
| DWZ 整合 | `extraPlannedAnnualAtAge` 加 kind/end_date 過濾；`_allDWZExpenses` 擴充包含 onetime |

### ❌ Phase 3 留待後續

- 取代既有項目（replaces_id 邏輯 — 新房租取代舊房租，活化時舊項目同步下架）
- 時間軸視覺化（horizontal timeline 或 stepped chart）
- 過期項目自動 hide / 移除（目前需手動）
- Onetime 已發生 自動扣現金帳戶（George 明確不要：用信用卡 / 推遲 / 變更 計畫易導致不同步）
- 已發生的 onetime 自動 archive 到別張表（保留在 planned 即可，使用者要清自己刪）

---

## 資料模型

### `expense_planned`（7 → 9 欄）

| 欄位索引 | 欄位名稱 | Phase | 說明 |
|---|---|---|---|
| 0 | `id` | 1 | 唯一識別碼 `'p_' + Date.now()` |
| 1 | `item_name` | 1 | 項目名稱 |
| 2 | `amount` | 1 | 金額（台幣）|
| 3 | `category` | 1 | `'固定'` / `'浮動'`（onetime 仍寫入但不影響 budget；UI 對 onetime 不顯示）|
| 4 | `payment_source` | 1 | 扣款帳戶 |
| 5 | `start_date` | 1 | `YYYY-MM` 開始月 / onetime 為發生月 |
| 6 | `notes` | 1 | 備註 |
| **7** | **`kind`** | **2 新** | `'monthly'`（default）/ `'onetime'`。空字串視為 `'monthly'`（Phase 1 既有 row 向後相容）|
| **8** | **`end_date`** | **2 新** | `YYYY-MM` / 空字串=無結束。僅 `kind='monthly'` 使用 |

**SCHEMAS 宣告**（`app.js:154`）：
```js
expense_planned: ['id','item_name','amount','category','payment_source','start_date','notes','kind','end_date'],
```

**`loadAll()` range 調整**：`expense_planned!A:G` → `expense_planned!A:I`

### `expense_budget`（4 → 5 欄）

| 欄位索引 | 欄位名稱 | Phase | 說明 |
|---|---|---|---|
| 0 | `category` | 1 | |
| 1 | `item_name` | 1 | |
| 2 | `amount` | 1 | |
| 3 | `payment_source` | 1 | |
| **4** | **`end_date`** | **2 新** | `YYYY-MM` / 空字串。僅來自 planned 自動活化且帶 end_date 的項目會寫入 |

**SCHEMAS 宣告**（`app.js:153`）：
```js
expense_budget: ['category','item_name','amount','payment_source','end_date'],
```

**`loadAll()` range 調整**：`expense_budget!A:D` → `expense_budget!A:E`

**`addBudgetItem` 仍寫 4 欄**：手動新增的不需要 end_date，Sheets 第 5 欄留空 = 無結束日，行為正確。

---

## 行為矩陣

| 類型 | 活化（start_date 到）| 結束（end_date 到）|
|---|---|---|
| **Monthly 無 end_date** | 自動活化進 expense_budget（Phase 1 行為）| N/A — 永久 |
| **Monthly 有 end_date** | 自動活化進 expense_budget **帶 end_date 進去** | 顯示 reminder banner，使用者手動 ✕ 刪除 |
| **Onetime** | **不活化** — 永久留在 planned，UI 標記「已發生」灰色 | N/A |

### 活化邏輯擴充

`_checkAndActivatePlanned()` 修改：

```js
// 1. 找出到期且 kind === 'monthly' 的項目（onetime 不活化）
const due = S.data.expense_planned.filter(r => {
  const kind = r[7] || 'monthly';
  return kind === 'monthly' && (r[5] || '') <= todayYM;
});

// 2. 寫進 expense_budget，第 5 欄帶 end_date
due.forEach(([id, name, amount, cat, source, start, notes, kind, end_date]) => {
  S.data.expense_budget.push([cat, name, amount, source, end_date || '']);
});

// 3. 從 expense_planned 移除已活化項目（同 Phase 1）
S.data.expense_planned = S.data.expense_planned.filter(r => {
  const kind = r[7] || 'monthly';
  if (kind !== 'monthly') return true; // onetime 永遠保留
  return (r[5] || '') > todayYM; // 未到期 monthly 保留
});

// 後續 save + toast 不變
```

---

## UI 結構

### Modal — 新增 / 編輯未來支出

加入「類型」select 作為**第一個欄位**（影響後續欄位顯隱）：

```
新增未來支出
├─ 類型           [月固定 ▾]                  type: select [月固定, 一次性]
├─ 項目名稱       [新房租]                    text
├─ 金額 (TWD)     [25000]                     number
├─ 類別           [固定 ▾]   ← 一次性時隱藏    select [固定, 浮動]
├─ 扣款帳戶（選填） [玉山活存]                text, opt
├─ 開始月份       [2029-06]                   month
├─ 結束月份（選填） [2034-05]  ← 一次性時隱藏  month, opt
├─ 備註（選填）   [搬到台北市區後]            text, opt
└─                       [取消] [儲存]
```

**條件式欄位顯隱**：
- `type === 'monthly'`（default）：顯示「類別」+「結束月份（選填）」
- `type === 'onetime'`：隱藏「類別」+「結束月份」

**Modal 條件邏輯**：`openModal` 沿用 Phase 1 + 加入 `hideWhen` 字段或在 onChange 後動態 toggle。具體實作 writing-plans 階段細化。

**驗證規則**：

| 欄位 | 規則 | 違反 |
|---|---|---|
| 項目名稱 | 必填、非空白 | 標紅、不送出（既有）|
| 金額 | > 0 | 同 Phase 1 |
| 開始月份 | 必填、> 當月 | 同 Phase 1 |
| 結束月份 | 選填；填了必須 > 開始月份 | 顯示「結束月需晚於開始月」|
| 類別 | 月固定必填、一次性忽略 | select 強制 |

### 列表顯示分支

```
未來規劃 (4)                                       +25,500/月
┌─────────────────────────────────────────────────────────┐
│ 新房租                                         25,000  │
│ 固定 · 玉山活存                                        │
│ 2029/06 起 · 3年後                          [✏] [✕]    │
├─────────────────────────────────────────────────────────┤
│ Netflix                                         500   │
│ 浮動                                                  │
│ 2026/09 起 · 至 2027/08                     [✏] [✕]    │
├─────────────────────────────────────────────────────────┤
│ 換車                                       2,000,000  │
│ 一次性                                                │
│ 於 2029/06 · 3年後                          [✏] [✕]    │
├─────────────────────────────────────────────────────────┤
│ 日本旅遊（已發生）                            300,000  │  ← 灰色
│ 一次性                                                │
│ 於 2025/12 · 已發生                         [✏] [✕]    │
└─────────────────────────────────────────────────────────┘
```

**規則**：
- Monthly 無 end_date：`2029/06 起 · X年Y個月後`（同 Phase 1）
- Monthly 有 end_date：`2029/06 起 · 至 2034/05`（相對時間省略，因為已有區間）
- Onetime 未到：`於 2029/06 · X年Y個月後`（"於" 取代 "起"，強調是事件）
- Onetime 已發生：灰色（opacity 0.55），`於 2025/12 · 已發生`

**`+/月` 標頭預告**：只統計 monthly（包含含 end_date 的，但不再扣除已過期的 — 因為過期 monthly 已被活化進 expense_budget）。Onetime 不算進 `+X/月`。

### 過期提示 Banner（新增）

**位置**：總覽頁、Hero banner（資產總額）之後、各 hero-block 之前。完整一條，全寬。

**Mockup**：
```
┌─────────────────────────────────────────────────────────┐
│ ⚠ 2 筆固定支出已過結束日，建議移除：                  │
│   房租、Netflix                          [前往編輯 →]   │
└─────────────────────────────────────────────────────────┘
```

- 樣式：類似 toast 但常駐顯示（直到用戶處理或關閉）
- 點「前往編輯」→ 滾到「生活支出預算」+ 自動展開該分類
- 也提供 ✕ 關閉（僅關閉 banner、不刪除資料；下次啟動仍顯示）

**觸發**：`initApp` 載入完成後、`_checkAndActivatePlanned` 之後執行 `_checkExpiredBudgetItems()`：

```js
function _checkExpiredBudgetItems() {
  const todayYM = _todayYM();
  const expired = (S.data.expense_budget || [])
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => {
      const endDate = r[4] || '';
      return endDate && endDate < todayYM;
    });
  
  if (!expired.length) {
    const banner = $('budget-expired-banner');
    if (banner) banner.style.display = 'none';
    return;
  }
  
  // 渲染 banner
  _renderExpiredBanner(expired);
}
```

---

## DWZ 整合

### 1. Monthly w/ end_date 未活化 — DWZ 時間上限

`extraPlannedAnnualAtAge` 加 `kind` 過濾 + `endAtAge` 上限：

```js
const plannedActivations = (S.data.expense_planned || [])
  .filter(r => (r[7] || 'monthly') === 'monthly')
  .filter(r => !_ignoredPlanned.has(r[0]))
  .map(r => {
    const startYear = parseInt(String(r[5] || '').slice(0, 4)) || 9999;
    const endYear = r[8] ? (parseInt(String(r[8] || '').slice(0, 4)) || null) : null;
    return {
      activeAtAge: currentAge + (startYear - currentYear),
      endAtAge: endYear !== null ? currentAge + (endYear - currentYear) : null,
      annualAmount: (parseFloat(r[2]) || 0) * 12,
    };
  }).filter(p => p.annualAmount > 0);

const extraPlannedAnnualAtAge = (age) => plannedActivations
  .filter(p => age >= p.activeAtAge && (p.endAtAge === null || age <= p.endAtAge))
  .reduce((s, p) => s + p.annualAmount, 0);
```

### 2. Onetime — 透過 `_allDWZExpenses` 擴充

`_allDWZExpenses()` 目前僅返回 bucket_list 項目。擴充加入 onetime planned items：

```js
function _allDWZExpenses() {
  const bucketItems = _activeBucketItems().filter(b => !b.paid);
  
  // Phase 2: 一次性未來規劃納入 DWZ（在 start_year 那年一次扣）
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const currentYear = now.getUTCFullYear();
  const currentAge = _dwzParam('dwz-age');
  const ignoredPlanned = _getDwzPlannedIgnored();
  const onetimeItems = (S.data.expense_planned || [])
    .filter(r => (r[7] || 'monthly') === 'onetime' && !ignoredPlanned.has(r[0]))
    .map(r => {
      const startYear = parseInt(String(r[5] || '').slice(0, 4)) || 9999;
      return {
        age: currentAge + (startYear - currentYear),
        amount: (parseFloat(r[2]) || 0) / 10000, // 元 → 萬（_allDWZExpenses 慣例為萬）
        name: r[1] || '',
        paid: false,
        // 其餘 bucket-style 欄位視 _activeBucketItems 慣例補
      };
    });
  
  return [...bucketItems, ...onetimeItems];
}
```

### 3. simulateMonthly — 同樣加 kind 過濾 + end_date 上限

```js
const sortedPlanned = [...(S.data.expense_planned || [])]
  .filter(r => (r[7] || 'monthly') === 'monthly')
  .filter(r => !_ignored.has(r[0]))
  .sort((a, b) => (a[5] || '').localeCompare(b[5] || ''));

const budgetAtYM = (ym) => {
  let total = monthlyBudget;
  for (const r of sortedPlanned) {
    const start = r[5] || '';
    const end = r[8] || '';
    if (start <= ym && (!end || end >= ym)) total += parseFloat(r[2]) || 0;
  }
  return total;
};
```

⚠ 不能用 `else break` — 因為 sorted by start_date 但 end_date 可能不同。需逐項判斷區間。

### 4. DWZ tab 「未來支出規劃」區塊（Phase 1 加的）— 列表顯示 kind

`_renderDwzPlannedList` 加 kind 分支顯示，monthly 顯示「N歲(YYYY)起 +Y/年」+ 結束資訊，onetime 顯示「N歲(YYYY) 一次 +Y萬」。Counter 顯示「啟用 N/M」不變。

---

## 過期提示 Banner — 互動細節

- **顯示位置**：總覽頁 `<aside>`-mode hero banner 區塊**之後**，hero block grid 之前
- **HTML 容器**：`<div id="budget-expired-banner" class="expired-banner" style="display:none"></div>`
- **行為**：
  - 「前往編輯」按鈕：`window.location.hash = '#hb-budget'` + 觸發該分類展開
  - ✕ 關閉：`this.parentElement.style.display = 'none'`（僅當次 session 隱藏；下次 reload 又出現）
  - 不提供「忽略此項」localStorage 設定 — 設計意圖是促使用戶處理

---

## 邊界 / 已知限制

### MVP 暫不處理

1. **過期 monthly 在 calcBudgetTotal 仍計算** — DWZ 模擬會略為高估月支出，直到用戶手動刪除。Reminder banner 催使用戶處理。理由：避免「畫面顯示有此項、總額卻不含此項」的不一致。
2. **onetime 已發生狀態無 paid flag** — 不像 bucket_list 有 `.paid` 區分。UI 純以 `start_date <= today` 判定為「已發生」。若用戶想標記「實際上沒花到 / 取消」，要手動刪除該 planned row。
3. **Modal 條件式欄位顯隱依賴 onChange 觸發 re-render**：`openModal` 需擴充支持 hideWhen 或 callback。具體做法 writing-plans 階段細化。

### 邊界 case

| Case | 處理 |
|---|---|
| Monthly w/ end_date 的 end_date < start_date | UI 驗證拒絕（顯示「結束月需晚於開始月」）|
| Onetime 的 start_date 設為過去 | 允許（與 monthly 不同；onetime 表示「歷史發生過」也合理；同 bucket_list 慣例）|
| Phase 1 既有 row 沒 kind 欄 | 視為 `'monthly'`（向後相容）|
| Phase 1 既有 row 沒 end_date 欄 | 視為無結束日（向後相容）|

---

## 與既有 skill 的關係

- 實作前：複習 `pwa-danger-zones`（特別是動 expense_budget schema 要小心 — 雖然 expense_budget 本身不在禁區，但加欄位影響整個資料生態）
- UI bug：套用 `visual-vs-data-divergence` 診斷順序
- commit 前：必跑 `bump-build-version` skill

---

## 部署清單

1. 程式碼變動：`app.js`、`index.html`、`style.css`
2. Google Sheets：**不需手動建表**（HEADERS bump + initSheets 已存在的 sheet 不會強制改 schema，但讀取範圍擴大會抓到新欄位；新欄位為空 = 預設行為）
3. BUILD_DATE / cache-buster：bump
4. commit message：依專案慣例
5. push 後手機驗證
