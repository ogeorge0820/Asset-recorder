# Active Income Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在管理頁面新增「主動收入管理」Accordion 區塊，支援收入 CRUD、入帳時自動同步流動現金帳戶、入帳可反悔，並在 Google Sheets 新增 `Income_Records` 工作表。

**Architecture:** 沿用現有 Vanilla JS 模式。資料層新增 `income_records` 到 `HEADERS`/`S.data`/`loadAll()`。UI 採月份分組 accordion（仿 `rewards-accordion`）。Transaction logic 透過現有 `appendHistory()` / `saveSheet()` 完成帳戶同步。

**Tech Stack:** Vanilla JS、Google Sheets API v4、Tailwind-free CSS（CSS Variables）、Chart.js（不異動）

---

## 檔案異動清單

| 檔案 | 操作 | 說明 |
|------|------|------|
| `app.js` | 修改 | HEADERS、S.data、loadAll()、renderManagement()、新增 7 個函式 |
| `index.html` | 修改 | 在 `section-exp-plan` 之後插入 `section-income` |
| `style.css` | 修改 | 在檔案末尾前新增 income 相關 CSS class |

---

## Task 1：資料層 — HEADERS / S.data / loadAll()

**Files:**
- Modify: `app.js:151` （HEADERS 物件）
- Modify: `app.js:178` （S.data 物件）
- Modify: `app.js:315` （loadAll() 函式）

- [ ] **Step 1：在 HEADERS 新增 income_records 宣告**

在 `app.js` 第 151 行附近，`experience_plan` 那行之後加入：

```js
  income_records: ['id','name','category','amount_twd','expected_date','status','linked_account','settled_date','payer'],
```

找到這段：
```js
  experience_plan: ['name','year','month','amount_twd','paid'],
};
```
改為：
```js
  experience_plan: ['name','year','month','amount_twd','paid'],
  income_records: ['id','name','category','amount_twd','expected_date','status','linked_account','settled_date','payer'],
};
```

- [ ] **Step 2：在 S.data 新增 income_records 初始陣列**

找到：
```js
    experience_plan: [], // [name, year, month, amount_twd, paid]
```
改為：
```js
    experience_plan: [], // [name, year, month, amount_twd, paid]
    income_records: [],  // [id, name, category, amount_twd, expected_date, status, linked_account, settled_date, payer]
```

- [ ] **Step 3：在 loadAll() 新增 sheetGet 呼叫**

找到：
```js
  const [cash, tw, us, crypto, snap, daily, sett, rw, hist, twHist, usHist, cashHist, otherHist, expBudget, expPlan] = await Promise.allSettled([
```
改為：
```js
  const [cash, tw, us, crypto, snap, daily, sett, rw, hist, twHist, usHist, cashHist, otherHist, expBudget, expPlan, incomeRec] = await Promise.allSettled([
```

在 `sheetGet('experience_plan!A:E'),` 後面加入：
```js
    sheetGet('income_records!A:I'),
```

在 `S.data.experience_plan = rows(expPlan);` 後面加入：
```js
  S.data.income_records  = rows(incomeRec);
```

- [ ] **Step 4：手動驗證**

啟動 `python3 -m http.server 8080`，登入後開啟瀏覽器 Console，執行：
```js
S.data.income_records
```
預期回傳 `[]`（空陣列，代表欄位已初始化且不報錯）。

- [ ] **Step 5：Commit**

```bash
git add app.js
git commit -m "feat(income): data layer — HEADERS, S.data, loadAll"
```

---

## Task 2：HTML 結構

**Files:**
- Modify: `index.html:281` （`section-exp-plan` 結束標籤之後）

- [ ] **Step 1：在 section-exp-plan 結束後插入 section-income**

找到：
```html
        </div>

      </div><!-- /mgmt-grid -->
```
（`section-exp-plan` 的 `</div>` 後、`/mgmt-grid` 前）

改為：
```html
        </div>

        <!-- Row 8: 主動收入管理 全寬 -->
        <div class="section-card collapsed" id="section-income" style="grid-column: 1 / -1">
          <h3 class="section-header" onclick="toggleSection('income')"><span>💰 主動收入管理 (Active Income) <span class="badge" id="cnt-income">0</span></span><span class="section-header-right"><span class="income-header-label">本月已入帳：</span><span class="section-total" id="tot-income">—</span><span class="section-chevron">▾</span></span></h3>
          <div class="section-body">
            <div id="income-accordion"></div>
            <div class="income-forecast" id="income-month-forecast"></div>
            <button class="btn-add" onclick="addIncomeItem()">+ 新增收入</button>
          </div>
        </div>

      </div><!-- /mgmt-grid -->
```

