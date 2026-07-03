/************************************************************
 * 資產追蹤 — 雲端夜間每日快照（夜班記帳員）
 *
 * 部署位置：綁定在資產試算表的 Apps Script（擴充功能 → Apps Script）
 * 用途：解決「app 沒開就缺當日快照」的問題——不管手機/電腦有沒有開，
 *       Google 伺服器每晚都會自動寫入當天的 daily_snapshots。
 *
 * 函式說明：
 *   setupTriggers()   — 執行一次即可：建立每晚 22 點與 23 點各一次的
 *                        自動觸發（雙保險，皆為台北時間）
 *   nightlySnapshot() — 觸發器呼叫的主函式：抓即時價格 → 算總值 →
 *                        upsert 當天一列（與 app 寫入格式完全相同）
 *   backfillJul2()    — 一次性：用 2026/07/02 當天收盤價回補缺日
 *   backfillDate(ds)  — 通用回補（ds 格式 'yyyy/MM/dd'）
 *
 * 安全設計：
 *   - 只 upsert「單一列」，絕不清空、絕不重寫整張表（不可能抹掉歷史）
 *   - 沿用 app 的防呆：價格沒載到 / 匯率不合理 → 直接放棄本次寫入
 *   - 額外防呆：任一資產類別「有持倉但總值算出 0」→ 放棄（防假懸崖）
 *   - 當天已有快照且本次抓價有任何失敗 → 不覆寫（保留 app 寫的好資料）
 ************************************************************/

var TZ = 'Asia/Taipei';

// ── 與 app.js 同步的常數（來源：app.js COIN_MAP / STABLECOINS）──
var COIN_MAP = {
  BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', SOL:'solana',
  XRP:'ripple', ADA:'cardano', DOGE:'dogecoin', DOT:'polkadot',
  AVAX:'avalanche-2', MATIC:'matic-network', LINK:'chainlink',
  UNI:'uniswap', LTC:'litecoin', BCH:'bitcoin-cash', ALGO:'algorand',
  ATOM:'cosmos', XLM:'stellar', VET:'vechain', MANA:'decentraland',
  SAND:'the-sandbox', SHIB:'shiba-inu', TRX:'tron', FIL:'filecoin',
  NEAR:'near', APT:'aptos', SUI:'sui', ARB:'arbitrum',
  OP:'optimism', INJ:'injective-protocol', PEPE:'pepe',
  CRO:'crypto-com-chain', BGB:'bitget-token', IMX:'immutable-x', FET:'fetch-ai',
  TAO:'bittensor', USDT:'tether', USDC:'usd-coin', DAI:'dai'
};
var STABLECOINS = { USDT:1, USDC:1, DAI:1, BUSD:1, TUSD:1, FRAX:1, FDUSD:1 };

// ══════════════════════════════════════════════════════════
// ★ 一鍵安裝：George 只需要執行這一個函式 ★
//   1. 建立每晚自動快照的觸發器
//   2. 立刻試跑一次夜間快照（驗證整條管線通）
// （不回補歷史缺日；日後若要補某天，手動執行 backfillDate）
// ══════════════════════════════════════════════════════════
function install() {
  setupTriggers();
  Logger.log('── 步驟 1/2 完成：每日觸發器已建立（台北 22 點與 23 點）');
  nightlySnapshot();
  Logger.log('── 步驟 2/2 完成：夜間快照試跑結束（結果見上一行）');
  Logger.log('✅ 安裝完成。之後每晚會自動記錄當日快照，手機不用開。');
}

