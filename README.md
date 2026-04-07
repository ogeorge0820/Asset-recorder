# 💰 個人資產追蹤

一個用來追蹤和管理個人資產的網頁應用，支援多種資產類型（現金、台股、美股、加密貨幣、儲蓄險等），並與 Google Sheets 整合進行資料儲存，同時串接即時市場報價 API。

🔗 **線上預覽**：[https://ogeorge0820.github.io/asset-recorder](https://ogeorge0820.github.io/asset-recorder)

---

## ✨ 功能特色

### 📊 儀表板（總覽）
- 即時顯示總資產、淨資產等關鍵 KPI 指標
- 本月收益與累計成長率（依快照計算）
- 資產組成圓形圖表（Chart.js）
- 美金匯率即時顯示

### 💼 資產管理（管理）
| 資產類型 | 功能說明 |
|----------|----------|
| 流動現金 | 支援多幣種（TWD、USD、JPY、SGD、EUR、HKD），自動換算台幣現值 |
| 台股 | 輸入代號與股數，自動抓取即時股價（Yahoo Finance） |
| 美股 | 輸入代號與股數，自動抓取即時股價（Yahoo Finance），換算台幣 |
| 加密貨幣 | 輸入幣種與數量，透過 CoinGecko API 抓取即時幣價 |
| 儲蓄險 | 輸入美元保額，自動換算台幣 |
| 負債 | 記錄貸款等負債總額 |

### 🔄 自動更新
- 每 5 分鐘自動刷新所有市場報價
- 顯示最後更新時間與狀態指示燈
- 支援部分報價失敗時的錯誤提示

### 📸 快照功能
- 可手動儲存每日資產快照
- 快照資料用於計算本月收益與累計成長率

---

## 🛠️ 技術棧

| 類別 | 技術 |
|------|------|
| 前端 | HTML5、CSS3（CSS Variables）、Vanilla JavaScript |
| 圖表 | [Chart.js 4.4.0](https://www.chartjs.org/) |
| 認證 | Google Identity Services（OAuth 2.0） |
| 資料儲存 | Google Sheets API v4 |
| 股票報價 | Yahoo Finance API（透過 CORS Proxy） |
| 加密貨幣報價 | [CoinGecko API](https://www.coingecko.com/en/api) |
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
```

### 本地開發
由於本專案為純靜態 HTML，可直接用瀏覽器開啟，或透過本地伺服器執行：

```bash
# 使用 Python 啟動本地伺服器
python3 -m http.server 8000

# 或使用 Node.js
npx serve .
```

---

## 📁 專案結構

```
asset-recorder/
└── index.html    # 主要應用程式（單頁應用）
```

---

## 📋 版本歷史

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
- 📸 每日資產快照功能

---

## 🗺️ 未來計劃

- [ ] 資產歷史趨勢折線圖
- [ ] 月度收益統計報表
- [ ] 移動端 (RWD) 優化
- [ ] 資料匯出功能（PDF、Excel）
- [ ] 加密貨幣 COIN_MAP 自動更新
- [ ] 更多幣種支援

---

## 👤 開發者

**George Lee** ([@ogeorge0820](https://github.com/ogeorge0820))

---

## 📄 授權

MIT License
