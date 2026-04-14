// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════
// Build 時間：每次修改 code 後手動更新此時間（UTC+8 台北時間）
const BUILD_DATE = '2026/04/14 12:25';

const SPREADSHEET_ID = '1lpRpxVzWaYUqL-jVPOAJCtjsJUIedPYYyOx4gg4PPFU';
const CLIENT_ID = '149884248440-85f8dhc6ub9up10sv0f89e3e0itrnooj.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const PROXY = 'https://corsproxy.io/?';
const PROXY_BACKUP = 'https://api.allorigins.win/raw?url=';

// George，未來每個月初請在這裡更新上月底的快照金額
const LAST_MONTH_AVAILABLE_SNAPSHOT = 17819156;

// George，未來每年底請在這裡更新當年 12/31 的可用資產快照金額
const LAST_YEAR_END_AVAILABLE_SNAPSHOT = 22272019; // 2025/12/31 快照

// 2026/02/28 加密貨幣數量基準（首次啟動時自動寫入 crypto_history，僅執行一次）
const BASELINE_FEB28 = [
  ['BTC', 3.019], ['ETH', 46.986], ['USDT', 29036.299], ['BNB', 24.359],
  ['CRO', 178573.150], ['SOL', 85.809], ['ADA', 23618.738], ['SUI', 4560.470],
  ['BGB', 2031.098], ['AVAX', 281.443], ['TAO', 2.630], ['LINK', 77.779],
  ['APT', 571.834], ['NEAR', 412.734], ['IMX', 3156.570], ['FET', 1005.576],
];

// 若 crypto_history 中尚無 2026/02 基準資料，自動寫入一次
async function seedBaselineHistory() {
  const hasBaseline = S.data.crypto_history.some(r => r[0]?.startsWith('2026/02'));
  if (hasBaseline) return;
  const seedRows = BASELINE_FEB28.map(([sym, qty]) =>
    ['2026/02/28 基準', sym, '0', String(qty), String(qty), '', '']
  );
  S.data.crypto_history.push(...seedRows);
  S.data.crypto_history.sort((a, b) => a[0].localeCompare(b[0]));
  await saveSheet('crypto_history', S.data.crypto_history);
}

// USDT 3 月手動支出金額（計算質押利息時扣除）
const USDT_MARCH_MANUAL_ADJ = -4000;

// 批量寫入 2026/03 各幣種質押收益（首次執行，Guard：已有 2026/03 系統換算記錄則跳過）
// 需在 fetchAllPrices() 之後呼叫，確保 S.prices.crypto 已就緒
async function batchSeedMarchRewards() {
  const TARGET_MONTH = '2026/03';
  if (S.data.rewards.some(r => r[0] === TARGET_MONTH && r[5] === '系統換算')) return 0;
  return _calcAndWriteMarchRewards(TARGET_MONTH);
}

// 強制覆蓋 2026/03 質押收益：刪除舊記錄，依最新持倉重算後寫回
// 從瀏覽器 console 呼叫：await forceReseedMarchRewards()
async function forceReseedMarchRewards() {
  const TARGET_MONTH = '2026/03';
  // 先重新抓取最新持倉與報價
  await loadAll();
  await fetchAllPrices();
  // 刪除所有 2026/03 記錄（不管 type）
  const before = S.data.rewards.length;
  S.data.rewards = S.data.rewards.filter(r => r[0] !== TARGET_MONTH);
  const deleted = before - S.data.rewards.length;
  console.log(`[forceReseed] 已移除 ${deleted} 筆舊 2026/03 記錄`);
  const written = await _calcAndWriteMarchRewards(TARGET_MONTH);
  renderKPIs(); renderCharts(); renderManagement();
  showToast(`對帳完成：刪除 ${deleted} 筆，新增 ${written} 筆 2026/03 記錄`);
  return { deleted, written };
}

async function _calcAndWriteMarchRewards(TARGET_MONTH) {
  const feb28Map = new Map(BASELINE_FEB28.map(([sym, qty]) => [sym.toUpperCase(), qty]));
  const newRecords = [];
  const log = [];

  for (const holding of S.data.crypto) {
    const sym = (holding[0] || '').toUpperCase();
    const march31Qty = parseFloat(holding[1]) || 0;
    const feb28Qty = feb28Map.get(sym);
    if (feb28Qty === undefined) continue;

    const delta = march31Qty - feb28Qty;
    const manualAdj = sym === 'USDT' ? USDT_MARCH_MANUAL_ADJ : 0;
    const interestQty = delta - manualAdj;
    log.push(`${sym}: 3/31=${march31Qty}, 2/28=${feb28Qty}, delta=${delta.toFixed(6)}, adj=${manualAdj}, interest=${interestQty.toFixed(6)}`);
    if (interestQty <= 0) continue;

    const price = S.prices.crypto[sym] || 0;
    const valueTWD = Math.round(interestQty * price * S.prices.usdtwd);
    newRecords.push([TARGET_MONTH, sym, interestQty, price, valueTWD, '系統換算']);
  }

  console.table(log);
  if (newRecords.length === 0) return 0;

  S.data.rewards.push(...newRecords);
  S.data.rewards.sort((a, b) => b[0].localeCompare(a[0]) || a[1].localeCompare(b[1]));
  await saveSheet('crypto_rewards', S.data.rewards);
  console.log(`[calcMarchRewards] 寫入 ${newRecords.length} 筆:`, newRecords);
  return newRecords.length;
}

// 歷史淨資產快照基準（僅含 net_assets，其他欄位補 0）
// 若 Google Sheet 中已有同月資料，以 Sheet 資料優先
const SNAPSHOT_SEEDS = [
  ['2025/12','0','0','0','0','0','0','0','25508561'],
  ['2026/01','0','0','0','0','0','0','0','24206629'],
  ['2026/02','0','0','0','0','0','0','0','21005199'],
  ['2026/03','0','0','0','0','0','0','0','21117892'],
];

async function proxyFetch(url, opts = {}) {
  try {
    const r = await fetch(`${PROXY}${encodeURIComponent(url)}`, { ...opts, signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } catch {
    const r2 = await fetch(`${PROXY_BACKUP}${encodeURIComponent(url)}`, { ...opts, signal: AbortSignal.timeout(9000) });
    if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
    return r2;
  }
}

const COIN_MAP = {
  BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', SOL:'solana',
  XRP:'ripple', ADA:'cardano', DOGE:'dogecoin', DOT:'polkadot',
  AVAX:'avalanche-2', MATIC:'matic-network', LINK:'chainlink',
  UNI:'uniswap', LTC:'litecoin', BCH:'bitcoin-cash', ALGO:'algorand',
  ATOM:'cosmos', XLM:'stellar', VET:'vechain', MANA:'decentraland',
  SAND:'the-sandbox', SHIB:'shiba-inu', TRX:'tron', FIL:'filecoin',
  NEAR:'near', APT:'aptos', SUI:'sui', ARB:'arbitrum',
  OP:'optimism', INJ:'injective-protocol', PEPE:'pepe',
  CRO:'crypto-com-coin', BGB:'bitget-token', IMX:'immutable-x', FET:'fetch-ai',
  TAO:'bittensor', USDT:'tether', USDC:'usd-coin', DAI:'dai',
};

// 穩定幣：固定 $1.00，不需呼叫 API
const STABLECOINS = new Set(['USDT','USDC','DAI','BUSD','TUSD','FRAX','FDUSD']);

const HEADERS = {
  snapshots: ['date','cash_total','stock_tw_total','stock_us_total','crypto_total','insurance_total','realestate_total','debt','net_assets'],
  daily_snapshots: ['date','cash_total','stock_tw_total','stock_us_total','crypto_total','insurance_total','realestate_total','debt','net_assets'],
  holdings_tw: ['symbol','shares'],
  holdings_us: ['symbol','shares'],
  holdings_crypto: ['symbol','quantity'],
  cash_accounts: ['bank_name','amount','currency'],
  settings: ['key','value'],
  crypto_rewards: ['date','symbol','quantity','price_usd','value_twd','type','note'],
  crypto_history: ['date','symbol','qty_before','qty_after','delta','price_usd','value_twd'],
  tw_history: ['date','symbol','qty_before','qty_after','delta','price_twd','value_twd'],
  us_history: ['date','symbol','qty_before','qty_after','delta','price_usd','value_twd'],
  cash_history: ['date','account','amount_before','amount_after','delta','currency','value_twd'],
  other_history: ['date','key','value_before','value_after','delta','note'],
  expense_budget: ['category','item_name','amount','payment_source'],
};

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════
const S = {
  token: null,
  tokenExpiry: 0,
  tokenClient: null,
  initialized: false,

  data: {
    cash: [],           // [bank_name, amount, currency]
    tw: [],             // [symbol, shares]
    us: [],             // [symbol, shares]
    crypto: [],         // [symbol, quantity]
    snapshots: [],      // [date, cash, tw, us, crypto, ins, re, debt, net]
    daily_snapshots: [], // [date, cash, tw, us, crypto, ins, re, debt, net]
    rewards: [],        // [date, symbol, quantity, price_usd, value_twd]
    crypto_history: [], // [date, symbol, qty_before, qty_after, delta, price_usd, value_twd]
    tw_history: [],     // [date, symbol, qty_before, qty_after, delta, price_twd, value_twd]
    us_history: [],     // [date, symbol, qty_before, qty_after, delta, price_usd, value_twd]
    cash_history: [],   // [date, account, amount_before, amount_after, delta, currency, value_twd]
    other_history: [],  // [date, key, value_before, value_after, delta, note]
    expense_budget: [], // [category, item_name, amount, payment_source]
    settings: { insurance_total: 0, realestate_total: 0, debt: 0 },
  },

  prices: {
    tw: {}, us: {}, crypto: {},
    usdtwd: 32.0,
    fx: { TWD:1, USD:32.0, SGD:24.0, JPY:0.22, EUR:35.0, HKD:4.1 },
    errs: {},
  },

  charts: { pie: null, trend: null, monthly: null, dailyTrend: null },
  trendFilter: 'all',
  lastUpdate: null,
};

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
function setupTokenClient() {
  if (!window.google?.accounts?.oauth2) return;

  S.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback(resp) {
      if (resp.error) {
        $('login-error').textContent = '登入失敗：' + resp.error;
        return;
      }
      S.token = resp.access_token;
      S.tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      sessionStorage.setItem('at', JSON.stringify({ t: S.token, e: S.tokenExpiry }));
      if (!S.initialized) {
        S.initialized = true;
        showApp();
      }
    },
  });

  // Restore session
  try {
    const saved = JSON.parse(sessionStorage.getItem('at') || 'null');
    if (saved && Date.now() < saved.e) {
      S.token = saved.t;
      S.tokenExpiry = saved.e;
      S.initialized = true;
      showApp();
      return;
    }
  } catch (_) {}

  $('login-screen').style.display = 'flex';
}

function signIn() {
  if (!S.tokenClient) { $('login-error').textContent = 'Google API 尚未載入，請重新整理'; return; }
  S.tokenClient.requestAccessToken({ prompt: 'consent' });
}

function signOut() {
  if (S.token) google.accounts.oauth2.revoke(S.token, () => {});
  S.token = null; S.initialized = false;
  sessionStorage.removeItem('at');
  $('app').style.display = 'none';
  $('login-screen').style.display = 'flex';
}

function showApp() {
  $('login-screen').style.display = 'none';
  $('app').style.display = 'block';
  initApp();
}

// ══════════════════════════════════════════════════════════════
// SHEETS API
// ══════════════════════════════════════════════════════════════
async function api(method, path, body) {
  const headers = { Authorization: `Bearer ${S.token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`,
    { method, headers, body: body ? JSON.stringify(body) : undefined }
  );
  if (resp.status === 401) { showToast('登入已過期，請重新登入', 'err'); signOut(); throw new Error('auth'); }
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.error?.message || `API ${resp.status}`);
  }
  return resp.json();
}

async function sheetGet(range) {
  const d = await api('GET', `/values/${encodeURIComponent(range)}`);
  return d.values || [];
}

async function sheetPut(range, values) {
  return api('PUT', `/values/${encodeURIComponent(range)}?valueInputOption=RAW`, { values });
}

async function sheetClear(range) {
  return api('POST', `/values/${encodeURIComponent(range)}:clear`, {});
}

async function sheetBatch(requests) {
  return api('POST', ':batchUpdate', { requests });
}

async function initSheets() {
  const meta = await api('GET', '?fields=sheets.properties.title');
  const existing = new Set(meta.sheets.map(s => s.properties.title));
  const needed = Object.keys(HEADERS).filter(n => !existing.has(n));

  if (needed.length > 0) {
    await sheetBatch(needed.map(title => ({ addSheet: { properties: { title } } })));
    for (const name of needed) {
      await sheetPut(`${name}!A1`, [HEADERS[name]]);
    }
    if (needed.includes('holdings_tw')) {
      const rows = [HEADERS.holdings_tw, ['0050','0'], ['00878','0']];
      await sheetPut('holdings_tw!A1', rows);
    }
    if (needed.includes('holdings_us')) {
      const rows = [HEADERS.holdings_us, ['VTI','0'],['QQQ','0'],['MARA','0'],['NVDA','0'],['TSLA','0']];
      await sheetPut('holdings_us!A1', rows);
    }
    if (needed.includes('settings')) {
      await sheetPut('settings!A1', [HEADERS.settings, ['insurance_total','0'], ['realestate_total','0'], ['debt','0']]);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// DATA LOAD / SAVE
// ══════════════════════════════════════════════════════════════
async function loadAll() {
  const [cash, tw, us, crypto, snap, daily, sett, rw, hist, twHist, usHist, cashHist, otherHist, expBudget] = await Promise.allSettled([
    sheetGet('cash_accounts!A:C'),
    sheetGet('holdings_tw!A:B'),
    sheetGet('holdings_us!A:B'),
    sheetGet('holdings_crypto!A:B'),
    sheetGet('snapshots!A:I'),
    sheetGet('daily_snapshots!A:I'),
    sheetGet('settings!A:B'),
    sheetGet('crypto_rewards!A:F'),
    sheetGet('crypto_history!A:G'),
    sheetGet('tw_history!A:G'),
    sheetGet('us_history!A:G'),
    sheetGet('cash_history!A:G'),
    sheetGet('other_history!A:F'),
    sheetGet('expense_budget!A:D'),
  ]);

  S.data.cash            = rows(cash);
  S.data.tw              = rows(tw);
  S.data.us              = rows(us);
  S.data.crypto          = rows(crypto);
  S.data.snapshots       = rows(snap);
  // 合併歷史種子：Sheet 有的月份不覆蓋，Sheet 沒有的才補入
  for (const seed of SNAPSHOT_SEEDS) {
    if (!S.data.snapshots.some(s => s[0] === seed[0])) S.data.snapshots.push(seed);
  }
  S.data.snapshots.sort((a, b) => a[0].localeCompare(b[0]));
  S.data.daily_snapshots = rows(daily);
  S.data.rewards         = rows(rw);
  S.data.crypto_history  = rows(hist);
  S.data.tw_history      = rows(twHist);
  S.data.us_history      = rows(usHist);
  S.data.cash_history    = rows(cashHist);
  S.data.other_history   = rows(otherHist);
  S.data.expense_budget  = rows(expBudget);

  S.data.settings = { insurance_total: 0, realestate_total: 0, debt: 0 };
  rows(sett).forEach(r => { if (r[0]) S.data.settings[r[0]] = parseFloat(r[1]) || 0; });
}

function rows(settled) {
  if (settled.status === 'rejected') return [];
  return (settled.value || []).slice(1).filter(r => r?.length && r[0] !== '');
}

async function saveSheet(name, dataRows) {
  const values = [HEADERS[name], ...dataRows.map(r => r.map(v => v ?? ''))];
  await sheetClear(`${name}!A:Z`);   // 先清空，防止刪除後舊列殘留
  await sheetPut(`${name}!A1`, values);
}

// ══════════════════════════════════════════════════════════════
// PRICE FETCHING
// ══════════════════════════════════════════════════════════════
const PRICE_CACHE_KEY = 'asset_price_cache';
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 分鐘，跨 tab/reload 共享

async function fetchAllPrices(force = false) {
  // ── 嘗試讀取 localStorage 快取（防止頻繁重整 / 多分頁打爆 API rate limit）
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(PRICE_CACHE_KEY));
      if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL) {
        S.prices.tw      = cached.tw      || {};
        S.prices.us      = cached.us      || {};
        S.prices.crypto  = cached.crypto  || {};
        S.prices.usdtwd  = cached.usdtwd  || 32.0;
        S.prices.fx      = cached.fx      || S.prices.fx;
        S.prices.errs    = {};
        S.lastUpdate     = new Date(cached.ts);
        setPriceStatus('ok');
        return;
      }
    } catch (_) {}
  }

  setPriceStatus('spin');
  const results = await Promise.allSettled([
    fetchUSDTWD(),
    fetchFXRates(),
    fetchTWPrices(),
    fetchUSPrices(),
    fetchCryptoPrices(),
  ]);
  S.lastUpdate = new Date();
  const hasErr = results.some(r => r.status === 'rejected') || Object.keys(S.prices.errs).length > 0;
  setPriceStatus(hasErr ? 'err' : 'ok');

  // ── 若無錯誤才寫入快取，避免把失敗的空值快取下來
  if (!hasErr) {
    try {
      localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({
        ts:     Date.now(),
        tw:     S.prices.tw,
        us:     S.prices.us,
        crypto: S.prices.crypto,
        usdtwd: S.prices.usdtwd,
        fx:     S.prices.fx,
      }));
    } catch (_) {}
  }
}