- [ ] **Step 2：手動驗證**

重整頁面，切換到「管理」分頁，確認：
- 最下方出現「💰 主動收入管理 (Active Income)」區塊
- 點擊標題可展開/收起（`collapsed` 動畫正常）
- Badge 顯示 `0`、右側顯示 `—`

- [ ] **Step 3：Commit**

```bash
git add index.html
git commit -m "feat(income): HTML section structure"
```

---

## Task 3：CSS 樣式

**Files:**
- Modify: `style.css`（在 `/* ── Die With Zero Simulator ──*/` 之前插入）

- [ ] **Step 1：插入 income CSS**

找到：
```css
/* ── Die With Zero Simulator ── */
```
在這行之前插入：

```css
/* ══ 主動收入管理 ══ */
.income-empty { color: var(--muted); font-size: 0.9rem; text-align: center; padding: 20px 0; }
.income-group {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 8px;
}
.income-group:last-child { margin-bottom: 0; }
.income-group.current { border-color: var(--accent); }
.income-group-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px;
  cursor: pointer;
  background: rgba(255,255,255,.03);
  transition: background .15s;
}
.income-group-header:hover { background: rgba(99,102,241,.08); }
.income-group-left { display: flex; align-items: center; gap: 8px; }
.income-month-label { font-weight: 600; font-size: 0.9rem; color: var(--text); }
.income-group-sub { font-size: 0.75rem; color: var(--muted); }
.income-group-right { display: flex; align-items: center; gap: 10px; }
.income-group-total { font-weight: 700; font-size: 0.95rem; color: var(--accent-light); }
.income-group-toggle { font-size: 0.72rem; color: var(--muted); user-select: none; }
.income-group-body { padding: 0 14px 10px; }
.income-item {
  display: grid;
  grid-template-columns: 28px 1fr auto auto auto;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  border-bottom: 1px solid rgba(45,49,85,.25);
}
.income-item:last-child { border-bottom: none; }
.income-item.income-settled { background: rgba(255,255,255,.03); border-radius: 6px; }
.income-status-btn {
  background: none; border: 1.5px solid var(--muted);
  border-radius: 4px; width: 22px; height: 22px;
  cursor: pointer; font-size: 0.95rem; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  color: var(--muted); flex-shrink: 0;
  transition: border-color .15s, color .15s;
}
.income-status-btn.settled {
  border-color: #10b981; color: #10b981;
}
.income-status-btn:hover { border-color: var(--accent-light); }
.income-item-info { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.income-item-name { font-size: 0.88rem; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.income-cat-badge {
  font-size: 0.7rem; font-weight: 600; white-space: nowrap;
  background: rgba(99,102,241,.14); color: #818cf8;
  padding: 1px 6px; border-radius: 20px;
}
.income-payer { font-size: 0.72rem; color: var(--muted); white-space: nowrap; }
.income-item-date { font-size: 0.78rem; color: var(--muted); white-space: nowrap; }
.income-item-amt { font-size: 0.88rem; font-weight: 700; color: var(--text); white-space: nowrap; text-align: right; }
.income-item-actions { display: flex; gap: 4px; flex-shrink: 0; }
.income-forecast {
  font-size: 0.82rem; color: var(--muted);
  padding: 10px 4px 4px;
  border-top: 1px solid var(--border);
  margin-top: 8px;
}
.income-header-label { font-size: 0.75rem; color: var(--muted); margin-right: 2px; }
/* Light mode */
[data-theme="light"] .income-group { border-color: #e2d9c8; }
[data-theme="light"] .income-group.current { border-color: #8b6f47; }
[data-theme="light"] .income-group-header { background: rgba(0,0,0,.02); }
[data-theme="light"] .income-group-header:hover { background: rgba(99,102,241,.06); }
[data-theme="light"] .income-group-total { color: var(--accent); }
[data-theme="light"] .income-item { border-bottom-color: rgba(139,111,71,.2); }
[data-theme="light"] .income-item.income-settled { background: rgba(0,0,0,.02); }
[data-theme="light"] .income-cat-badge { background: rgba(99,102,241,.1); color: #4f46e5; }

```

