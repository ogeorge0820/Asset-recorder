# 💰 個人資產追蹤

一個用來追蹤和管理個人資產的網頁應用，支援多種資產類型（現金、台股、美股、加密貨幣、儲蓄險等），並與 Google Sheets 整合進行資料儲存，同時串接即時市場報價 API。

🔗 **線上預覽**：[https://ogeorge0820.github.io/asset-recorder](https://ogeorge0820.github.io/asset-recorder)

---

## ✨ 功能特色

### 📊 儀表板（總覽）
- 即時顯示總資產、淨資產、可用資產（總資產 − 房地產）等關鍵 KPI 指標
- 本月收益（動態正/負顏色邊框）與累計成長率（依快照計算）
- 資產組成圓形圖表、每日資產趨勢、月收益長條圖（Chart.js）
- 質押/活存收益本月摘要
- 美金匯率即時顯示

### 💼 資產管理（管理）
| 資產類型 | 功能說明 |
|----------|----------|
| 流動現金 | 支援多幣種（TWD、USD、JPY、SGD、EUR、HKD），自動換算台幣現值 |
| 台股 | 輸入代號與股數，自動抓取即時股價（Yahoo Finance） |
| 美股 | 輸入代號與股數，自動抓取即時股價（Yahoo Finance），換算台幣 |
| 加密貨幣 | 輸入幣種與數量，透過 CoinGecko API 抓取即時幣價 |
| 質押/活存收益 | 記錄每月因質押或活存增加的幣量與當下台幣價值 |
| 儲蓄險 | 輸入美元保額，自動換算台幣 |
| 房地產 | 記錄不動產市值（計入總資產但排除於可用資產） |
| 負債 | 記錄貸款等負債總額 |

### 🔄 自動更新
- 每 5 分鐘自動刷新所有市場報價
- Header 顯示最後更新時間、狀態指示燈與版本號
- 支援部分報價失敗時的錯誤提示

### 📸 快照功能
- 可手動儲存每月資產快照，用於計算本月收益與累計成長率
- 快照按鈕顯示上次儲存日期，趨勢圖無資料時可直接在畫面內儲存快照

### 🎨 主題切換
- 支援 Dark Mode（深色）與 Light Mode（白色木質調）
- 主題設定自動保存，重新整理後保持

---

## 🛠️ 技術棧

| 類別 | 技術 |
|------|------|
| 前端 | HTML5、CSS3（CSS Variables）、Vanilla JavaScript |
| 圖表 | [Chart.js 4.4.0](https://www.chartjs.org/) |
| 認證 | Google Identity Services（OAuth 2.0） |
| 資料儲存 | Google Sheets API v4 |
| 股票報價 | Yahoo Finance API（透過 CORS Proxy） |
| 加密貨幣報價 | [CoinGecko API](https://www.coingecko.com/en/api)（透過 CORS Proxy） |
| 匯率 | Yahoo Finance（USDTWD=X、SGDTWD=X 等） |
| 部署 | GitHub Pages |

---

## 🚀 使用方法

1. 訪問 [https://ogeorge0820.github.io/asset-recorder](https://ogeorge0820.github.io/asset-recorder)
2. 點擊「使用 Google 帳號登入」按鈕
3. 授權應用程式存取 Google Sheets
4. 在「管理」頁面新增或修改各類資產
5. 在「總覽」頁面查看資產儀表板

---

## ⚙️ 開發設定

### 前置需求
- Google Cloud Console 專案
- 已啟用 Google Sheets API 與 Google Identity Services
- OAuth 2.0 Client ID（Web application 類型）

### 授權 URI 設定
在 Google Cloud Console → APIs & Services → Credentials 中，需將以下 URI 加入 **Authorized redirect URIs**：

```
https://ogeorge0820.github.io
http://localhost:3000
http://localhost:8000
http://localhost:8080
```

### 本地開發
```bash
# 使用 Python 啟動本地伺服器
python3 -m http.server 8080

# 接著開啟瀏覽器前往
# http://localhost:8080
```

---

## 📁 專案結構

```
asset-recorder/
├── index.html    # HTML 結構（登入畫面、儀表板、管理頁面）
├── style.css     # 所有樣式（Dark/Light Mode、RWD）
└── app.js        # 所有邏輯（API 串接、資料處理、圖表渲染）
```

---

## 📋 版本歷史

### v0.3 (2026/04/09 14:24)

#### ✨ 新功能

- **本月收益 KPI**：新增「本月收益」卡片，計算公式為「可用資產 − 上月底（3/31）快照基準」，收益正/負動態顯示綠/紅色邊框
- **本年收益 KPI**：新增「本年收益」卡片，計算公式為「可用資產 − 2025/12/31 年底快照基準」，全年損益一目了然
- **資產詳細 Panel**（互動優化）：
  - 加密貨幣、台股、美股、流動現金均新增底部滑入式 Detail Panel
  - Panel 支援查看完整變動記錄（`crypto_history` / `tw_history` / `us_history`）
  - 提供「＋ 增減數量」與「✎ 設定餘額」快速操作，每次變動自動寫入歷史 sheet
  - 支援從 Panel 內直接刪除資產
- **淨資產趨勢圖**（原總資產趨勢圖）：
  - 圖表聚焦單一「淨資產」折線，移除總資產線，資訊更聚焦
  - 整合 4 筆歷史快照種子資料（2025/12、2026/01、2026/02、2026/03）
  - 若 Google Sheet 已有同月快照，以 Sheet 資料優先
  - X 軸加入 `maxRotation:0` 防止手機版標籤重疊

#### 🎨 UI / UX 優化

- **全站行動端卡片佈局**：
  - 流動現金、台股、美股、加密貨幣列表全部採用卡片式佈局（與桌機 Table 並行）
  - 統一卡片結構：左側百分比圓圈 → 資產名稱 → 右側台幣現值 + 詳細資訊
  - 百分比移至最左側，解決名稱顯示截斷（...）問題
- **Section 合計上移**：各資產區塊的「合計」欄位從底部移動到標題列右側，資訊密度更高
- **KPI 層級重構**：總資產、淨資產、可用資產改用 `kpi-primary` 視覺強調樣式

#### 🔧 系統優化

- **價格快取機制**（防止 Rate Limit）：
  - 使用 `localStorage` 跨 Tab / Reload 共享價格快取（TTL 4.5 分鐘）
  - 僅在完全無錯誤時寫入快取，防止把失敗結果快取下來
  - 解決桌機頻繁切換視窗觸發 CoinGecko/Yahoo API rate limit 導致「更新失敗」的問題
- **快照全自動化**：移除 UI 中所有手動快照按鈕（包含趨勢圖 nodata 區塊與管理頁快照列），改為完全依賴每日 23:59 自動背景記錄

#### 🐛 Bug Fix

- **修正 net_assets 索引錯誤**：`renderTrend()` 與 `renderMonthly()` 原本誤用 `s[7]`（debt）讀取 net_assets，已修正為 `s[8]`（net_assets）

---

### v0.2 (2026/04/08 23:10)

#### ✨ 新功能

- **可用資產 KPI**：新增「可用資產」卡片（公式：總資產 − 房地產），更清楚呈現可流動的資產規模
- **Light / Dark Mode**：
  - Header 新增主題切換按鈕（☀ / 🌙）
  - Light Mode 採白色木質調設計（暖色奶油底色、木棕色強調色）
  - 主題設定透過 `localStorage` 持久化，重整後保留
  - Chart.js 圖表顏色（grid、tick、legend）隨主題同步切換
- **每日資產趨勢圖**：新增每日自動快照（每天 23:59 自動記錄）並以折線圖呈現
- **質押 / 活存收益記錄**（全新功能）：
  - 管理頁新增「🎁 質押/活存收益記錄」section
  - 可記錄每月因質押或活存增加的幣量、當時幣價（USD）及台幣收益價值
  - 新增收益 Modal：月份預設當月、幣種下拉自動帶入現有持倉、幣價自動填入即時報價、TWD 即時計算
  - 支援編輯與刪除，footer 顯示本月收益合計
  - 總覽頁新增「質押/活存收益（本月）」摘要卡片，依幣種顯示本月增量與收益
  - 資料存入 Google Sheets 新 sheet：`crypto_rewards`
- **版本號顯示**：Header 新增版本時間 badge（`版本 YYYY/MM/DD HH:MM`）

#### 🎨 UI / UX 優化

- **行動端響應式設計**：
  - 管理頁表格改為 flex-nowrap 單行佈局，名稱欄優先壓縮，操作按鈕永遠在同一行靠右
  - 所有輸入框、按鈕 `min-height: 44px`，符合 iOS / Android 觸控標準
  - 首頁版本資訊在手機版改顯示於 KPI 區塊上方（`.mobile-build-bar`）
- **圓餅圖優化**：
  - 手機版圖例縮小（10px 字體、8px padding），避免「房地產」標籤換行
  - Tooltip 改為 `position: 'nearest'`，靠近點擊扇形顯示，不遮住中心數字
- **圖表順序調整**：每日資產趨勢圖移至月收益圖上方，資訊層次更合理
- **本月收益卡片動態邊框**：收益為正顯示綠色左邊框，收益為負顯示紅色左邊框，一眼辨識趨勢
- **快照可發現性提升**：
  - 趨勢圖無資料時，空白狀態直接嵌入「📸 立即儲存快照」按鈕，無需跳頁
  - 管理頁快照按鈕上方顯示「上次快照：YYYY/MM」提醒
- **Header 精簡**：移除 Header 中的匯率，USD/TWD 資訊統一由 KPI 卡片呈現
- **加密貨幣數量顯示格式化**：管理頁數量統一顯示至小數點後兩位（原始資料不受影響）

#### 🔧 程式碼架構

- 將原本的單一 `index.html` 拆分為三個獨立檔案：`index.html`、`style.css`、`app.js`，提升可維護性
- 新增 `CLAUDE.md` 專案規範文件（語言、時區、UI 框架、貨幣精度）

#### 🐛 Bug Fix

- **修正加密貨幣幣價全部顯示「更新失敗」**：CoinGecko API 呼叫缺少 CORS Proxy，已補上 `corsproxy.io` proxy 路由（含 `simple/price` 與 `search` 端點）
- **修正行動端整頁橫向滑動**：`body { overflow-x: hidden }` 防止表格溢出造成頁面層級滾動
- **修正 CSS 重複 media query**：移除重複的 `@media` 定義

---

### v0.1 (2026-04-07)
> 初始版本發佈

- ✨ 儀表板功能
  - 總資產、淨資產、本月收益、累計成長率、美金匯率等 KPI 卡片
  - 資產組成圓形圖表（Chart.js）
- 💰 資產管理功能
  - 流動現金管理（支援多幣種：TWD、USD、JPY、SGD、EUR、HKD）
  - 台股投資管理（串接 Yahoo Finance 即時報價）
  - 美股投資管理（串接 Yahoo Finance 即時報價）
  - 加密貨幣管理（串接 CoinGecko 即時報價）
  - 儲蓄險與負債記錄
- 🔐 Google 整合
  - Google OAuth 2.0 認證
  - Google Sheets API v4 資料儲存與讀取
- 🎨 深色主題 UI 設計
- 🔄 每 5 分鐘自動刷新報價
- 📸 每月資產快照功能

---

## 🗺️ 未來計劃

- [ ] 資料匯出功能（PDF、Excel）
- [ ] 加密貨幣 COIN_MAP 自動更新
- [ ] 更多幣種支援
- [ ] 質押收益年化報酬率計算

---

## 👤 開發者

**George Lee** ([@ogeorge0820](https://github.com/ogeorge0820))

---

## 📄 授權

MIT License