async function yahooFetch(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
  const r = await proxyFetch(url);
  const d = await r.json();
  const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!price) throw new Error('no price');
  return price;
}

async function fetchUSDTWD() {
  try {
    S.prices.usdtwd = await yahooFetch('USDTWD=X');
    S.prices.fx.USD = S.prices.usdtwd;
    S.prices.fx.TWD = 1;
    delete S.prices.errs.usdtwd;
  } catch (e) {
    S.prices.errs.usdtwd = true;
    console.warn('USDTWD failed:', e.message);
  }
}

async function fetchFXRates() {
  const pairs = { SGD:'SGDTWD=X', JPY:'JPYTWD=X', EUR:'EURTWD=X', HKD:'HKDTWD=X' };
  await Promise.allSettled(Object.entries(pairs).map(async ([ccy, ticker]) => {
    try {
      S.prices.fx[ccy] = await yahooFetch(ticker);
      delete S.prices.errs[`fx_${ccy}`];
    } catch(e) {
      S.prices.errs[`fx_${ccy}`] = true;
      console.warn(`${ticker} failed:`, e.message);
    }
  }));
}

function cashToTWD(r) {
  const amt = parseFloat(r[1]) || 0;
  const ccy = (r[2] || 'TWD').toUpperCase();
  const rate = S.prices.fx[ccy] ?? S.prices.usdtwd;
  return amt * rate;
}

async function fetchTWPrices() {
  const syms = S.data.tw.map(r => r[0]).filter(Boolean);
  await Promise.allSettled(syms.map(async sym => {
    try {
      S.prices.tw[sym] = await yahooFetch(`${sym}.TW`);
      delete S.prices.errs[`tw_${sym}`];
    } catch (e) {
      S.prices.errs[`tw_${sym}`] = true;
      console.warn(`TW ${sym}:`, e.message);
    }
  }));
}

async function fetchUSPrices() {
  const syms = S.data.us.map(r => r[0]).filter(Boolean);
  await Promise.allSettled(syms.map(async sym => {
    try {
      S.prices.us[sym] = await yahooFetch(sym);
      delete S.prices.errs[`us_${sym}`];
    } catch (e) {
      S.prices.errs[`us_${sym}`] = true;
      console.warn(`US ${sym}:`, e.message);
    }
  }));
}

async function fetchCryptoPrices() {
  const syms = S.data.crypto.map(r => r[0]?.toUpperCase()).filter(Boolean);
  if (!syms.length) return;

  // 穩定幣直接設 $1.00
  const toFetch = [];
  syms.forEach(sym => {
    if (STABLECOINS.has(sym)) {
      S.prices.crypto[sym] = 1.0;
      delete S.prices.errs[`c_${sym}`];
    } else {
      toFetch.push(sym);
    }
  });
  if (!toFetch.length) return;

  // ── 第一優先：Binance API，每個幣獨立請求（URL 最簡單，無編碼問題），全部並行
  const notFound = [];
  await Promise.allSettled(toFetch.map(async sym => {
    try {
      const r = await proxyFetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`);
      const d = await r.json();
      if (d.price) { S.prices.crypto[sym] = parseFloat(d.price); delete S.prices.errs[`c_${sym}`]; }
      else notFound.push(sym);
    } catch { notFound.push(sym); }
  }));
  // Binance 上沒有的幣種 fallback 到 CryptoCompare，再失敗才 CoinGecko
  if (notFound.length) await fetchCryptoFromCC(notFound);
}

// CryptoCompare fallback（直接 fetch，CORS 支援，用 symbol 名稱，不需要 ID mapping）
async function fetchCryptoFromCC(syms) {
  const stillMissing = [];
  try {
    const url = `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${syms.join(',')}&tsyms=USD`;
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    const d = await r.json();
    syms.forEach(sym => {
      if (d[sym]?.USD) { S.prices.crypto[sym] = d[sym].USD; delete S.prices.errs[`c_${sym}`]; }
      else { stillMissing.push(sym); console.warn(`CryptoCompare: no price for ${sym}`); }
    });
  } catch (e) {
    console.warn('CryptoCompare failed:', e.message);
    syms.forEach(s => stillMissing.push(s));
  }
  if (stillMissing.length) await fetchCryptoFromCoinGecko(stillMissing);
}

// CoinGecko 最後備用
async function fetchCryptoFromCoinGecko(syms) {
  const ids = syms.map(s => COIN_MAP[s] || s.toLowerCase());
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
  let d = null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (r.ok) d = await r.json();
  } catch {}
  if (!d) {
    try { const r = await proxyFetch(url); d = await r.json(); }
    catch (e) {
      syms.forEach(sym => { S.prices.errs[`c_${sym}`] = true; });
      console.warn('CoinGecko also failed:', e.message);
      return;
    }
  }
  if (d?.status?.error_code) {
    syms.forEach(sym => { S.prices.errs[`c_${sym}`] = true; });
    return;
  }
  syms.forEach((sym, i) => {
    const id = ids[i];
    if (d[id]?.usd) { S.prices.crypto[sym] = d[id].usd; delete S.prices.errs[`c_${sym}`]; }
    else { S.prices.errs[`c_${sym}`] = true; console.warn(`CoinGecko: no price for ${sym} (id="${id}")`); }
  });
}

async function validateCoinGecko(symbol) {
  const sym = symbol.toUpperCase();
  // 穩定幣直接通過
  if (STABLECOINS.has(sym)) return sym;
  // 先試 Binance（透過 proxy）
  try {
    const r = await proxyFetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`);
    const d = await r.json(); if (d.price) return sym;
  } catch {}
  // Fallback：CoinGecko
  const id = COIN_MAP[sym];
  if (id) return id;
  try {
    const r = await proxyFetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`);
    const d = await r.json();
    const coin = (d.coins || []).find(c => c.symbol.toUpperCase() === sym);
    if (coin) { COIN_MAP[sym] = coin.id; return coin.id; }
    return null;
  } catch { return null; }
}

function setPriceStatus(state) {
  // Management page bar
  const dot = $('price-dot'), ts = $('price-ts'), fail = $('price-fail-lbl');
  if (dot) dot.className = `dot ${state}`;
  // Header badge
  const hdrDot = $('update-dot'), hdrTs = $('update-ts');

  const sbDot = $('sidebar-update-dot'), sbTs = $('sidebar-update-ts');
  if (state === 'spin') {
    if (ts) ts.textContent = '價格更新中...';
    if (fail) fail.textContent = '';
    if (hdrDot) hdrDot.className = 'update-dot spin';
    if (hdrTs)  hdrTs.textContent = '更新中…';
    if (sbDot)  sbDot.className  = 'update-dot spin';
    if (sbTs)   sbTs.textContent = '更新中…';
  } else {
    const t = S.lastUpdate
      ? S.lastUpdate.toLocaleTimeString('zh-TW', {hour:'2-digit', minute:'2-digit'})
      : '—';
    if (ts) ts.textContent = `最後更新：${t}`;
    if (state === 'err') {
      if (fail) fail.innerHTML = '<span style="color:var(--red)">⚠ 部分價格更新失敗</span>';
      if (hdrDot) hdrDot.className = 'update-dot err';
      if (sbDot)  sbDot.className  = 'update-dot err';
    } else {
      if (fail) fail.textContent = '';
      if (hdrDot) hdrDot.className = 'update-dot ok';
      if (sbDot)  sbDot.className  = 'update-dot ok';
    }
    if (hdrTs) hdrTs.textContent = `${t} 更新`;
    if (sbTs)  sbTs.textContent  = `${t} 更新`;
    const menuTs = $('menu-update-ts'); if (menuTs) menuTs.textContent = `${t}`;
    // Mobile footer dot
    const fDot = $('mobile-footer-dot');
    if (fDot) fDot.className = `mobile-footer-dot ${state === 'err' ? 'err' : 'ok'}`;
    const fTs = $('mobile-footer-ts'); if (fTs) fTs.textContent = `${t} 更新`;
  }
}

// ══════════════════════════════════════════════════════════════
// CALCULATIONS
// ══════════════════════════════════════════════════════════════
function calcBudgetTotal() {
  return S.data.expense_budget.reduce((s, r) => s + (parseFloat(r[2]) || 0), 0);
}

function calcTotals() {
  const rate = S.prices.usdtwd;
  const cashT = S.data.cash.reduce((s, r) => s + cashToTWD(r), 0);
  const twT   = S.data.tw.reduce((s, r) => s + (parseFloat(r[1]) || 0) * (S.prices.tw[r[0]] || 0), 0);
  const usT   = S.data.us.reduce((s, r) => s + (parseFloat(r[1]) || 0) * (S.prices.us[r[0]] || 0) * rate, 0);
  const cryT  = S.data.crypto.reduce((s, r) => s + (parseFloat(r[1]) || 0) * (S.prices.crypto[r[0]?.toUpperCase()] || 0) * rate, 0);
  const ins   = (S.data.settings.insurance_total || 0) * rate;  // stored in USD
  const re    = S.data.settings.realestate_total || 0;
  const debt   = S.data.settings.debt || 0;
  const budget = calcBudgetTotal();
  const total  = cashT + twT + usT + cryT + ins + re;
  const net    = total - debt;
  const liquid = total - re;
  const available = liquid - budget;
  return { cashT, twT, usT, cryT, ins, re, debt, budget, total, net, liquid, available };
}

// ══════════════════════════════════════════════════════════════
// RENDER — KPIs
// ══════════════════════════════════════════════════════════════
function renderKPIs() {
  const { cashT, total, net, liquid, available, budget } = calcTotals();
  const snaps = S.data.snapshots;

  setKPI('kv-total', fmt(total), 'ks-total', '');
  setKPI('kv-net', fmt(net), 'ks-net', '');
  setKPI('kv-liquid', fmt(liquid), 'ks-liquid', budget > 0 ? `可用：${fmtWan(available)}` : '總資產 − 房地產');

  // 本月收益：可用資產 − 上月底快照基準
  const monthlyDiff = liquid - LAST_MONTH_AVAILABLE_SNAPSHOT;
  const elMonthly = $('kv-monthly');
  const cardMonthly = $('card-monthly');
  if (monthlyDiff === 0) {
    elMonthly.textContent = '持平'; elMonthly.className = 'kpi-value neutral';
    if (cardMonthly) cardMonthly.className = 'kpi-card';
  } else {
    elMonthly.textContent = (monthlyDiff > 0 ? '+' : '') + fmt(monthlyDiff);
    elMonthly.className = `kpi-value ${monthlyDiff > 0 ? 'pos' : 'neg'}`;
    if (cardMonthly) cardMonthly.className = `kpi-card ${monthlyDiff > 0 ? 'kpi-gain' : 'kpi-loss'}`;
  }
  const sMonthly = $('ks-monthly'); if (sMonthly) sMonthly.textContent = '可用資產 − 3/31 基準';

  // 本年收益：可用資產 − 2025/12/31 快照基準
  const yearlyDiff = liquid - LAST_YEAR_END_AVAILABLE_SNAPSHOT;
  const elGrowth = $('kv-growth');
  const cardGrowth = $('card-growth');
  if (yearlyDiff === 0) {
    elGrowth.textContent = '持平'; elGrowth.className = 'kpi-value neutral';
    if (cardGrowth) cardGrowth.className = 'kpi-card';
  } else {
    elGrowth.textContent = (yearlyDiff > 0 ? '+' : '') + fmt(yearlyDiff);
    elGrowth.className = `kpi-value ${yearlyDiff > 0 ? 'pos' : 'neg'}`;
    if (cardGrowth) cardGrowth.className = `kpi-card ${yearlyDiff > 0 ? 'kpi-gain' : 'kpi-loss'}`;
  }
  const sGrowth = $('ks-growth'); if (sGrowth) sGrowth.textContent = '可用資產 − 2025/12/31 基準';

  // 匯率 — header + sidebar + mobile menu
  const rateStr = S.prices.usdtwd.toFixed(2);
  ['header-rate-val', 'sidebar-rate-val', 'menu-rate-val'].forEach(id => {
    const el = $(id); if (el) el.textContent = rateStr;
  });

  // 本日收益 KPI（淨資產日變化）
  const dailySnaps = S.data.daily_snapshots || [];
  const dgEl = $('kv-daily-gain');
  const dgSub = $('ks-daily-gain');
  const dgCard = $('card-daily-gain');
  if (dgEl) {
    if (dailySnaps.length) {
      const { net: curNet } = calcTotals();
      const todayStr = (() => { const n = new Date(); return `${n.getFullYear()}/${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}`; })();
      const prevSnap = [...dailySnaps].reverse().find(s => s[0] < todayStr);
      if (prevSnap) {
        const prevNet = parseFloat(prevSnap[8]) || 0;
        const diff = curNet - prevNet;
        if (Math.abs(diff) < 100) {
          dgEl.textContent = '持平'; dgEl.className = 'kpi-value neutral';
          if (dgCard) dgCard.className = 'kpi-card';
        } else {
          dgEl.textContent = (diff > 0 ? '+' : '') + fmt(diff);
          dgEl.className = `kpi-value ${diff > 0 ? 'pos' : 'neg'}`;
          if (dgCard) dgCard.className = `kpi-card ${diff > 0 ? 'kpi-gain' : 'kpi-loss'}`;
        }
        if (dgSub) dgSub.textContent = '淨資產日變化';
      } else {
        dgEl.textContent = '—'; dgEl.className = 'kpi-value';
        if (dgSub) dgSub.textContent = '尚無前日快照';
      }
    } else {
      dgEl.textContent = '—'; dgEl.className = 'kpi-value';
      if (dgSub) dgSub.textContent = '尚無每日快照';
    }
  }

  // 本日投資損益（台股 + 美股 + 加密貨幣，排除現金與其他資產）
  const igEl = $('kv-invest-gain');
  const igSub = $('ks-invest-gain');
  const igCard = $('card-invest-gain');
  if (igEl) {
    const { twT, usT, cryT } = calcTotals();
    const curInvest = twT + usT + cryT;
    const todayStrIG = (() => { const n = new Date(); return `${n.getFullYear()}/${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}`; })();
    const prevSnapIG = [...dailySnaps].reverse().find(s => s[0] < todayStrIG);
    if (prevSnapIG) {
      const prevInvest = (parseFloat(prevSnapIG[2]) || 0) + (parseFloat(prevSnapIG[3]) || 0) + (parseFloat(prevSnapIG[4]) || 0);
      const igDiff = curInvest - prevInvest;
      if (Math.abs(igDiff) < 100) {
        igEl.textContent = '持平'; igEl.className = 'kpi-value neutral';
        if (igCard) igCard.className = 'kpi-card';
      } else {
        igEl.textContent = (igDiff > 0 ? '+' : '') + fmt(igDiff);
        igEl.className = `kpi-value ${igDiff > 0 ? 'pos' : 'neg'}`;
        if (igCard) igCard.className = `kpi-card ${igDiff > 0 ? 'kpi-gain' : 'kpi-loss'}`;
      }
      if (igSub) igSub.textContent = '僅含台美股與加密貨幣';
    } else {
      igEl.textContent = '—'; igEl.className = 'kpi-value';
      if (igSub) igSub.textContent = '尚無前日快照';
    }
  }

  // 財務存活月數（流動現金 / 月支出預算）
  const svEl = $('kv-survival');
  const svSub = $('ks-survival');
  if (svEl) {
    if (budget > 0) {
      const months = cashT / budget;
      svEl.textContent = months.toFixed(1) + ' 個月';
      svEl.className = 'kpi-value' + (months >= 6 ? '' : months >= 3 ? ' neutral' : ' neg');
    } else {
      svEl.textContent = '—'; svEl.className = 'kpi-value';
    }
    if (svSub) svSub.textContent = '流動現金 / 月支出';
  }

  ['build-badge', 'sidebar-build-badge'].forEach(id => {
    const el = $(id); if (el) el.textContent = `版本 ${BUILD_DATE}`;
  });

}

function setKPI(vid, val, sid, sub) {
  const v = $(vid); if (!v) return;
  v.textContent = val; v.className = 'kpi-value';
  const s = $(sid); if (s) s.textContent = sub;
}

// ══════════════════════════════════════════════════════════════
// RENDER — MANAGEMENT TABLES
// ══════════════════════════════════════════════════════════════
function renderManagement() {
  renderCash(); renderTW(); renderUS(); renderCrypto(); renderOther(); renderRewards(); renderBudget();
  initAccordion();
}

// 計算並更新「其他資產 & 負債」標題列淨值摘要
function updateOtherTotal() {
  const el = $('tot-other');
  if (!el) return;
  const insUSD = S.data.settings.insurance_total  || 0;
  const re     = S.data.settings.realestate_total || 0;
  const debt   = S.data.settings.debt             || 0;
  const net = insUSD * S.prices.usdtwd + re - debt;
  el.textContent = net !== 0 ? '淨值 ' + fmt(net) : '—';
}

// 渲染「其他資產 & 負債」三個固定項目卡片
function renderOther() {
  const ins  = S.data.settings.insurance_total  || 0;
  const re   = S.data.settings.realestate_total || 0;
  const debt = S.data.settings.debt             || 0;
  const rate = S.prices.usdtwd;

  const items = [
    {
      key: 'insurance_total',
      icon: '🛡️',
      label: '儲蓄險',
      valueTWD: ins * rate,
      sub: ins > 0 ? `USD ${ins.toLocaleString('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2})}` : '尚未設定',
      isDebt: false,
    },
    {
      key: 'realestate_total',
      icon: '🏠',
      label: '房地產',
      valueTWD: re,
      sub: '不動產市值',
      isDebt: false,
    },
    {
      key: 'debt',
      icon: '📉',
      label: '負債',
      valueTWD: debt,
      sub: '貸款等負債總額',
      isDebt: true,
    },
  ];

  const el = $('other-items');
  if (!el) return;
  el.innerHTML = items.map(c => `
    <div class="other-item-card" onclick="openOtherItemDetail('${c.key}')" role="button" tabindex="0">
      <div class="other-item-icon">${c.icon}</div>
      <div class="other-item-info">
        <div class="other-item-label">${c.label}</div>
        <div class="other-item-sub">${c.sub}</div>
      </div>
      <div class="other-item-value${c.isDebt ? ' neg' : ''}">${c.valueTWD > 0 ? fmt(c.valueTWD) : '—'}</div>
    </div>
  `).join('');

  updateOtherTotal();
}

// 開啟「其他資產」修改 Modal
function openOtherItemDetail(key) {
  const META = {
    insurance_total:  { label: '儲蓄險',  currency: 'USD', icon: '🛡️' },
    realestate_total: { label: '房地產',  currency: 'TWD', icon: '🏠' },
    debt:             { label: '負債',    currency: 'TWD', icon: '📉' },
  };
  const m = META[key];
  if (!m) return;
  const current = S.data.settings[key] || 0;
  const fields = [
    { id: 'new_value', label: `新餘額 (${m.currency})`, type: 'number', val: current, min: 0, step: 'any' },
    { id: 'note', label: '備註（選填）', type: 'text', ph: '例如：市值更新、保費繳納' },
  ];
  openModal(`${m.icon} 更新 · ${m.label}`, fields, async vals => {
    const newValue = parseFloat(vals.new_value);
    if (isNaN(newValue) || newValue < 0) { showToast('請輸入有效數值', 'err'); return false; }
    const valueBefore = S.data.settings[key] || 0;
    S.data.settings[key] = newValue;
    const settRows = Object.entries(S.data.settings).map(([k, v]) => [k, v]);
    await saveSheet('settings', settRows);
    await appendOtherHistory(key, valueBefore, newValue, vals.note || '');
    renderKPIs(); renderCharts(); renderManagement();
    showToast('已更新', 'ok');
    return true;
  });
}

// 寫入「其他資產」歷史記錄
async function appendOtherHistory(key, valueBefore, valueAfter, note) {
  const delta = valueAfter - valueBefore;
  const row = [getNowTW8(), key, valueBefore, valueAfter, delta, note];
  S.data.other_history.push(row);
  await saveSheet('other_history', S.data.other_history);
}

// ── Accordion: 折疊/展開資產分類 ──
function initAccordion() {
  const saved = JSON.parse(localStorage.getItem('section_acc') || '{}');
  ['cash', 'tw', 'us', 'crypto', 'other'].forEach(id => {
    const card = document.getElementById('section-' + id);
    if (!card) return;
    const body = card.querySelector('.section-body');
    if (saved[id] === true) {
      // 已儲存為展開：移除 collapsed，設為無限制高
      card.classList.remove('collapsed');
      body.style.maxHeight = '';
    } else {
      // 預設收合
      card.classList.add('collapsed');
      body.style.maxHeight = '0';
    }
  });
}

function toggleSection(id) {
  const card = document.getElementById('section-' + id);
  if (!card) return;
  const body = card.querySelector('.section-body');
  const isCollapsed = card.classList.contains('collapsed');
  if (isCollapsed) {
    // 展開
    card.classList.remove('collapsed');
    body.style.maxHeight = body.scrollHeight + 'px';
    body.addEventListener('transitionend', function handler() {
      body.style.maxHeight = ''; // 移除限制，允許內容動態增長
      body.removeEventListener('transitionend', handler);
    });
  } else {
    // 收合：先固定高度，再 RAF 觸發動畫
    body.style.maxHeight = body.scrollHeight + 'px';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      card.classList.add('collapsed');
      body.style.maxHeight = '0';
    }));
  }
  // 儲存狀態
  const saved = JSON.parse(localStorage.getItem('section_acc') || '{}');
  saved[id] = isCollapsed; // 原本 collapsed→現在展開 = true
  localStorage.setItem('section_acc', JSON.stringify(saved));
}

