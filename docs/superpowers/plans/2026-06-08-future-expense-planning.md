# 未來支出規劃 Phase 1 MVP — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「資產追蹤」PWA 內新增未來支出規劃功能：用戶可預先記錄已知會在某個月開始的月固定支出，DWZ 模擬從該月起算進每月扣款；日期到了自動活化成正式支出。

**Architecture:** 新增獨立 Google Sheets 工作表 `expense_planned`（7 欄），與既有 `expense_budget` 平行存在。UI 在「生活支出預算」hero card 內加折疊區塊，沿用既有 `openModal()` + `<input type="month">`（HTML5 原生支援，無需 modal 擴充）。DWZ 端在 `simulateMonthly()` 內部升級為逐月查表，caller signature 不變。App 開啟時 `_checkAndActivatePlanned()` 檢查到期項目，自動寫進 `expense_budget` 並 toast 通知。

**Tech Stack:** vanilla JS（單檔 ~6000 行 `app.js`）、Google Sheets API、CSS Grid/Flexbox、Mobile First Tailwind-flavored CSS。無 build step、無 test framework — 驗證採人工瀏覽器測試。

**設計文件：** `docs/superpowers/specs/2026-06-08-future-expense-planning-design.md`

---

## File Structure

| 檔案 | 變動內容 | 行數估計 |
|---|---|---|
| `app.js` | + HEADERS 一行；+ S.data init 一行；+ loadAll destructure + sheetGet + rows + _track；+ 三個 CRUD 函式；+ renderPlannedSection；+ simulateMonthly 內部升級；+ _checkAndActivatePlanned；+ initApp 串接 | +180~220 |
| `index.html` | + `#budget-planned-section` 容器；bump cache-buster | +3 |
| `theme.css`（或 `style.css`）| + `.budget-planned-section`、`.budget-planned-item` 等 class | +60~80 |

---

## Task 1: 資料層整合（HEADERS + S.data + loadAll）

**目標：** Sheet schema 接通，APP 啟動時 `S.data.expense_planned` 為陣列（即使是空），且 Google Sheets 自動建立 `expense_planned` tab。

**Files:**
- Modify: `app.js:139-158` (HEADERS)
- Modify: `app.js:186` (S.data init)
- Modify: `app.js:513-578` (loadAll + rows + _track)

**不需要：** 不需要為「sheet 不存在」寫 try/catch — `initSheets()` 已會在啟動時自動建表（line 474-507）。

### Steps

- [ ] **Step 1: 在 HEADERS 新增 `expense_planned`**

在 `app.js:153`（`expense_budget` 那行）之後加：

```js
expense_planned: ['id','item_name','amount','category','payment_source','start_date','notes'],
```

- [ ] **Step 2: 在 `S.data` 初始化加新欄位**

在 `app.js:186`（`expense_budget: []` 那行）之後加：

```js
expense_planned: [], // [id, item_name, amount, category, payment_source, start_date, notes]
```

- [ ] **Step 3: 在 `loadAll()` 的 `Promise.allSettled` array 加入新 sheetGet**

修改 `app.js:514` 的 destructure 變數列表，加入 `expPlanned`。
在 `app.js:533` 之前的 sheetGet 陣列末尾加 `sheetGet('expense_planned!A:G'),`（注意在 `sheetGet('market_indicators!A:D'),` 之前或之後都可，視 destructure 順序一致即可。建議放在 `expense_budget` 之後保持邏輯相近）。

修改後示例（如插在 `expense_budget` 後）：

```js
const [cash, tw, us, crypto, snap, daily, sett, rw, hist, twHist, usHist, cashHist, otherHist, expBudget, expPlanned, expPlan, incomeRec, bucketList, indicators] = await Promise.allSettled([
  // ... 既有 sheetGet ...
  sheetGet('expense_budget!A:D'),
  sheetGet('expense_planned!A:G'),  // ← 新加
  sheetGet('experience_plan!A:E'),
  // ... 後續維持 ...
]);
```

⚠ destructure 變數順序必須與 sheetGet 陣列順序一致 — 加入 `expPlanned` 在 `expPlan`（experience_plan）之前。