// ══════════════════════════════════════════════════════════
// 觸發器設定（執行一次）
// ══════════════════════════════════════════════════════════
function setupTriggers() {
  // 先清掉舊的同名觸發器，避免重複
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlySnapshot') ScriptApp.deleteTrigger(t);
  });
  // 台北時間每晚 22:00-23:00 與 23:00-24:00 各觸發一次（Google 在該小時內隨機時刻執行）
  ScriptApp.newTrigger('nightlySnapshot').timeBased().everyDays(1).atHour(22).inTimezone(TZ).create();
  ScriptApp.newTrigger('nightlySnapshot').timeBased().everyDays(1).atHour(23).inTimezone(TZ).create();
  Logger.log('已建立 2 個每日觸發器（台北 22 點與 23 點各一次）');
}

// ══════════════════════════════════════════════════════════
// 主函式：夜間快照
// ══════════════════════════════════════════════════════════
function nightlySnapshot() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ds = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd');
  var data = readHoldings_(ss);
  var errs = [];

  // ── 抓即時價格（來源與 app.js 相同：Yahoo / Binance → CryptoCompare → CoinGecko）
  var usdtwd = null;
  try { usdtwd = yahooPrice_('USDTWD=X'); } catch (e) { errs.push('usdtwd:' + e.message); }
  var fx = fetchFxRates_(data.cash, usdtwd, errs);
  var twP = fetchYahooBatch_(data.tw.map(function (r) { return r[0]; }), '.TW', errs, 'tw');
  var usP = fetchYahooBatch_(data.us.map(function (r) { return r[0]; }), '', errs, 'us');
  var cryP = fetchCryptoPrices_(data.crypto.map(function (r) { return String(r[0] || '').toUpperCase(); }), errs);

  var row = buildSnapshotRow_(ds, data, usdtwd, fx, twP, usP, cryP);
  if (!row.ok) { Logger.log('放棄寫入：' + row.reason); return; }

  // 當天已有快照且本次抓價不完全乾淨 → 不覆寫（保留既有資料）
  var exists = findDateRow_(ss, ds) > 0;
  if (exists && errs.length) {
    Logger.log('當日已有快照且本次有 ' + errs.length + ' 項價格失敗，保留原資料不覆寫。失敗：' + errs.join(', '));
    return;
  }
  var action = upsertDailyRow_(ss, row.values);
  Logger.log(ds + ' 快照 ' + action + '（淨資產 ' + row.values[8] + '；價格失敗 ' + errs.length + ' 項）');
}

// ══════════════════════════════════════════════════════════
// 回補缺日（用當日收盤價；持倉數量/現金/設定用「現在」的值近似）
// ══════════════════════════════════════════════════════════
function backfillJul2() { backfillDate('2026/07/02'); }

function backfillDate(ds) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (findDateRow_(ss, ds) > 0) { Logger.log(ds + ' 已存在，跳過回補'); return; }
  var data = readHoldings_(ss);
  var errs = [];
  var endTs = dateStrEndEpoch_(ds); // 該日 23:59 台北時間的 epoch 秒

  var usdtwd = null;
  try { usdtwd = yahooHistClose_('USDTWD=X', endTs); } catch (e) { errs.push('usdtwd:' + e.message); }
  var fx = { TWD: 1, USD: usdtwd };
  ccyList_(data.cash).forEach(function (ccy) {
    if (ccy === 'TWD' || ccy === 'USD') return;
    try { fx[ccy] = yahooHistClose_(ccy + 'TWD=X', endTs); } catch (e) { errs.push('fx_' + ccy + ':' + e.message); }
  });
  var twP = {}, usP = {}, cryP = {};
  data.tw.forEach(function (r) {
    try { twP[r[0]] = yahooHistClose_(r[0] + '.TW', endTs); } catch (e) { errs.push('tw_' + r[0] + ':' + e.message); }
  });
  data.us.forEach(function (r) {
    try { usP[r[0]] = yahooHistClose_(r[0], endTs); } catch (e) { errs.push('us_' + r[0] + ':' + e.message); }
  });
  data.crypto.forEach(function (r) {
    var sym = String(r[0] || '').toUpperCase();
    if (STABLECOINS[sym]) { cryP[sym] = 1.0; return; }
    try { cryP[sym] = cryptoHistClose_(sym, endTs); } catch (e) { errs.push('c_' + sym + ':' + e.message); }
  });

  var row = buildSnapshotRow_(ds, data, usdtwd, fx, twP, usP, cryP);
  if (!row.ok) { Logger.log('回補失敗：' + row.reason + '；錯誤：' + errs.join(', ')); return; }
  var action = upsertDailyRow_(ss, row.values);
  Logger.log(ds + ' 回補 ' + action + '（淨資產 ' + row.values[8] + '；價格失敗 ' + errs.length + ' 項' +
    (errs.length ? '：' + errs.join(', ') : '') + '）');
}