function renderCash() {
  const rows = S.data.cash;

  // USDT 從加密貨幣移植至此顯示（視覺重分類，不改 Sheet 結構）
  const usdtIdx   = S.data.crypto.findIndex(r => r[0]?.toUpperCase() === 'USDT');
  const usdtEntry = usdtIdx >= 0 ? S.data.crypto[usdtIdx] : null;
  const usdtQty   = usdtEntry ? (parseFloat(usdtEntry[1]) || 0) : 0;
  const usdtTWD   = usdtQty * S.prices.usdtwd; // USDT = $1 USD

  $('cnt-cash').textContent = rows.length;

  // 將 USDT 併入排序清單，統一按台幣現值由大到小
  const allItems = rows.map((r, i) => ({ type: 'cash', r, i, twd: cashToTWD(r) }));
  if (usdtQty > 0) allItems.push({ type: 'usdt', r: null, i: usdtIdx, twd: usdtTWD });
  allItems.sort((a, b) => b.twd - a.twd);

  // ── 桌機 table ──
  const tableRows = allItems.length ? allItems.map(item => {
    if (item.type === 'usdt') {
      return `<tr class="clickable-row" onclick="openAssetDetail('crypto',${usdtIdx})">
        <td data-label="帳戶">加密錢包</td>
        <td data-label="幣別"><span class="sym-tag" style="font-size:0.78rem;color:var(--accent-light)">USDT</span></td>
        <td data-label="金額" class="amt">${usdtQty.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td data-label="台幣現值" class="amt">${fmt(usdtTWD)}</td>
      </tr>`;
    }
    const { r, i } = item;
    const ccy = (r[2] || 'TWD').toUpperCase();
    const amt = parseFloat(r[1]) || 0;
    const twd = item.twd;
    const hasErr = ccy !== 'TWD' && S.prices.errs[`fx_${ccy}`];
    return `<tr class="clickable-row" onclick="openAssetDetail('cash',${i})">
      <td data-label="帳戶">${esc(r[0])}</td>
      <td data-label="幣別"><span class="sym-tag" style="font-size:0.78rem;color:var(--accent-light)">${esc(ccy)}</span></td>
      <td data-label="金額" class="amt">${fmtCashAmt(amt, ccy)}</td>
      <td data-label="台幣現值" class="amt">${fmt(twd)}${hasErr ? '<span class="price-err">匯率失敗</span>' : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--muted)">尚無帳戶</td></tr>';
  $('tb-cash').innerHTML = tableRows;

  const cashTotal   = rows.reduce((s, r) => s + cashToTWD(r), 0);
  const displayTotal = cashTotal + usdtTWD;
  $('tot-cash').textContent = fmt(displayTotal);

  const availEl = $('avail-cash');
  if (availEl) {
    const budget = calcBudgetTotal();
    if (budget > 0) {
      availEl.textContent = `(可用：${fmtWan(displayTotal - budget)})`;
      availEl.style.display = '';
    } else {
      availEl.style.display = 'none';
    }
  }

  // ── 手機卡片（與桌機同一 allItems，排序一致）──
  const totalCashTWD = displayTotal; // 含 USDT
  const allCards = allItems.map(item => {
    if (item.type === 'usdt') {
      const pct = totalCashTWD > 0 ? Math.round(usdtTWD / totalCashTWD * 100) : null;
      return `<div class="asset-card" onclick="openAssetDetail('crypto',${usdtIdx})" role="button" tabindex="0">
        <div class="asset-card-pct">${pct !== null ? pct + '%' : '—'}</div>
        <div class="asset-card-sym">USDT</div>
        <div class="asset-card-mid">
          <div class="asset-card-twd">${fmt(usdtTWD)}</div>
          <div class="asset-card-detail">USDT ${usdtQty.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
      </div>`;
    }
    const { r, i } = item;
    const ccy = (r[2] || 'TWD').toUpperCase();
    const amt = parseFloat(r[1]) || 0;
    const twd = item.twd;
    const hasErr = ccy !== 'TWD' && S.prices.errs[`fx_${ccy}`];
    const pct = totalCashTWD > 0 ? Math.round(twd / totalCashTWD * 100) : null;
    const pctStr = pct !== null ? pct + '%' : '—';
    const twdStr = hasErr ? '匯率失敗' : fmt(twd);
    return `<div class="asset-card${hasErr ? ' err' : ''}" onclick="openAssetDetail('cash',${i})" role="button" tabindex="0">
      <div class="asset-card-pct">${pctStr}</div>
      <div class="asset-card-sym">${esc(r[0])}</div>
      <div class="asset-card-mid">
        <div class="asset-card-twd">${twdStr}</div>
        <div class="asset-card-detail">${esc(ccy)} ${fmtCashAmt(amt, ccy)}</div>
      </div>
    </div>`;
  }).join('');

  $('cash-cards').innerHTML = allCards ||
    '<div style="text-align:center;padding:20px;color:var(--muted);font-size:0.88rem">尚無帳戶</div>';
}

// 取昨日 daily_snapshots 某欄位數值（colIdx: 2=tw,3=us,4=crypto）
// 回傳 null 表示無昨日快照
function getDailySnapYesterday(colIdx) {
  const todayStr = (() => { const n = new Date(); return `${n.getFullYear()}/${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}`; })();
  const prev = [...S.data.daily_snapshots].reverse().find(s => s[0] < todayStr);
  if (!prev) return null;
  const v = parseFloat(prev[colIdx]);
  return isNaN(v) ? null : v;
}

// 更新分類今日收益 badge
function updateSectionGain(elId, curTotal, colIdx) {
  const el = $(elId);
  if (!el) return;
  const yesterday = getDailySnapYesterday(colIdx);
  if (yesterday === null) { el.textContent = ''; return; }
  const diff = curTotal - yesterday;
  if (Math.abs(diff) < 10) {
    el.textContent = '(持平)';
    el.className = 'section-gain neutral';
  } else {
    el.textContent = (diff > 0 ? '(+' : '(') + fmt(diff) + ')';
    el.className = `section-gain ${diff > 0 ? 'pos' : 'neg'}`;
  }
}

function renderTW() {
  const rows = S.data.tw;
  $('cnt-tw').textContent = rows.length;
  const sorted = rows.map((r,i) => ({r,i})).sort((a,b) => {
    const val = r => (parseFloat(r[1])||0) * (S.prices.tw[r[0]]||0);
    return val(b.r) - val(a.r);
  });

  const totalTWTWD = rows.reduce((s, r) => s + (parseFloat(r[1]) || 0) * (S.prices.tw[r[0]] || 0), 0);

  if (!sorted.length) {
    $('tb-tw').innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--muted)">尚無持股</td></tr>';
    $('tw-cards').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:0.88rem">尚無持股</div>';
  } else {
    $('tb-tw').innerHTML = sorted.map(({r, i}) => {
      const p = S.prices.tw[r[0]], v = p ? (parseFloat(r[1]) || 0) * p : null;
      const err = S.prices.errs[`tw_${r[0]}`];
      const priceCell = err
        ? '<span style="color:var(--red);font-size:0.8rem">-</span>'
        : (p !== undefined ? p.toLocaleString('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2}) : skelSpan());
      return `<tr class="clickable-row" onclick="openAssetDetail('tw',${i})">
        <td data-label="代號"><span class="sym-tag">${esc(r[0])}</span></td>
        <td data-label="股數">${(parseFloat(r[1]) || 0).toLocaleString()}</td>
        <td data-label="股價 (TWD)" class="amt">${priceCell}</td>
        <td data-label="現值 (TWD)" class="amt">${v !== null ? fmt(v) : skelSpan()}${err ? '<span class="price-err">更新失敗</span>' : ''}</td>
      </tr>`;
    }).join('');

    $('tw-cards').innerHTML = sorted.map(({r, i}) => {
      const sym = r[0]?.toUpperCase(), p = S.prices.tw[sym];
      const qty = parseFloat(r[1]) || 0;
      const v = p ? qty * p : null;
      const err = S.prices.errs[`tw_${sym}`];
      const pct = (totalTWTWD > 0 && v !== null) ? Math.round(v / totalTWTWD * 100) : null;
      const pctStr = pct !== null ? pct + '%' : '—';
      const twdStr = err ? '更新失敗' : (v !== null ? fmt(v) : skelSpan());
      const detailStr = err
        ? `持有 ${qty.toLocaleString()} 股`
        : `持有 ${qty.toLocaleString()} 股 · ${p !== undefined ? p.toLocaleString('zh-TW', {minimumFractionDigits:2,maximumFractionDigits:2}) + ' TWD' : '—'}`;
      return `<div class="asset-card${err ? ' err' : ''}" onclick="openAssetDetail('tw',${i})" role="button" tabindex="0">
        <div class="asset-card-pct">${pctStr}</div>
        <div class="asset-card-sym">${esc(sym)}</div>
        <div class="asset-card-mid">
          <div class="asset-card-twd">${twdStr}</div>
          <div class="asset-card-detail">${detailStr}</div>
        </div>
      </div>`;
    }).join('');
  }

  $('tot-tw').textContent = fmt(totalTWTWD);
  updateSectionGain('gain-tw', totalTWTWD, 2);
}

function renderUS() {
  const rows = S.data.us, rate = S.prices.usdtwd;
  $('cnt-us').textContent = rows.length;
  const sorted = rows.map((r,i) => ({r,i})).sort((a,b) => {
    const val = r => (parseFloat(r[1])||0) * (S.prices.us[r[0]]||0) * rate;
    return val(b.r) - val(a.r);
  });

  const totalUSTWD = rows.reduce((s, r) => s + (parseFloat(r[1]) || 0) * (S.prices.us[r[0]] || 0) * rate, 0);

  if (!sorted.length) {
    $('tb-us').innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--muted)">尚無持股</td></tr>';
    $('us-cards').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:0.88rem">尚無持股</div>';
  } else {
    $('tb-us').innerHTML = sorted.map(({r, i}) => {
      const p = S.prices.us[r[0]], v = p ? (parseFloat(r[1]) || 0) * p * rate : null;
      const err = S.prices.errs[`us_${r[0]}`];
      const priceCell = err
        ? '<span style="color:var(--red);font-size:0.8rem">-</span>'
        : (p !== undefined ? fmtUSD(p) : skelSpan());
      return `<tr class="clickable-row" onclick="openAssetDetail('us',${i})">
        <td data-label="代號"><span class="sym-tag">${esc(r[0])}</span></td>
        <td data-label="股數">${(parseFloat(r[1]) || 0).toLocaleString(undefined, {maximumFractionDigits:4})}</td>
        <td data-label="股價 (USD)" class="amt">${priceCell}</td>
        <td data-label="現值 (TWD)" class="amt">${v !== null ? fmt(v) : skelSpan()}${err ? '<span class="price-err">更新失敗</span>' : ''}</td>
      </tr>`;
    }).join('');

    $('us-cards').innerHTML = sorted.map(({r, i}) => {
      const sym = r[0]?.toUpperCase(), p = S.prices.us[sym];
      const qty = parseFloat(r[1]) || 0;
      const v = p ? qty * p * rate : null;
      const err = S.prices.errs[`us_${sym}`];
      const pct = (totalUSTWD > 0 && v !== null) ? Math.round(v / totalUSTWD * 100) : null;
      const pctStr = pct !== null ? pct + '%' : '—';
      const twdStr = err ? '更新失敗' : (v !== null ? fmt(v) : skelSpan());
      const detailStr = err
        ? `持有 ${qty.toLocaleString(undefined,{maximumFractionDigits:4})} 股`
        : `持有 ${qty.toLocaleString(undefined,{maximumFractionDigits:4})} 股 · ${p !== undefined ? fmtUSD(p) + ' USD' : '—'}`;
      return `<div class="asset-card${err ? ' err' : ''}" onclick="openAssetDetail('us',${i})" role="button" tabindex="0">
        <div class="asset-card-pct">${pctStr}</div>
        <div class="asset-card-sym">${esc(sym)}</div>
        <div class="asset-card-mid">
          <div class="asset-card-twd">${twdStr}</div>
          <div class="asset-card-detail">${detailStr}</div>
        </div>
      </div>`;
    }).join('');
  }

  $('tot-us').textContent = fmt(totalUSTWD);
  updateSectionGain('gain-us', totalUSTWD, 3);
}

function renderCrypto() {
  const rows = S.data.crypto, rate = S.prices.usdtwd;

  // 收益計算含全部 crypto（含 USDT），與 daily_snapshots col 4 一致
  const gainTot = rows.reduce((s, r) => {
    const sym = r[0]?.toUpperCase(), p = S.prices.crypto[sym];
    return s + (p ? (parseFloat(r[1]) || 0) * p * rate : 0);
  }, 0);

  // 顯示清單：隱藏 USDT（已移至流動現金區）
  const displayRows = rows.map((r,i) => ({r,i})).filter(({r}) => r[0]?.toUpperCase() !== 'USDT');
  $('cnt-crypto').textContent = displayRows.length;

  const sorted = [...displayRows].sort((a,b) => {
    const val = ({r}) => (parseFloat(r[1])||0) * (S.prices.crypto[r[0]?.toUpperCase()]||0) * rate;
    return val(b) - val(a);
  });

  // 顯示總值（不含 USDT）
  const totalCryptoTWD = displayRows.reduce((s, {r}) => {
    const sym = r[0]?.toUpperCase(), p = S.prices.crypto[sym];
    return s + (p ? (parseFloat(r[1]) || 0) * p * rate : 0);
  }, 0);

  if (!sorted.length) {
    const empty = '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--muted)">尚無持幣</td></tr>';
    $('tb-crypto').innerHTML = empty;
    $('crypto-cards').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:0.88rem">尚無持幣</div>';
  } else {
    // ── 桌機 table rows ──
    $('tb-crypto').innerHTML = sorted.map(({r, i}) => {
      const sym = r[0]?.toUpperCase(), p = S.prices.crypto[sym];
      const v = p ? (parseFloat(r[1]) || 0) * p * rate : null;
      const err = S.prices.errs[`c_${sym}`];
      const qty = parseFloat(r[1]) || 0;
      const priceCell = err
        ? '<span style="color:var(--red);font-size:0.8rem">-</span>'
        : (p !== undefined ? fmtUSD(p, 4) : skelSpan());
      return `<tr class="clickable-row" onclick="openAssetDetail('crypto',${i})">
        <td data-label="代號"><span class="sym-tag">${esc(sym)}</span></td>
        <td data-label="數量">${qty.toFixed(3)}</td>
        <td data-label="幣價 (USD)" class="amt">${priceCell}</td>
        <td data-label="現值 (TWD)" class="amt">${v !== null ? fmt(v) : skelSpan()}${err ? '<span class="price-err">更新失敗</span>' : ''}</td>
      </tr>`;
    }).join('');

    // ── 手機卡片 ──
    $('crypto-cards').innerHTML = sorted.map(({r, i}) => {
      const sym = r[0]?.toUpperCase(), p = S.prices.crypto[sym];
      const v = p ? (parseFloat(r[1]) || 0) * p * rate : null;
      const err = S.prices.errs[`c_${sym}`];
      const qty = parseFloat(r[1]) || 0;
      const pct = (totalCryptoTWD > 0 && v !== null) ? Math.round(v / totalCryptoTWD * 100) : null;
      const pctStr = pct !== null ? pct + '%' : '—';
      const twdStr = err ? '更新失敗' : (v !== null ? fmt(v) : skelSpan());
      const detailStr = err
        ? `持有 ${qty.toFixed(3)}`
        : `持有 ${qty.toFixed(3)} · ${p !== undefined ? fmtFloor3(p) : '—'}`;
      return `<div class="asset-card${err ? ' err' : ''}" onclick="openAssetDetail('crypto',${i})" role="button" tabindex="0">
        <div class="asset-card-pct">${pctStr}</div>
        <div class="asset-card-sym">${esc(sym)}</div>
        <div class="asset-card-mid">
          <div class="asset-card-twd">${twdStr}</div>
          <div class="asset-card-detail">${detailStr}</div>
        </div>
      </div>`;
    }).join('');
  }

  $('tot-crypto').textContent = fmt(totalCryptoTWD); // 顯示不含 USDT
  updateSectionGain('gain-crypto', gainTot, 4);       // 收益含 USDT，與快照對齊
}

// ── 質押/活存收益記錄 ──────────────────────────────────────────
// 計算單筆收益即時 TWD（有報價用即時，否則 fallback 存量）
function rewardTWD(r) {
  const qty = parseFloat(r[2]) || 0;
  const sym = (r[1] || '').toUpperCase();
  const price = S.prices.crypto[sym];
  return price !== undefined ? qty * price * S.prices.usdtwd : (parseFloat(r[4]) || 0);
}

function renderRewards() {
  const rw = S.data.rewards;
  const allTimeTWD = rw.reduce((s, r) => s + rewardTWD(r), 0);
  if ($('cnt-rewards')) $('cnt-rewards').textContent = allTimeTWD >= 10000 ? fmtWan(allTimeTWD) : fmt(allTimeTWD);

  const now = new Date();
  const curMonth = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}`;

  // Group by month, preserving original array indices for delete/edit
  const groups = {};
  rw.forEach((r, i) => {
    const m = r[0] || '—';
    if (!groups[m]) groups[m] = [];
    groups[m].push({ r, i });
  });
  const sortedMonths = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const accordion = $('rewards-accordion');
  if (!sortedMonths.length) {
    accordion.innerHTML = '<div class="rwd-empty">尚無收益記錄</div>';
    if ($('tot-rewards-month')) $('tot-rewards-month').textContent = '—';
    return;
  }


  accordion.innerHTML = sortedMonths.map(month => {
    const items = groups[month];
    // Sort by TWD desc for expanded view
    const sorted = [...items].sort((a, b) => rewardTWD(b.r) - rewardTWD(a.r));
    const totalTWD = items.reduce((s, { r }) => s + rewardTWD(r), 0);

    const [yr, mo] = month.split('/');
    const monthLabel = yr && mo ? `${yr}年 ${parseInt(mo, 10)}月` : month;
    const gid = month.replace('/', '-');
    const isCur = month === curMonth;

    return `<div class="rwd-group${isCur ? ' current' : ''}">
      <div class="rwd-header" onclick="toggleRewardGroup('${gid}')">
        <div class="rwd-header-left">
          <span class="rwd-month-label">${esc(monthLabel)} 收益總計</span>
          <span class="rwd-header-sub">${items.length} 筆</span>
        </div>
        <div class="rwd-header-right">
          <span class="rwd-total-twd">${fmt(totalTWD)}</span>
          <span class="rwd-toggle" id="rwd-toggle-${gid}">▼</span>
        </div>
      </div>
      <div class="rwd-body" id="rwd-body-${gid}" style="${isCur ? 'display:block' : 'display:none'}">
        ${sorted.map(({ r, i }) => {
          const qty = parseFloat(r[2]) || 0;
          const sym = (r[1] || '').toUpperCase();
          const twd = rewardTWD(r);
          const type = r[5] || '手動';
          const note = r[6] || '';
          const isAuto = type === '系統換算';
          const typeBadge = isAuto ? '' : `<span class="rwd-type-badge rwd-type-${type === '外部存入' ? 'ext' : 'manual'}">${esc(type)}</span>`;
          // 幣價：非 USDT 才顯示，永遠使用即時價（S.prices.crypto）
          const livePrice = S.prices.crypto[sym];
          const priceStr = sym !== 'USDT' && livePrice > 0
            ? ` <span class="rwd-price">($${livePrice >= 1000 ? Math.round(livePrice).toLocaleString() : livePrice.toFixed(2)})</span>`
            : '';
          return `<div class="rwd-item">
            <div class="rwd-item-left">
              <span class="rwd-sym">${esc(sym)}${typeBadge}</span>
              ${note ? `<span class="rwd-note">${esc(note)}</span>` : ''}
            </div>
            <span class="rwd-detail">+${qty.toFixed(3)}${priceStr} <span class="rwd-twd">≈ ${fmt(twd)}</span></span>
            <div class="rwd-actions">
              ${isAuto ? '' : `<button class="btn-icon edit" onclick="editReward(${i})" title="編輯">✏</button>`}
              <button class="btn-icon del" onclick="deleteReward(${i})" title="刪除">✕</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');

  // Update current-month toggle arrow (default open)
  const curGid = curMonth.replace('/', '-');
  const curToggle = $(`rwd-toggle-${curGid}`);
  if (curToggle) curToggle.textContent = '▲';

  // 歷史總收益合計 for footer（與 badge 一致）
  if ($('tot-rewards-month')) $('tot-rewards-month').textContent = allTimeTWD > 0 ? fmt(allTimeTWD) : '—';
}

function toggleRewardGroup(gid) {
  const body = $(`rwd-body-${gid}`);
  const toggle = $(`rwd-toggle-${gid}`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (toggle) toggle.textContent = open ? '▼' : '▲';
}

function rewardSyncPrice() {
  rewardSyncValue();
}

function rewardSyncValue() {
  const sym = ($('mf-symbol')?.value || '').toUpperCase();
  const qty = parseFloat($('mf-quantity')?.value) || 0;
  const price = S.prices.crypto[sym] || 0;
  const twd = qty * price * S.prices.usdtwd;
  const el = $('mf-value_twd');
  if (el) el.value = twd > 0 ? fmt(twd) : '';
}

function openRewardModal(title, defaults, onSave) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const symOptions = [...new Set(S.data.crypto.map(r => r[0]?.toUpperCase()).filter(Boolean))];
  const sel = defaults.symbol || symOptions[0] || '';
  const monthVal = defaults.date ? defaults.date.replace('/', '-') : defaultMonth;
  const typeVal = defaults.type || '手動';
  const noteVal = defaults.note || '';

  $('modal-title').textContent = title;
  $('modal-body').innerHTML = `
    <div class="modal-form">
      <div class="field"><label>月份</label>
        <input id="mf-date" type="month" value="${esc(monthVal)}">
      </div>
      <div class="field"><label>幣種</label>
        <select id="mf-symbol" onchange="rewardSyncPrice()">
          ${symOptions.map(s => `<option value="${esc(s)}" ${s===sel?'selected':''}>${esc(s)}</option>`).join('')}
          <option value="__custom">自訂…</option>
        </select>
        <input id="mf-symbol-custom" type="text" placeholder="輸入幣種代號" style="display:none;margin-top:6px" oninput="this.value=this.value.toUpperCase()">
      </div>
      <div class="field"><label>類型</label>
        <select id="mf-type">
          <option value="手動" ${typeVal==='手動'?'selected':''}>手動輸入</option>
          <option value="外部存入" ${typeVal==='外部存入'?'selected':''}>外部存入</option>
        </select>
      </div>
      <div class="field"><label>增加數量</label>
        <input id="mf-quantity" type="number" step="any" min="0" value="${esc(String(defaults.quantity??''))}" placeholder="0" oninput="rewardSyncValue()">
      </div>
      <div class="field"><label>收益價值 (TWD)　<small style="color:var(--muted)">(即時幣價換算)</small></label>
        <input id="mf-value_twd" type="text" readonly value="${esc(defaults.value_twd??'')}" placeholder="—">
      </div>
      <div class="field"><label>備註 <small style="color:var(--muted)">(選填)</small></label>
        <input id="mf-note" type="text" maxlength="60" value="${esc(noteVal)}" placeholder="例：VISA 儲值、Binance Earn…">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-ok" id="modal-ok">確認</button>
    </div>`;
  $('modal').classList.add('open');

  // 自訂幣種切換
  $('mf-symbol').addEventListener('change', function() {
    const custom = $('mf-symbol-custom');
    custom.style.display = this.value === '__custom' ? 'block' : 'none';
    if (this.value !== '__custom') rewardSyncPrice();
  });

  // 初始計算
  rewardSyncValue();

  $('modal-ok').onclick = async () => {
    const btn = $('modal-ok');
    const rawMonth = $('mf-date')?.value;
    const symSel = $('mf-symbol')?.value;
    const sym = symSel === '__custom' ? ($('mf-symbol-custom')?.value?.toUpperCase()) : symSel;
    const qty = parseFloat($('mf-quantity')?.value) || 0;
    const type = $('mf-type')?.value || '手動';
    const note = ($('mf-note')?.value || '').trim();

    if (!rawMonth || !sym || qty <= 0) {
      showToast('請填寫月份、幣種與數量', 'err'); return;
    }
    const date = rawMonth.replace('-', '/');  // YYYY-MM → YYYY/MM
    // price_usd 不再儲存（顯示時改用即時價），寫 0 保留 schema 相容
    const liveP = S.prices.crypto[sym] || 0;
    const valueTWD = qty * liveP * S.prices.usdtwd;

    btnLoading(btn);
    try {
      await onSave(date, sym, qty, 0, valueTWD, type, note);
      btn.classList.remove('btn-loading');
      btn.textContent = '✓ 完成';
      setTimeout(() => closeModal(), 600);
    } catch(e) {
      btnReset(btn);
      showToast('錯誤：' + e.message, 'err');
    }
  };
}

function addReward() {
  openRewardModal('新增收益記錄', {}, async (date, sym, qty, price, twd, type, note) => {
    S.data.rewards.push([date, sym, qty, price, Math.round(twd), type || '手動', note || '']);
    S.data.rewards.sort((a, b) => b[0].localeCompare(a[0]));
    await saveSheet('crypto_rewards', S.data.rewards);
    renderRewards(); renderRewardsSummary();
    showToast('收益記錄已新增', 'ok');
  });
}

function editReward(idx) {
  const r = S.data.rewards[idx];
  openRewardModal('編輯收益記錄', { date: r[0], symbol: r[1], quantity: r[2], price_usd: r[3], value_twd: fmt(parseFloat(r[4])), type: r[5], note: r[6] || '' }, async (date, sym, qty, price, twd, type, note) => {
    S.data.rewards[idx] = [date, sym, qty, price, Math.round(twd), type || r[5] || '手動', note ?? r[6] ?? ''];
    S.data.rewards.sort((a, b) => b[0].localeCompare(a[0]));
    await saveSheet('crypto_rewards', S.data.rewards);
    renderRewards(); renderRewardsSummary();
    showToast('已更新', 'ok');
  });
}

function deleteReward(idx) {
  openConfirm('確認刪除', '確定要刪除這筆收益記錄嗎？', async () => {
    S.data.rewards.splice(idx, 1);
    await saveSheet('crypto_rewards', S.data.rewards);
    renderRewards(); renderRewardsSummary();
    showToast('已刪除', 'ok');
  });
}

function renderRewardsSummary() {
  const el = $('rewards-summary');
  if (!el) return;
  const now = new Date();
  const curMonth = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthRw = S.data.rewards.filter(r => r[0] === curMonth);

  if (!monthRw.length) {
    el.innerHTML = `<div style="color:var(--muted);font-size:0.85rem;padding:12px 0">本月尚無收益記錄</div>`;
    return;
  }

  // group by symbol（只累計顆數，TWD 以即時幣價動態計算）
  const grouped = {};
  monthRw.forEach(r => {
    const sym = (r[1] || '').toUpperCase();
    if (!grouped[sym]) grouped[sym] = { qty: 0 };
    grouped[sym].qty += parseFloat(r[2]) || 0;
  });

  el.innerHTML = `<table class="data-table" style="margin-top:4px">
    <thead><tr>
      <th>幣種</th>
      <th style="text-align:right">本月增量</th>
      <th style="text-align:right">收益價值 (TWD)</th>
    </tr></thead>
    <tbody>
      ${Object.entries(grouped).map(([sym, v]) => {
        const price = S.prices.crypto[sym] || 0;
        const twd = v.qty * price * S.prices.usdtwd;
        return `<tr>
          <td><span class="sym-tag">${esc(sym)}</span></td>
          <td class="amt">${v.qty.toLocaleString(undefined,{maximumFractionDigits:8})}</td>
          <td class="amt">${fmt(twd)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

// 自動新增系統換算利息收益記錄（含防重複）
async function autoAddReward(sym, interestQty) {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}`;

  // 同月同幣種已有系統換算記錄 → 先刪除再寫入（覆蓋模式）
  const dupIdx = S.data.rewards.findIndex(r => r[0] === month && r[1] === sym && r[5] === '系統換算');
  if (dupIdx !== -1) S.data.rewards.splice(dupIdx, 1);

  const price = S.prices.crypto[sym] || 0;
  const valueTWD = Math.round(interestQty * price * S.prices.usdtwd);
  S.data.rewards.push([month, sym, interestQty, price, valueTWD, '系統換算']);
  S.data.rewards.sort((a, b) => b[0].localeCompare(a[0]));
  await saveSheet('crypto_rewards', S.data.rewards);
  renderRewards();
  renderRewardsSummary();
  showToast(`已自動新增 ${sym} 利息收益記錄 (${fmt(valueTWD)} TWD)`, 'ok');
}

// ══════════════════════════════════════════════════════════════
// RENDER — EXPENSE BUDGET
// ══════════════════════════════════════════════════════════════
function renderBudget() {
  const items = S.data.expense_budget;
  const cntEl = $('cnt-budget');
  const totEl = $('tot-budget');
  const catsEl = $('budget-cats');
  if (!catsEl) return;

  if (cntEl) cntEl.textContent = items.length;
  const grandTotal = calcBudgetTotal();
  if (totEl) totEl.textContent = fmt(grandTotal);

  if (!items.length) {
    catsEl.innerHTML = '<div class="budget-empty">尚無支出項目</div>';
    return;
  }

  // 依 category 分組
  const groups = {};
  items.forEach((r, i) => {
    const cat = r[0] || '未分類';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ r, i });
  });

  catsEl.innerHTML = Object.entries(groups).map(([cat, list]) => {
    const catTotal = list.reduce((s, { r }) => s + (parseFloat(r[2]) || 0), 0);
    const rows = list.map(({ r, i }) => `
      <div class="budget-item">
        <div class="budget-item-name">${esc(r[1] || '—')}</div>
        <div class="budget-item-source">${esc(r[3] || '—')}</div>
        <div class="budget-item-amt">${fmt(parseFloat(r[2]) || 0)}</div>
        <div class="budget-item-actions">
          <button class="btn-icon edit" onclick="editBudgetItem(${i})">✏</button>
          <button class="btn-icon del" onclick="deleteBudgetItem(${i})">✕</button>
        </div>
      </div>`).join('');
    return `
      <div class="budget-cat">
        <div class="budget-cat-header">
          <span class="budget-cat-name">${esc(cat)}</span>
          <span class="budget-cat-total">${fmt(catTotal)}</span>
        </div>
        <div class="budget-cat-items">${rows}</div>
      </div>`;
  }).join('');
}

function addBudgetItem() {
  openModal('新增支出項目', [
    { id: 'cat',    label: '類別',    type: 'select', options: ['固定','浮動'] },
    { id: 'name',   label: '項目名稱', type: 'text',   ph: '例：房租、水電' },
    { id: 'amount', label: '金額 (TWD)', type: 'number', step: '1', min: 0, ph: '0' },
    { id: 'source', label: '扣款帳戶（選填）', type: 'text', ph: '對應流動現金帳戶名稱', opt: true },
  ], async (vals) => {
    const amount = parseFloat(vals.amount) || 0;
    S.data.expense_budget.push([vals.cat, vals.name, String(amount), vals.source || '']);
    await saveSheet('expense_budget', S.data.expense_budget);
    renderBudget(); renderKPIs(); renderCash();
    showToast('已新增支出項目', 'ok');
  });
}

function editBudgetItem(idx) {
  const r = S.data.expense_budget[idx];
  if (!r) return;
  openModal('編輯支出項目', [
    { id: 'cat',    label: '類別',    type: 'select', options: ['固定','浮動'], val: r[0] },
    { id: 'name',   label: '項目名稱', type: 'text',   val: r[1] || '' },
    { id: 'amount', label: '金額 (TWD)', type: 'number', step: '1', min: 0, val: r[2] || '0' },
    { id: 'source', label: '扣款帳戶（選填）', type: 'text', val: r[3] || '', opt: true },
  ], async (vals) => {
    const amount = parseFloat(vals.amount) || 0;
    S.data.expense_budget[idx] = [vals.cat, vals.name, String(amount), vals.source || ''];
    await saveSheet('expense_budget', S.data.expense_budget);
    renderBudget(); renderKPIs(); renderCash();
    showToast('已更新支出項目', 'ok');
  });
}

function deleteBudgetItem(idx) {
  openConfirm('確認刪除', '刪除此支出項目？', async () => {
    S.data.expense_budget.splice(idx, 1);
    await saveSheet('expense_budget', S.data.expense_budget);
    renderBudget(); renderKPIs(); renderCash();
    showToast('已刪除支出項目', 'ok');
  });
}

function skelSpan() {
  return '<span class="skel" style="display:inline-block;width:55px;height:14px;vertical-align:middle"></span>';
}

// ══════════════════════════════════════════════════════════════
// RENDER — CHARTS
// ══════════════════════════════════════════════════════════════
Chart.defaults.color = '#94a3b8';

function chartColors() {
  const light = document.documentElement.dataset.theme === 'light';
  return {
    grid:        light ? 'rgba(0,0,0,.0)'     : 'rgba(255,255,255,.04)',
    gridFaint:   light ? 'rgba(0,0,0,.05)'    : 'rgba(255,255,255,.04)',
    tick:        light ? '#86868b'             : '#64748b',
    legend:      light ? '#86868b'             : '#94a3b8',
    center_text: light ? '#1d1d1f'             : '#e2e8f0',
    center_sub:  light ? '#86868b'             : '#94a3b8',
    nodata:      light ? '#86868b'             : '#475569',
    border:      light ? '#ffffff'             : '#1a1d2e',
    // 趨勢圖線條顏色
    line1:       light ? '#007AFF'             : '#6366f1',
    line2:       light ? '#34C759'             : '#22c55e',
    barPos:      light ? 'rgba(52,199,89,.7)'  : 'rgba(34,197,94,.65)',
    barNeg:      light ? 'rgba(255,59,48,.65)' : 'rgba(239,68,68,.65)',
  };
}

// Tooltip Positioner: 跟隨滑鼠游標，往上偏移避免遮住圓心文字
Chart.Tooltip.positioners.cursorOffset = function(elements, eventPosition) {
  if (!elements.length || !eventPosition) return false;
  return {
    x: eventPosition.x,
    y: eventPosition.y - 12,
  };
};

// Plugin: draw total value in doughnut centre
Chart.register({
  id: 'doughnutCenter',
  afterDraw(chart) {
    if (chart.config.type !== 'doughnut') return;
    const opts = chart.config.options.plugins?.doughnutCenter;
    if (!opts?.text) return;
    const cc = chartColors();
    const { ctx, chartArea: { left, right, top, bottom } } = chart;
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 主數字：縮小字體、深灰色更 Apple
    ctx.fillStyle = cc.center_text;
    ctx.font = '700 18px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(opts.text, cx, cy - 10);
    ctx.fillStyle = cc.center_sub;
    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(opts.sub || '', cx, cy + 12);
    ctx.restore();
  }
});

function renderCharts() {
  renderPie();
  renderDailyTrend();
  renderTrend();
  renderRewardsSummary();
  renderMonthly();
}

function renderDailyTrend() {
  const snaps = S.data.daily_snapshots;
  const ctx = $('daily-trend-chart').getContext('2d');
  if (S.charts.dailyTrend) S.charts.dailyTrend.destroy();

  const nodata = $('daily-trend-nodata');
  if (snaps.length < 1) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (nodata) nodata.style.display = 'flex';
    return;
  }
  if (nodata) nodata.style.display = 'none';

  // ── Step 1：取最近 15 筆快照，做缺日補全 ──
  const recent = snaps.slice(-15);

  function dateStr(d) {
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  }
  function nextDay(str) {
    const d = new Date(str.replace(/\//g, '-') + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return dateStr(d);
  }

  // 將快照展開，填補跳過的日期（delta = 0，投資值沿用前日）
  // net 欄位改為台股+美股+加密貨幣合計（排除現金與其他資產）
  const filled = []; // { date, net, isLive }
  for (let i = 0; i < recent.length; i++) {
    const net = (parseFloat(recent[i][2]) || 0) + (parseFloat(recent[i][3]) || 0) + (parseFloat(recent[i][4]) || 0);
    if (i > 0) {
      let d = filled[filled.length - 1].date;
      while (nextDay(d) < recent[i][0]) {
        d = nextDay(d);
        filled.push({ date: d, net: filled[filled.length - 1].net, isLive: false });
      }
    }
    filled.push({ date: recent[i][0], net, isLive: false });
  }

  // ── Step 2：追加今日即時點（若今日尚無快照）──
  const todayStr = getNowTW8().slice(0, 10);
  const lastFilled = filled[filled.length - 1];
  if (lastFilled.date < todayStr) {
    // 補全最後快照到昨日之間的空白
    let d = lastFilled.date;
    while (nextDay(d) < todayStr) {
      d = nextDay(d);
      filled.push({ date: d, net: filled[filled.length - 1].net, isLive: false });
    }
    // 今日即時點（台股+美股+加密貨幣即時合計）
    const { twT, usT, cryT } = calcTotals();
    filled.push({ date: todayStr, net: twT + usT + cryT, isLive: true });
  }

  // ── Step 3：取最後 15 個節點計算損益差值 ──
  const win = filled.slice(-15);
  if (win.length < 2) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (nodata) nodata.style.display = 'flex';
    return;
  }
  const labels = [], plData = [], netData = [], isLiveArr = [];
  for (let i = 1; i < win.length; i++) {
    labels.push(win[i].date.slice(5)); // MM/DD
    plData.push(win[i].net - win[i-1].net);
    netData.push(win[i].net);
    isLiveArr.push(win[i].isLive);
  }

  const maxAbs = Math.max(...plData.map(Math.abs), 1);
  const yPad   = maxAbs * 1.38;
  const cc = chartColors();
  const isDark = document.documentElement.dataset.theme !== 'light';
  const zeroLine = isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.13)';

  // Inline plugin：繪製旗標標註（防禦性寫法，任何例外均靜默處理）
  const annotPlugin = {
    id: 'plFlags',
    afterDatasetsDraw(chart) {
      try {
        const xSc = chart.scales?.x;
        const ySc = chart.scales?.y;
        if (!xSc || !ySc) return;
        const c = chart.ctx;
        const poleLen = 30, flagW = 64, flagH = 16, flagR = 3;

        function drawFlag(idx, value, color, text) {
          const px = xSc.getPixelForIndex(idx);
          const py = ySc.getPixelForValue(value);
          if (!isFinite(px) || !isFinite(py)) return;
          const isUp = value >= 0;
          c.save();
          c.strokeStyle = color; c.lineWidth = 1.5; c.setLineDash([]);
          c.beginPath(); c.moveTo(px, py); c.lineTo(px, isUp ? py - poleLen : py + poleLen); c.stroke();
          const fy = isUp ? py - poleLen - flagH : py + poleLen;
          const fx = Math.min(Math.max(px - flagW / 2, 2), (chart.width || 300) - flagW - 6);
          c.fillStyle = color;
          c.beginPath();
          c.moveTo(fx + flagR, fy);
          c.lineTo(fx + flagW - flagR, fy);
          c.arcTo(fx + flagW, fy, fx + flagW, fy + flagR, flagR);
          c.lineTo(fx + flagW, fy + flagH - flagR);
          c.arcTo(fx + flagW, fy + flagH, fx + flagW - flagR, fy + flagH, flagR);
          c.lineTo(fx + flagR, fy + flagH);
          c.arcTo(fx, fy + flagH, fx, fy + flagH - flagR, flagR);
          c.lineTo(fx, fy + flagR);
          c.arcTo(fx, fy, fx + flagR, fy, flagR);
          c.closePath(); c.fill();
          c.fillStyle = '#fff';
          c.font = '700 10px -apple-system, BlinkMacSystemFont, sans-serif';
          c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(text, fx + flagW / 2, fy + flagH / 2);
          c.restore();
        }

        // 旗標只標歷史最高/最低（不標即時點）
        const histPlData = plData.filter((_, i) => !isLiveArr[i]);
        const histMaxPl = histPlData.length ? Math.max(...histPlData) : -Infinity;
        const histMinPl = histPlData.length ? Math.min(...histPlData) : Infinity;
        const histMaxIdx = plData.findIndex((v, i) => !isLiveArr[i] && v === histMaxPl);
        const histMinIdx = plData.findIndex((v, i) => !isLiveArr[i] && v === histMinPl);
        if (histMaxPl > 1000)  drawFlag(histMaxIdx, histMaxPl, '#34C759', '+' + fmtWan(histMaxPl));
        if (histMinPl < -1000) drawFlag(histMinIdx, histMinPl, '#FF3B30', fmtWan(histMinPl));
      } catch (e) { /* 旗標繪製失敗不影響主圖表 */ }
    },
  };

  // 點顏色：即時點空心、歷史點實心
  const ptBg     = plData.map((v, i) => isLiveArr[i] ? 'transparent'  : (v >= 0 ? '#34C759' : '#FF3B30'));
  const ptBorder = plData.map((_v, i) => isLiveArr[i] ? cc.line1        : 'transparent');
  const ptRadius = plData.map((_, i) => isLiveArr[i] ? 5               : 3);
  const ptBorderW= plData.map((_, i) => isLiveArr[i] ? 2               : 0);

  S.charts.dailyTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '每日投資損益',
        data: plData,
        borderColor: cc.line1,
        borderWidth: 2,
        tension: 0.42,
        pointRadius: ptRadius,
        pointHoverRadius: 7,
        pointBackgroundColor: ptBg,
        pointBorderColor: ptBorder,
        pointBorderWidth: ptBorderW,
        fill: true,
        // 最後一段（連向即時點）改為虛線
        segment: {
          borderDash: ctx2 => isLiveArr[ctx2.p1DataIndex] ? [5, 4] : [],
          borderColor: ctx2 => isLiveArr[ctx2.p1DataIndex] ? cc.line1 + 'bb' : cc.line1,
        },
        backgroundColor(context) {
          const ca = context.chart?.chartArea;
          const c2 = context.chart?.ctx;
          if (!ca || !c2 || ca.bottom <= ca.top) return 'rgba(52,199,89,0.12)';
          try {
            const ySc2 = context.chart.scales?.y;
            const top = ca.top, bot = ca.bottom;
            const zeroY = ySc2 ? ySc2.getPixelForValue(0) : (top + bot) / 2;
            const frac = Math.max(0.01, Math.min(0.99, (zeroY - top) / (bot - top)));
            const g = c2.createLinearGradient(0, top, 0, bot);
            g.addColorStop(0,                        'rgba(52,199,89,0.26)');
            g.addColorStop(Math.max(0, frac - 0.04), 'rgba(52,199,89,0.05)');
            g.addColorStop(frac,                     'rgba(128,128,128,0.0)');
            g.addColorStop(Math.min(1, frac + 0.04), 'rgba(255,59,48,0.05)');
            g.addColorStop(1,                        'rgba(255,59,48,0.26)');
            return g;
          } catch { return 'rgba(52,199,89,0.12)'; }
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 50, right: 6, bottom: 0, left: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) {
              const i = items[0].dataIndex;
              const fullDate = win[i + 1]?.date || labels[i];
              return isLiveArr[i] ? `${fullDate}  ▸ 即時` : fullDate;
            },
            label(c) {
              const pl  = c.parsed.y;
              const net = netData[c.dataIndex];
              const sign = pl >= 0 ? '+' : '';
              return [` 投資損益：${sign}${fmt(pl)}`, ` 投資總值：${fmt(net)}`];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: cc.tick, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 14 },
          border: { display: false },
        },
        y: {
          min: -yPad, max: yPad,
          grid: {
            color(ctx2) { return ctx2.tick.value === 0 ? zeroLine : 'transparent'; },
            lineWidth(ctx2) { return ctx2.tick.value === 0 ? 1.5 : 0; },
          },
          ticks: { color: cc.tick, font: { size: 9 }, maxTicksLimit: 5, callback(v) { return fmtWan(v); } },
          border: { display: false },
        },
      },
    },
    plugins: [annotPlugin],
  });
}

function renderPie() {
  const { cashT, twT, usT, cryT, ins, re, total } = calcTotals();
  // USDT 視覺歸類至「流動現金」，不改變整體加總
  const usdtEntry = S.data.crypto.find(r => r[0]?.toUpperCase() === 'USDT');
  const usdtTWD   = usdtEntry ? (parseFloat(usdtEntry[1]) || 0) * S.prices.usdtwd : 0;
  const entries = [
    { label:'流動現金', value:cashT + usdtTWD,   color:'#22c55e' },
    { label:'台股',     value:twT,               color:'#6366f1' },
    { label:'美股',     value:usT,               color:'#3b82f6' },
    { label:'加密貨幣', value:cryT - usdtTWD,    color:'#f59e0b' },
    { label:'儲蓄險',   value:ins,               color:'#ec4899' },
    { label:'房地產',   value:re,                color:'#14b8a6' },
  ].filter(e => e.value > 0);

  const ctx = $('pie-chart').getContext('2d');
  if (S.charts.pie) S.charts.pie.destroy();

  const cc = chartColors();
  if (!entries.length) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = cc.nodata; ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('尚無資產資料', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  S.charts.pie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e.label),
      datasets: [{ data: entries.map(e => e.value), backgroundColor: entries.map(e => e.color), borderColor: cc.border, borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      layout: { padding: { top: 8, bottom: 8, left: 8, right: 8 } },
      plugins: {
        legend: window.innerWidth <= 640
          // 手機：底部橫排，字體縮小
          ? {
              position: 'bottom',
              labels: {
                color: cc.legend,
                padding: 10,
                font: { size: 11 },
                boxWidth: 10,
                usePointStyle: true,
                generateLabels(chart) {
                  const ds = chart.data.datasets[0];
                  const tot = ds.data.reduce((a,b)=>a+b,0);
                  return chart.data.labels.map((label, i) => ({
                    text: `${label} ${(ds.data[i]/tot*100).toFixed(1)}%`,
                    fillStyle: ds.backgroundColor[i],
                    strokeStyle: ds.backgroundColor[i],
                    hidden: false, index: i,
                  }));
                },
              },
            }
          // 桌面：右側垂直排列，含百分比
          : {
              position: 'right',
              align: 'center',
              labels: {
                color: cc.legend,
                padding: 16,
                font: { size: 12 },
                boxWidth: 10,
                usePointStyle: true,
                generateLabels(chart) {
                  const ds = chart.data.datasets[0];
                  const tot = ds.data.reduce((a,b)=>a+b,0);
                  return chart.data.labels.map((label, i) => ({
                    text: `${label}  ${(ds.data[i]/tot*100).toFixed(1)}%`,
                    fillStyle: ds.backgroundColor[i],
                    strokeStyle: ds.backgroundColor[i],
                    hidden: false, index: i,
                  }));
                },
              },
            },
        tooltip: {
          // 跟隨游標顯示，yAlign:bottom 讓 tooltip 在游標上方展開
          position: 'cursorOffset',
          yAlign: 'bottom',
          callbacks: { label(c) {
            return ` ${c.label}: ${fmt(c.parsed)}`;
          }},
        },
        doughnutCenter: { text: fmt(total), sub: '總資產' },
      },
    },
  });
}

function renderTrend() {
  let snaps = [...S.data.snapshots];
  const ctx = $('trend-chart').getContext('2d');
  if (S.charts.trend) S.charts.trend.destroy();

  const nodata = $('trend-nodata');
  if (snaps.length === 0) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (nodata) nodata.style.display = 'flex';
    return;
  }
  if (nodata) nodata.style.display = 'none';

  const now = new Date();
  if (S.trendFilter === '1y') {
    const cut = new Date(now.getFullYear()-1, now.getMonth(), 1);
    snaps = snaps.filter(s => new Date(s[0]) >= cut);
  } else if (S.trendFilter === '6m') {
    const cut = new Date(now.getFullYear(), now.getMonth()-6, 1);
    snaps = snaps.filter(s => new Date(s[0]) >= cut);
  }

  // 加入當月即時數據點（若最後一筆快照不是本月）
  const todayM = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}`;
  if (!snaps.length || snaps[snaps.length-1][0] < todayM) {
    const { net: liveNet } = calcTotals();
    snaps = [...snaps, [todayM + ' ▸', 0,0,0,0,0,0,0, liveNet]];
  }

  const cc = chartColors();
  S.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: snaps.map(s => s[0]),
      datasets: [{
        label: '淨資產',
        data: snaps.map(s => parseFloat(s[8]) || 0),
        borderColor: cc.line1,
        borderWidth: 2.5,
        tension: 0.42,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: cc.line1,
        pointBorderColor: 'transparent',
        fill: true,
        backgroundColor(context) {
          const { ctx: c, chartArea } = context.chart;
          if (!chartArea) return 'rgba(0,0,0,0)';
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, cc.line1 === '#007AFF' ? 'rgba(0,122,255,0.22)' : 'rgba(99,102,241,0.22)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          return g;
        },
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 8, right: 8, bottom: 0, left: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label(c) { return ` 淨資產: ${fmt(c.parsed.y)}`; } } },
      },
      scales: {
        x: { offset: false, grid: { display: false }, ticks: { color: cc.tick, font: { size: 10 }, maxTicksLimit: 6, maxRotation: 0 }, border: { display: false } },
        y: { display: false },
      },
    },
  });
}

function renderMonthly() {
  const snaps = S.data.snapshots;
  const ctx = $('monthly-chart').getContext('2d');
  if (S.charts.monthly) S.charts.monthly.destroy();

  const cc = chartColors();
  if (snaps.length < 2) {
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
    ctx.fillStyle=cc.nodata; ctx.font='13px sans-serif'; ctx.textAlign='center';
    ctx.fillText('需至少兩筆快照', ctx.canvas.width/2, ctx.canvas.height/2);
    return;
  }

  const labels=[], vals=[];
  for (let i=1;i<snaps.length;i++) {
    labels.push(snaps[i][0]);
    vals.push((parseFloat(snaps[i][8])||0) - (parseFloat(snaps[i-1][8])||0));
  }

  // 加入當月即時數據（若最後一筆快照不是本月）
  const nowM = new Date();
  const todayM2 = `${nowM.getFullYear()}/${String(nowM.getMonth()+1).padStart(2,'0')}`;
  if (snaps.length && snaps[snaps.length-1][0] < todayM2) {
    const lastNet = parseFloat(snaps[snaps.length-1][8]) || 0;
    const { net: curNet } = calcTotals();
    labels.push(todayM2 + ' ▸');
    vals.push(curNet - lastNet);
  }

  S.charts.monthly = new Chart(ctx, {
    type:'bar',
    data: {
      labels,
      datasets: [{
        label:'月收益', data:vals,
        backgroundColor: vals.map(v=>v>=0 ? cc.barPos : cc.barNeg),
        borderColor: vals.map(v=>v>=0 ? (cc.line2) : '#FF3B30'),
        borderWidth:0, borderRadius:6,
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{display:false},
        tooltip:{ callbacks:{ label(c){ return ` ${c.parsed.y>=0?'+':''}${fmt(c.parsed.y)}`; } } },
      },
      scales: {
        x:{ grid:{display:false}, ticks:{color:cc.tick,font:{size:10}}, border:{display:false} },
        y:{ display:false },
      },
    },
  });
}

function setTrendFilter(btn) {
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  S.trendFilter = btn.dataset.f;
  renderTrend();
}

// ══════════════════════════════════════════════════════════════
// CRUD
// ══════════════════════════════════════════════════════════════
function addItem(type) {
  const configs = {
    cash:   { title:'新增流動現金', fields:[{id:'bank_name',label:'帳戶名稱',ph:'例如：永豐活存'},{id:'currency',label:'幣別',type:'select',options:['TWD','USD','SGD','JPY','EUR','HKD'],def:'TWD'},{id:'amount',label:'金額',type:'number',ph:'0',min:0}] },
    tw:     { title:'新增台股',     fields:[{id:'symbol',label:'股票代號',ph:'例如：0050',upper:true},{id:'shares',label:'股數',type:'number',ph:'0',min:0}] },
    us:     { title:'新增美股',     fields:[{id:'symbol',label:'股票代號',ph:'例如：VTI',upper:true},{id:'shares',label:'股數（可含小數）',type:'number',ph:'0',min:0,step:'any'}] },
    crypto: { title:'新增加密貨幣', fields:[{id:'symbol',label:'幣種代號（BTC、ETH…）',ph:'BTC',upper:true},{id:'quantity',label:'數量',type:'number',ph:'0',min:0,step:'any'}] },
  };
  const c = configs[type];
  openModal(c.title, c.fields, async vals => {
    if (type === 'crypto') {
      const sym = vals.symbol.toUpperCase();
      if (!COIN_MAP[sym]) {
        showToast('驗證幣種中…');
        const id = await validateCoinGecko(sym);
        if (!id) { showToast(`找不到幣種「${sym}」，請確認代號`, 'err'); return false; }
      }
    }
    const sym = vals.symbol?.toUpperCase();
    if (type === 'cash')   S.data.cash.push([vals.bank_name, parseFloat(vals.amount)||0, vals.currency||'TWD']);
    if (type === 'tw')     S.data.tw.push([sym, parseFloat(vals.shares)||0]);
    if (type === 'us')     S.data.us.push([sym, parseFloat(vals.shares)||0]);
    if (type === 'crypto') S.data.crypto.push([sym, parseFloat(vals.quantity)||0]);

    await persistAndRefresh(type);
    showToast('新增成功', 'ok');
    return true;
  });
}

function editItem(type, idx) {
  const getRow = () => ({ cash:S.data.cash, tw:S.data.tw, us:S.data.us, crypto:S.data.crypto }[type][idx]);
  const r = getRow();
  const configs = {
    cash:   { title:'編輯流動現金', fields:[{id:'bank_name',label:'帳戶名稱',val:r[0]},{id:'currency',label:'幣別',type:'select',options:['TWD','USD','SGD','JPY','EUR','HKD'],val:r[2]||'TWD'},{id:'amount',label:'金額',type:'number',val:r[1],min:0}] },
    tw:     { title:'編輯台股', fields:[{id:'symbol',label:'代號',val:r[0],ro:true},{id:'shares',label:'股數',type:'number',val:r[1],min:0}] },
    us:     { title:'編輯美股', fields:[{id:'symbol',label:'代號',val:r[0],ro:true},{id:'shares',label:'股數',type:'number',val:r[1],min:0,step:'any'}] },
    crypto: { title:'編輯加密貨幣', fields:[{id:'symbol',label:'代號',val:r[0],ro:true},{id:'quantity',label:'數量',type:'number',val:r[1],min:0,step:'any'}] },
  };
  const c = configs[type];
  openModal(c.title, c.fields, async vals => {
    if (type === 'cash') {
      const amtBefore = parseFloat(r[1]) || 0;
      const amtAfter  = parseFloat(vals.amount) || 0;
      const currency  = vals.currency || 'TWD';
      S.data.cash[idx] = [vals.bank_name, amtAfter, currency];
      await persistAndRefresh(type);
      await appendHistory('cash', vals.bank_name, amtBefore, amtAfter, currency);
    } else if (type === 'tw') {
      const qtyBefore = parseFloat(r[1]) || 0;
      const qtyAfter = parseFloat(vals.shares) || 0;
      S.data.tw[idx] = [r[0], qtyAfter];
      await persistAndRefresh(type);
      await appendHistory('tw', r[0].toUpperCase(), qtyBefore, qtyAfter);
    } else if (type === 'us') {
      const qtyBefore = parseFloat(r[1]) || 0;
      const qtyAfter = parseFloat(vals.shares) || 0;
      S.data.us[idx] = [r[0], qtyAfter];
      await persistAndRefresh(type);
      await appendHistory('us', r[0].toUpperCase(), qtyBefore, qtyAfter);
    } else if (type === 'crypto') {
      const qtyBefore = parseFloat(r[1]) || 0;
      const qtyAfter = parseFloat(vals.quantity) || 0;
      S.data.crypto[idx] = [r[0], qtyAfter];
      await persistAndRefresh(type);
      await appendHistory('crypto', r[0].toUpperCase(), qtyBefore, qtyAfter);
    }
    doSaveDailySnapshot(true);
    showToast('已儲存並記錄變動', 'ok');
    return true;
  });
}

function deleteItem(type, idx) {
  openConfirm('確認刪除', '確定要刪除這筆資料嗎？', async () => {
    const map = { cash:S.data.cash, tw:S.data.tw, us:S.data.us, crypto:S.data.crypto };
    map[type].splice(idx, 1);
    await persistAndRefresh(type);
    showToast('已刪除', 'ok');
  });
}

async function persistAndRefresh(type) {
  const map = { cash:['cash_accounts',S.data.cash], tw:['holdings_tw',S.data.tw], us:['holdings_us',S.data.us], crypto:['holdings_crypto',S.data.crypto] };
  const [name, data] = map[type];
  await saveSheet(name, data);
  renderKPIs(); renderCharts(); renderManagement();
}

// ══════════════════════════════════════════════════════════════
// SNAPSHOT
// ══════════════════════════════════════════════════════════════
async function doSaveDailySnapshot(silent = false) {
  const { cashT, twT, usT, cryT, ins, re, debt, net } = calcTotals();
  const now = new Date();
  const ds = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
  const row = [ds, cashT.toFixed(0), twT.toFixed(0), usT.toFixed(0), cryT.toFixed(0), ins.toFixed(0), re.toFixed(0), debt.toFixed(0), net.toFixed(0)];
  const idx = S.data.daily_snapshots.findIndex(s => s[0] === ds);
  if (idx >= 0) S.data.daily_snapshots[idx] = row;
  else { S.data.daily_snapshots.push(row); S.data.daily_snapshots.sort((a,b) => a[0].localeCompare(b[0])); }
  await saveSheet('daily_snapshots', S.data.daily_snapshots);
  renderCharts();
  if (!silent) showToast(`${ds} 每日快照已儲存`, 'ok');
}

function scheduleDailySnapshot() {
  // Check immediately if today's snapshot is missing and it's past 23:59
  const checkAndSnap = async () => {
    const now = new Date();
    const ds = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
    const alreadyDone = S.data.daily_snapshots.some(s => s[0] === ds);
    const isPastTime = now.getHours() === 23 && now.getMinutes() >= 59;
    if (!alreadyDone && isPastTime) {
      try { await doSaveDailySnapshot(true); } catch(e) { console.warn('Daily snapshot failed:', e); }
    }
  };

  checkAndSnap();
  // Check every minute
  setInterval(checkAndSnap, 60 * 1000);
}

// ══════════════════════════════════════════════════════════════
// MODAL
// ══════════════════════════════════════════════════════════════
function openModal(title, fields, onOK) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = `
    <div class="modal-form">
      ${fields.map(f => `
        <div class="field">
          <label>${esc(f.label)}</label>
          ${f.type === 'select' ? `
          <select id="mf-${f.id}">
            ${(f.options||[]).map(o => `<option value="${esc(o)}" ${o === (f.val||f.def||f.options[0]) ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select>` : `
          <input
            id="mf-${f.id}"
            type="${f.type||'text'}"
            value="${f.val !== undefined ? esc(String(f.val)) : ''}"
            placeholder="${f.ph||''}"
            ${f.min!==undefined?`min="${f.min}"`:''}
            ${f.step?`step="${f.step}"`:''}
            ${f.ro?'readonly':''}
            ${f.upper?`oninput="this.value=this.value.toUpperCase()"` :''}
          />`}
        </div>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-ok" id="modal-ok">確認</button>
    </div>`;
  $('modal').classList.add('open');
  setTimeout(() => { const f = $('modal-body').querySelector('input:not([readonly])'); if(f) f.focus(); }, 80);

  $('modal-ok').onclick = async () => {
    const vals = {};
    let ok = true;
    fields.forEach(f => {
      const el = $(`mf-${f.id}`);
      const v = el?.value?.trim();
      if (!v && f.type !== 'number' && f.type !== 'select' && !f.opt) { el.classList.add('invalid'); ok = false; }
      else { el?.classList.remove('invalid'); vals[f.id] = v; }
    });
    if (!ok) return;
    const btn = $('modal-ok');
    btnLoading(btn);
    try {
      const res = await onOK(vals);
      if (res !== false) {
        btn.classList.remove('btn-loading');
        btn.textContent = '✓ 完成';
        setTimeout(() => closeModal(), 600);
      } else {
        btnReset(btn);
      }
    } catch(e) {
      btnReset(btn);
      showToast('錯誤：' + e.message, 'err');
    }
  };

  $('modal-body').onkeydown = e => { if(e.key==='Enter') $('modal-ok')?.click(); };
}

function openConfirm(title, msg, onOK) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = `
    <p style="color:var(--muted);line-height:1.6;white-space:pre-line;margin-bottom:20px">${esc(msg)}</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-ok" id="modal-ok">確認</button>
    </div>`;
  $('modal').classList.add('open');
  $('modal-ok').onclick = async () => {
    const btn = $('modal-ok');
    btnLoading(btn);
    closeModal();
    try { await onOK(); } catch(e) { showToast('錯誤：'+e.message,'err'); }
  };
}

function closeModal() { $('modal').classList.remove('open'); }
function modalBgClick(e) { if(e.target === $('modal')) closeModal(); }

// 流動現金卡片點擊詳情
function openCashDetail(idx) {
  const r = S.data.cash[idx];
  if (!r) return;
  const name = r[0] || '帳戶';
  const ccy = (r[2] || 'TWD').toUpperCase();
  const amt = parseFloat(r[1]) || 0;
  const twd = cashToTWD(r);
  const hasErr = ccy !== 'TWD' && S.prices.errs[`fx_${ccy}`];
  $('modal-title').textContent = name;
  $('modal-body').innerHTML = `
    <div style="text-align:center;padding:8px 0 20px">
      <div style="font-size:1.6rem;font-weight:800;color:var(--text);line-height:1.2">${hasErr ? '匯率失敗' : fmt(twd)}</div>
      <div style="font-size:0.85rem;color:var(--muted);margin-top:6px">${esc(ccy)} ${fmtCashAmt(amt, ccy)}</div>
    </div>
    <div class="modal-actions" style="flex-direction:column;gap:10px">
      <button class="btn-ok" style="width:100%" onclick="closeModal();setTimeout(()=>editItem('cash',${idx}),80)">✏ 修改金額</button>
      <button class="btn-cp-delete" onclick="closeModal();setTimeout(()=>deleteItem('cash',${idx}),80)">✕ 刪除帳戶</button>
    </div>`;
  $('modal').classList.add('open');
}

function openUsdtDetail() {
  const idx = S.data.crypto.findIndex(r => r[0]?.toUpperCase() === 'USDT');
  if (idx < 0) return;
  const qty = parseFloat(S.data.crypto[idx][1]) || 0;
  const twd = qty * S.prices.usdtwd;
  $('modal-title').textContent = 'USDT';
  $('modal-body').innerHTML = `
    <div style="text-align:center;padding:8px 0 20px">
      <div style="font-size:1.6rem;font-weight:800;color:var(--text);line-height:1.2">${fmt(twd)}</div>
      <div style="font-size:0.85rem;color:var(--muted);margin-top:6px">USDT ${qty.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
    </div>
    <div class="modal-actions" style="flex-direction:column;gap:10px">
      <button class="btn-ok" style="width:100%" onclick="closeModal();setTimeout(()=>editItem('crypto',${idx}),80)">✏ 修改數量</button>
      <button class="btn-cp-delete" onclick="closeModal();setTimeout(()=>deleteItem('crypto',${idx}),80)">✕ 刪除 USDT</button>
    </div>`;
  $('modal').classList.add('open');
}

// ══════════════════════════════════════════════════════════════
// ASSET DETAIL PANEL (共用：crypto / tw / us)
// ══════════════════════════════════════════════════════════════
let _panelIdx = null;
let _panelAssetType = null; // 'crypto' | 'tw' | 'us'

function getNowTW8() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth()+1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// 通用歷史寫入（支援 cash / crypto / tw / us）
async function appendHistory(type, sym, qtyBefore, qtyAfter, extra) {
  const delta = qtyAfter - qtyBefore;
  let col5 = '', col6 = '';
  if (type === 'crypto') {
    const p = S.prices.crypto[sym];
    col5 = p !== undefined ? p : '';
    col6 = p !== undefined ? delta * p * S.prices.usdtwd : '';
  } else if (type === 'tw') {
    const p = S.prices.tw[sym];
    col5 = p !== undefined ? p : '';
    col6 = p !== undefined ? delta * p : '';
  } else if (type === 'us') {
    const p = S.prices.us[sym];
    col5 = p !== undefined ? p : '';
    col6 = p !== undefined ? delta * p * S.prices.usdtwd : '';
  } else if (type === 'cash') {
    // sym = account name, extra = currency
    const currency = extra || 'TWD';
    col5 = currency;
    const fx = S.prices.fx[currency] || 1;
    col6 = delta * fx;
  }
  const histKey = `${type}_history`;
  const row = [getNowTW8(), sym, qtyBefore, qtyAfter, delta, col5, col6];
  S.data[histKey].push(row);
  await saveSheet(histKey, S.data[histKey]);
}

// 向下相容舊呼叫（editItem crypto 路徑）
async function appendCryptoHistory(sym, qtyBefore, qtyAfter) {
  return appendHistory('crypto', sym, qtyBefore, qtyAfter);
}

// 更新 panel 顯示
function _refreshPanelDisplay(sym) {
  const type = _panelAssetType, idx = _panelIdx;
  if (idx === null) return;

  let valueTwd = null, subText = '';

  if (type === 'cash') {
    const r = S.data.cash[idx];
    if (!r) return;
    const ccy = (r[2] || 'TWD').toUpperCase();
    const amt = parseFloat(r[1]) || 0;
    valueTwd = cashToTWD(r);
    subText = `${esc(ccy)} ${fmtCashAmt(amt, ccy)}`;
  } else {
    const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
    const r = dataMap[type]?.[idx];
    if (!r) return;
    const qty = parseFloat(r[1]) || 0;
    if (type === 'crypto') {
      const p = S.prices.crypto[sym];
      valueTwd = p !== undefined ? qty * p * S.prices.usdtwd : null;
      subText = `持有 ${qty.toFixed(3)} ${sym}　·　${p !== undefined ? fmtUSD(p, 4) : '—'}`;
    } else if (type === 'tw') {
      const p = S.prices.tw[sym];
      valueTwd = p !== undefined ? qty * p : null;
      subText = `持有 ${qty.toLocaleString()} 股　·　${p !== undefined ? p.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' TWD' : '—'}`;
    } else if (type === 'us') {
      const p = S.prices.us[sym];
      valueTwd = p !== undefined ? qty * p * S.prices.usdtwd : null;
      subText = `持有 ${qty.toLocaleString(undefined,{maximumFractionDigits:4})} 股　·　${p !== undefined ? fmtUSD(p) + ' USD' : '—'}`;
    }
  }

  $('cp-value').textContent = valueTwd !== null ? fmt(valueTwd) + ' TWD' : '—';
  $('cp-value-sub').textContent = subText;
  renderHistoryInPanel(type, sym);
}

// 通用：開啟 panel（支援 cash / tw / us / crypto）
function openAssetDetail(type, idx) {
  _panelAssetType = type;
  _panelIdx = idx;
  let sym;
  if (type === 'cash') {
    sym = S.data.cash[idx]?.[0] || '帳戶';
  } else {
    const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
    sym = dataMap[type][idx]?.[0]?.toUpperCase() || '';
  }
  $('cp-sym').textContent = sym;
  _refreshPanelDisplay(sym);
  $('crypto-panel').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// 向下相容
function openCryptoDetail(idx) { openAssetDetail('crypto', idx); }

function closeAssetDetail() {
  $('crypto-panel').classList.remove('open');
  document.body.style.overflow = '';
  _panelIdx = null;
  _panelAssetType = null;
}

// 向下相容
function closeCryptoDetail() { closeAssetDetail(); }

function cryptoPanelBgClick(e) {
  if (e.target === $('crypto-panel')) closeAssetDetail();
}

// 通用歷史記錄渲染（table 格式，支援 cash / tw / us / crypto）
function renderHistoryInPanel(type, sym) {
  const histKey = `${type}_history`;
  const hist = (S.data[histKey] || []).filter(r => r[1] === sym);
  hist.sort((a, b) => (b[0] > a[0] ? 1 : -1));

  const el = $('cp-history');
  if (!hist.length) {
    el.innerHTML = '<div class="cp-history-empty">尚無變動記錄</div>';
    return;
  }

  const isCash   = type === 'cash';
  const isCrypto = type === 'crypto';

  // 欄位 header
  const colPrice = isCash ? '幣別' : (type === 'tw' ? '股價' : '幣價');

  const rows = hist.map(r => {
    const delta    = parseFloat(r[4]);
    const isPos    = delta >= 0;
    const qtyAfter = parseFloat(r[3]);

    let deltaStr, qtyStr, priceStr;

    if (isCash) {
      const ccy = r[5] || 'TWD';
      deltaStr  = (isPos ? '+' : '') + delta.toLocaleString('zh-TW',{minimumFractionDigits:0,maximumFractionDigits:2});
      qtyStr    = qtyAfter.toLocaleString('zh-TW',{minimumFractionDigits:0,maximumFractionDigits:2});
      priceStr  = ccy;
    } else if (isCrypto) {
      deltaStr  = (isPos ? '+' : '') + delta.toFixed(4);
      qtyStr    = qtyAfter.toFixed(4);
      priceStr  = r[5] !== '' && r[5] !== undefined ? fmtUSD(parseFloat(r[5]), 4) : '—';
    } else if (type === 'tw') {
      deltaStr  = (isPos ? '+' : '') + delta.toLocaleString(undefined,{maximumFractionDigits:0});
      qtyStr    = qtyAfter.toLocaleString();
      priceStr  = r[5] !== '' && r[5] !== undefined
        ? parseFloat(r[5]).toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' TWD'
        : '—';
    } else { // us
      deltaStr  = (isPos ? '+' : '') + delta.toLocaleString(undefined,{maximumFractionDigits:4});
      qtyStr    = qtyAfter.toLocaleString(undefined,{maximumFractionDigits:4});
      priceStr  = r[5] !== '' && r[5] !== undefined ? fmtUSD(parseFloat(r[5]), 2) : '—';
    }

    return `<tr>
      <td class="ch-date">${esc(r[0])}</td>
      <td class="ch-delta ${isPos ? 'pos' : 'neg'}">${deltaStr}</td>
      <td class="ch-qty">${qtyStr}</td>
      <td class="ch-price">${priceStr}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `<table class="cp-history-table">
    <thead><tr>
      <th>日期</th><th>增減</th><th>餘額</th><th>${colPrice}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// 向下相容
function renderCryptoHistory(sym) { renderHistoryInPanel('crypto', sym); }

// 通用：增減數量（支援 cash / tw / us / crypto）
async function adjustAssetQty() {
  if (_panelIdx === null) return;
  const type = _panelAssetType;

  if (type === 'cash') {
    const r = S.data.cash[_panelIdx];
    const name = r[0];
    const ccy  = (r[2] || 'TWD').toUpperCase();
    const amtBefore = parseFloat(r[1]) || 0;
    openModal(`增減金額 · ${name}`, [
      { id: 'delta', label: `變動金額 ${ccy}（正為增加，負為減少）`, type: 'number', step: 'any', ph: '例如 5000 或 -2000' },
    ], async vals => {
      const delta = parseFloat(vals.delta);
      if (isNaN(delta) || delta === 0) { showToast('請輸入有效的變動金額', 'err'); return false; }
      const amtAfter = amtBefore + delta;
      S.data.cash[_panelIdx] = [name, amtAfter, ccy];
      await saveSheet('cash_accounts', S.data.cash);
      await appendHistory('cash', name, amtBefore, amtAfter, ccy);
      renderKPIs(); renderCharts(); renderManagement();
      doSaveDailySnapshot(true);
      _refreshPanelDisplay(name);
      showToast('已儲存並記錄變動', 'ok');
      return true;
    });
    return;
  }

  const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
  const r = dataMap[type][_panelIdx];
  const sym = r[0]?.toUpperCase();
  const qtyBefore = parseFloat(r[1]) || 0;
  const unit = type === 'crypto' ? '' : '股';
  const fields = [
    { id: 'delta', label: `變動${unit ? unit : '數量'}（正為增加，負為減少）`, type: 'number', step: 'any', ph: unit ? '例如 100 或 -50' : '例如 0.5 或 -0.1' },
    ...(type === 'crypto' ? [{ id: 'manual_adj', label: '其中手動增減（如提領生活費，選填）', type: 'number', step: 'any', val: 0, ph: '例如 -100 表示提領了 100' }] : []),
  ];
  openModal(`增減數量 · ${sym}`, fields, async vals => {
    const delta = parseFloat(vals.delta);
    if (isNaN(delta) || delta === 0) { showToast('請輸入有效的變動數量', 'err'); return false; }
    const qtyAfter = qtyBefore + delta;
    if (qtyAfter < 0) { showToast('數量不能小於 0', 'err'); return false; }
    dataMap[type][_panelIdx] = [sym, qtyAfter];
    const sheetMap = { crypto:'holdings_crypto', tw:'holdings_tw', us:'holdings_us' };
    await saveSheet(sheetMap[type], dataMap[type]);
    await appendHistory(type, sym, qtyBefore, qtyAfter);
    renderKPIs(); renderCharts(); renderManagement();
    doSaveDailySnapshot(true);
    _refreshPanelDisplay(sym);
    showToast('已儲存並記錄變動', 'ok');
    // 自動換算利息收益（僅 crypto）
    if (type === 'crypto') {
      const manualAdj = parseFloat(vals.manual_adj) || 0;
      const interestQty = delta - manualAdj;
      if (interestQty > 0) await autoAddReward(sym, interestQty);
    }
    return true;
  });
}

// 向下相容
async function adjustCryptoQty() { return adjustAssetQty(); }

// 通用：設定餘額（支援 cash / tw / us / crypto）
async function setAssetQty() {
  if (_panelIdx === null) return;
  const type = _panelAssetType;

  if (type === 'cash') {
    const r = S.data.cash[_panelIdx];
    const name = r[0];
    const ccy  = (r[2] || 'TWD').toUpperCase();
    const amtBefore = parseFloat(r[1]) || 0;
    openModal(`設定餘額 · ${name}`, [
      { id: 'amount', label: `新餘額 (${ccy})`, type: 'number', val: r[1], min: 0, step: 'any' },
    ], async vals => {
      const amtAfter = parseFloat(vals.amount);
      if (isNaN(amtAfter) || amtAfter < 0) { showToast('請輸入有效金額', 'err'); return false; }
      S.data.cash[_panelIdx] = [name, amtAfter, ccy];
      await saveSheet('cash_accounts', S.data.cash);
      await appendHistory('cash', name, amtBefore, amtAfter, ccy);
      renderKPIs(); renderCharts(); renderManagement();
      doSaveDailySnapshot(true);
      _refreshPanelDisplay(name);
      showToast('已儲存並記錄變動', 'ok');
      return true;
    });
    return;
  }

  const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
  const r = dataMap[type][_panelIdx];
  const sym = r[0]?.toUpperCase();
  const qtyBefore = parseFloat(r[1]) || 0;
  const fields = [
    { id: 'quantity', label: type === 'crypto' ? '新數量' : '新股數', type: 'number', val: r[1], min: 0, step: 'any' },
    ...(type === 'crypto' ? [{ id: 'manual_adj', label: '本月手動增減（如提領生活費，選填）', type: 'number', step: 'any', val: 0, ph: '例如 -100 表示提領了 100，0 表示全為利息' }] : []),
  ];
  openModal(`設定餘額 · ${sym}`, fields, async vals => {
    const qtyAfter = parseFloat(vals.quantity);
    if (isNaN(qtyAfter) || qtyAfter < 0) { showToast('請輸入有效數量', 'err'); return false; }
    dataMap[type][_panelIdx] = [sym, qtyAfter];
    const sheetMap = { crypto:'holdings_crypto', tw:'holdings_tw', us:'holdings_us' };
    await saveSheet(sheetMap[type], dataMap[type]);
    await appendHistory(type, sym, qtyBefore, qtyAfter);
    renderKPIs(); renderCharts(); renderManagement();
    doSaveDailySnapshot(true);
    _refreshPanelDisplay(sym);
    showToast('已儲存並記錄變動', 'ok');
    // 自動換算利息收益（僅 crypto）
    if (type === 'crypto') {
      const delta = qtyAfter - qtyBefore;
      const manualAdj = parseFloat(vals.manual_adj) || 0;
      const interestQty = delta - manualAdj;
      if (interestQty > 0) await autoAddReward(sym, interestQty);
    }
    return true;
  });
}

// 向下相容
async function setCryptoQty() { return setAssetQty(); }

// 通用：從 panel 刪除（支援 cash / tw / us / crypto）
function deleteAssetFromPanel() {
  if (_panelIdx === null) return;
  const type = _panelAssetType;
  let label, sheetName, dataArr;
  if (type === 'cash') {
    dataArr = S.data.cash;
    label = dataArr[_panelIdx]?.[0] || '帳戶';
    sheetName = 'cash_accounts';
  } else {
    const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
    const sheetMap = { crypto:'holdings_crypto', tw:'holdings_tw', us:'holdings_us' };
    dataArr = dataMap[type];
    label = dataArr[_panelIdx]?.[0]?.toUpperCase() || '';
    sheetName = sheetMap[type];
  }
  openConfirm('刪除 ' + label, `確定要移除「${label}」嗎？`, async () => {
    dataArr.splice(_panelIdx, 1);
    await saveSheet(sheetName, dataArr);
    renderKPIs(); renderCharts(); renderManagement();
    closeAssetDetail();
    showToast('已刪除 ' + label, 'ok');
  });
}

// 向下相容
function deleteCryptoFromPanel() { deleteAssetFromPanel(); }

// ══════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════
function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  localStorage.setItem('theme', next);
  Chart.defaults.color = next === 'light' ? '#8c7055' : '#94a3b8';
  renderCharts();
  updateThemeBtn();
}

function updateMobileBuildBar() {
  // 舊的頂部 bar（已隱藏，保留相容）
  const el = $('mobile-build-bar');
  if (el) el.textContent = `版本 ${BUILD_DATE}`;
  // 新的底部 footer
  const fb = $('mobile-footer-build');
  if (fb) fb.textContent = `版本 ${BUILD_DATE}`;
}

function updateThemeBtn() {
  const isLight = document.documentElement.dataset.theme === 'light';
  const icon = isLight ? '🌙' : '☀';
  const title = isLight ? '切換為深色模式' : '切換為淺色模式';
  ['btn-theme', 'sidebar-btn-theme'].forEach(id => {
    const btn = $(id); if (!btn) return;
    btn.textContent = icon; btn.title = title;
  });
  const menuIcon = $('menu-theme-icon');
  if (menuIcon) menuIcon.textContent = icon;
}

// ══════════════════════════════════════════════════════════════
// UI UTILITIES
// ══════════════════════════════════════════════════════════════
function switchTab(tab) {
  $('tab-overview').style.display   = tab==='overview'   ? 'block' : 'none';
  $('tab-management').style.display = tab==='management' ? 'block' : 'none';
  document.querySelectorAll('.tab-btn').forEach((b,i) => {
    b.classList.toggle('active', (i===0&&tab==='overview')||(i===1&&tab==='management'));
  });
  // Sidebar nav
  const sO = $('snav-overview'), sM = $('snav-management');
  if (sO) sO.classList.toggle('active', tab === 'overview');
  if (sM) sM.classList.toggle('active', tab === 'management');
  if (tab === 'management') renderManagement();
}

// ── Mobile Menu Sheet ──
function openMobileMenu() {
  const overlay = $('mobile-menu');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeMobileMenu() {
  const overlay = $('mobile-menu');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}
function mobileMenuBgClick(e) {
  if (e.target === $('mobile-menu')) closeMobileMenu();
}

let toastTmr;
function showToast(msg, type='') {
  const t = $('toast');
  t.textContent = msg; t.className = `toast show ${type}`;
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => t.classList.remove('show'), 3000);
}

// TWD 萬元格式（所有台幣現值、合計）
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n), sign = n < 0 ? '-' : '';
  if (abs >= 10000) {
    return sign + (abs/10000).toLocaleString('zh-TW', {minimumFractionDigits:1,maximumFractionDigits:1}) + '萬';
  }
  return sign + Math.round(abs).toLocaleString('zh-TW');
}

// 萬元簡略格式（不加單位符號，用於副標題）
function fmtWan(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n), sign = n < 0 ? '-' : '';
  if (abs >= 10000) return sign + (abs/10000).toLocaleString('zh-TW', {minimumFractionDigits:1,maximumFractionDigits:1}) + '萬';
  return sign + Math.round(abs).toLocaleString('zh-TW');
}

// 加密貨幣幣價（卡片顯示）：無條件捨去到小數第三位
function fmtFloor3(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const f = Math.floor(n * 1000) / 1000;
  if (f >= 1000) return '$' + f.toLocaleString('en-US', {minimumFractionDigits:3, maximumFractionDigits:3});
  return '$' + f.toFixed(3);
}

// USD 價格格式：$325.21
function fmtUSD(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  if (n >= 1)    return '$' + n.toFixed(decimals);
  // Small prices (e.g. SHIB): up to 6 significant digits
  return '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:6});
}

// Cash amount by currency
function fmtCashAmt(amt, ccy) {
  if (ccy === 'JPY') return Math.round(amt).toLocaleString('ja-JP');
  if (ccy === 'TWD') return Math.round(amt).toLocaleString('zh-TW');
  return amt.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function $(id) { return document.getElementById(id); }

// Button loading helpers
function btnLoading(el, loadingText = '處理中…') {
  el.disabled = true;
  el._origText = el.textContent;
  el.classList.add('btn-loading');
  el.textContent = loadingText;
}
function btnDone(el, doneText = '✓ 完成') {
  el.classList.remove('btn-loading');
  el.textContent = doneText;
  setTimeout(() => {
    el.disabled = false;
    el.textContent = el._origText || doneText;
  }, 1000);
}
function btnReset(el) {
  el.classList.remove('btn-loading');
  el.disabled = false;
  if (el._origText) el.textContent = el._origText;
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
async function initApp() {
  try {
    showToast('初始化資料表…');
    await initSheets();

    showToast('載入資料…');
    await loadAll();
    await seedBaselineHistory();

    showToast('抓取即時價格…');
    localStorage.removeItem(PRICE_CACHE_KEY); // 啟動時強制清快取
    await fetchAllPrices(true); // 並強制抓新報價，確保跨裝置數據一致

    const marchCount = await batchSeedMarchRewards();
    if (marchCount > 0) showToast(`已新增 ${marchCount} 筆 3 月份質押收益`, 'ok');

    renderKPIs();
    renderCharts();
    showToast('載入完成', 'ok');

    scheduleDailySnapshot();

    // Auto-refresh every 10 minutes（force=true 繞過快取，確保定時刷新）
    setInterval(async () => {
      await fetchAllPrices(true);
      renderKPIs(); renderCharts();
      if ($('tab-management').style.display !== 'none') renderManagement();
    }, 10 * 60 * 1000);

  } catch(e) {
    if (e.message !== 'auth') showToast('載入失敗：' + e.message, 'err');
    console.error('initApp:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Restore saved theme
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;
  Chart.defaults.color = savedTheme === 'light' ? '#8c7055' : '#94a3b8';
  updateThemeBtn();
  updateMobileBuildBar();

  $('btn-signin').addEventListener('click', signIn);
  const gisCheck = setInterval(() => {
    if (window.google?.accounts?.oauth2) { clearInterval(gisCheck); setupTokenClient(); }
  }, 150);
  setTimeout(() => {
    clearInterval(gisCheck);
    if (!S.initialized) $('login-screen').style.display = 'flex';
  }, 12000);
});