- [ ] **Step 4: 加 `rows()` 解析與 `_track`**

在 `app.js` 對應 `S.data.expense_budget = rows(expBudget, 'expense_budget');` 那行（grep 找）之後，加：

```js
S.data.expense_planned = rows(expPlanned, 'expense_planned');
```

接著找到 `_track('expense_budget', ...)` 那行，之後加：

```js
_track('expense_planned', S.data.expense_planned);
```

- [ ] **Step 5: 手動驗證**

啟動 APP（瀏覽器開 `index.html`），在 console 執行：

```js
console.log(S.data.expense_planned);  // 應為 []
console.log(HEADERS.expense_planned);  // 應為陣列含 7 欄
```

打開 Google Sheets，確認 `expense_planned` tab 已自動建立、header row 有 7 欄。

- [ ] **Step 6: Commit（不 bump 版本：使用者看不到任何變化）**

```bash
git add app.js
git commit -m "新增：expense_planned 工作表與資料層整合（Phase 1 Task 1）"
git push
```

---

## Task 2: CRUD 函式 + UI 渲染 + HTML/CSS

**目標：** 使用者可以在「生活支出預算」hero card 看到「未來規劃」折疊區塊，可新增 / 編輯 / 刪除項目。

**Files:**
- Modify: `app.js` — 新增 4 個函式
- Modify: `app.js:2399` 附近 `renderBudget()` — 末尾呼叫新函式
- Modify: `index.html` — 加 HTML 容器，bump cache-buster
- Modify: `theme.css` 或 `style.css`（看 budget-* class 放哪）— 加新 class

### Steps

- [ ] **Step 1: 在 `index.html` 的 `#hb-budget` 加 HTML 容器**

找到 `index.html` 中的 `+ 新增支出項目` 按鈕（搜尋 `addBudgetItem`，約 line 376）。在該按鈕 element **之後**插入：

```html
<div class="budget-planned-wrap" id="budget-planned-section">
  <!-- 由 renderPlannedSection() 動態填入 -->
</div>
```

- [ ] **Step 2: 在 CSS（`theme.css` 或 `style.css`，先 grep 找 `.budget-cat` 在哪）加新 styles**

找到既有 `.budget-cat` / `.budget-item` 等 class 所在檔案，在那個區段之後加：

```css
/* ─── 未來支出規劃 ─── */
.budget-planned-wrap {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-color, #e5e7eb);
}

.budget-planned-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  padding: 8px 4px;
}

.budget-planned-header .chevron {
  transition: transform .2s;
}
.budget-planned-wrap.expanded .budget-planned-header .chevron {
  transform: rotate(180deg);
}

.budget-planned-title {
  font-weight: 600;
  font-size: 14px;
}

.budget-planned-title .count {
  color: var(--text-muted, #6b7280);
  font-weight: 400;
}

.budget-planned-preview {
  font-size: 13px;
  color: var(--text-muted, #6b7280);
}

.budget-planned-list {
  display: none;
  margin-top: 8px;
  flex-direction: column;
  gap: 8px;
}
.budget-planned-wrap.expanded .budget-planned-list {
  display: flex;
}

.budget-planned-item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  grid-template-rows: auto auto;
  grid-template-areas:
    "name amt actions"
    "meta meta actions";
  gap: 4px 12px;
  padding: 12px;
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 8px;
  background: var(--bg-subtle, #fafafa);
}

.budget-planned-item-name { grid-area: name; font-weight: 500; font-size: 14px; }
.budget-planned-item-amt  { grid-area: amt;  font-weight: 600; font-size: 14px; }
.budget-planned-item-meta { grid-area: meta; font-size: 12px; color: var(--text-muted, #6b7280); }
.budget-planned-item-actions {
  grid-area: actions;
  display: flex;
  gap: 4px;
  align-items: center;
}

.budget-planned-empty {
  font-size: 13px;
  color: var(--text-muted, #6b7280);
  padding: 8px 4px;
}

.budget-planned-add {
  margin-top: 8px;
  /* 沿用既有 .btn-add 樣式即可，這 class 可選 */
}
```

⚠ 如果現有 CSS 用 Tailwind utility classes 而不是 custom classes，請改用對等 utility（grep `.budget-cat` 看現有風格）。