- [ ] **Step 2：手動驗證**

重整頁面，展開「主動收入管理」區塊，確認無 CSS 錯誤、區塊空白顯示正常。切換 Dark/Light Mode 確認兩種主題樣式都合理。

- [ ] **Step 3：Commit**

```bash
git add style.css
git commit -m "feat(income): CSS styles for income accordion"
```

---

## Task 4：renderIncome() + toggleIncomeGroup() + 接入 renderManagement()

**Files:**
- Modify: `app.js`（在 `renderExperiencePlan` 函式區塊之後新增）
- Modify: `app.js:820` （renderManagement 函式）

- [ ] **Step 1：在 renderExperiencePlan 區塊後新增 renderIncome 函式**

找到 `function addExpPlanItem()` 之前（renderExperiencePlan 結束後），插入以下兩個函式：

```js
// ══════════════════════════════════════════════════════════════
// RENDER — 主動收入管理
// ══════════════════════════════════════════════════════════════
function renderIncome() {
  const items = S.data.income_records;
  const cntEl = $('cnt-income');
  const totEl = $('tot-income');
  const accordionEl = $('income-accordion');
  const forecastEl = $('income-month-forecast');
  if (!accordionEl) return;

  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const curYMDash  = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
  const curYMSlash = `${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}`;

  if (cntEl) cntEl.textContent = items.length;

  const monthSettled = items
    .filter(r => r[5] === '1' && (r[7] || '').startsWith(curYMSlash))
    .reduce((s, r) => s + (parseFloat(r[3]) || 0), 0);
  if (totEl) totEl.textContent = monthSettled > 0 ? fmt(monthSettled) : '—';

  const monthForecast = items
    .filter(r => (r[4] || '').startsWith(curYMDash))
    .reduce((s, r) => s + (parseFloat(r[3]) || 0), 0);
  if (forecastEl) {
    forecastEl.textContent = monthForecast > 0
      ? `本月預計總收入（含未入帳）：${fmt(monthForecast)}`
      : '';
    forecastEl.style.display = monthForecast > 0 ? '' : 'none';
  }

  if (!items.length) {
    accordionEl.innerHTML = '<div class="income-empty">尚無收入記錄</div>';
    return;
  }

  const groups = {};
  items.forEach((r, i) => {
    const ym = (r[4] || '').slice(0, 7) || '未知';
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push({ r, i });
  });

  const sortedYMs = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  accordionEl.innerHTML = sortedYMs.map(ym => {
    const list = groups[ym];
    const [yr, mo] = ym.split('-');
    const label = yr && mo ? `${yr}年${parseInt(mo, 10)}月` : ym;
    const monthTotal = list.reduce((s, { r }) => s + (parseFloat(r[3]) || 0), 0);
    const isCur = ym === curYMDash;

    const rowsHTML = list.map(({ r, i }) => {
      const settled = r[5] === '1';
      const amt = parseFloat(r[3]) || 0;
      return `<div class="income-item${settled ? ' income-settled' : ''}">
        <button class="income-status-btn${settled ? ' settled' : ''}" onclick="toggleIncomeStatus(${i})" title="${settled ? '點擊取消入帳' : '點擊標記已入帳'}">${settled ? '☑' : '☐'}</button>
        <div class="income-item-info">
          <span class="income-item-name">${esc(r[1] || '—')}</span>
          ${r[2] ? `<span class="income-cat-badge">${esc(r[2])}</span>` : ''}
          ${r[8] ? `<span class="income-payer">${esc(r[8])}</span>` : ''}
        </div>
        <span class="income-item-date">${esc(r[4] || '—')}</span>
        <span class="income-item-amt">${fmt(amt)}</span>
        <div class="income-item-actions">
          <button class="btn-icon edit" onclick="editIncomeItem(${i})">✏</button>
          <button class="btn-icon del" onclick="deleteIncomeItem(${i})">✕</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="income-group${isCur ? ' current' : ''}">
      <div class="income-group-header" onclick="toggleIncomeGroup('${ym}')">
        <div class="income-group-left">
          <span class="income-month-label">${esc(label)}</span>
          <span class="income-group-sub">${list.length} 筆</span>
        </div>
        <div class="income-group-right">
          <span class="income-group-total">${fmt(monthTotal)}</span>
          <span class="income-group-toggle" id="inc-toggle-${ym}">▼</span>
        </div>
      </div>
      <div class="income-group-body" id="inc-body-${ym}" style="${isCur ? 'display:block' : 'display:none'}">
        ${rowsHTML}
      </div>
    </div>`;
  }).join('');

  const curToggle = $(`inc-toggle-${curYMDash}`);
  if (curToggle) curToggle.textContent = '▲';
}

function toggleIncomeGroup(ym) {
  const body   = $(`inc-body-${ym}`);
  const toggle = $(`inc-toggle-${ym}`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (toggle) toggle.textContent = open ? '▼' : '▲';
}
```