// ══════════════════════════════════════════════════════════
// 共用：讀取持倉 / 組快照列 / upsert
// ══════════════════════════════════════════════════════════
function readHoldings_(ss) {
  return {
    cash:   readRows_(ss, 'cash_accounts'),   // [bank_name, amount, currency]
    tw:     readRows_(ss, 'holdings_tw'),     // [symbol, shares]
    us:     readRows_(ss, 'holdings_us'),     // [symbol, shares]
    crypto: readRows_(ss, 'holdings_crypto'), // [symbol, quantity]
    settings: readSettings_(ss)               // { insurance_total(USD), realestate_total, debt }
  };
}

function readRows_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('找不到分頁: ' + name);
  var vals = sh.getDataRange().getValues();
  return vals.slice(1).filter(function (r) { return String(r[0]) !== ''; });
}

function readSettings_(ss) {
  var out = { insurance_total: 0, realestate_total: 0, debt: 0 };
  readRows_(ss, 'settings').forEach(function (r) {
    var k = String(r[0]);
    if (k) out[k] = parseFloat(r[1]) || 0;
  });
  return out;
}

// 對齊 app.js calcTotals() + doSaveDailySnapshot() 的計算與防呆
function buildSnapshotRow_(ds, data, usdtwd, fx, twP, usP, cryP) {
  if (!usdtwd || usdtwd < 10) return { ok: false, reason: '匯率不合理或未載入 usdtwd=' + usdtwd };
  // 防呆 0：持有的非 TWD/USD 幣別若匯率沒抓到 → 中止。
  // （app 端有預設匯率種子值可退；這裡沒有，若放行會以美金匯率頂替、嚴重灌水，寧可不寫）
  for (var ci = 0; ci < data.cash.length; ci++) {
    var ccy0 = String(data.cash[ci][2] || 'TWD').toUpperCase();
    var amt0 = parseFloat(data.cash[ci][1]) || 0;
    if (amt0 !== 0 && ccy0 !== 'TWD' && ccy0 !== 'USD' &&
        (fx[ccy0] === undefined || fx[ccy0] === null)) {
      return { ok: false, reason: '匯率未載入: ' + ccy0 };
    }
  }
  var rate = usdtwd;
  var cashT = data.cash.reduce(function (s, r) {
    var amt = parseFloat(r[1]) || 0;
    var ccy = String(r[2] || 'TWD').toUpperCase();
    var fr = (fx[ccy] !== undefined && fx[ccy] !== null) ? fx[ccy] : rate; // 防呆 0 已保證持有幣別必有匯率
    return s + amt * fr;
  }, 0);
  var twT = data.tw.reduce(function (s, r) { return s + (parseFloat(r[1]) || 0) * (twP[r[0]] || 0); }, 0);
  var usT = data.us.reduce(function (s, r) { return s + (parseFloat(r[1]) || 0) * (usP[r[0]] || 0) * rate; }, 0);
  var cryT = data.crypto.reduce(function (s, r) {
    return s + (parseFloat(r[1]) || 0) * (cryP[String(r[0] || '').toUpperCase()] || 0) * rate;
  }, 0);
  var ins = (data.settings.insurance_total || 0) * rate; // USD 存量
  var re = data.settings.realestate_total || 0;
  var debt = data.settings.debt || 0;
  var net = cashT + twT + usT + cryT + ins + re - debt;

  // 防呆 1（同 app 意圖）：有實際持倉但投資總值 = 0 → 價格沒載到
  // 注意：持倉判定用「數量 > 0」的列數——app 會種零股數占位列（如 ['0050','0']），
  // 若用 .length 判定，一個全是占位列的類別會讓快照永遠拒寫
  var twHeld = countHeld_(data.tw), usHeld = countHeld_(data.us), cryHeld = countHeld_(data.crypto);
  var hasHoldings = twHeld || usHeld || cryHeld;
  if (hasHoldings && (twT + usT + cryT) === 0) return { ok: false, reason: '投資總值為 0（價格未載入）' };
  // 防呆 2（加強）：任一類別有實際持倉但該類總值 = 0 → 防止單類假懸崖
  if (twHeld && twT === 0) return { ok: false, reason: '台股價格全數未載入' };
  if (usHeld && usT === 0) return { ok: false, reason: '美股價格全數未載入' };
  if (cryHeld && cryT === 0) return { ok: false, reason: '加密貨幣價格全數未載入' };

  // prices_json：只收錄成功取得的價格（同 app 過濾 null）
  var priceSnap = { tw: cleanMap_(twP), us: cleanMap_(usP), crypto: cleanMap_(cryP) };
  // 全部轉字串，對齊 app 以 RAW 寫入的既有格式（避免 Sheets 自動轉型改變日期/數字外觀）
  var values = [ds, cashT.toFixed(0), twT.toFixed(0), usT.toFixed(0), cryT.toFixed(0),
    ins.toFixed(0), re.toFixed(0), debt.toFixed(0), net.toFixed(0), JSON.stringify(priceSnap)];
  return { ok: true, values: values };
}