- [ ] **Step 3: 在 `app.js` 加入 `addPlannedExpense()` 函式**

找到 `app.js:2498` 附近 `addBudgetItem()` 函式，在 `deleteBudgetItem()` 之後加：

```js
// ══════════════════════════════════════════════════════════════
// 未來支出規劃 CRUD
// ══════════════════════════════════════════════════════════════
function addPlannedExpense() {
  const todayYM = _todayYM();
  openModal('新增未來支出', [
    { id: 'name',   label: '項目名稱', type: 'text',   ph: '例：新房租、健身房' },
    { id: 'amount', label: '金額 (TWD)', type: 'number', step: '1', min: 1, ph: '0' },
    { id: 'cat',    label: '類別',    type: 'select', options: ['固定','浮動'] },
    { id: 'source', label: '扣款帳戶（選填）', type: 'text', ph: '對應流動現金帳戶名稱', opt: true },
    { id: 'start',  label: '開始月份', type: 'month',  ph: 'YYYY-MM' },
    { id: 'notes',  label: '備註（選填）', type: 'text', opt: true },
  ], async (vals) => {
    // 驗證：金額 > 0
    const amount = parseFloat(vals.amount) || 0;
    if (amount <= 0) { showToast('金額需大於 0', 'err'); return false; }
    // 驗證：start_date 必須為未來月份（> 當月）
    if (!vals.start || vals.start <= todayYM) {
      showToast('開始月份需為未來月份（不含當月）', 'err');
      return false;
    }
    const id = 'p_' + Date.now();
    S.data.expense_planned.push([id, vals.name, String(amount), vals.cat, vals.source || '', vals.start, vals.notes || '']);
    await saveSheet('expense_planned', S.data.expense_planned);
    renderBudget();
    renderKPIs();
    showToast(`已新增未來支出（${vals.start} 起）`, 'ok');
  });
}

function editPlannedExpense(idx) {
  const r = S.data.expense_planned[idx];
  if (!r) return;
  const todayYM = _todayYM();
  openModal('編輯未來支出', [
    { id: 'name',   label: '項目名稱', type: 'text',   val: r[1] || '' },
    { id: 'amount', label: '金額 (TWD)', type: 'number', step: '1', min: 1, val: r[2] || '0' },
    { id: 'cat',    label: '類別',    type: 'select', options: ['固定','浮動'], val: r[3] || '固定' },
    { id: 'source', label: '扣款帳戶（選填）', type: 'text', val: r[4] || '', opt: true },
    { id: 'start',  label: '開始月份', type: 'month',  val: r[5] || '' },
    { id: 'notes',  label: '備註（選填）', type: 'text', val: r[6] || '', opt: true },
  ], async (vals) => {
    const amount = parseFloat(vals.amount) || 0;
    if (amount <= 0) { showToast('金額需大於 0', 'err'); return false; }
    if (!vals.start || vals.start <= todayYM) {
      showToast('開始月份需為未來月份（不含當月）', 'err');
      return false;
    }
    // 保留原 id（不重新生成）
    S.data.expense_planned[idx] = [r[0], vals.name, String(amount), vals.cat, vals.source || '', vals.start, vals.notes || ''];
    await saveSheet('expense_planned', S.data.expense_planned);
    renderBudget();
    renderKPIs();
    showToast('已更新未來支出', 'ok');
  });
}

function deletePlannedExpense(idx) {
  const r = S.data.expense_planned[idx];
  if (!r) return;
  openConfirm('確認刪除', `刪除未來支出「${r[1]}」（${r[5]} 起）？`, async () => {
    S.data.expense_planned.splice(idx, 1);
    await saveSheet('expense_planned', S.data.expense_planned);
    renderBudget();
    renderKPIs();
    showToast('已刪除未來支出', 'ok');
  });
}

// 取得今天的 YYYY-MM（Asia/Taipei）
function _todayYM() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
```

- [ ] **Step 4: 在 `app.js` 加入 `renderPlannedSection()` 函式**

緊接上面的 CRUD 之後加：