- [ ] **Step 2：在 renderManagement() 新增 renderIncome() 呼叫**

找到：
```js
function renderManagement() {
  renderCash(); renderTW(); renderUS(); renderCrypto(); renderOther(); renderRewards(); renderBudget(); renderExperiencePlan();
  initAccordion();
}
```
改為：
```js
function renderManagement() {
  renderCash(); renderTW(); renderUS(); renderCrypto(); renderOther(); renderRewards(); renderBudget(); renderExperiencePlan(); renderIncome();
  initAccordion();
}
```

- [ ] **Step 3：手動驗證**

在 Console 執行：
```js
S.data.income_records.push(['1','測試收入','薪資','50000','2026-04-15','0','','','公司A']);
renderIncome();
```
預期：展開區塊後看到「2026年4月」分組，內含一筆「測試收入」記錄，Badge 顯示 1，底部顯示「本月預計總收入（含未入帳）：50,000」。完成後執行 `S.data.income_records = []; renderIncome();` 清除測試資料。

- [ ] **Step 4：Commit**

```bash
git add app.js
git commit -m "feat(income): renderIncome, toggleIncomeGroup, wire renderManagement"
```

---

## Task 5：addIncomeItem() + editIncomeItem() + deleteIncomeItem()

**Files:**
- Modify: `app.js`（緊接在 Task 4 新增的函式之後）

- [ ] **Step 1：新增 addIncomeItem()**

```js
function addIncomeItem() {
  openModal('新增收入', [
    { id: 'name',     label: '收入名稱',              type: 'text',   ph: '例：四月薪資' },
    { id: 'category', label: '類別（選填）',           type: 'text',   ph: '例：薪資、獎金', opt: true },
    { id: 'payer',    label: '付款人 / 平台（選填）',  type: 'text',   ph: '例：A 客戶、Upwork', opt: true },
    { id: 'amount',   label: '金額 (TWD)',             type: 'number', step: '1', min: 0, ph: '0' },
    { id: 'date',     label: '預計入帳日',              type: 'date' },
  ], async vals => {
    const amount = parseFloat(vals.amount) || 0;
    if (!vals.name) { showToast('請填寫收入名稱', 'err'); return false; }
    if (!vals.date) { showToast('請選擇預計入帳日', 'err'); return false; }
    S.data.income_records.push([
      String(Date.now()), vals.name, vals.category || '', String(amount),
      vals.date, '0', '', '', vals.payer || ''
    ]);
    S.data.income_records.sort((a, b) => (b[4] || '').localeCompare(a[4] || ''));
    await saveSheet('income_records', S.data.income_records);
    renderIncome();
    showToast('已新增收入記錄', 'ok');
  });
}
```

- [ ] **Step 2：新增 editIncomeItem()**

```js
function editIncomeItem(idx) {
  const r = S.data.income_records[idx];
  if (!r) return;
  openModal('編輯收入', [
    { id: 'name',     label: '收入名稱',              type: 'text',   val: r[1] || '' },
    { id: 'category', label: '類別（選填）',           type: 'text',   val: r[2] || '', opt: true },
    { id: 'payer',    label: '付款人 / 平台（選填）',  type: 'text',   val: r[8] || '', opt: true },
    { id: 'amount',   label: '金額 (TWD)',             type: 'number', step: '1', min: 0, val: r[3] || '0' },
    { id: 'date',     label: '預計入帳日',              type: 'date',   val: r[4] || '' },
  ], async vals => {
    const amount = parseFloat(vals.amount) || 0;
    S.data.income_records[idx] = [
      r[0], vals.name, vals.category || '', String(amount),
      vals.date, r[5], r[6], r[7], vals.payer || ''
    ];
    S.data.income_records.sort((a, b) => (b[4] || '').localeCompare(a[4] || ''));
    await saveSheet('income_records', S.data.income_records);
    renderIncome();
    showToast('已更新收入記錄', 'ok');
  });
}
```