function cleanMap_(m) {
  var out = {};
  Object.keys(m).forEach(function (k) { if (m[k] !== null && m[k] !== undefined) out[k] = m[k]; });
  return out;
}

// 「實際持倉」列數（數量 > 0；排除零股數占位列）
function countHeld_(rows) {
  return rows.filter(function (r) { return (parseFloat(r[1]) || 0) > 0; }).length;
}

// 回傳 ds 所在的列號（1-based；0 = 不存在）
function findDateRow_(ss, ds) {
  var sh = ss.getSheetByName('daily_snapshots');
  if (!sh) throw new Error('找不到分頁: daily_snapshots');
  var col = sh.getRange(1, 1, sh.getLastRow() || 1, 1).getValues();
  for (var i = 1; i < col.length; i++) {
    if (normDate_(col[i][0]) === ds) return i + 1;
  }
  return 0;
}

// 儲存格可能是文字 "2026/07/02" 或真日期物件——統一正規化成 yyyy/MM/dd 再比對
function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy/MM/dd');
  return String(v);
}

// 只動一列：存在 → 覆寫；不存在 → 插入到日期排序正確的位置（或附加到最後）
function upsertDailyRow_(ss, row) {
  var sh = ss.getSheetByName('daily_snapshots');
  // 全空表（連標題列都沒有）= 疑似抹除進行中 → 拒寫並拋錯（觸發器失敗通知會寄信提醒）
  if (sh.getLastRow() === 0) throw new Error('daily_snapshots 完全空白（無標題列），疑似異常狀態，中止寫入');
  var existing = findDateRow_(ss, row[0]);
  if (existing > 0) { writeRow_(sh, existing, row); return '已更新既有列'; }
  var last = sh.getLastRow();
  var col = sh.getRange(1, 1, last, 1).getValues();
  var insertAt = 0;
  for (var i = 1; i < col.length; i++) {
    if (normDate_(col[i][0]) > row[0]) { insertAt = i + 1; break; }
  }
  if (insertAt > 0) {
    sh.insertRowBefore(insertAt);
    writeRow_(sh, insertAt, row);
    return '已插入第 ' + insertAt + ' 列';
  }
  // 附加到最後：格線列數用盡時 getRange 會拋錯（不像 appendRow 會自動擴充），先擴充
  if (last + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  writeRow_(sh, last + 1, row);
  return '已附加到最後';
}

function writeRow_(sh, rowIdx, row) {
  var rng = sh.getRange(rowIdx, 1, 1, row.length);
  rng.setNumberFormat('@'); // 純文字，對齊 app RAW 寫入格式
  rng.setValues([row]);
}

// ══════════════════════════════════════════════════════════
// 價格來源（即時）
// ══════════════════════════════════════════════════════════
function fetchJson_(url) {
  var r = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode());
  return JSON.parse(r.getContentText());
}