```js
function renderPlannedSection() {
  const wrap = $('budget-planned-section');
  if (!wrap) return;

  const items = (S.data.expense_planned || []).slice();
  // 排序：start_date 由近到遠
  items.sort((a, b) => (a[5] || '').localeCompare(b[5] || ''));

  // 預告：所有未來項目活化後月支出會增加的總額
  const previewSum = items.reduce((s, r) => s + (parseFloat(r[2]) || 0), 0);

  // 標頭
  const header = `
    <div class="budget-planned-header" onclick="togglePlanned()">
      <span class="budget-planned-title">▾ 未來規劃 <span class="count">(${items.length})</span></span>
      <span class="budget-planned-preview">${items.length ? '+' + fmt(previewSum) + '/月' : ''}</span>
    </div>`;

  // 清單
  let listHTML;
  if (!items.length) {
    listHTML = `
      <div class="budget-planned-list">
        <div class="budget-planned-empty">尚無未來規劃</div>
        <button class="btn-add" onclick="addPlannedExpense()">+ 新增未來支出</button>
      </div>`;
  } else {
    const todayYM = _todayYM();
    const rowsHTML = items.map((r, i) => {
      const [id, name, amount, cat, source, start, notes] = r;
      const amt = parseFloat(amount) || 0;
      const isPast = (start || '') <= todayYM;
      const relText = _relMonthText(start, todayYM);
      const metaParts = [esc(cat || ''), esc(source || '')].filter(Boolean).join(' · ');
      const dateText = isPast
        ? `<span style="color:#dc2626;">${esc(start)} · 待活化</span>`
        : `${esc(start)} 起${relText ? ` · ${relText}` : ''}`;
      return `
        <div class="budget-planned-item">
          <div class="budget-planned-item-name">${esc(name || '—')}</div>
          <div class="budget-planned-item-amt">${fmt(amt)}</div>
          <div class="budget-planned-item-meta">${metaParts}<br>${dateText}</div>
          <div class="budget-planned-item-actions">
            <button class="btn-icon edit" onclick="editPlannedExpense(${i})">✏</button>
            <button class="btn-icon del" onclick="deletePlannedExpense(${i})">✕</button>
          </div>
        </div>`;
    }).join('');
    listHTML = `
      <div class="budget-planned-list">
        ${rowsHTML}
        <button class="btn-add" onclick="addPlannedExpense()">+ 新增未來支出</button>
      </div>`;
  }

  wrap.innerHTML = header + listHTML;
}

// 計算「YYYY-MM 距今多少」相對文字
function _relMonthText(targetYM, todayYM) {
  if (!targetYM || !todayYM) return '';
  const [ty, tm] = targetYM.split('-').map(Number);
  const [cy, cm] = todayYM.split('-').map(Number);
  if (!ty || !tm || !cy || !cm) return '';
  const monthsDiff = (ty - cy) * 12 + (tm - cm);
  if (monthsDiff <= 0) return '';
  if (monthsDiff < 12) return `${monthsDiff}個月後`;
  const years = Math.floor(monthsDiff / 12);
  const remMonths = monthsDiff % 12;
  return remMonths ? `${years}年${remMonths}個月後` : `${years}年後`;
}

function togglePlanned() {
  const wrap = $('budget-planned-section');
  if (wrap) wrap.classList.toggle('expanded');
}
```

- [ ] **Step 5: 在 `renderBudget()` 末尾呼叫 `renderPlannedSection()`**

找到 `app.js:2399` 的 `function renderBudget()`，在函式 return 之前（或最後一個 statement 之後）加：

```js
renderPlannedSection();
```

- [ ] **Step 6: bump 版本（這 step 用 bump-build-version skill）**

執行：
```bash
bash ~/.claude/skills/bump-build-version/scripts/now.sh
```

把輸出的 `BUILD_DATE` 寫進 `app.js:7`，把 `CACHE_BUSTER` 用 `replace_all` 換掉 `index.html` 三處 `?v=...`。最後 grep 驗證 4 處都換到。

- [ ] **Step 7: 手動驗證**

