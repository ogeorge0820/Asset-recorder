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

### v0.2 (2026-04-08)

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

- **圖表順序調整**：每日資產趨勢圖移至月收益圖上方，資訊層次更合理
- **本月收益卡片動態邊框**：收益為正顯示綠色左邊框，收益為負顯示紅色左邊框，一眼辨識趨勢
- **觸控體驗改善**：編輯 / 刪除 icon 按鈕點擊區域擴大至 44×44px，符合 iOS / Android 觸控標準
- **快照可發現性提升**：
  - 趨勢圖無資料時，空白狀態直接嵌入「📸 立即儲存快照」按鈕，無需跳頁
  - 管理頁快照按鈕上方顯示「上次快照：YYYY/MM」提醒
- **Header 精簡**：移除 Header 中的匯率與更新時間，改放至更新時間 badge 回 Header，USD/TWD 資訊統一由 KPI 卡片呈現

#### 🔧 程式碼架構

- 將原本的單一 `index.html` 拆分為三個獨立檔案：`index.html`、`style.css`、`app.js`，提升可維護性

#### 🐛 Bug Fix

- **修正加密貨幣幣價全部顯示「更新失敗」**：CoinGecko API 呼叫缺少 CORS Proxy，導致瀏覽器端跨域請求被封鎖。已補上與 Yahoo Finance 相同的 `corsproxy.io` proxy 路由（含 `simple/price` 與 `search` 端點）
- **修正 CSS 重複 media query**：移除 `@media (max-width: 1100px)` 與 `@media (max-width: 1200px)` 的重複定義

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