- [ ] **Step 3：新增 deleteIncomeItem()**

```js
async function deleteIncomeItem(idx) {
  const r = S.data.income_records[idx];
  if (!r) return;
  if (r[5] === '1') {
    const amt = parseFloat(r[3]) || 0;
    openConfirm('刪除已入帳記錄',
      `此筆收入已併入「${r[6]}」，刪除紀錄將同步扣除 ${fmt(amt)}，是否確定？`,
      async () => {
        await _revertIncomeSettlement(r);
        const newIdx = S.data.income_records.findIndex(rec => rec[0] === r[0]);
        if (newIdx >= 0) S.data.income_records.splice(newIdx, 1);
        await saveSheet('income_records', S.data.income_records);
        renderIncome(); renderKPIs(); renderCash();
        showToast('已刪除收入記錄並還原帳戶金額', 'ok');
      }
    );
  } else {
    openConfirm('確認刪除', '刪除此收入記錄？', async () => {
      S.data.income_records.splice(idx, 1);
      await saveSheet('income_records', S.data.income_records);
      renderIncome();
      showToast('已刪除收入記錄', 'ok');
    });
  }
}
```

- [ ] **Step 4：手動驗證 CRUD**

展開「主動收入管理」，點「+ 新增收入」，填寫資料確認存入。
點「✏」確認可編輯。
點「✕」確認出現刪除確認框，刪除後 Badge 更新。
確認 Google Sheets `Income_Records` 工作表有對應資料。

- [ ] **Step 5：Commit**

```bash
git add app.js
git commit -m "feat(income): CRUD — add, edit, delete income items"
```

---

## Task 6：toggleIncomeStatus() + _revertIncomeSettlement()（入帳 / 反悔）

**Files:**
- Modify: `app.js`（緊接在 deleteIncomeItem 之後）

- [ ] **Step 1：新增 _revertIncomeSettlement() 內部輔助函式**

```js
async function _revertIncomeSettlement(r) {
  const linkedAccount = r[6];
  if (!linkedAccount) return;
  const amt = parseFloat(r[3]) || 0;
  const cashIdx = S.data.cash.findIndex(c => c[0] === linkedAccount);
  if (cashIdx < 0) return;
  const ccy = (S.data.cash[cashIdx][2] || 'TWD').toUpperCase();
  const amtBefore = parseFloat(S.data.cash[cashIdx][1]) || 0;
  const amtAfter  = amtBefore - amt;
  S.data.cash[cashIdx] = [linkedAccount, amtAfter, ccy];
  await saveSheet('cash_accounts', S.data.cash);
  await appendHistory('cash', linkedAccount, amtBefore, amtAfter, 'TWD');
}
```

- [ ] **Step 2：新增 toggleIncomeStatus()**