開瀏覽器（清 cache 或 Cmd+Shift+R）：
1. 展開「生活支出預算」hero card
2. 滑到最下方應看到「▾ 未來規劃 (0)」+「+ 新增未來支出」按鈕
3. 點 `+ 新增未來支出` → modal 開啟、月份欄位是 month picker
4. 嘗試輸入過去月份 → 提示「需未來月份」、modal 不關
5. 輸入合法資料儲存 → 列表出現該項、Google Sheets `expense_planned` tab 出現該 row
6. 點 ✏ 編輯 → 預填值正確、可改 → 儲存後列表更新
7. 點 ✕ 刪除 → openConfirm 對話、確認後刪除

mobile：手機刷新（注意 cache-buster 已 bump），同樣流程跑一次。

- [ ] **Step 8: Commit + push**

```bash
git add app.js index.html theme.css  # 或 style.css 看 CSS 放哪
git commit -m "新增：未來支出規劃 UI + CRUD（Phase 1 Task 2）

- 在生活支出預算 hero card 加折疊區塊「未來規劃」
- 新增/編輯/刪除：openModal 沿用、type='month' HTML5 原生
- 排序 by start_date、預告活化後月增加總額
- 過去日期：拒絕新增 + 異常顯示「待活化」紅字"
git push
```

---

## Task 3: DWZ 模擬整合

**目標：** `simulateMonthly()` 從各 planned 項目 `start_date` 那個月起，把它算進每月支出 — DWZ 折線圖在那個月斜率變陡。

**Files:**
- Modify: `app.js:936-988`（`simulateMonthly` 函式）

⚠ `simulateMonthly` 不在 `pwa-danger-zones` 禁區清單，可以動。但要小心不要動到既有 `incomeByYM` / `expByYM` 邏輯。

### Steps

- [ ] **Step 1: 確認 `simulateMonthly` 現況不需 caller 改動**

執行：
```bash
grep -n "simulateMonthly(" "/Users/george/VS Code/My Project/app.js"
```

確認 callers 的呼叫方式。本次 task 只改 `simulateMonthly` 內部，不影響 caller signature。

- [ ] **Step 2: 在 `simulateMonthly` 函式內、`for` 迴圈之前，加入 `sortedPlanned` 與 `budgetAtYM`**

在 `app.js:973` 的 `const balances = [];` 之前插入：

```js
  // 未來支出規劃：逐月查表（從 start_date 那月起算進每月 budget）
  const sortedPlanned = [...(S.data.expense_planned || [])]
    .sort((a, b) => (a[5] || '').localeCompare(b[5] || ''));

  const budgetAtYM = (ym) => {
    let total = monthlyBudget;
    for (const r of sortedPlanned) {
      if ((r[5] || '') <= ym) total += parseFloat(r[2]) || 0;
      else break; // sorted，後面更晚的不會再加
    }
    return total;
  };
```

- [ ] **Step 3: 把迴圈內 `monthlyBudget` 換成 `budgetAtYM(ym)`**

修改 `app.js:977`：

```js
// 原：
const netChange = (incomeByYM.get(ym) || 0) - monthlyBudget - (expByYM.get(ym) || 0);

// 改為：
const netChange = (incomeByYM.get(ym) || 0) - budgetAtYM(ym) - (expByYM.get(ym) || 0);
```

- [ ] **Step 4: bump 版本**

執行 bump-build-version skill 流程（如 Task 2 Step 6）。

- [ ] **Step 5: 手動驗證**

1. 用既有資料開 DWZ tab，記住「財務存活月數」數字
2. 加入一筆未來支出（例：12 個月後 +30,000/月）
3. 重新進 DWZ tab，「財務存活月數」應**縮短**（因為未來那個月起每月多扣 30k）
4. 看折線圖：應在那個月之後斜率變陡（餘額下降變快）
5. 刪除該未來支出 → DWZ 數字應回到原值

- [ ] **Step 6: Commit + push**

```bash
git add app.js index.html
git commit -m "新增：DWZ 模擬整合未來支出規劃（Phase 1 Task 3）

- simulateMonthly 內部加 sortedPlanned + budgetAtYM(ym) 逐月查表
- caller signature 不變，所有呼叫自動受益
- start_date 那個月起折線斜率變陡"
git push
```

---

## Task 4: 自動活化 + initApp 串接

