# 主動收入管理 (Active Income) — 設計文件

**日期：** 2026-04-17  
**狀態：** 已核准，待實作

---

## 背景

個人資產追蹤 App 目前有支出預算（`expense_budget`）與資產管理，但缺乏主動收入的追蹤與帳戶自動對接機制。本功能新增「主動收入管理」區塊，讓使用者記錄預計收入，並在收入入帳時自動同步到對應的流動現金帳戶。

---

## 資料模型

### Google Sheets — `Income_Records` 工作表（8 欄）

| 欄位索引 | 欄位名稱 | 說明 |
|---------|---------|------|
| 0 | `id` | 唯一識別碼（`Date.now()` 字串） |
| 1 | `name` | 收入名稱 |
| 2 | `category` | 類別（使用者自訂字串） |
| 3 | `amount_twd` | 金額（台幣整數） |
| 4 | `expected_date` | 預計入帳日（`YYYY-MM-DD`） |
| 5 | `status` | `0` = 預計，`1` = 已入帳 |
| 6 | `linked_account` | 入帳帳戶名稱（空白 = 尚未入帳） |
| 7 | `settled_date` | 實際入帳時間戳記（空白 = 尚未入帳） |

**SHEETS_COLS 宣告：**
```js
income_records: ['id','name','category','amount_twd','expected_date','status','linked_account','settled_date']
```

---

## UI 結構

### 位置

管理頁面（`tab-management`）的 `mgmt-grid` 內，插入在「重大體驗支出規劃」之後，全寬：`grid-column: 1 / -1`，HTML section ID 為 `section-income`。

### Header 列

```
💰 主動收入管理 (Active Income)  [badge: 總筆數]    本月已入帳：NT$xx,xxx  ▾
```

- 右側金額 ID：`tot-income`
- badge ID：`cnt-income`
- 預設 `collapsed`

### 區塊內部

**月份分組 Accordion（仿 `rewards-accordion`）：**
- 按 `expected_date` 的 `YYYY-MM` 分組，標題格式 `YYYY年MM月`，右側顯示該月小計
- 當月自動展開，其餘預設折疊
- 排序：新月份在上（降冪）

**每筆記錄列：**
```
[狀態切換按鈕]  收入名稱  類別tag  預計入帳日  NT$金額  [✏編輯]  [✕刪除]
```
- 狀態切換按鈕：`☐` (預計) / `☑` (已入帳，顯示綠色)
- 已入帳的列整體加 `settled` class（輕灰底色）

**區塊底部固定顯示：**
```
本月預計總收入（含未入帳）：NT$xx,xxx
```
ID：`income-month-forecast`

**最底部：**
```
＋ 新增收入
```

### 新增 / 編輯 Modal（`openModal` 通用函式）

欄位：
1. 收入名稱（text，必填）
2. 類別（text，選填，placeholder：「例如：薪資、獎金」）
3. 金額 TWD（number，必填）
4. 預計入帳日（date，必填）

### 入帳確認 Modal（`status: 0 → 1`）

> 此筆收入「{name}」已存入哪個帳戶？

下拉選單動態列出 `S.data.cash` 所有帳戶（顯示 `bank_name` + 幣別）。

### 反悔確認 Modal（`status: 1 → 0`）

> 確認取消入帳？將自動從「{linked_account}」扣回 NT${amount_twd}。

---

## Transaction Logic

### 入帳流程（`status: 0 → 1`）

1. 彈出帳戶選擇 Modal
2. 使用者確認後：
   a. 更新 `S.data.income_records` 該筆：`status='1'`、`linked_account`、`settled_date = getNowTW8()`
   b. 在 `S.data.cash` 找到 `bank_name === linked_account` 的帳戶，`amount += amount_twd`（幣別固定 TWD）
   c. 呼叫 `appendHistory('cash', linked_account, amtBefore, amtAfter, 'TWD')`
   d. `saveSheet('income_records', S.data.income_records)`
   e. `saveSheet('cash_accounts', S.data.cash)`
   f. `renderKPIs()`、`renderCash()`、`renderIncome()`、`doSaveDailySnapshot(true)`

### 反悔流程（`status: 1 → 0`）

1. 彈出確認 Modal，顯示將扣回的帳戶與金額
2. 使用者確認後：
   a. 讀取原 `linked_account`
   b. 更新該筆：`status='0'`、清空 `linked_account`、清空 `settled_date`
   c. 在 `S.data.cash` 找到對應帳戶，`amount -= amount_twd`
   d. 呼叫 `appendHistory('cash', linked_account, amtBefore, amtAfter, 'TWD')`（delta 為負）
   e. 同步 `saveSheet` × 2 + render × 4

---

## 資料聚合（純前端，每次 `renderIncome()` 重算）

```
當月已入帳 = income_records
  .filter(r => r[5] === '1' && r[7].startsWith(currentYYYYMM))
  .reduce(sum of r[3])

本月預計總收入 = income_records
  .filter(r => r[4].startsWith(currentYYYYMM))
  .reduce(sum of r[3])
```

`currentYYYYMM` 依台北時間（UTC+8）計算。

---

## 儲存結構異動

| 項目 | 說明 |
|------|------|
| 新增 Sheet | `Income_Records`（8 欄，見上方） |
| `SHEETS_COLS` | 新增 `income_records` 欄位宣告 |
| `S.data` | 新增 `income_records: []` 初始值 |
| `loadData()` | 新增 `sheetGet('income_records!A:H')` |
| `renderAll()` | 新增呼叫 `renderIncome()` |

---

## 樣式規範

- 整體 UI 樣式與「生活支出預算」區塊一致（`section-card`、`section-header`、`btn-add`）
- 月份分組沿用 `rewards-accordion` 的折疊互動模式
- 已入帳列加 `income-settled` class，套用輕灰底色
- 狀態 badge：預計用灰色、已入帳用綠色

---

## 不在本次範圍內

- 外幣收入（本次金額統一為 TWD）
- 收入統計圖表
- 與 DWZ 模擬器連動