```js
function toggleIncomeStatus(idx) {
  const r = S.data.income_records[idx];
  if (!r) return;

  if (r[5] === '1') {
    // 已入帳 → 預計（反悔流程）
    const amt = parseFloat(r[3]) || 0;
    openConfirm('取消入帳',
      `確認取消入帳？將自動從「${r[6]}」扣回 ${fmt(amt)}。`,
      async () => {
        await _revertIncomeSettlement(r);
        r[5] = '0'; r[6] = ''; r[7] = '';
        await saveSheet('income_records', S.data.income_records);
        renderIncome(); renderKPIs(); renderCash();
        doSaveDailySnapshot(true);
        showToast('已取消入帳並還原帳戶金額', 'ok');
      }
    );
  } else {
    // 預計 → 已入帳（選擇帳戶）
    if (!S.data.cash.length) { showToast('請先新增流動現金帳戶', 'err'); return; }
    const cashOptions = S.data.cash.map(c => `${c[0]} (${c[2] || 'TWD'})`);
    openModal(`標記已入帳 · ${esc(r[1])}`, [
      { id: 'account', label: '此筆收入已存入哪個帳戶？', type: 'select', options: cashOptions },
    ], async vals => {
      const cashIdx = S.data.cash.findIndex(c => `${c[0]} (${c[2] || 'TWD'})` === vals.account);
      if (cashIdx < 0) { showToast('找不到對應帳戶', 'err'); return false; }
      const bankName  = S.data.cash[cashIdx][0];
      const ccy       = (S.data.cash[cashIdx][2] || 'TWD').toUpperCase();
      const amt       = parseFloat(r[3]) || 0;
      const amtBefore = parseFloat(S.data.cash[cashIdx][1]) || 0;
      const amtAfter  = amtBefore + amt;
      S.data.cash[cashIdx] = [bankName, amtAfter, ccy];
      r[5] = '1'; r[6] = bankName; r[7] = getNowTW8();
      await saveSheet('cash_accounts', S.data.cash);
      await appendHistory('cash', bankName, amtBefore, amtAfter, 'TWD');
      await saveSheet('income_records', S.data.income_records);
      renderIncome(); renderKPIs(); renderCash();
      doSaveDailySnapshot(true);
      showToast('已標記入帳並更新帳戶餘額', 'ok');
    });
  }
}
```

- [ ] **Step 3：手動驗證入帳流程**

新增一筆收入（預計）→ 點 `☐` 按鈕 → 應彈出帳戶選擇 Modal → 選擇帳戶確認 → 確認：
- 該筆收入變為 `☑`（綠色）
- 流動現金該帳戶餘額增加對應金額
- 「本月已入帳」金額更新
- Google Sheets `cash_history` 新增一筆正向記錄

- [ ] **Step 4：手動驗證反悔流程**

點已入帳記錄的 `☑` → 確認 Modal → 確認：
- 該筆收入回到 `☐`（灰色）
- 流動現金帳戶餘額已扣回
- `cash_history` 新增一筆負向記錄

- [ ] **Step 5：手動驗證已入帳刪除防呆**

將一筆記錄標記為已入帳，再點 `✕` 刪除 → 確認出現「此筆收入已併入...」的警告 Modal → 確認刪除後：帳戶餘額已扣回、記錄已消失。

- [ ] **Step 6：Commit**

```bash
git add app.js
git commit -m "feat(income): settle/unsettle transaction logic with cash account sync"
```

---

## Task 7：BUILD_DATE + 最終 Commit

**Files:**
- Modify: `app.js:5`（BUILD_DATE 常數）

- [ ] **Step 1：更新 BUILD_DATE**

找到：
```js
const BUILD_DATE = '2026/04/15 16:33';
```
改為：
```js
const BUILD_DATE = '2026/04/17 14:12';
```

- [ ] **Step 2：最終整合驗證**

1. 重整頁面，確認「主動收入管理」區塊正常顯示
2. 新增跨月份的幾筆收入（例如 2026-03 和 2026-04），確認月份分組正確（新月在上）
3. 確認 Header 右側「本月已入帳」只統計本月（`settled_date` 在當月）
4. 確認底部「本月預計總收入」包含本月所有記錄（不論狀態）
5. 切換 Dark/Light Mode 確認樣式正確
6. 確認 Google Sheets `Income_Records` 工作表資料正確

- [ ] **Step 3：Commit + Push**

```bash
git add app.js
git commit -m "chore: BUILD_DATE 2026/04/17 14:12"
git push
```

---

## 自我檢查記錄

| Spec 需求 | 對應 Task |
|-----------|----------|
| Income_Records 工作表（9 欄含 payer） | Task 1 |
| Accordion UI（月份分組、當月展開） | Task 4 |
| CRUD（新增/編輯/刪除） | Task 5 |
| 入帳 Modal（選帳戶）+ 帳戶金額同步 | Task 6 |
| 反悔流程（扣回帳戶 + 負向 history） | Task 6 |
| 刪除已入帳防呆 | Task 5 Step 3 + Task 6 |
| 本月已入帳合計（Header 右側） | Task 4 |
| 本月預計總收入（區塊底部） | Task 4 |
| 樣式與生活支出預算一致 | Task 3 |
| BUILD_DATE 14:12 | Task 7 |