**目標：** APP 開啟時自動把 `start_date <= 當月` 的 planned 項目寫進 `expense_budget`，從 `expense_planned` 移除，toast 通知使用者。

**Files:**
- Modify: `app.js` — 新增 `_checkAndActivatePlanned()` 函式
- Modify: `app.js:5998`（initApp 內，`await loadAll()` 之後）

### Steps

- [ ] **Step 1: 在 `app.js` 加入 `_checkAndActivatePlanned()` 函式**

緊接 Task 2 加的 CRUD/render 函式區段之後加：

```js
// ══════════════════════════════════════════════════════════════
// 自動活化：APP 啟動時把到期的未來規劃寫進正式預算
// ══════════════════════════════════════════════════════════════
async function _checkAndActivatePlanned() {
  if (!S.data.expense_planned || !S.data.expense_planned.length) return;

  const todayYM = _todayYM();

  // 1. 找出到期項目（start_date <= 當月）
  const due = S.data.expense_planned.filter(r => (r[5] || '') <= todayYM);
  if (!due.length) return;

  // 2. 寫進 expense_budget（追加，不覆寫既有）
  due.forEach(([id, name, amount, cat, source, start, notes]) => {
    S.data.expense_budget.push([cat, name, amount, source]);
  });

  // 3. 從 expense_planned 移除已活化項目
  S.data.expense_planned = S.data.expense_planned.filter(r => (r[5] || '') > todayYM);

  // 4. 防 saveSheet high-water guard 誤擋（大量活化時會觸發）
  //    把 expense_planned 的 high water 重設為新 size，避免 < 50% 守衛擋下
  _SHEET_HIGH_WATER['expense_planned'] = S.data.expense_planned.length;

  // 5. 兩張表都存（順序：先存目標表，再存來源表）
  try {
    await saveSheet('expense_budget', S.data.expense_budget);
    await saveSheet('expense_planned', S.data.expense_planned);
  } catch (e) {
    console.error('[planned activate] save failed:', e);
    showToast('未來規劃自動活化儲存失敗，請手動檢查', 'err');
    return;
  }

  // 6. Toast 通知（停留 6 秒，比一般 toast 長）
  const names = due.map(r => `${r[1]} (${fmt(parseFloat(r[2]) || 0)})`).join('、');
  showToast(`已啟用 ${due.length} 筆未來規劃：${names}`, 'ok', 6000);
}
```

- [ ] **Step 2: 在 `initApp` 中、`await loadAll()` 之後串接**

修改 `app.js:5998` 附近：

```js
// 原：
showToast('載入資料…');
await loadAll();
await seedBaselineHistory();

// 改為：
showToast('載入資料…');
await loadAll();
await _checkAndActivatePlanned();  // ← 新加：載入後立刻檢查活化
await seedBaselineHistory();
```

- [ ] **Step 3: 確認 `showToast` 支援自訂 duration**

執行：
```bash
grep -n "^function showToast" "/Users/george/VS Code/My Project/app.js"
```

打開函式定義，確認第三個參數是 duration（ms）。若不支援，改為呼叫兩次 showToast 或修改 showToast 加 duration 參數（後者較佳，但要謹慎 — 看 showToast 內部實作）。

⚠ 若 showToast 不接受 duration、又不想動 showToast，退而求其次：

```js
showToast(`已啟用 ${due.length} 筆未來規劃：${names}`, 'ok');
```

（停留時間用預設，不致於不可用，只是訊息消失快了點。）

- [ ] **Step 4: bump 版本**

執行 bump-build-version skill 流程。

- [ ] **Step 5: 手動驗證 — 「正常情境」**

1. 確保目前 `expense_planned` 有未來月項目（不會活化）
2. 重新整理 APP
3. 應無「已啟用」toast — 因為沒有到期項目

- [ ] **Step 6: 手動驗證 — 「活化情境」**

製造一筆「到期」項目（測試用）：
1. 在 Google Sheets `expense_planned` tab 直接編輯，把某筆 `start_date` 改成上個月或當月（YYYY-MM 格式）
2. 重新整理 APP
3. 應看到 toast「已啟用 1 筆未來規劃：項目名 ($金額)」
4. 該項目從「未來規劃」清單消失
5. 該項目出現在主預算清單對應類別（固定/浮動）
6. Google Sheets：`expense_planned` 該 row 已刪除、`expense_budget` 多了一 row