function yahooPrice_(ticker) {
  var hosts = ['query1', 'query2'];
  for (var i = 0; i < hosts.length; i++) {
    try {
      var d = fetchJson_('https://' + hosts[i] + '.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker));
      var p = d && d.chart && d.chart.result && d.chart.result[0] && d.chart.result[0].meta &&
        d.chart.result[0].meta.regularMarketPrice;
      if (p) return p;
    } catch (e) { if (i === hosts.length - 1) throw e; }
  }
  throw new Error('no price: ' + ticker);
}

function fetchYahooBatch_(syms, suffix, errs, tag) {
  var out = {};
  syms.filter(Boolean).forEach(function (sym) {
    try { out[sym] = yahooPrice_(sym + suffix); }
    catch (e) { errs.push(tag + '_' + sym + ':' + e.message); }
  });
  return out;
}

// 現金幣別列表（一定含 USD，供 usdtwd 使用）
function ccyList_(cash) {
  var set = { USD: 1 };
  cash.forEach(function (r) { set[String(r[2] || 'TWD').toUpperCase()] = 1; });
  return Object.keys(set);
}

function fetchFxRates_(cash, usdtwd, errs) {
  var fx = { TWD: 1, USD: usdtwd };
  ccyList_(cash).forEach(function (ccy) {
    if (ccy === 'TWD' || ccy === 'USD') return;
    try { fx[ccy] = yahooPrice_(ccy + 'TWD=X'); }
    catch (e) { errs.push('fx_' + ccy + ':' + e.message); }
  });
  return fx;
}

// 加密即時價：穩定幣 $1 → Binance（並行）→ CryptoCompare → CoinGecko（與 app.js 三層一致）
function fetchCryptoPrices_(syms, errs) {
  var out = {};
  var toFetch = [];
  syms.filter(Boolean).forEach(function (s) {
    if (STABLECOINS[s]) out[s] = 1.0; else toFetch.push(s);
  });
  if (!toFetch.length) return out;

  var notFound = [];
  try {
    var resps = UrlFetchApp.fetchAll(toFetch.map(function (s) {
      return { url: 'https://api.binance.com/api/v3/ticker/price?symbol=' + s + 'USDT', muteHttpExceptions: true };
    }));
    resps.forEach(function (r, i) {
      try {
        var d = JSON.parse(r.getContentText());
        if (r.getResponseCode() === 200 && d.price) out[toFetch[i]] = parseFloat(d.price);
        else notFound.push(toFetch[i]);
      } catch (e) { notFound.push(toFetch[i]); }
    });
  } catch (e) { notFound = toFetch.slice(); }

  if (notFound.length) {
    var still = [];
    try {
      var d1 = fetchJson_('https://min-api.cryptocompare.com/data/pricemulti?fsyms=' + notFound.join(',') + '&tsyms=USD');
      notFound.forEach(function (s) {
        if (d1[s] && d1[s].USD) out[s] = d1[s].USD; else still.push(s);
      });
    } catch (e) { still = notFound.slice(); }
    notFound = still;
  }

  if (notFound.length) {
    var ids = notFound.map(function (s) { return COIN_MAP[s] || s.toLowerCase(); });
    try {
      var d2 = fetchJson_('https://api.coingecko.com/api/v3/simple/price?ids=' + ids.join(',') + '&vs_currencies=usd');
      notFound.forEach(function (s, i) {
        if (d2[ids[i]] && d2[ids[i]].usd) out[s] = d2[ids[i]].usd;
        else errs.push('c_' + s + ':no price');
      });
    } catch (e) {
      notFound.forEach(function (s) { errs.push('c_' + s + ':' + e.message); });
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════
// 價格來源（歷史收盤，回補用）
// ══════════════════════════════════════════════════════════
// ds 當日 23:59（台北）的 epoch 秒
function dateStrEndEpoch_(ds) {
  var m = ds.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!m) throw new Error('日期格式須為 yyyy/MM/dd: ' + ds);
  // 台北 = UTC+8：當日 23:59 TW = 當日 15:59 UTC
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], 15, 59, 0) / 1000);
}