- [ ] **Step 7: 手動驗證 — 冪等性**

再次重新整理（不再有到期項目） → 應無 toast、無重複活化。

- [ ] **Step 8: Commit + push**

```bash
git add app.js index.html
git commit -m "新增：未來支出自動活化（Phase 1 Task 4 — 收尾）

- _checkAndActivatePlanned 於 initApp 載入後執行
- 到期項目寫進 expense_budget、從 expense_planned 移除
- 處理 saveSheet high-water guard（重設 _SHEET_HIGH_WATER）
- Toast 通知活化清單；錯誤時 err toast 不刪 planned 等下次重試"
git push
```

---

## Task 5: 手機端最終驗證

**目標：** 在實機上把整個 Phase 1 流程跑一次，確保 mobile 體驗 OK。

**Files:** 無變動（僅驗證）

### Steps

- [ ] **Step 1: 手機刷新 PWA**

打開手機瀏覽器到 GitHub Pages 部署網址（hard refresh 確保抓最新 cache-buster）。

- [ ] **Step 2: 跑完整流程**

1. 進總覽頁 → 展開「生活支出預算」hero card
2. 滑到底部 → 「未來規劃」區塊應顯示
3. 點 `+ 新增未來支出` → modal 開啟（手機鍵盤跳出，month picker 是否好用？）
4. 新增一筆未來支出（例：12 個月後 +5,000）
5. 看到列表更新、預告 `+5,000/月` 顯示
6. 進 DWZ tab → 確認模擬數字反映新支出
7. 編輯該筆 → 改金額 → 儲存
8. 刪除該筆 → openConfirm 動作正常
9. 切到別 tab 再切回總覽 → 「未來規劃」區塊 state 應保留（折疊/展開）

- [ ] **Step 3: 異常測試**

1. 嘗試新增「過去月份」→ 應有錯誤提示、modal 不關
2. 嘗試金額為 0 → 應拒絕
3. 不填項目名稱 → modal 內 input 標紅、不送出

- [ ] **Step 4: 回報結果**

跟使用者確認：
- 所有步驟是否順暢
- 是否有意外行為
- 有沒有 UI 跑版（特別是 hero card 是否變太高、折疊區塊是否擠）

若一切順暢 → Phase 1 MVP 完成。
若有問題 → 視為 follow-up task，獨立修。

---

## Spec 對應對照

| Spec 章節 | 對應 Task |
|---|---|
| 資料模型（HEADERS + S.data + loadAll + fallback）| Task 1 |
| UI 結構（hero card 折疊區塊 + 預告）| Task 2 |
| 新增/編輯/刪除互動（modal + 驗證）| Task 2 |
| DWZ 模擬整合（budgetAtYM 逐月查表）| Task 3 |
| 自動活化機制（_checkAndActivatePlanned + initApp 串接）| Task 4 |
| 手機驗證 | Task 5 |
| Phase 2/3（不在 MVP）| 不實作（明確 out of scope）|

## 邊界提醒（給實作工程師）

1. **單檔架構是刻意的** — 不要把新函式拆到別檔。`app.js` 大就是大。
2. **不要動 `loadAll() / rows() / saveSheet() / doSaveDailySnapshot() / getYesterdayPriceSnap()`** — 僅 `loadAll` 容許「插入新 sheetGet + 對應 destructure 變數」這種加法式變更。
3. **commit 後直接 push** — 不要等使用者點頭。
4. **時間禁止編造** — bump 版本一律用 `bump-build-version` skill / `now.sh` 取系統時間。
5. **不要新增 README / docs 檔** — 除非使用者明確要求。
6. **`*.backup`、`design-test.html`、`SPREADSHEET_ID/CLIENT_ID` 不要碰**。
7. **遇到 UI bug 才不要立刻調 CSS 數值** — 套用 `visual-vs-data-divergence` skill 的診斷順序（先檢查 inline style 是否覆蓋 CSS）。