// Yahoo 歷史：取「endTs 之前最後一筆」日線收盤（假日自動沿用前一交易日，與 app 當晚快照到的值一致）
function yahooHistClose_(ticker, endTs) {
  var startTs = endTs - 8 * 86400; // 往前抓 8 天，涵蓋連假
  var hosts = ['query1', 'query2'];
  for (var i = 0; i < hosts.length; i++) {
    try {
      var d = fetchJson_('https://' + hosts[i] + '.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) +
        '?interval=1d&period1=' + startTs + '&period2=' + endTs);
      var res = d && d.chart && d.chart.result && d.chart.result[0];
      var ts = res && res.timestamp;
      var closes = res && res.indicators && res.indicators.quote && res.indicators.quote[0] &&
        res.indicators.quote[0].close;
      if (ts && closes) {
        for (var j = ts.length - 1; j >= 0; j--) {
          if (ts[j] <= endTs && closes[j] !== null && closes[j] !== undefined) return closes[j];
        }
      }
    } catch (e) { if (i === hosts.length - 1) throw e; }
  }
  throw new Error('no hist close: ' + ticker);
}

// 加密歷史：CryptoCompare 小時線收盤（endTs 當下最近一小時）→ 失敗改 CoinGecko 每日快照
function cryptoHistClose_(sym, endTs) {
  try {
    var d = fetchJson_('https://min-api.cryptocompare.com/data/v2/histohour?fsym=' + sym + '&tsym=USD&limit=1&toTs=' + endTs);
    var arr = d && d.Data && d.Data.Data;
    if (arr && arr.length && arr[arr.length - 1].close) return arr[arr.length - 1].close;
  } catch (e) { /* fallthrough */ }
  var id = COIN_MAP[sym] || sym.toLowerCase();
  // CoinGecko /history 回傳「該日 00:00 UTC」的快照。目標時刻是台北 23:59（= 當日 15:59 UTC），
  // 取「次一 UTC 日」的 00:00（目標後 8 小時）遠比取當日 00:00（目標前 16 小時）接近收盤。
  // 若次日 00:00 UTC 還沒過（給快照 1 小時緩衝），才退回當日。
  var nextDayStartTs = endTs + 28860; // 15:59 UTC + 8h01m = 次日 00:00 UTC
  var useTs = (Date.now() / 1000 > nextDayStartTs + 3600) ? nextDayStartTs : endTs - 86400 + 28860;
  var dateStr = Utilities.formatDate(new Date(useTs * 1000), 'UTC', 'dd-MM-yyyy');
  var d2 = fetchJson_('https://api.coingecko.com/api/v3/coins/' + id + '/history?date=' + dateStr);
  var p = d2 && d2.market_data && d2.market_data.current_price && d2.market_data.current_price.usd;
  if (p) return p;
  throw new Error('no hist close: ' + sym);
}
