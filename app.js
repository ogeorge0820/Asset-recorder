// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════
// Build 時間：每次修改 code 後手動更新此時間（UTC+8 台北時間）
const BUILD_DATE = '2026/05/01 23:58';

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
  daily_snapshots: ['date','cash_total','stock_tw_total','stock_us_total','crypto_total','insurance_total','realestate_total','debt','net_assets','prices_json'],
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
  experience_plan: ['name','year','month','amount_twd','paid'],
  income_records: ['id','name','category','amount_twd','expected_date','status','linked_account','settled_date','payer'],
  bucket_list: ['id','name','category','age','budget_wan','status','date','paid','notes'],
};

// Bucket List 列舉
const BUCKET_STATUSES = ['規劃中', '已完成', '放棄'];
const BUCKET_CATEGORIES = ['旅遊', '體驗', '學習', '家人', '其他'];

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
    experience_plan: [], // [name, year, month, amount_twd, paid]
    income_records: [],  // [id, name, category, amount_twd, expected_date, status, linked_account, settled_date, payer]
    bucket_list: [],     // [age, name, budget_wan, status, category, note]
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
//
// Google access token 本身硬上限約 1 小時。我們用兩招達到「數週免重登」：
// 1) Token 存 localStorage（跨 tab、跨開關瀏覽器持續），30 天硬上限做 sanity
// 2) 在 token 快過期前用 prompt:'' 做 silent refresh（不彈視窗）
//    只要使用者仍在此瀏覽器登入 Google 帳號，就會無感續期
// ══════════════════════════════════════════════════════════════
const AUTH_STORAGE_KEY = 'asset_recorder_auth_v1';
const AUTH_MAX_AGE_MS = 30 * 24 * 3600 * 1000;  // 30 天硬上限：超過就強制重登
const AUTH_REFRESH_BEFORE_MS = 5 * 60 * 1000;   // 過期前 5 分鐘預先刷新
const AUTH_REFRESH_TIMEOUT_MS = 10 * 1000;      // silent refresh 等候上限（保險）
let _authRefreshTimer = null;
let _authSilentInflight = false;                // 防止重複 silent refresh
// on-demand silent refresh（被 401 觸發）共用 promise，避免重複請求
let _authRefreshPromise = null;
let _authRefreshResolve = null;
let _authRefreshReject  = null;

// 發起 silent refresh 並回傳 Promise<newToken>
// - 若已有 in-flight 的 refresh，直接回傳同一個 promise
// - 內建 10 秒 timeout；Google 不回應就 reject，由呼叫方決定是否登出
function _requestSilentRefresh() {
  if (_authRefreshPromise) return _authRefreshPromise;
  if (!S.tokenClient) return Promise.reject(new Error('no-token-client'));

  _authRefreshPromise = new Promise((resolve, reject) => {
    _authRefreshResolve = resolve;
    _authRefreshReject  = reject;
    _authSilentInflight = true;
    try {
      S.tokenClient.requestAccessToken({ prompt: '' });
    } catch (e) {
      _settleRefresh(null, e);
      return;
    }
    setTimeout(() => {
      if (_authRefreshPromise) _settleRefresh(null, new Error('silent-refresh-timeout'));
    }, AUTH_REFRESH_TIMEOUT_MS);
  });
  return _authRefreshPromise;
}

// 從 tokenClient callback 或 timeout 呼叫：兌現或拒絕 pending promise
function _settleRefresh(token, err) {
  const r = _authRefreshResolve, j = _authRefreshReject;
  _authRefreshResolve = null;
  _authRefreshReject  = null;
  _authRefreshPromise = null;
  _authSilentInflight = false;
  if (err) { if (j) j(err); }
  else     { if (r) r(token); }
}

function _persistAuth() {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
      t: S.token,
      e: S.tokenExpiry,
      savedAt: Date.now(),
    }));
  } catch (_) {}
}

function _clearAuth() {
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (_) {}
  if (_authRefreshTimer) { clearTimeout(_authRefreshTimer); _authRefreshTimer = null; }
}

function _scheduleSilentRefresh() {
  if (_authRefreshTimer) clearTimeout(_authRefreshTimer);
  const ms = Math.max(30 * 1000, S.tokenExpiry - Date.now() - AUTH_REFRESH_BEFORE_MS);
  _authRefreshTimer = setTimeout(() => {
    if (!S.tokenClient || _authSilentInflight) return;
    console.log('[auth] silent refresh');
    _authSilentInflight = true;
    try { S.tokenClient.requestAccessToken({ prompt: '' }); }
    catch (e) { _authSilentInflight = false; console.warn('[auth] silent refresh threw', e); }
  }, ms);
}

function setupTokenClient() {
  if (!window.google?.accounts?.oauth2) return;
  _ensureVisibilityHandler();

  S.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback(resp) {
      if (resp.error) {
        console.warn('[auth] token request error:', resp.error, 'initialized=', S.initialized);
        // 先把 pending on-demand refresh reject 掉
        _settleRefresh(null, new Error(resp.error));
        if (!S.initialized) {
          // 尚未登入過 → 顯示登入畫面 + 錯誤訊息
          $('login-error').textContent = '登入失敗：' + resp.error;
          $('login-screen').style.display = 'flex';
        } else {
          // 已登入過、背景靜默刷新失敗：不強制登出，讓當前 token 自然到期
          // 排程 2 分鐘後再試一次（給 Google 足夠時間恢復狀態）
          console.warn('[auth] silent refresh failed, will retry in 2min');
          if (_authRefreshTimer) clearTimeout(_authRefreshTimer);
          _authRefreshTimer = setTimeout(() => {
            if (!_authSilentInflight && S.tokenClient) {
              _authSilentInflight = true;
              try { S.tokenClient.requestAccessToken({ prompt: '' }); }
              catch (e) { _authSilentInflight = false; }
            }
          }, 2 * 60 * 1000);
        }
        return;
      }
      S.token = resp.access_token;
      S.tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      _persistAuth();
      _scheduleSilentRefresh();
      _settleRefresh(S.token, null);
      console.log('[auth] token acquired, expires at', new Date(S.tokenExpiry).toLocaleString());
      if (!S.initialized) {
        S.initialized = true;
        showApp();
      }
    },
  });

  // Restore session
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null'); } catch (_) {}

  if (saved && saved.savedAt && (Date.now() - saved.savedAt < AUTH_MAX_AGE_MS)) {
    if (Date.now() < saved.e) {
      // Token 仍有效：直接用 + 排程預先刷新
      S.token = saved.t;
      S.tokenExpiry = saved.e;
      S.initialized = true;
      showApp();
      _scheduleSilentRefresh();
      return;
    }
    // Token 過期但保存時間還在 30 天內 → 嘗試靜默續期
    console.log('[auth] token expired, trying silent refresh');
    _authSilentInflight = true;
    try {
      S.tokenClient.requestAccessToken({ prompt: '' });
      // callback 會處理成功/失敗；先什麼都不顯示
      return;
    } catch (e) {
      _authSilentInflight = false;
      console.warn('[auth] silent refresh threw on startup', e);
    }
  }

  // 無有效 session → 顯示登入畫面
  _clearAuth();
  $('login-screen').style.display = 'flex';
}

// 進入前景時主動檢查 token，必要時觸發續期
// 解決 iOS 把背景 JS 殺掉後 _scheduleSilentRefresh 的 setTimeout 永遠不 fire 的情境
function _onVisibilityRefresh() {
  if (document.visibilityState !== 'visible') return;
  if (!S.initialized || !S.tokenClient) return;
  // 還超過 1 分鐘以上才到期 → 不打擾，等原排程 timer
  if (S.tokenExpiry && Date.now() < S.tokenExpiry - 60 * 1000) return;
  if (_authSilentInflight) return;
  console.log('[auth] visibility resume → silent refresh');
  _authSilentInflight = true;
  try { S.tokenClient.requestAccessToken({ prompt: '' }); }
  catch (e) { _authSilentInflight = false; console.warn('[auth] visibility refresh threw', e); }
}

// 一次性註冊（_authVisListenerAdded 防止 setupTokenClient 重複呼叫時加多份）
let _authVisListenerAdded = false;
function _ensureVisibilityHandler() {
  if (_authVisListenerAdded) return;
  document.addEventListener('visibilitychange', _onVisibilityRefresh);
  _authVisListenerAdded = true;
}

function signIn() {
  if (!S.tokenClient) { $('login-error').textContent = 'Google API 尚未載入，請重新整理'; return; }
  // 不強制 consent：首次會自動跳，後續若已授權只需快速確認帳號即可
  S.tokenClient.requestAccessToken({});
}

// 使用者主動登出：撤銷 token + 清本地
function signOut() {
  if (S.token) google.accounts.oauth2.revoke(S.token, () => {});
  _localSignOut();
}

// 內部清理（不 revoke）：用於 401 / silent refresh 失敗等非使用者主動的情境
// 撤銷 token 會讓使用者下次必須重新授權整套權限，iOS storage 短暫失效時不應觸發
function _localSignOut() {
  S.token = null; S.initialized = false;
  _clearAuth();
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
async function api(method, path, body, _retried) {
  // 主動續期：token 剩 < 2 分鐘就先刷新，避免實際呼叫時剛好過期被 401 中斷
  // _retried 為 true 代表這次本來就是續期後的重試，不要再續期一次
  if (!_retried && S.tokenExpiry && S.tokenClient
      && Date.now() > S.tokenExpiry - 120 * 1000
      && !_authSilentInflight) {
    try { await _requestSilentRefresh(); }
    catch (_) { /* 失敗就讓既有 401 流程處理 */ }
  }
  const headers = { Authorization: `Bearer ${S.token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}${path}`,
    { method, headers, body: body ? JSON.stringify(body) : undefined }
  );
  // 401：先試 silent refresh，成功就重試一次；失敗才登出
  if (resp.status === 401) {
    if (_retried) {
      console.warn('[auth] 401 after silent refresh — giving up');
      showToast('登入已過期，請重新登入', 'err');
      _localSignOut();
      throw new Error('auth');
    }
    try {
      console.log('[auth] 401 received, attempting silent refresh');
      await _requestSilentRefresh();
    } catch (e) {
      console.warn('[auth] silent refresh failed on 401:', e.message || e);
      showToast('登入已過期，請重新登入', 'err');
      _localSignOut();
      throw new Error('auth');
    }
    return api(method, path, body, true);  // 用新 token 重試一次
  }
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
  const [cash, tw, us, crypto, snap, daily, sett, rw, hist, twHist, usHist, cashHist, otherHist, expBudget, expPlan, incomeRec, bucketList] = await Promise.allSettled([
    sheetGet('cash_accounts!A:C'),
    sheetGet('holdings_tw!A:B'),
    sheetGet('holdings_us!A:B'),
    sheetGet('holdings_crypto!A:B'),
    sheetGet('snapshots!A:I'),
    sheetGet('daily_snapshots!A:J'),
    sheetGet('settings!A:B'),
    sheetGet('crypto_rewards!A:F'),
    sheetGet('crypto_history!A:G'),
    sheetGet('tw_history!A:G'),
    sheetGet('us_history!A:G'),
    sheetGet('cash_history!A:G'),
    sheetGet('other_history!A:F'),
    sheetGet('expense_budget!A:D'),
    sheetGet('experience_plan!A:E'),
    sheetGet('income_records!A:I'),
    sheetGet('bucket_list!A:I'),
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
  S.data.experience_plan = rows(expPlan);
  S.data.income_records  = rows(incomeRec);
  S.data.bucket_list     = rows(bucketList);
  console.log('[bucket_list] raw from Sheet (' + S.data.bucket_list.length + ' rows):',
    JSON.parse(JSON.stringify(S.data.bucket_list)));
  await _migrateBucketListIfNeeded();
  await _repairCorruptedBucketRows();

  S.data.settings = { insurance_total: 0, realestate_total: 0, debt: 0, peak_experience_age: 65 };
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

// 計算未來 12 個月內尚未支付的重大體驗支出總額（取 bucket_list 規劃中、未付、有 date）
function calcUpcomingExpenses() {
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  return (S.data.bucket_list || []).reduce((sum, r) => {
    const b = _bucketRow(r);
    if (b.status !== '規劃中' || b.paid || !b.date) return sum;
    const [yStr, mStr] = b.date.split('/');
    const year = parseInt(yStr) || 0;
    const month = parseInt(mStr) || 1;
    const monthsDiff = (year - nowYear) * 12 + (month - nowMonth);
    if (monthsDiff >= 0 && monthsDiff <= 12) sum += b.amount * 10000;
    return sum;
  }, 0);
}

// 逐月現金流模擬：從 startYM 起每月加預計收入、扣月支出預算、扣當月重大體驗。
// 餘額 < 0 停止；maxMonths 內未耗盡視為 ∞ (isInfinite=true)。
function simulateMonthly({
  startBalance,
  maxMonths = 600,
  monthlyBudget,
  startYM = null,
  includeIncome = true,
  includeExperience = true,
} = {}) {
  if (startYM === null) {
    const now = new Date(Date.now() + 8 * 3600 * 1000);
    startYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  const incomeByYM = new Map();
  if (includeIncome) {
    (S.data.income_records || []).forEach(r => {
      if (r[5] !== '0') return; // 只計預計，已入帳已反映在現金中
      const ym = String(r[4] || '').slice(0, 7);
      if (ym.length !== 7) return;
      incomeByYM.set(ym, (incomeByYM.get(ym) || 0) + (parseFloat(r[3]) || 0));
    });
  }

  const expByYM = new Map();
  if (includeExperience) {
    (S.data.bucket_list || []).forEach(r => {
      const b = _bucketRow(r);
      if (b.status !== '規劃中' || b.paid || !b.date) return;
      const [yStr, mStr] = b.date.split('/');
      const y = parseInt(yStr) || 0;
      const m = parseInt(mStr) || 0;
      if (!y || !m) return;
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      expByYM.set(ym, (expByYM.get(ym) || 0) + b.amount * 10000);
    });
  }

  const balances = [];
  let balance = startBalance;
  for (let i = 0; i < maxMonths; i++) {
    const ym = addMonths(startYM + '-01', i).slice(0, 7);
    const netChange = (incomeByYM.get(ym) || 0) - monthlyBudget - (expByYM.get(ym) || 0);
    const prevBalance = balance;
    balance += netChange;
    if (balance < 0) {
      // 線性插值：前一月末餘額佔本月淨消耗的比例 = 實際撐過本月的分數
      const fraction = netChange < 0 ? prevBalance / (-netChange) : 0;
      return { months: i, monthsFloat: i + fraction, balances, isInfinite: false, finalBalance: balance };
    }
    balances.push(balance);
  }
  return { months: maxMonths, monthsFloat: maxMonths, balances, isInfinite: true, finalBalance: balance };
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
  const upcoming = calcUpcomingExpenses();
  const availableAdj = available - upcoming;
  setKPI('kv-liquid', fmt(liquid), 'ks-liquid',
    budget > 0
      ? (upcoming > 0 ? `可用：${fmtWan(availableAdj)}（含規劃支出）` : `可用：${fmtWan(available)}`)
      : '總資產 − 房地產'
  );

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
      const prevTW  = parseFloat(prevSnapIG[2]) || 0;
      const prevUS  = parseFloat(prevSnapIG[3]) || 0;
      const prevCry = parseFloat(prevSnapIG[4]) || 0;
      const prevInvest = prevTW + prevUS + prevCry;
      // Guard：前日快照投資合計為 0 但現有持倉非空 → 快照可能為無效記錄
      const hasHoldings = S.data.tw.length || S.data.us.length || S.data.crypto.length;
      if (prevInvest === 0 && hasHoldings) {
        igEl.textContent = '—'; igEl.className = 'kpi-value';
        if (igSub) igSub.textContent = `${prevSnapIG[0]} 快照異常，資料不可靠`;
      } else {
        const igDiff = curInvest - prevInvest;
        if (Math.abs(igDiff) < 100) {
          igEl.textContent = '持平'; igEl.className = 'kpi-value neutral';
          if (igCard) igCard.className = 'kpi-card';
        } else {
          igEl.textContent = (igDiff > 0 ? '+' : '') + fmt(igDiff);
          igEl.className = `kpi-value ${igDiff > 0 ? 'pos' : 'neg'}`;
          if (igCard) igCard.className = `kpi-card ${igDiff > 0 ? 'kpi-gain' : 'kpi-loss'}`;
        }
        if (igSub) igSub.textContent = `對比 ${prevSnapIG[0]} 快照`;
      }
    } else {
      igEl.textContent = '—'; igEl.className = 'kpi-value';
      if (igSub) igSub.textContent = '尚無前日快照';
    }
  }

  // 財務存活月數（逐月現金流模擬：起始流動現金 + USDT，每月加預計收入、扣月支出預算、扣當月重大體驗）
  const svEl = $('kv-survival');
  const svSub = $('ks-survival');
  if (svEl) {
    if (budget > 0) {
      const usdtEntry = S.data.crypto.find(r => r[0]?.toUpperCase() === 'USDT');
      const usdtTWD = usdtEntry ? (parseFloat(usdtEntry[1]) || 0) * S.prices.usdtwd : 0;
      const sim = simulateMonthly({
        startBalance: cashT + usdtTWD,
        monthlyBudget: budget,
      });
      const mf = sim.monthsFloat;
      svEl.textContent = sim.isInfinite ? '∞ 個月' : mf.toFixed(1) + ' 個月';
      svEl.className = 'kpi-value' + (sim.isInfinite || mf >= 6 ? '' : mf >= 3 ? ' neutral' : ' neg');
      if (svSub) svSub.textContent = '含未來預計收入模擬';
    } else {
      svEl.textContent = '—'; svEl.className = 'kpi-value';
      if (svSub) svSub.textContent = '含未來預計收入模擬';
    }
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
  renderCash(); renderTW(); renderUS(); renderCrypto(); renderOther(); renderRewards(); renderBudget(); renderExperiencePlan(); renderIncome();
  renderHoldingCards();
  initAccordion();
}

// ── 管理頁頂部 4 張類別卡 ──
function renderHoldingCards() {
  const rate = S.prices.usdtwd || 0;
  const setHC = (cat, count, total, change, syms, unit) => {
    const cEl = $('hc-count-' + cat);
    const aEl = $('hc-amount-' + cat);
    const dEl = $('hc-change-' + cat);
    const sEl = $('hc-symbols-' + cat);
    if (cEl) cEl.textContent = count + ' ' + unit;
    if (aEl) aEl.textContent = total > 0 ? fmt(total) : '—';
    if (dEl) {
      if (!change || change.pct == null) {
        dEl.textContent = ''; dEl.className = 'hc-change';
      } else {
        const pSign = change.pct >= 0 ? '+' : '';
        const dSign = change.delta >= 0 ? '+' : '';
        const win = cat === 'crypto' ? '24h' : '今日';
        const deltaStr = (change.delta >= 0 ? dSign : '') + fmtWan(change.delta);
        dEl.textContent = `${pSign}${change.pct.toFixed(2)}% · ${deltaStr} · ${win}`;
        dEl.className = 'hc-change ' + (change.pct >= 0 ? 'pos' : 'neg');
      }
    }
    if (sEl) sEl.textContent = syms || '—';
  };
  const aggChange = (rows, getToday, getPct) => {
    let today = 0, yest = 0;
    rows.forEach(r => {
      const t = getToday(r); if (!t) return;
      const pct = getPct(r);
      today += t;
      yest += pct != null ? t / (1 + pct/100) : t;
    });
    if (yest <= 0) return null;
    return { pct: (today - yest) / yest * 100, delta: today - yest };
  };

  // Crypto — 排除 USDT（顯示在流動現金）
  const cryRowsAll = S.data.crypto || [];
  const cryRows = cryRowsAll.filter(r => r[0]?.toUpperCase() !== 'USDT');
  const cryTot = cryRows.reduce((s, r) => s + (parseFloat(r[1])||0) * (S.prices.crypto[r[0]?.toUpperCase()]||0) * rate, 0);
  const cryChg = aggChange(cryRows,
    r => (parseFloat(r[1])||0) * (S.prices.crypto[r[0]?.toUpperCase()]||0) * rate,
    r => symDailyChangePct('crypto', r[0]?.toUpperCase(), S.prices.crypto[r[0]?.toUpperCase()]));
  const crySyms = cryRows.slice().sort((a,b) =>
    (parseFloat(b[1])||0)*(S.prices.crypto[b[0]?.toUpperCase()]||0) -
    (parseFloat(a[1])||0)*(S.prices.crypto[a[0]?.toUpperCase()]||0))
    .slice(0,5).map(r => r[0]?.toUpperCase()).filter(Boolean).join(' · ');
  setHC('crypto', cryRows.length, cryTot, cryChg, crySyms, 'holdings');

  // US
  const usRows = S.data.us || [];
  const usTot = usRows.reduce((s, r) => s + (parseFloat(r[1])||0) * (S.prices.us[r[0]]||0) * rate, 0);
  const usChg = aggChange(usRows,
    r => (parseFloat(r[1])||0) * (S.prices.us[r[0]]||0) * rate,
    r => symDailyChangePct('us', r[0], S.prices.us[r[0]]));
  const usSyms = usRows.slice().sort((a,b) =>
    (parseFloat(b[1])||0)*(S.prices.us[b[0]]||0) - (parseFloat(a[1])||0)*(S.prices.us[a[0]]||0))
    .slice(0,5).map(r => r[0]).filter(Boolean).join(' · ');
  setHC('us', usRows.length, usTot, usChg, usSyms, 'holdings');

  // TW
  const twRows = S.data.tw || [];
  const twTot = twRows.reduce((s, r) => s + (parseFloat(r[1])||0) * (S.prices.tw[r[0]]||0), 0);
  const twChg = aggChange(twRows,
    r => (parseFloat(r[1])||0) * (S.prices.tw[r[0]]||0),
    r => symDailyChangePct('tw', r[0], S.prices.tw[r[0]]));
  const twSyms = twRows.slice().sort((a,b) =>
    (parseFloat(b[1])||0)*(S.prices.tw[b[0]]||0) - (parseFloat(a[1])||0)*(S.prices.tw[a[0]]||0))
    .slice(0,5).map(r => r[0]).filter(Boolean).join(' · ');
  setHC('tw', twRows.length, twTot, twChg, twSyms, 'holdings');

  // Cash — 含 USDT TWD 折算（與 renderCash 顯示總計一致）
  const cashRows = S.data.cash || [];
  const usdtEntry = (S.data.crypto || []).find(r => r[0]?.toUpperCase() === 'USDT');
  const usdtTWD = usdtEntry ? (parseFloat(usdtEntry[1]) || 0) * rate : 0;
  const cashTot = cashRows.reduce((s, r) => s + cashToTWD(r), 0) + usdtTWD;
  const cashCount = cashRows.length + (usdtTWD > 0 ? 1 : 0);
  const currencies = [...new Set([
    ...cashRows.map(r => (r[2]||'').toUpperCase()).filter(Boolean),
    ...(usdtTWD > 0 ? ['USDT'] : [])
  ])].slice(0, 5).join(' · ');
  setHC('cash', cashCount, cashTot, null, currencies, 'accounts');

  // 可用現金 = 流動現金總額（含 USDT）− 月生活支出預算
  const availEl = $('hc-avail-cash');
  if (availEl) {
    try {
      const budget = calcBudgetTotal();
      availEl.textContent = budget > 0 ? `可用：${fmtWan(cashTot - budget)}` : '';
    } catch (e) { availEl.textContent = ''; }
  }
}

// 點擊持有卡片：展開/收合內嵌明細
function toggleHolding(cat) {
  const block = $('hb-' + cat);
  if (!block) return;
  block.classList.toggle('expanded');
}

// 管理頁第二排：其他資產+負債（合併卡）/ 質押收益
function renderExtrasCards() {
  const rate = S.prices.usdtwd || 0;
  const ins  = (S.data.settings.insurance_total  || 0) * rate;
  const re   = (S.data.settings.realestate_total || 0);
  const debt = (S.data.settings.debt             || 0);

  // 合併卡：左 = 其他資產總額；右 = 負債、淨值
  const otherAssetsTot = ins + re;
  const net = otherAssetsTot - debt;
  let itemCount = 0;
  if (ins > 0) itemCount++;
  if (re > 0) itemCount++;
  if (debt > 0) itemCount++;
  const aAEl = $('hc-amount-other-assets');
  if (aAEl) aAEl.textContent = otherAssetsTot > 0 ? fmt(otherAssetsTot) : '—';
  const cAEl = $('hc-count-other-assets');
  if (cAEl) cAEl.textContent = itemCount + ' items';
  const debtEl = $('hc-side-debt');
  if (debtEl) debtEl.textContent = debt > 0 ? fmt(debt) : '—';
  const netEl = $('hc-side-net');
  if (netEl) netEl.textContent = otherAssetsTot + debt > 0 ? fmt(net) : '—';

  // 質押 / 活存收益（歷史總計）
  try {
    const allRw = S.data.rewards || [];
    const totalTWD = allRw.reduce((s, r) => s + rewardTWD(r), 0);
    const aREl = $('hc-amount-rewards');
    if (aREl) aREl.textContent = totalTWD > 0 ? fmt(totalTWD) : '—';
    const sREl = $('hc-symbols-rewards');
    if (sREl) {
      const syms = [...new Set(allRw.map(r => (r[1] || '').toUpperCase()).filter(Boolean))].slice(0, 8).join(' · ');
      sREl.textContent = syms || '—';
    }
  } catch (e) {
    console.error('[renderExtrasCards] rewards 錯誤', e);
    const aREl = $('hc-amount-rewards'); if (aREl) aREl.textContent = '—';
    const sREl = $('hc-symbols-rewards'); if (sREl) sREl.textContent = '—';
  }
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

  const renderItemCard = c => `
    <div class="other-item-card" onclick="openOtherItemDetail('${c.key}')" role="button" tabindex="0">
      <div class="other-item-icon">${c.icon}</div>
      <div class="other-item-info">
        <div class="other-item-label">${c.label}</div>
        <div class="other-item-sub">${c.sub}</div>
      </div>
      <div class="other-item-value${c.isDebt ? ' neg' : ''}">${c.valueTWD > 0 ? fmt(c.valueTWD) : '—'}</div>
    </div>
  `;
  // 舊容器（保留相容性）
  const elAll = $('other-items');
  if (elAll) elAll.innerHTML = items.map(renderItemCard).join('');
  // 卡片版：分拆成「其他資產」與「負債」
  const elAssets = $('other-assets-items');
  if (elAssets) elAssets.innerHTML = items.filter(c => !c.isDebt).map(renderItemCard).join('');
  const elLiab = $('liab-items');
  if (elLiab) elLiab.innerHTML = items.filter(c => c.isDebt).map(renderItemCard).join('');

  updateOtherTotal();
  renderExtrasCards();
}

// 「其他資產 & 負債」三個固定項目的元資料
const OTHER_META = {
  insurance_total:  { label: '儲蓄險', currency: 'USD', icon: '🛡️', sub: '保單現值',         isDebt: false },
  realestate_total: { label: '房地產', currency: 'TWD', icon: '🏠', sub: '不動產市值',       isDebt: false },
  debt:             { label: '負債',   currency: 'TWD', icon: '📉', sub: '貸款等負債總額',  isDebt: true  },
};

// 入口：點擊「其他資產」卡片 → 開啟通用 panel（支援增減/設定/變動紀錄）
function openOtherItemDetail(key) {
  openAssetDetail('other', key);
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
  // cash/tw/us/crypto 改由 holding-card 控制展開，跳過
  ['other'].forEach(id => {
    const card = document.getElementById('section-' + id);
    if (!card) return;
    const body = card.querySelector('.section-body');
    if (saved[id] === true) {
      card.classList.remove('collapsed');
      body.style.maxHeight = '';
    } else {
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
        <div class="asset-card-info">
          <div class="asset-card-sym">USDT</div>
          <div class="asset-card-sub">USDT ${usdtQty.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <div class="asset-card-right">
          <div class="asset-card-twd">${fmt(usdtTWD)}</div>
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
      <div class="asset-card-info">
        <div class="asset-card-sym">${esc(r[0])}</div>
        <div class="asset-card-sub">${esc(ccy)} ${fmtCashAmt(amt, ccy)}</div>
      </div>
      <div class="asset-card-right">
        <div class="asset-card-twd">${twdStr}</div>
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

// 讀取最近一筆「今日之前」的 per-symbol 價格快照（原幣別）
// 回傳 {tw:{}, us:{}, crypto:{}} 或 null
let _cachedYestPrices = null, _cachedYestPricesAt = 0;
function getYesterdayPriceSnap() {
  // 同一次 render pass 內多次呼叫不重複 parse（便宜的 cache，資料變動時 invalidate）
  if (_cachedYestPrices && Date.now() - _cachedYestPricesAt < 1000) return _cachedYestPrices;
  const n = new Date();
  const todayStr = `${n.getFullYear()}/${String(n.getMonth()+1).padStart(2,'0')}/${String(n.getDate()).padStart(2,'0')}`;
  const prev = [...S.data.daily_snapshots].reverse().find(s => s[0] < todayStr && s[9]);
  if (!prev) { _cachedYestPrices = null; _cachedYestPricesAt = Date.now(); return null; }
  try { _cachedYestPrices = JSON.parse(prev[9]); }
  catch { _cachedYestPrices = null; }
  _cachedYestPricesAt = Date.now();
  return _cachedYestPrices;
}

// 計算單一 symbol 相對昨日快照的漲跌 %（curPrice 為當下即時價，原幣別）
function symDailyChangePct(type, sym, curPrice) {
  if (curPrice == null || !sym) return null;
  const snap = getYesterdayPriceSnap();
  if (!snap) return null;
  const key = type === 'crypto' ? sym.toUpperCase() : sym;
  const prev = snap[type]?.[key];
  if (!prev || prev <= 0) return null;
  return (curPrice - prev) / prev * 100;
}

// 渲染漲跌幅 cell HTML
function renderChangePctCell(pct) {
  if (pct === null || pct === undefined) return '<span class="sym-change none">-</span>';
  if (Math.abs(pct) < 0.005) return '<span class="sym-change zero">0.00%</span>';
  const cls = pct > 0 ? 'pos' : 'neg';
  const sign = pct > 0 ? '+' : '';
  return `<span class="sym-change ${cls}">${sign}${pct.toFixed(2)}%</span>`;
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
    $('tb-tw').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted)">尚無持股</td></tr>';
    $('tw-cards').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:0.88rem">尚無持股</div>';
  } else {
    $('tb-tw').innerHTML = sorted.map(({r, i}) => {
      const p = S.prices.tw[r[0]], v = p ? (parseFloat(r[1]) || 0) * p : null;
      const err = S.prices.errs[`tw_${r[0]}`];
      const priceCell = err
        ? '<span style="color:var(--red);font-size:0.8rem">-</span>'
        : (p !== undefined ? p.toLocaleString('zh-TW', {minimumFractionDigits:2, maximumFractionDigits:2}) : skelSpan());
      const chgCell = err ? '<span class="sym-change none">-</span>' : renderChangePctCell(symDailyChangePct('tw', r[0], p));
      return `<tr class="clickable-row" onclick="openAssetDetail('tw',${i})">
        <td data-label="代號"><span class="sym-tag">${esc(r[0])}</span></td>
        <td data-label="股數">${(parseFloat(r[1]) || 0).toLocaleString()}</td>
        <td data-label="股價 (TWD)" class="amt">${priceCell}</td>
        <td data-label="日漲跌" class="amt">${chgCell}</td>
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
      const chgStr = err ? '' : renderChangePctCell(symDailyChangePct('tw', r[0], p));
      const subStr = err
        ? `持有 ${qty.toLocaleString()} 股`
        : `持有 ${qty.toLocaleString()} 股 · ${p !== undefined ? p.toLocaleString('zh-TW', {minimumFractionDigits:2,maximumFractionDigits:2}) + ' TWD' : '—'}`;
      return `<div class="asset-card${err ? ' err' : ''}" onclick="openAssetDetail('tw',${i})" role="button" tabindex="0">
        <div class="asset-card-pct">${pctStr}</div>
        <div class="asset-card-info">
          <div class="asset-card-sym">${esc(sym)}</div>
          <div class="asset-card-sub">${subStr}</div>
        </div>
        <div class="asset-card-right">
          <div class="asset-card-twd">${twdStr}</div>
          <div class="asset-card-change">${chgStr}</div>
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
    $('tb-us').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted)">尚無持股</td></tr>';
    $('us-cards').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:0.88rem">尚無持股</div>';
  } else {
    $('tb-us').innerHTML = sorted.map(({r, i}) => {
      const p = S.prices.us[r[0]], v = p ? (parseFloat(r[1]) || 0) * p * rate : null;
      const err = S.prices.errs[`us_${r[0]}`];
      const priceCell = err
        ? '<span style="color:var(--red);font-size:0.8rem">-</span>'
        : (p !== undefined ? fmtUSD(p) : skelSpan());
      const chgCell = err ? '<span class="sym-change none">-</span>' : renderChangePctCell(symDailyChangePct('us', r[0], p));
      return `<tr class="clickable-row" onclick="openAssetDetail('us',${i})">
        <td data-label="代號"><span class="sym-tag">${esc(r[0])}</span></td>
        <td data-label="股數">${(parseFloat(r[1]) || 0).toLocaleString(undefined, {maximumFractionDigits:4})}</td>
        <td data-label="股價 (USD)" class="amt">${priceCell}</td>
        <td data-label="日漲跌" class="amt">${chgCell}</td>
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
      const chgStr = err ? '' : renderChangePctCell(symDailyChangePct('us', r[0], p));
      const subStr = err
        ? `持有 ${qty.toLocaleString(undefined,{maximumFractionDigits:4})} 股`
        : `持有 ${qty.toLocaleString(undefined,{maximumFractionDigits:4})} 股 · ${p !== undefined ? fmtUSD(p) + ' USD' : '—'}`;
      return `<div class="asset-card${err ? ' err' : ''}" onclick="openAssetDetail('us',${i})" role="button" tabindex="0">
        <div class="asset-card-pct">${pctStr}</div>
        <div class="asset-card-info">
          <div class="asset-card-sym">${esc(sym)}</div>
          <div class="asset-card-sub">${subStr}</div>
        </div>
        <div class="asset-card-right">
          <div class="asset-card-twd">${twdStr}</div>
          <div class="asset-card-change">${chgStr}</div>
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
    const empty = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted)">尚無持幣</td></tr>';
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
      const chgCell = err ? '<span class="sym-change none">-</span>' : renderChangePctCell(symDailyChangePct('crypto', sym, p));
      return `<tr class="clickable-row" onclick="openAssetDetail('crypto',${i})">
        <td data-label="代號"><span class="sym-tag">${esc(sym)}</span></td>
        <td data-label="數量">${qty.toFixed(3)}</td>
        <td data-label="幣價 (USD)" class="amt">${priceCell}</td>
        <td data-label="24h漲跌" class="amt">${chgCell}</td>
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
      const chgStr = err ? '' : renderChangePctCell(symDailyChangePct('crypto', sym, p));
      const subStr = err
        ? `持有 ${qty.toFixed(3)}`
        : `持有 ${qty.toFixed(3)} · ${p !== undefined ? fmtFloor3(p) : '—'}`;
      return `<div class="asset-card${err ? ' err' : ''}" onclick="openAssetDetail('crypto',${i})" role="button" tabindex="0">
        <div class="asset-card-pct">${pctStr}</div>
        <div class="asset-card-info">
          <div class="asset-card-sym">${esc(sym)}</div>
          <div class="asset-card-sub">${subStr}</div>
        </div>
        <div class="asset-card-right">
          <div class="asset-card-twd">${twdStr}</div>
          <div class="asset-card-change">${chgStr}</div>
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
              <button class="btn-icon edit" onclick="editReward(${i})" title="編輯">✏</button>
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
  renderExtrasCards();
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
          <option value="系統換算" ${typeVal==='系統換算'?'selected':''}>系統換算</option>
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

// 自動新增／累加系統換算利息收益記錄
// 累加模式：同月同幣已有「系統換算」→ 把新 delta 疊加到 qty 上
// 避免多次 sync（UI 編輯、CSV 匯入）互相覆蓋彼此紀錄
async function autoAddReward(sym, interestQty) {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}`;
  const price = S.prices.crypto[sym] || 0;

  const dupIdx = S.data.rewards.findIndex(r => r[0] === month && r[1] === sym && r[5] === '系統換算');
  let finalQty;
  if (dupIdx !== -1) {
    const r = S.data.rewards[dupIdx];
    finalQty = (parseFloat(r[2]) || 0) + interestQty;
    const valueTWD = Math.round(finalQty * price * S.prices.usdtwd);
    S.data.rewards[dupIdx] = [r[0], r[1], finalQty, price, valueTWD, '系統換算', r[6] || ''];
  } else {
    finalQty = interestQty;
    const valueTWD = Math.round(interestQty * price * S.prices.usdtwd);
    S.data.rewards.push([month, sym, interestQty, price, valueTWD, '系統換算']);
  }
  S.data.rewards.sort((a, b) => b[0].localeCompare(a[0]));
  await saveSheet('crypto_rewards', S.data.rewards);
  renderRewards();
  renderRewardsSummary();
  const sign = interestQty >= 0 ? '+' : '';
  showToast(`${sym} 系統換算 ${sign}${interestQty.toFixed(4)}（本月累計 ${finalQty.toFixed(4)}）`, 'ok');
}

// ══════════════════════════════════════════════════════════════
// CoinMarketCap Portfolio CSV 匯入
// ══════════════════════════════════════════════════════════════
// CMC 全名 → 交易所 symbol 對照（常見幣），未收錄者 symbol 回退為 name
const CMC_NAME_MAP = {
  'Bitcoin':'BTC', 'Ethereum':'ETH', 'Tether USDt':'USDT', 'Tether':'USDT',
  'USD Coin':'USDC', 'BNB':'BNB', 'Cronos':'CRO', 'Solana':'SOL',
  'Cardano':'ADA', 'Sui':'SUI', 'Bitget Token':'BGB', 'Avalanche':'AVAX',
  'Chainlink':'LINK', 'Bittensor':'TAO', 'NEAR Protocol':'NEAR',
  'Immutable':'IMX', 'Aptos':'APT',
  'Artificial Superintelligence Alliance':'FET',
  'XRP':'XRP', 'Dogecoin':'DOGE', 'Polkadot':'DOT', 'Polygon':'MATIC',
  'Litecoin':'LTC', 'Cosmos':'ATOM', 'Uniswap':'UNI', 'Shiba Inu':'SHIB',
  'Pepe':'PEPE', 'TRON':'TRX', 'Tron':'TRX', 'Stellar':'XLM',
  'Internet Computer':'ICP', 'Hedera':'HBAR', 'Arbitrum':'ARB',
  'Optimism':'OP', 'Ondo':'ONDO', 'Render':'RNDR', 'Jupiter':'JUP',
  'Ethena':'ENA', 'PancakeSwap':'CAKE', 'Maker':'MKR', 'Filecoin':'FIL',
  'Worldcoin':'WLD', 'The Graph':'GRT', 'Fantom':'FTM', 'Injective':'INJ',
  'Sei':'SEI', 'Celestia':'TIA', 'Pyth Network':'PYTH', 'Kaspa':'KAS',
  'Algorand':'ALGO', 'Bitcoin Cash':'BCH', 'Mantle':'MNT', 'Lido DAO':'LDO',
  'Wrapped Bitcoin':'WBTC', 'Jito':'JTO', 'Raydium':'RAY',
  'VeChain':'VET', 'Stacks':'STX',
};

// 簡易 CSV 行解析（雙引號包裹 + "" 轉義）
function _parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

// 解析 CMC portfolio CSV → [{name, symbol, amount, mapped}]
function _parseCmcCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  const headerIdx = lines.findIndex(l => /"Name"/.test(l) && /"Amount"/.test(l));
  if (headerIdx === -1) throw new Error('找不到 Name / Amount 欄位');
  const headers = _parseCsvLine(lines[headerIdx]);
  const nameCol = headers.indexOf('Name');
  const amountCol = headers.indexOf('Amount');
  if (nameCol < 0 || amountCol < 0) throw new Error('欄位位置異常');
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = _parseCsvLine(lines[i]);
    const name = (cells[nameCol] || '').trim();
    const amt = parseFloat((cells[amountCol] || '').replace(/,/g, '').trim());
    if (name && !isNaN(amt) && amt > 0) {
      const mapped = !!CMC_NAME_MAP[name];
      rows.push({ name, symbol: CMC_NAME_MAP[name] || name.toUpperCase(), amount: amt, mapped });
    }
  }
  return rows;
}

function openCMCImport() {
  $('modal-title').textContent = '匯入 CoinMarketCap Portfolio';
  $('modal-body').innerHTML = `
    <div class="modal-form">
      <div class="field">
        <label>CSV 檔案（CMC portfolio → Export to CSV）</label>
        <input id="cmc-file" type="file" accept=".csv,text/csv">
      </div>
      <div class="field">
        <label>或直接貼上 CSV 內容</label>
        <textarea id="cmc-text" rows="3" style="resize:vertical;font-family:var(--ds-font-mono,monospace);font-size:11px" placeholder='"Name","Price (USD)",...'></textarea>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:normal">
          <input type="checkbox" id="cmc-auto-reward" checked>
          <span>持倉增加時自動寫入「系統換算」質押收益</span>
        </label>
      </div>
      <div id="cmc-preview" style="max-height:60vh;overflow:auto"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-ok" id="cmc-parse-btn">解析 CSV</button>
      <button class="btn-ok" id="cmc-apply-btn" style="display:none">套用變更</button>
    </div>`;
  $('modal').classList.add('open');
  // 把 modal 放寬讓預覽表格一次看完
  const box = $('modal').querySelector('.modal-box');
  if (box) { box.style.maxWidth = 'min(820px, 96vw)'; box.style.width = '96%'; }

  $('cmc-file').onchange = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { $('cmc-text').value = r.result; };
    r.readAsText(f);
  };

  $('cmc-parse-btn').onclick = () => {
    const txt = $('cmc-text').value;
    if (!txt.trim()) { showToast('請選檔或貼上 CSV', 'err'); return; }
    let rows;
    try { rows = _parseCmcCsv(txt); }
    catch (e) { showToast('解析失敗：' + e.message, 'err'); return; }
    if (!rows.length) { showToast('CSV 沒有可匯入的持倉', 'err'); return; }
    _renderCmcPreview(rows);
  };
}

function _renderCmcPreview(rows) {
  const current = [...S.data.crypto];
  const cm = new Map(current.map(r => [(r[0]||'').toUpperCase(), parseFloat(r[1]) || 0]));
  const ins = new Set(rows.map(r => r.symbol.toUpperCase()));
  const diff = [];
  for (const row of rows) {
    const S_ = row.symbol.toUpperCase();
    if (!cm.has(S_)) diff.push({ symbol:S_, name:row.name, action:'NEW', prev:null, next:row.amount, mapped:row.mapped });
    else {
      const prev = cm.get(S_);
      const rel = Math.abs(prev - row.amount) / Math.max(prev, row.amount, 1);
      diff.push({ symbol:S_, name:row.name, action: rel > 0.0001 ? 'UPDATE' : 'SAME', prev, next:row.amount, mapped:row.mapped });
    }
  }
  for (const r of current) {
    const S_ = (r[0]||'').toUpperCase();
    if (!ins.has(S_)) diff.push({ symbol:S_, name:'', action:'NOT_IN_CSV', prev:parseFloat(r[1])||0, next:null, mapped:true });
  }
  const actMap = {
    NEW:        '<span style="color:var(--success)">+ 新增</span>',
    UPDATE:     '<span style="color:var(--accent)">~ 更新</span>',
    SAME:       '<span style="color:var(--text-muted)">= 相同</span>',
    NOT_IN_CSV: '<span style="color:var(--text-muted)">? CSV 無</span>',
  };
  const tr = d => `
    <tr${d.mapped === false ? ' style="background:rgba(239,68,68,0.08)"' : ''}>
      <td style="white-space:nowrap"><b>${esc(d.symbol)}</b>${d.mapped === false ? ' <span style="color:var(--danger)">?</span>' : ''}</td>
      <td style="color:var(--text-secondary);white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</td>
      <td style="white-space:nowrap">${actMap[d.action]}</td>
      <td style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${d.prev === null ? '—' : d.prev.toLocaleString(undefined,{maximumFractionDigits:4})}</td>
      <td style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${d.next === null ? '—' : d.next.toLocaleString(undefined,{maximumFractionDigits:4})}</td>
    </tr>`;
  const unmapped = diff.filter(d => d.mapped === false);
  const changed = diff.filter(d => d.action === 'NEW' || d.action === 'UPDATE').length;
  $('cmc-preview').innerHTML = `
    <div style="margin:10px 0 6px;font-weight:600">變更預覽：${changed} 筆實質變更 / 共 ${diff.length} 項</div>
    ${unmapped.length ? `<div style="color:var(--danger);font-size:11px;margin-bottom:6px">⚠ ${unmapped.length} 個未知幣種（紅底）symbol 直接使用 CSV name 大寫，如有誤請關閉重選</div>` : ''}
    <div style="overflow-x:auto">
      <table class="data-table" style="font-size:12px;width:100%;min-width:560px">
        <thead><tr>
          <th style="width:70px">Symbol</th>
          <th>Name</th>
          <th style="width:80px">動作</th>
          <th style="width:120px;text-align:right">舊數量</th>
          <th style="width:120px;text-align:right">新數量</th>
        </tr></thead>
        <tbody>${diff.map(tr).join('')}</tbody>
      </table>
    </div>`;
  $('cmc-parse-btn').style.display = 'none';
  $('cmc-apply-btn').style.display = '';
  $('cmc-apply-btn').onclick = () => _applyCmcDiff(diff, $('cmc-auto-reward').checked);
}

async function _applyCmcDiff(diff, autoReward) {
  const btn = $('cmc-apply-btn'); btnLoading(btn);
  try {
    const map = new Map(S.data.crypto.map(r => [(r[0]||'').toUpperCase(), [(r[0]||'').toUpperCase(), r[1]]]));
    for (const d of diff) {
      if (d.action === 'NEW' || d.action === 'UPDATE' || d.action === 'SAME') {
        map.set(d.symbol, [d.symbol, d.next]);
      }
    }
    S.data.crypto = [...map.values()];
    await saveSheet('holdings_crypto', S.data.crypto);
    for (const d of diff) {
      if (d.action !== 'NEW' && d.action !== 'UPDATE') continue;
      const prev = d.prev ?? 0;
      await appendHistory('crypto', d.symbol, prev, d.next);
      const delta = d.next - prev;
      if (autoReward && delta > 0) await autoAddReward(d.symbol, delta);
    }
    renderKPIs(); renderCharts(); renderManagement();
    btn.classList.remove('btn-loading');
    btn.textContent = '✓ 完成';
    const changed = diff.filter(d => d.action === 'NEW' || d.action === 'UPDATE').length;
    showToast(`已匯入 ${changed} 筆變更`, 'ok');
    setTimeout(closeModal, 700);
  } catch (e) {
    btnReset(btn);
    showToast('匯入失敗：' + e.message, 'err');
  }
}

// ══════════════════════════════════════════════════════════════
// RENDER — EXPENSE BUDGET
// ══════════════════════════════════════════════════════════════
// 數位服務與通訊 自動歸類的名稱關鍵字（不分大小寫）
const BUDGET_DIGITAL_RE = /gemini|claude|chatgpt|openai|youtube|netflix|spotify|apple\s*music|icloud|disney|prime|premium|網路|電話|中華電信|遠傳|台哥大|台灣大哥大|hbo|notion|dropbox|office\s*365|microsoft\s*365/i;

function renderBudget() {
  const items = S.data.expense_budget;
  const cntEl = $('cnt-budget');
  const totEl = $('tot-budget');
  const catsEl = $('budget-cats');
  const ratioEl = $('budget-ratio-bar');
  if (!catsEl) return;

  if (cntEl) cntEl.textContent = items.length;

  // 小計（以類別）
  const fixedTotal = items.filter(r => (r[0] || '') === '固定').reduce((s, r) => s + (parseFloat(r[2]) || 0), 0);
  const varTotal   = items.filter(r => (r[0] || '') === '浮動').reduce((s, r) => s + (parseFloat(r[2]) || 0), 0);
  const grandTotal = fixedTotal + varTotal;
  if (totEl) totEl.textContent = fmt(grandTotal);

  // 固定/浮動 比例條
  if (ratioEl) {
    if (grandTotal > 0) {
      const fixedPct = (fixedTotal / grandTotal) * 100;
      const varPct   = 100 - fixedPct;
      ratioEl.innerHTML = `
        <div class="budget-ratio-track">
          <div class="budget-ratio-fixed" style="width:${fixedPct.toFixed(1)}%"></div>
        </div>
        <div class="budget-ratio-labels">
          <span class="budget-ratio-lbl-fixed">固定 ${fmt(fixedTotal)} · ${fixedPct.toFixed(0)}%</span>
          <span class="budget-ratio-lbl-var">浮動 ${fmt(varTotal)} · ${varPct.toFixed(0)}%</span>
        </div>`;
    } else {
      ratioEl.innerHTML = '';
    }
  }

  if (!items.length) {
    catsEl.innerHTML = '<div class="budget-empty">尚無支出項目</div>';
    return;
  }

  // 兩類固定順序渲染：固定 → 浮動；未分類併入最後
  const groups = { 固定: [], 浮動: [], 未分類: [] };
  items.forEach((r, i) => {
    const cat = r[0] || '未分類';
    (groups[cat] || groups['未分類']).push({ r, i });
  });

  const renderItem = ({ r, i }) => `
    <div class="budget-item">
      <div class="budget-item-name">${esc(r[1] || '—')}</div>
      <div class="budget-item-source">${esc(r[3] || '—')}</div>
      <div class="budget-item-amt">${fmt(parseFloat(r[2]) || 0)}</div>
      <div class="budget-item-actions">
        <button class="btn-icon edit" onclick="editBudgetItem(${i})">✏</button>
        <button class="btn-icon del" onclick="deleteBudgetItem(${i})">✕</button>
      </div>
    </div>`;

  catsEl.innerHTML = Object.entries(groups).filter(([_, list]) => list.length).map(([cat, list]) => {
    const catTotal = list.reduce((s, { r }) => s + (parseFloat(r[2]) || 0), 0);
    list.sort((a, b) => (parseFloat(b.r[2]) || 0) - (parseFloat(a.r[2]) || 0));

    // 拆成一般 / 數位服務
    const digitalList = list.filter(({ r }) => BUDGET_DIGITAL_RE.test(r[1] || ''));
    const normalList  = list.filter(({ r }) => !BUDGET_DIGITAL_RE.test(r[1] || ''));
    const digitalTotal = digitalList.reduce((s, { r }) => s + (parseFloat(r[2]) || 0), 0);

    const bundleId = `budget-digital-${cat}`;
    const digitalBlock = digitalList.length >= 2 ? `
      <div class="budget-bundle collapsed" id="${bundleId}">
        <div class="budget-bundle-header" onclick="toggleBudgetBundle('${bundleId}')">
          <span class="budget-bundle-name">數位服務與通訊 <span class="budget-bundle-count">${digitalList.length}</span></span>
          <span class="budget-bundle-total">${fmt(digitalTotal)}</span>
          <span class="budget-bundle-chevron">▾</span>
        </div>
        <div class="budget-bundle-items">${digitalList.map(renderItem).join('')}</div>
      </div>` : digitalList.map(renderItem).join('');

    return `
      <div class="budget-cat collapsed" id="budget-cat-${cat}">
        <div class="budget-cat-header" onclick="toggleBudgetCat('${cat}')">
          <span class="budget-cat-name">${esc(cat)}支出 <span class="budget-cat-count">${list.length}</span></span>
          <span class="budget-cat-total">${fmt(catTotal)}</span>
          <span class="budget-cat-chevron">▾</span>
        </div>
        <div class="budget-cat-items">${normalList.map(renderItem).join('')}${digitalBlock}</div>
      </div>`;
  }).join('');
}

function toggleBudgetCat(cat) {
  const el = document.getElementById(`budget-cat-${cat}`);
  if (el) el.classList.toggle('collapsed');
}

function toggleBudgetBundle(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('collapsed');
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

// ══════════════════════════════════════════════════════════════
// RENDER — 重大體驗支出規劃（從 bucket_list 讀取、僅顯示 status=規劃中）
// ══════════════════════════════════════════════════════════════
function renderExperiencePlan() {
  const cntEl = $('cnt-exp-plan');
  const totEl = $('tot-exp-plan');
  const listEl = $('exp-plan-list');
  if (!listEl) return;

  const items = (S.data.bucket_list || [])
    .map(r => _bucketRow(r))
    .filter(b => b.status === '規劃中');

  const unpaidTotal = items.filter(b => !b.paid).reduce((s, b) => s + b.amount * 10000, 0);
  if (cntEl) cntEl.textContent = items.length;
  if (totEl) totEl.textContent = items.length ? fmt(unpaidTotal) + ' 未付' : '—';

  if (!items.length) {
    listEl.innerHTML = '<div class="exp-plan-empty">尚無規劃。新增後將同步至 DWZ 模擬器與 Bucket List。</div>';
    return;
  }

  // 排序：有 date 的優先按 date，否則按 age
  const sorted = items.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.age - b.age;
  });

  const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const fmtDate = (b) => {
    if (b.date) {
      const [y, m] = b.date.split('/');
      const mi = parseInt(m) || 1;
      return `${y}年 ${MONTHS[mi - 1] || ''}`;
    }
    return b.age ? `${b.age} 歲` : '—';
  };

  listEl.innerHTML = sorted.map(b => `
    <div class="exp-plan-item${b.paid ? ' paid' : ''}">
      <label class="exp-plan-checkbox" title="${b.paid ? '標記為未支付' : '標記為已支付'}">
        <input type="checkbox" ${b.paid ? 'checked' : ''} onchange="toggleExpPlanPaid('${b.id}')">
        <span class="exp-plan-check-icon"></span>
      </label>
      <div class="exp-plan-main">
        <div class="exp-plan-name">${esc(b.name || '—')}</div>
        <div class="exp-plan-date">${fmtDate(b)}</div>
      </div>
      <div class="exp-plan-amt${b.paid ? ' muted' : ''}">${b.paid ? '<s>' : ''}${fmt(b.amount * 10000)}${b.paid ? '</s>' : ''}</div>
      <div class="exp-plan-actions">
        <button class="btn-icon edit" onclick="editExpPlanItem('${b.id}')">✏</button>
        <button class="btn-icon del" onclick="deleteExpPlanItem('${b.id}')">✕</button>
      </div>
    </div>`).join('');
}

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

  // 週期性 fingerprint：同名 + 同金額出現 ≥ 2 次 → 標「週期」
  const fp = new Map();
  items.forEach(r => {
    const key = `${r[1] || ''}|${r[3] || ''}`;
    fp.set(key, (fp.get(key) || 0) + 1);
  });

  // 排序：status=0 (未入帳) 在上、status=1 (已入帳) 在下；各自按 expected_date ASC（由近到遠）
  const sorted = items.map((r, idx) => ({ r, idx })).sort((a, b) => {
    const sA = a.r[5] === '1' ? 1 : 0;
    const sB = b.r[5] === '1' ? 1 : 0;
    if (sA !== sB) return sA - sB;
    return (a.r[4] || '').localeCompare(b.r[4] || '');
  });

  accordionEl.innerHTML = sorted.map(({ r, idx }) => {
    const settled = r[5] === '1';
    const amt = parseFloat(r[3]) || 0;
    const isCurMonth = (r[4] || '').startsWith(curYMDash);
    const recurring = (fp.get(`${r[1] || ''}|${r[3] || ''}`) || 0) >= 2;
    return `<div class="income-item${settled ? ' income-settled' : ''}${isCurMonth ? ' income-current' : ''}">
      <button class="income-status-btn${settled ? ' settled' : ''}" onclick="toggleIncomeStatus(${idx})" title="${settled ? '點擊取消入帳' : '點擊標記已入帳'}">${settled ? '☑' : '☐'}</button>
      <div class="income-item-info">
        <span class="income-item-name">${esc(r[1] || '—')}</span>
        ${recurring ? '<span class="income-recurring-badge" title="同名同金額重複出現">🔁 週期</span>' : ''}
        ${r[2] ? `<span class="income-cat-badge">${esc(r[2])}</span>` : ''}
        ${r[8] ? `<span class="income-payer">${esc(r[8])}</span>` : ''}
      </div>
      <span class="income-item-date">${esc(r[4] || '—')}</span>
      <span class="income-item-amt">${fmt(amt)}</span>
      <div class="income-item-actions">
        <button class="btn-icon copy" onclick="copyIncomeToNextMonth(${idx})" title="複製到下月">🔁</button>
        <button class="btn-icon edit" onclick="editIncomeItem(${idx})">✏</button>
        <button class="btn-icon del" onclick="deleteIncomeItem(${idx})">✕</button>
      </div>
    </div>`;
  }).join('');
}

function toggleIncomeGroup(ym) {
  const body   = $(`inc-body-${ym}`);
  const toggle = $(`inc-toggle-${ym}`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (toggle) toggle.textContent = open ? '▼' : '▲';
}

function addMonths(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const total = (y * 12 + (m - 1)) + n;
  const targetY = Math.floor(total / 12);
  const targetM = (total % 12) + 1;
  const lastDay = new Date(targetY, targetM, 0).getDate();
  const targetD = Math.min(d, lastDay);
  return `${targetY}-${String(targetM).padStart(2,'0')}-${String(targetD).padStart(2,'0')}`;
}

function addIncomeItem() {
  openModal('新增收入', [
    { id: 'name',     label: '收入名稱',             type: 'text',   ph: '例：四月薪資' },
    { id: 'category', label: '類別（選填）',          type: 'text',   ph: '例：薪資、獎金', opt: true },
    { id: 'payer',    label: '付款人 / 平台（選填）', type: 'text',   ph: '例：A 客戶、Upwork', opt: true },
    { id: 'amount',   label: '金額 (TWD)',            type: 'number', step: '1', min: 0, ph: '0' },
    { id: 'date',     label: '預計入帳日',             type: 'date' },
    { id: 'months',   label: '同時建立未來幾個月（含本月）', type: 'number', step: '1', min: 1, val: '1' },
  ], async vals => {
    const amount = parseFloat(vals.amount) || 0;
    const months = Math.max(1, Math.min(24, parseInt(vals.months, 10) || 1));
    if (!vals.name) { showToast('請填寫收入名稱', 'err'); return false; }
    if (!vals.date) { showToast('請選擇預計入帳日', 'err'); return false; }
    const baseId = Date.now();
    for (let n = 0; n < months; n++) {
      S.data.income_records.push([
        String(baseId + n), vals.name, vals.category || '', String(amount),
        addMonths(vals.date, n), '0', '', '', vals.payer || ''
      ]);
    }
    S.data.income_records.sort((a, b) => (b[4] || '').localeCompare(a[4] || ''));
    await saveSheet('income_records', S.data.income_records);
    renderIncome(); renderKPIs();
    showToast(months > 1 ? `已新增 ${months} 筆收入記錄` : '已新增收入記錄', 'ok');
  });
}

function editIncomeItem(idx) {
  const r = S.data.income_records[idx];
  if (!r) return;
  openModal('編輯收入', [
    { id: 'name',     label: '收入名稱',             type: 'text',   val: r[1] || '' },
    { id: 'category', label: '類別（選填）',          type: 'text',   val: r[2] || '', opt: true },
    { id: 'payer',    label: '付款人 / 平台（選填）', type: 'text',   val: r[8] || '', opt: true },
    { id: 'amount',   label: '金額 (TWD)',            type: 'number', step: '1', min: 0, val: r[3] || '0' },
    { id: 'date',     label: '預計入帳日',             type: 'date',   val: r[4] || '' },
  ], async vals => {
    const amount = parseFloat(vals.amount) || 0;
    S.data.income_records[idx] = [
      r[0], vals.name, vals.category || '', String(amount),
      vals.date, r[5], r[6], r[7], vals.payer || ''
    ];
    S.data.income_records.sort((a, b) => (b[4] || '').localeCompare(a[4] || ''));
    await saveSheet('income_records', S.data.income_records);
    renderIncome(); renderKPIs();
    showToast('已更新收入記錄', 'ok');
  });
}

async function copyIncomeToNextMonth(idx) {
  const r = S.data.income_records[idx];
  if (!r) return;
  const nextDate = addMonths(r[4] || '', 1);
  S.data.income_records.push([
    String(Date.now()), r[1] || '', r[2] || '', r[3] || '0',
    nextDate, '0', '', '', r[8] || ''
  ]);
  S.data.income_records.sort((a, b) => (b[4] || '').localeCompare(a[4] || ''));
  await saveSheet('income_records', S.data.income_records);
  renderIncome(); renderKPIs();
  showToast(`已複製到 ${nextDate}`, 'ok');
}

async function _revertIncomeSettlement(r) {
  const linkedAccount = r[6];
  if (!linkedAccount) return;
  const amt = parseFloat(r[3]) || 0;
  const cashIdx = S.data.cash.findIndex(c => c[0] === linkedAccount);
  if (cashIdx < 0) return;
  const ccy       = (S.data.cash[cashIdx][2] || 'TWD').toUpperCase();
  const amtBefore = parseFloat(S.data.cash[cashIdx][1]) || 0;
  const amtAfter  = amtBefore - amt;
  S.data.cash[cashIdx] = [linkedAccount, amtAfter, ccy];
  await saveSheet('cash_accounts', S.data.cash);
  await appendHistory('cash', linkedAccount, amtBefore, amtAfter, 'TWD');
}

function toggleIncomeStatus(idx) {
  const r = S.data.income_records[idx];
  if (!r) return;

  if (r[5] === '1') {
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
      renderIncome(); renderKPIs();
      showToast('已刪除收入記錄', 'ok');
    });
  }
}

// 管理頁的 add/edit/toggle/delete 全部走 bucket_list（使用統一 modal）
function addExpPlanItem() {
  _openBucketModal({ id: '', age: '', name: '', amount: '', status: '規劃中', category: '其他', date: '', paid: false, notes: '' });
}

function editExpPlanItem(id) {
  const idx = _findBucketIdx(id);
  if (idx < 0) return;
  _openBucketModal(_bucketRow(S.data.bucket_list[idx]));
}

async function toggleExpPlanPaid(id) {
  const idx = _findBucketIdx(id);
  if (idx < 0) return;
  const r = S.data.bucket_list[idx];
  r[7] = r[7] === 'true' ? 'false' : 'true';
  await saveSheet('bucket_list', S.data.bucket_list);
  _refreshBucketViews();
}

function deleteExpPlanItem(id) {
  const idx = _findBucketIdx(id);
  if (idx < 0) return;
  const name = S.data.bucket_list[idx]?.[1] || '';
  openConfirm('確認刪除', `刪除「${name}」？`, async () => {
    S.data.bucket_list.splice(idx, 1);
    await saveSheet('bucket_list', S.data.bucket_list);
    _refreshBucketViews();
    showToast('已刪除', 'ok');
  });
}

function skelSpan() {
  return '<span class="skel" style="display:inline-block;width:55px;height:14px;vertical-align:middle"></span>';
}

// ══════════════════════════════════════════════════════════════
// RENDER — CHARTS
// ══════════════════════════════════════════════════════════════
Chart.defaults.color = 'rgba(255,255,255,0.88)';
Chart.defaults.font.size = 10;

function chartColors() {
  const light = document.documentElement.dataset.theme === 'light';
  return {
    grid:        light ? '#e5e5e5'             : 'rgba(255,255,255,0.1)',
    gridFaint:   light ? '#f0f0f0'             : 'rgba(255,255,255,0.05)',
    tick:        light ? '#666666'             : 'rgba(255,255,255,0.88)',
    legend:      light ? '#333333'             : '#ffffff',
    center_text: light ? '#111111'             : '#ffffff',
    center_sub:  light ? '#666666'             : 'rgba(255,255,255,0.82)',
    nodata:      light ? '#999999'             : 'rgba(255,255,255,0.7)',
    border:      light ? '#ffffff'             : '#1a1a1a',
    line1:       light ? '#111111'             : '#ffffff',
    line2:       light ? '#16a34a'             : '#22c55e',
    barPos:      light ? 'rgba(22,163,74,.65)' : 'rgba(34,197,94,.65)',
    barNeg:      light ? 'rgba(220,38,38,.65)' : 'rgba(239,68,68,.65)',
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
  // ⚠ 關鍵修正：排除今日的快照（若有），避免晨間存下的舊值覆蓋即時值，
  //   造成圖表與「投資收益」KPI 不一致
  const todayStr = getNowTW8().slice(0, 10);
  const recent = snaps.filter(s => s[0] < todayStr).slice(-15);

  function dateStr(d) {
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
  }
  function nextDay(str) {
    const d = new Date(str.replace(/\//g, '-') + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return dateStr(d);
  }

  // 將快照展開，填補跳過的日期（gap 日標記 isGap:true，不參與 delta 計算）
  // net 欄位改為台股+美股+加密貨幣合計（排除現金與其他資產）
  const filled = []; // { date, net, isLive, isGap }
  for (let i = 0; i < recent.length; i++) {
    const net = (parseFloat(recent[i][2]) || 0) + (parseFloat(recent[i][3]) || 0) + (parseFloat(recent[i][4]) || 0);
    if (i > 0) {
      let d = filled[filled.length - 1].date;
      while (nextDay(d) < recent[i][0]) {
        d = nextDay(d);
        // 缺失日期：net=null，不帶入計算以免製造假 0
        filled.push({ date: d, net: null, isLive: false, isGap: true });
      }
    }
    filled.push({ date: recent[i][0], net, isLive: false, isGap: false });
  }

  // ── Step 2：永遠以即時值追加今日點（與 KPI「投資收益」同源 = calcTotals()）──
  const lastFilled = filled[filled.length - 1];
  if (lastFilled) {
    // 補全最後快照到昨日之間的空白（gap 標記，不製造假 delta）
    let d = lastFilled.date;
    while (nextDay(d) < todayStr) {
      d = nextDay(d);
      filled.push({ date: d, net: null, isLive: false, isGap: true });
    }
  }
  // 今日即時點：與 renderKPIs 的 curInvest 同源，確保兩者完全吻合
  const { twT: _twT, usT: _usT, cryT: _cryT } = calcTotals();
  filled.push({ date: todayStr, net: _twT + _usT + _cryT, isLive: true, isGap: false });

  // ── Step 3：取最後 15 個節點計算損益差值 ──
  const win = filled.slice(-15);
  if (win.length < 2) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (nodata) nodata.style.display = 'flex';
    return;
  }
  const labels = [], plData = [], netData = [], isLiveArr = [];
  // 預先找出各點「最近非 gap 前任」（用於跨週末計算 delta）
  const lastValidNet = new Array(win.length).fill(null);
  for (let i = 0; i < win.length; i++) {
    if (!win[i].isGap && win[i].net !== null) lastValidNet[i] = win[i].net;
    else if (i > 0) lastValidNet[i] = lastValidNet[i - 1];
  }
  for (let i = 1; i < win.length; i++) {
    labels.push(win[i].date.slice(5)); // MM/DD
    if (win[i].isGap || win[i].net === null) {
      // gap 日：不繪製
      plData.push(null);
      netData.push(null);
    } else if (win[i-1].isGap || win[i-1].net === null) {
      // 前一天是 gap（如週末）→ 用最近一筆有效 net 當基準，顯示跨假期累計變動
      const prevNet = lastValidNet[i - 1];
      if (prevNet === null) {
        plData.push(null);
        netData.push(null);
      } else {
        plData.push(win[i].net - prevNet);
        netData.push(win[i].net);
      }
    } else {
      plData.push(win[i].net - win[i-1].net);
      netData.push(win[i].net);
    }
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

        // 旗標只標歷史最高/最低（不標即時點、不標 null gap）
        const histPlData = plData.filter((v, i) => !isLiveArr[i] && v !== null);
        const histMaxPl = histPlData.length ? Math.max(...histPlData) : -Infinity;
        const histMinPl = histPlData.length ? Math.min(...histPlData) : Infinity;
        const histMaxIdx = plData.findIndex((v, i) => !isLiveArr[i] && v !== null && v === histMaxPl);
        const histMinIdx = plData.findIndex((v, i) => !isLiveArr[i] && v !== null && v === histMinPl);
        if (histMaxPl > 1000)  drawFlag(histMaxIdx, histMaxPl, '#34C759', '+' + fmtWan(histMaxPl));
        if (histMinPl < -1000) drawFlag(histMinIdx, histMinPl, '#FF3B30', fmtWan(histMinPl));
      } catch (e) { /* 旗標繪製失敗不影響主圖表 */ }
    },
  };

  // 長條顏色：正綠負紅
  const barBg = plData.map(v => v === null ? 'transparent' : v >= 0 ? cc.barPos : cc.barNeg);

  S.charts.dailyTrend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '每日投資損益',
        data: plData,
        backgroundColor: barBg,
        borderWidth: 0,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 0, right: 6, bottom: 0, left: 4 } },
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
          beginAtZero: true,
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
  // Phase 8 Apple 霓虹：流動現金 藍 / 台股 綠 / 美股 紫 / 加密 金 / 儲蓄險 粉 / 房地產 青
  // Phase 7 Stripe 淺色柔和；保留兩種主題配色
  const light = document.documentElement.dataset.theme === 'light';
  const entries = light ? [
    { label:'流動現金', value:cashT + usdtTWD,   color: '#64748b' },
    { label:'加密貨幣', value:cryT - usdtTWD,    color: '#f59e0b' },
    { label:'美股',     value:usT,               color: '#6366f1' },
    { label:'台股',     value:twT,               color: '#3b82f6' },
    { label:'儲蓄險',   value:ins,               color: '#ec4899' },
    { label:'房地產',   value:re,                color: '#10b981' },
  ].filter(e => e.value > 0) : [
    { label:'流動現金', value:cashT + usdtTWD,   color: '#60a5fa' },
    { label:'加密貨幣', value:cryT - usdtTWD,    color: '#fbbf24' },
    { label:'美股',     value:usT,               color: '#a78bfa' },
    { label:'台股',     value:twT,               color: '#34d399' },
    { label:'儲蓄險',   value:ins,               color: '#f472b6' },
    { label:'房地產',   value:re,                color: '#38bdf8' },
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
      responsive: true, maintainAspectRatio: false, cutout: '55%', radius: 100,
      layout: { padding: { top: 4, bottom: 4, left: 4, right: 4 } },
      plugins: {
        legend: { display: false },
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

  // 自訂 HTML 圖例（圓餅右側垂直）
  const legendEl = $('pie-legend');
  if (legendEl) {
    const sumValue = entries.reduce((s, e) => s + e.value, 0);
    legendEl.innerHTML = entries.map(e => {
      const pct = sumValue > 0 ? (e.value / sumValue * 100) : 0;
      return `<li>
        <span class="pl-name-wrap">
          <span class="pl-dot" style="background:${e.color}"></span>
          <span class="pl-name">${e.label}</span>
        </span>
        <span class="pl-pct">${pct.toFixed(1)}%</span>
        <span class="pl-amt">${fmt(e.value)}</span>
      </li>`;
    }).join('');
  }
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
  // Guard：有持倉但投資總值為 0，代表價格尚未載入，跳過以防寫入壞快照
  const hasHoldings = S.data.tw.length || S.data.us.length || S.data.crypto.length;
  if (hasHoldings && (twT + usT + cryT) === 0) {
    console.warn('[snapshot] Skipped: prices not loaded (investment total = 0)');
    return;
  }
  // Guard：匯率不合理（< 10 代表未正確載入）
  if (S.prices.usdtwd < 10) {
    console.warn('[snapshot] Skipped: usdtwd rate implausible', S.prices.usdtwd);
    return;
  }
  const now = new Date();
  const ds = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
  // 同步儲存當下 per-symbol 即時價格（原幣別）→ 讓次日可算漲跌幅，與類別總值自我一致
  const priceSnap = {
    tw: Object.fromEntries(S.data.tw.map(r => [r[0], S.prices.tw[r[0]]]).filter(([,p]) => p != null)),
    us: Object.fromEntries(S.data.us.map(r => [r[0], S.prices.us[r[0]]]).filter(([,p]) => p != null)),
    crypto: Object.fromEntries(S.data.crypto.map(r => {
      const sym = r[0]?.toUpperCase();
      return [sym, S.prices.crypto[sym]];
    }).filter(([,p]) => p != null)),
  };
  const row = [ds, cashT.toFixed(0), twT.toFixed(0), usT.toFixed(0), cryT.toFixed(0), ins.toFixed(0), re.toFixed(0), debt.toFixed(0), net.toFixed(0), JSON.stringify(priceSnap)];
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

function closeModal() {
  $('modal').classList.remove('open');
  // 清掉可能被特定 modal（如 CMC 匯入）臨時放大的尺寸，避免影響下一個 modal
  const box = $('modal').querySelector('.modal-box');
  if (box) { box.style.maxWidth = ''; box.style.width = ''; }
}
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

  if (type === 'other') {
    const m = OTHER_META[idx];
    if (!m) return;
    const v = S.data.settings[idx] || 0;
    valueTwd = m.currency === 'USD' ? v * S.prices.usdtwd : v;
    subText = m.currency === 'USD'
      ? `USD ${v.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})}`
      : m.sub;
    const valEl = $('cp-value');
    valEl.textContent = valueTwd > 0 ? (m.isDebt ? '−' : '') + fmt(valueTwd) + ' TWD' : '—';
    valEl.style.color = m.isDebt && valueTwd > 0 ? 'var(--danger)' : '';
    $('cp-value-sub').textContent = subText;
    renderHistoryInPanel('other', idx);
    return;
  }

  // 重置非 other 情境的特殊樣式
  $('cp-value').style.color = '';

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

// 通用：開啟 panel（支援 cash / tw / us / crypto / other）
function openAssetDetail(type, idx) {
  _panelAssetType = type;
  _panelIdx = idx;
  let sym;
  if (type === 'cash') {
    sym = S.data.cash[idx]?.[0] || '帳戶';
  } else if (type === 'other') {
    const m = OTHER_META[idx];
    if (!m) return;
    sym = `${m.icon} ${m.label}`;
  } else {
    const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
    sym = dataMap[type][idx]?.[0]?.toUpperCase() || '';
  }
  $('cp-sym').textContent = sym;

  // 其他資產為固定槽位、不可刪除；改用「增減餘額」措辭
  const isOther = type === 'other';
  const delBtn = document.querySelector('#crypto-panel .btn-cp-delete');
  if (delBtn) delBtn.style.display = isOther ? 'none' : '';
  const adjBtn = document.querySelector('#crypto-panel .btn-cp-primary');
  if (adjBtn) adjBtn.textContent = (isOther || type === 'cash') ? '＋ 增減餘額' : '＋ 增減數量';

  _refreshPanelDisplay(isOther ? idx : sym);
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

// 通用歷史記錄渲染（table 格式，支援 cash / tw / us / crypto / other）
function renderHistoryInPanel(type, sym) {
  const histKey = `${type}_history`;
  const hist = (S.data[histKey] || []).filter(r => r[1] === sym);
  hist.sort((a, b) => (b[0] > a[0] ? 1 : -1));

  const el = $('cp-history');
  if (!hist.length) {
    el.innerHTML = '<div class="cp-history-empty">尚無變動記錄</div>';
    return;
  }

  // ── other：[date, key, before, after, delta, note] ──
  if (type === 'other') {
    const m = OTHER_META[sym];
    const ccy = m?.currency || 'TWD';
    const fmtV = v => v.toLocaleString('zh-TW', {minimumFractionDigits:0,maximumFractionDigits:2});
    const rows = hist.map(r => {
      const after = parseFloat(r[3]) || 0;
      const delta = parseFloat(r[4]) || 0;
      const isPos = delta >= 0;
      const note = r[5] || '';
      return `<tr>
        <td class="ch-date">${esc(r[0])}</td>
        <td class="ch-delta ${isPos ? 'pos' : 'neg'}">${(isPos?'+':'')+fmtV(delta)}</td>
        <td class="ch-qty">${fmtV(after)}</td>
        <td class="ch-price">${esc(note)}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `<table class="cp-history-table">
      <thead><tr><th>日期</th><th>增減 (${ccy})</th><th>餘額 (${ccy})</th><th>備註</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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

// 通用：增減數量（支援 cash / tw / us / crypto / other）
async function adjustAssetQty() {
  if (_panelIdx === null) return;
  const type = _panelAssetType;

  if (type === 'other') {
    const key = _panelIdx;
    const m = OTHER_META[key];
    if (!m) return;
    const before = S.data.settings[key] || 0;
    openModal(`增減餘額 · ${m.label}`, [
      { id: 'delta', label: `變動金額 ${m.currency}（正為增加，負為減少）`, type: 'number', step: 'any', ph: '例如 5000 或 -2000' },
      { id: 'note', label: '備註（選填）', type: 'text', ph: '例如：保費繳納、房貸還款', opt: true },
    ], async vals => {
      const delta = parseFloat(vals.delta);
      if (isNaN(delta) || delta === 0) { showToast('請輸入有效的變動金額', 'err'); return false; }
      const after = before + delta;
      if (after < 0) { showToast('餘額不能小於 0', 'err'); return false; }
      S.data.settings[key] = after;
      const settRows = Object.entries(S.data.settings).map(([k, v]) => [k, v]);
      await saveSheet('settings', settRows);
      await appendOtherHistory(key, before, after, vals.note || '');
      renderKPIs(); renderCharts(); renderManagement();
      _refreshPanelDisplay(key);
      showToast('已儲存並記錄變動', 'ok');
      return true;
    });
    return;
  }

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

// 通用：設定餘額（支援 cash / tw / us / crypto / other）
async function setAssetQty() {
  if (_panelIdx === null) return;
  const type = _panelAssetType;

  if (type === 'other') {
    const key = _panelIdx;
    const m = OTHER_META[key];
    if (!m) return;
    const before = S.data.settings[key] || 0;
    openModal(`設定餘額 · ${m.label}`, [
      { id: 'amount', label: `新餘額 (${m.currency})`, type: 'number', val: before, min: 0, step: 'any' },
      { id: 'note', label: '備註（選填）', type: 'text', ph: '例如：市值更新、年度結算', opt: true },
    ], async vals => {
      const after = parseFloat(vals.amount);
      if (isNaN(after) || after < 0) { showToast('請輸入有效金額', 'err'); return false; }
      S.data.settings[key] = after;
      const settRows = Object.entries(S.data.settings).map(([k, v]) => [k, v]);
      await saveSheet('settings', settRows);
      await appendOtherHistory(key, before, after, vals.note || '');
      renderKPIs(); renderCharts(); renderManagement();
      _refreshPanelDisplay(key);
      showToast('已儲存並記錄變動', 'ok');
      return true;
    });
    return;
  }

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

// 通用：從 panel 刪除（支援 cash / tw / us / crypto；其他資產為固定槽位不可刪）
function deleteAssetFromPanel() {
  if (_panelIdx === null) return;
  const type = _panelAssetType;
  if (type === 'other') return;
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
  Chart.defaults.color = next === 'light' ? '#666666' : 'rgba(255,255,255,0.88)';
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
// ══════════════════════════════════════════════════════════════
// DIE WITH ZERO SIMULATOR
// ══════════════════════════════════════════════════════════════

let _dwzChart = null;
// Bucket List 篩選狀態（'all' | 'planning' | 'done' | 'abandoned'）
let _bucketFilter = 'all';

// 9-col schema: [id, name, category, age, budget_wan, status, date, paid, notes]
function _bucketRow(r) {
  return {
    id: r?.[0] || '',
    name: r?.[1] || '',
    category: r?.[2] || '其他',
    age: parseInt(r?.[3]) || 0,
    amount: parseFloat(r?.[4]) || 0,    // 萬元
    status: r?.[5] || '規劃中',
    date: r?.[6] || '',                   // YYYY/MM 選填
    paid: r?.[7] === 'true' || r?.[7] === true,
    notes: r?.[8] || '',
  };
}

function _newBucketId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 自動還原 v0.6 早期 migration bug 造成的欄位錯位
// 腐化模式（被當作舊 6-col 重新寫過一次）：
//   [0]=新id  [1]=name  [2]=原budget  [3]=原id  [4]=原category
//   [5]=原age [6]=''   [7]='false'   [8]=原status
// 反向 mapping：
//   id=[0], name=[1], category=[4], age=[5], budget_wan=[2],
//   status=[8], date=[6], paid=[7], notes='' (遺失)
async function _repairCorruptedBucketRows() {
  const fixed = [];
  S.data.bucket_list = S.data.bucket_list.map((r, i) => {
    if (!r || r.length < 6) return r;
    const ageStr = String(r[3] || '').trim();
    const statusStr = String(r[5] || '').trim();
    // 確認腐化模式：age 欄含字母 + status 欄是純數字 + r[7] 是 'false'/'true'
    if (!ageStr || /^\d+$/.test(ageStr)) return r;
    if (!statusStr || !/^\d+$/.test(statusStr)) return r;
    fixed.push({ idx: i, name: r[1], recoveredAge: statusStr, recoveredBudget: r[2] });
    return [
      r[0] || _newBucketId(),
      r[1] || '',
      r[4] || '其他',
      String(r[5] || ''),
      String(r[2] || '0'),
      r[8] || '規劃中',
      r[6] || '',
      r[7] === 'true' ? 'true' : 'false',
      '',
    ];
  });
  if (fixed.length > 0) {
    try {
      await saveSheet('bucket_list', S.data.bucket_list);
      console.log('[bucket_list] ✓ 已自動還原', fixed.length, '筆腐化資料：', fixed);
    } catch (e) {
      console.error('[bucket_list] 還原儲存失敗:', e);
    }
  }
}

function _findBucketIdx(id) {
  return S.data.bucket_list.findIndex(r => r?.[0] === id);
}

// 「規劃中」的 bucket list 項目（給曲線扣除用）
function _activeBucketItems() {
  return S.data.bucket_list
    .map(r => _bucketRow(r))
    .filter(b => b.status === '規劃中');
}

// 統一遷移：升級舊 6-col bucket_list、整合 localStorage _dwzExpenses、合併 experience_plan
async function _migrateBucketListIfNeeded() {
  // 1) localStorage 旗標已設 → 已遷移完成，直接跳過
  //    （Google Sheets API 會 trim trailing 空 cells → 用 length 判斷會誤判）
  if (localStorage.getItem('bucket_list_migrated_v2') === '1') return;

  // 2) 內容偵測：新 schema 第 0 欄是 alphanumeric id，舊 schema 是純數字 age
  //    任何一列含字母即可確認是新 schema
  const looksLikeNewSchema = S.data.bucket_list.some(r => {
    const v = String(r?.[0] || '').trim();
    return v && !/^\d+$/.test(v);
  });
  if (looksLikeNewSchema) {
    console.log('[bucket_list] detected new schema by content, skipping migration');
    localStorage.setItem('bucket_list_migrated_v2', '1');
    return;
  }

  const merged = [];
  const seenNames = new Set(); // 名稱去重 lowercase

  // (1) 既有 bucket_list 舊 6-col schema 升級
  S.data.bucket_list.forEach(r => {
    if (!r) return;
    if (r.length >= 9) {
      merged.push(r);
      const n = (r[1] || '').toLowerCase();
      if (n) seenNames.add(n);
      return;
    }
    // 舊: [age, name, budget_wan, status, category, note]
    const name = r[1] || '';
    merged.push([
      _newBucketId(), name, r[4] || '其他',
      String(r[0] || ''), String(r[2] || '0'),
      r[3] || '規劃中', '', 'false', r[5] || '',
    ]);
    if (name) seenNames.add(name.toLowerCase());
  });

  // (2) localStorage _dwzExpenses 一次性
  if (localStorage.getItem('bucket_list_migrated_v1') !== '1') {
    let old;
    try { old = JSON.parse(localStorage.getItem('dwz_expenses') || '[]'); }
    catch { old = []; }
    if (Array.isArray(old)) {
      old.forEach(e => {
        const name = e?.name || '';
        if (!name || seenNames.has(name.toLowerCase())) return;
        merged.push([
          _newBucketId(), name, '其他',
          String(e.age || ''), String(e.amount || 0),
          '規劃中', '', 'false', '',
        ]);
        seenNames.add(name.toLowerCase());
      });
    }
    localStorage.setItem('bucket_list_migrated_v1', '1');
  }

  // (3) experience_plan → bucket_list（dedupe by lowercase name）
  const dwzAge = parseInt(JSON.parse(localStorage.getItem('dwz_params')||'{}').age) || 35;
  const curYear = new Date().getFullYear();
  (S.data.experience_plan || []).forEach(r => {
    const name = (r[0] || '').trim();
    if (!name || seenNames.has(name.toLowerCase())) return;

    const year = parseInt(r[1]) || 0;
    const month = parseInt(r[2]) || 1;
    const date = year ? `${year}/${String(month).padStart(2, '0')}` : '';
    const age = year ? (dwzAge + (year - curYear)) : '';
    const amountTwd = parseFloat(r[3]) || 0;
    const budget_wan = String(amountTwd / 10000);
    const paid = r[4] === '1' ? 'true' : 'false';

    merged.push([
      _newBucketId(), name, '其他',
      String(age), budget_wan, '規劃中',
      date, paid, '',
    ]);
    seenNames.add(name.toLowerCase());
  });

  S.data.bucket_list = merged;

  try {
    if (merged.length > 0) await saveSheet('bucket_list', S.data.bucket_list);
    localStorage.setItem('bucket_list_migrated_v2', '1');
    if (merged.length > 0) console.log('[bucket_list] v2 migrated', merged.length, 'items');
  } catch (e) {
    console.warn('[bucket_list] v2 migrate save failed:', e);
  }
}
let _dwzInited = false;
let _dwzDebounce = null;

// experience_plan 項目（未付）轉換為 DWZ 格式，依年份/月份計算年齡
// DWZ 曲線扣除來源：bucket_list 中 status === '規劃中' 且未付的項目
// （已合併原 experience_plan，所以唯一來源即為 bucket_list）
function _allDWZExpenses() {
  return _activeBucketItems().filter(b => !b.paid);
}

function _dwzParam(id) { return parseFloat(document.getElementById(id)?.value) || 0; }

function dwzAutoCalc() {
  clearTimeout(_dwzDebounce);
  _dwzDebounce = setTimeout(renderDWZ, 120);
}

function _saveDWZParams() {
  localStorage.setItem('dwz_params', JSON.stringify({
    age:        _dwzParam('dwz-age'),
    retire:     _dwzParam('dwz-retire'),
    life:       _dwzParam('dwz-life'),
    ret:        _dwzParam('dwz-return'),
    inf:        _dwzParam('dwz-inflation'),
    legacy:     _dwzParam('dwz-legacy'),
    illiquid:   _dwzParam('dwz-illiquid'),
    multEarly:  _dwzParam('dwz-mult-early'),
    multLate:   _dwzParam('dwz-mult-late'),
    safeFloor:  _dwzParam('dwz-safe-floor'),
    giftAge:    _dwzParam('dwz-gift-age'),
    expBudget:  _dwzParam('dwz-exp-budget'),
  }));
}

function _loadDWZParams() {
  const p = JSON.parse(localStorage.getItem('dwz_params') || '{}');
  const set = (id, v) => { if (v !== undefined && v !== null && document.getElementById(id)) document.getElementById(id).value = v; };
  set('dwz-age',        p.age);
  set('dwz-retire',     p.retire);
  set('dwz-life',       p.life);
  set('dwz-return',     p.ret);
  set('dwz-inflation',  p.inf);
  set('dwz-legacy',     p.legacy);
  set('dwz-illiquid',   p.illiquid);
  set('dwz-mult-early', p.multEarly);
  set('dwz-mult-late',  p.multLate);
  set('dwz-safe-floor', p.safeFloor);
  set('dwz-gift-age',   p.giftAge);
  set('dwz-exp-budget', p.expBudget);
}

// ── 標的級別 ROI：預設映射表 + 類別 fallback ──
const DWZ_ROI_PRESETS = {
  // 穩健大盤 / 高股息 ETF
  'VTI':8,'VOO':8,'SPY':8,'VT':8,'0050':8,'006208':8,'00878':8,'00929':8,'00713':8,'00919':8,'00940':8,
  // 成長型科技
  'QQQ':12,'NVDA':12,'TSLA':12,'AAPL':10,'MSFT':10,'GOOGL':10,'GOOG':10,'META':10,'AMZN':10,'AVGO':10,
  // 加密貨幣：除 USDT 穩定幣外統一 20%
  'BTC':20,'ETH':20,
  // 穩定幣（USDT 維持低生息預期；USDC/DAI 套用類別預設 20%，使用者可自行改）
  'USDT':4,
};
const DWZ_ROI_DEFAULT = { tw: 8, us: 10, crypto: 20, ins: 2, cash: 2 };

function _readAssetROIStore() { return JSON.parse(localStorage.getItem('dwz_asset_roi') || '{}'); }
function _writeAssetROIStore(obj) { localStorage.setItem('dwz_asset_roi', JSON.stringify(obj)); }

// 組出「所有非零持倉 + 現金 + 儲蓄險 + 市值 + 當前 ROI」清單
// 加總 = 首頁「可用資產」（liquid = cashT + twT + usT + cryT + ins）
function buildHoldingsROIList() {
  const rate = S.prices.usdtwd || 31;
  const store = _readAssetROIStore();
  const pick = (key, sym, defVal) => {
    if (store[key] !== undefined && !isNaN(parseFloat(store[key]))) return parseFloat(store[key]);
    if (DWZ_ROI_PRESETS[sym] !== undefined) return DWZ_ROI_PRESETS[sym];
    return defVal;
  };
  const items = [];
  (S.data.tw || []).forEach(r => {
    const sym = String(r[0] || '').trim();
    const qty = parseFloat(r[1]) || 0;
    if (!sym || qty <= 0) return;
    const mv = qty * (S.prices.tw[sym] || 0);
    if (mv <= 0) return;
    items.push({ key: `tw:${sym}`, symbol: sym, type: 'tw', label: '台股', marketValue: mv, roi: pick(`tw:${sym}`, sym, DWZ_ROI_DEFAULT.tw) });
  });
  (S.data.us || []).forEach(r => {
    const sym = String(r[0] || '').trim().toUpperCase();
    const qty = parseFloat(r[1]) || 0;
    if (!sym || qty <= 0) return;
    const mv = qty * (S.prices.us[sym] || 0) * rate;
    if (mv <= 0) return;
    items.push({ key: `us:${sym}`, symbol: sym, type: 'us', label: '美股', marketValue: mv, roi: pick(`us:${sym}`, sym, DWZ_ROI_DEFAULT.us) });
  });
  (S.data.crypto || []).forEach(r => {
    const sym = String(r[0] || '').trim().toUpperCase();
    const qty = parseFloat(r[1]) || 0;
    if (!sym || qty <= 0) return;
    const mv = qty * (S.prices.crypto[sym] || 0) * rate;
    if (mv <= 0) return;
    items.push({ key: `crypto:${sym}`, symbol: sym, type: 'crypto', label: '加密', marketValue: mv, roi: pick(`crypto:${sym}`, sym, DWZ_ROI_DEFAULT.crypto) });
  });
  return items.sort((a, b) => b.marketValue - a.marketValue);
}

// 加權年化：items 需已包含所有參與計算的資產（含現金、儲蓄險）
function computeWeightedROI(items) {
  const totalAsset = items.reduce((s, x) => s + (x.marketValue || 0), 0);
  if (totalAsset <= 0) return 0;
  const weighted = items.reduce((s, x) => s + (x.marketValue || 0) * ((x.roi || 0) / 100), 0);
  return (weighted / totalAsset) * 100;
}

// ── Side Drawer 版精算介面 ──
const DWZ_ROI_GROUP_META = {
  crypto: { icon: '', label: '加密貨幣', order: 1 },
  us:     { icon: '', label: '美股',     order: 2 },
  tw:     { icon: '', label: '台股',     order: 3 },
  ins:    { icon: '', label: '儲蓄險',   order: 4 },
  cash:   { icon: '', label: '現金',     order: 5 },
};

// 讀取抽屜當前所有 row（type 含 tw/us/crypto/ins/cash），一律視為 items 參與加權
function _roiDrawerGetState() {
  const body = $('roi-drawer-body');
  if (!body) return null;
  const items = [];
  body.querySelectorAll('.roi-input[data-type]').forEach(inp => {
    items.push({
      key: inp.dataset.key,
      type: inp.dataset.type,
      symbol: inp.dataset.sym,
      marketValue: parseFloat(inp.dataset.mv) || 0,
      roi: parseFloat(inp.value) || 0,
    });
  });
  return { items };
}

function _roiDrawerRecalc() {
  const st = _roiDrawerGetState();
  if (!st) return;
  const totalAsset = st.items.reduce((s, x) => s + x.marketValue, 0);
  const weighted = computeWeightedROI(st.items);
  $('roi-drawer-total').textContent = fmt(totalAsset);
  $('roi-drawer-weighted').textContent = weighted.toFixed(2) + ' %';
  // 更新每個分組小計的 avgROI
  const byGroup = { tw: [], us: [], crypto: [], ins: [], cash: [] };
  st.items.forEach(x => byGroup[x.type]?.push(x));
  Object.entries(byGroup).forEach(([type, arr]) => {
    const mv = arr.reduce((s, x) => s + x.marketValue, 0);
    const avg = mv > 0 ? arr.reduce((s, x) => s + x.marketValue * x.roi, 0) / mv : 0;
    const el = $(`roi-group-avg-${type}`);
    if (el) el.textContent = avg > 0 ? avg.toFixed(1) + ' %' : '—';
  });
}

function applyGroupFill(type, val) {
  const body = $('roi-drawer-body');
  if (!body) return;
  body.querySelectorAll(`.roi-input[data-type="${type}"]`).forEach(inp => { inp.value = val; });
  _roiDrawerRecalc();
  showToast(`${DWZ_ROI_GROUP_META[type]?.label || type} 已批次套用 ${val}%`, 'ok');
}

function resetROIToPresets() {
  const body = $('roi-drawer-body');
  if (!body) return;
  body.querySelectorAll('.roi-input[data-type]').forEach(inp => {
    const sym = inp.dataset.sym;
    const type = inp.dataset.type;
    const preset = DWZ_ROI_PRESETS[sym] !== undefined
      ? DWZ_ROI_PRESETS[sym]
      : (DWZ_ROI_DEFAULT[type] ?? 0);
    inp.value = preset;
  });
  _roiDrawerRecalc();
  showToast('已重置為系統預設', 'ok');
}

function closeROIDrawer() {
  $('roi-drawer')?.classList.remove('open');
  $('roi-drawer-backdrop')?.classList.remove('open');
  document.body.classList.remove('roi-drawer-open');
}

function openROIEditor() {
  const items = buildHoldingsROIList();
  const { cashT, ins } = calcTotals();
  const store = _readAssetROIStore();
  const cashRoi = store['cash'] !== undefined ? parseFloat(store['cash']) : DWZ_ROI_DEFAULT.cash;
  const insRoi  = store['ins']  !== undefined ? parseFloat(store['ins'])  : DWZ_ROI_DEFAULT.ins;

  // 分組
  const byType = { tw: [], us: [], crypto: [] };
  items.forEach(x => byType[x.type]?.push(x));

  const fillBtn = (type, val) =>
    `<button type="button" class="roi-group-fill" onclick="applyGroupFill('${type}',${val})" title="批次套用 ${val}%">全部填入 ${val}%</button>`;

  const renderRow = (x) => `
    <div class="roi-drawer-row">
      <span class="roi-sym">${esc(x.symbol)}</span>
      <span class="roi-mv" title="市值">${fmt(x.marketValue)}</span>
      <input type="number" class="roi-input" min="-20" max="80" step="0.5"
             value="${x.roi}" data-key="${esc(x.key)}" data-type="${x.type}"
             data-sym="${esc(x.symbol)}" data-mv="${x.marketValue}">
    </div>`;

  const renderGroup = (type, arr, presets) => {
    if (!arr.length) return '';
    const mv = arr.reduce((s, x) => s + x.marketValue, 0);
    const meta = DWZ_ROI_GROUP_META[type];
    return `
      <section class="roi-drawer-group roi-group-${type}">
        <header class="roi-drawer-group-head">
          <div class="roi-group-titleline">
            <span class="roi-group-icon">${meta.icon}</span>
            <span class="roi-group-name">${meta.label}</span>
            <span class="roi-group-count">${arr.length}</span>
          </div>
          <div class="roi-group-stats">
            <span class="roi-group-stat"><span class="roi-group-stat-lbl">小計</span><span class="roi-group-stat-val">${fmt(mv)}</span></span>
            <span class="roi-group-stat"><span class="roi-group-stat-lbl">平均 ROI</span><span class="roi-group-stat-val" id="roi-group-avg-${type}">—</span></span>
          </div>
          <div class="roi-group-fills">${presets.map(p => fillBtn(type, p)).join('')}</div>
        </header>
        <div class="roi-drawer-group-body">${arr.map(renderRow).join('')}</div>
      </section>`;
  };

  const groupsHTML =
    renderGroup('crypto', byType.crypto, [20, 30, 10]) +
    renderGroup('us',     byType.us,     [8, 10, 12])  +
    renderGroup('tw',     byType.tw,     [6, 8, 10])   +
    (ins > 0 ? `
    <section class="roi-drawer-group roi-group-ins">
       <header class="roi-drawer-group-head">
         <div class="roi-group-titleline">
           <span class="roi-group-name">儲蓄險</span>
           <span class="roi-group-count">1</span>
         </div>
         <div class="roi-group-stats">
           <span class="roi-group-stat"><span class="roi-group-stat-lbl">小計</span><span class="roi-group-stat-val">${fmt(ins)}</span></span>
           <span class="roi-group-stat"><span class="roi-group-stat-lbl">平均 ROI</span><span class="roi-group-stat-val" id="roi-group-avg-ins">—</span></span>
         </div>
       </header>
       <div class="roi-drawer-group-body">
         <div class="roi-drawer-row">
           <span class="roi-sym">儲蓄險總額</span>
           <span class="roi-mv">${fmt(ins)}</span>
           <input type="number" class="roi-input" min="-5" max="15" step="0.1"
                  value="${insRoi}" data-key="ins" data-type="ins"
                  data-sym="INS" data-mv="${ins}">
         </div>
       </div>
     </section>` : '') +
    `<section class="roi-drawer-group roi-group-cash">
       <header class="roi-drawer-group-head">
         <div class="roi-group-titleline">
           <span class="roi-group-name">現金</span>
           <span class="roi-group-count">1</span>
         </div>
         <div class="roi-group-stats">
           <span class="roi-group-stat"><span class="roi-group-stat-lbl">小計</span><span class="roi-group-stat-val">${fmt(cashT)}</span></span>
           <span class="roi-group-stat"><span class="roi-group-stat-lbl">平均 ROI</span><span class="roi-group-stat-val" id="roi-group-avg-cash">—</span></span>
         </div>
       </header>
       <div class="roi-drawer-group-body">
         <div class="roi-drawer-row">
           <span class="roi-sym">現金總額</span>
           <span class="roi-mv">${fmt(cashT)}</span>
           <input type="number" class="roi-input" min="-5" max="30" step="0.1"
                  value="${cashRoi}" data-key="cash" data-type="cash"
                  data-sym="CASH" data-mv="${cashT}">
         </div>
       </div>
     </section>`;

  const body = $('roi-drawer-body');
  body.innerHTML = items.length
    ? `<p class="roi-drawer-hint">每個持倉可獨立調整。分組旁的「全部填入」可批次套用到該分組所有標的。</p>${groupsHTML}`
    : `<p class="roi-drawer-hint">尚無持倉。</p>${groupsHTML}`;

  // bind
  body.querySelectorAll('.roi-input').forEach(inp => {
    inp.addEventListener('input', _roiDrawerRecalc);
    inp.addEventListener('focus', (e) => e.target.select());
  });

  $('roi-drawer-apply').onclick = () => {
    const st = _roiDrawerGetState();
    if (!st) return;
    const saved = {};
    st.items.forEach(x => { saved[x.key] = x.roi; });
    _writeAssetROIStore(saved);
    const weighted = computeWeightedROI(st.items);
    const retInp = $('dwz-return');
    if (retInp) {
      retInp.value = weighted.toFixed(2);
      dwzAutoCalc();
    }
    showToast(`已套用加權 ROI ${weighted.toFixed(2)}%`, 'ok');
    closeROIDrawer();
  };

  _roiDrawerRecalc();
  $('roi-drawer').classList.add('open');
  $('roi-drawer-backdrop').classList.add('open');
  document.body.classList.add('roi-drawer-open');
}

function initDWZ() {
  if (!_dwzInited) { _loadDWZParams(); _initStratLab(); _dwzInited = true; }
  renderDWZ();
}

// ── 策略實驗室 ─────────────────────────────────────────────────
function toggleStratLab() {
  const head = document.querySelector('.dwz-strat-lab-head');
  const body = $('strat-lab-body');
  if (!head || !body) return;
  const open = head.classList.toggle('open');
  body.hidden = !open;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  localStorage.setItem('dwz_strat_lab_open', open ? '1' : '0');
}

function _initStratLab() {
  const head = document.querySelector('.dwz-strat-lab-head');
  const body = $('strat-lab-body');
  if (!head || !body) return;
  if (localStorage.getItem('dwz_strat_lab_open') === '1') {
    head.classList.add('open');
    body.hidden = false;
    head.setAttribute('aria-expanded', 'true');
  }
  const c1 = $('strat-4pct'), c2 = $('strat-rewards');
  if (c1) {
    c1.checked = localStorage.getItem('dwz_strat_4pct') === '1';
    c1.addEventListener('change', () => localStorage.setItem('dwz_strat_4pct', c1.checked ? '1' : '0'));
  }
  if (c2) {
    c2.checked = localStorage.getItem('dwz_strat_rewards') === '1';
    c2.addEventListener('change', () => localStorage.setItem('dwz_strat_rewards', c2.checked ? '1' : '0'));
  }
}

// 計算策略實驗室的每月外部現金流入（TWD），同步更新 UI 估算文字
function _calcStratLabInflow() {
  let monthly = 0;
  const c1 = $('strat-4pct'), c2 = $('strat-rewards');
  const on1 = !!c1?.checked, on2 = !!c2?.checked;

  // 4% 年化提領
  let m1 = 0;
  if (on1) {
    const cryptoTotal = S.data.crypto.reduce((s, r) => {
      const sym = r[0]?.toUpperCase();
      const p = S.prices.crypto[sym];
      return s + (p ? (parseFloat(r[1]) || 0) * p * S.prices.usdtwd : 0);
    }, 0);
    m1 = cryptoTotal * 0.04 / 12;
  }
  // 質押收益（本月台幣總和）
  let m2 = 0;
  if (on2) {
    const now = new Date();
    const cur = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}`;
    m2 = S.data.rewards.filter(r => r[0] === cur).reduce((s, r) => s + rewardTWD(r), 0);
  }
  monthly = m1 + m2;

  // 更新 UI（row.on / 估算數字）
  const row1 = $('strat-row-4pct'), row2 = $('strat-row-rewards');
  if (row1) row1.classList.toggle('on', on1);
  if (row2) row2.classList.toggle('on', on2);
  const est1 = $('strat-4pct-est'), est2 = $('strat-rewards-est');
  if (est1) est1.textContent = on1 ? `每月約 +${fmtWan(m1)}` : '';
  if (est2) est2.textContent = on2 ? `每月約 +${m2.toLocaleString('zh-TW',{maximumFractionDigits:0})}` : '';

  return monthly;
}

function renderDWZ() {
  _saveDWZParams();

  const currentAge  = _dwzParam('dwz-age');
  const retireAge   = _dwzParam('dwz-retire');
  const lifeAge     = _dwzParam('dwz-life');
  const r           = _dwzParam('dwz-return') / 100;
  const inf         = _dwzParam('dwz-inflation') / 100;
  const legacyTWD   = _dwzParam('dwz-legacy') * 10000;
  const illiquidTWD = _dwzParam('dwz-illiquid') * 10000;
  const multEarly   = _dwzParam('dwz-mult-early') / 100 || 1.2;
  const multLate    = _dwzParam('dwz-mult-late')  / 100 || 0.8;
  const safeFloor   = _dwzParam('dwz-safe-floor') * 10000;
  const giftAge     = _dwzParam('dwz-gift-age') || 60;
  const expBudgetTWD = _dwzParam('dwz-exp-budget') * 10000;  // 40–65 歲年度體驗預算

  const { liquid, budget } = calcTotals();
  // 起點統一為可用資產（與首頁同步）：不再在 startNW 上預扣 12 個月生活費
  const startNW = liquid - illiquidTWD;
  // 年度迴圈從 currentAge + 1 起算，第一年的支出（含月支出預算 + 本年未付體驗
  // + 本年手動 bucket list + 本年生前贈與）都由第一年迭代一併扣除
  const year0ManualItems = _activeBucketItems().filter(e => e.age === currentAge && !e.paid);
  const year0ManualTotal = year0ManualItems.reduce((s, e) => s + e.amount * 10000, 0);
  const year0GiftTotal = (giftAge === currentAge && legacyTWD > 0) ? legacyTWD : 0;
  const annualBase = budget * 12;

  // 策略實驗室：每月外部現金流入 → 年度化後每年加回 NW
  const stratMonthlyInflow = _calcStratLabInflow();
  const stratAnnualInflow = stratMonthlyInflow * 12;

  // KPI 小標籤：起始可用資產（與首頁同步）+ 年支出基準
  const snwEl = $('dwz-start-nw'), sbuEl = $('dwz-start-budget');
  if (snwEl) snwEl.textContent = fmtWan(startNW);
  if (sbuEl) sbuEl.textContent = fmtWan(annualBase);

  // ── Build wealth curve ──
  const ages   = [];
  const wealth = [];
  const totalYears = lifeAge - currentAge || 1;
  let nw = startNW;
  let peakNW = startNW, peakAge = currentAge;
  // 影子曲線：策略實驗室「未啟用」基準（僅當 stratAnnualInflow > 0 時才有意義）
  const trackBaseline = stratAnnualInflow > 0;
  let nwBaseline = startNW;
  const wealthBaseline = [Math.round(startNW)];

  // 先 push year-0 起點（由月度模擬產生），年度迴圈再從 currentAge + 1 推進
  ages.push(currentAge);
  wealth.push(Math.round(startNW));

  for (let age = currentAge + 1; age <= lifeAge; age++) {
    const n = age - currentAge;

    // Annual expense with inflation + retirement phase multiplier
    let mult = 1;
    if (age >= retireAge) {
      const yearsRetired = age - retireAge;
      mult = yearsRetired < 15 ? multEarly : multLate;
    }
    // 第一年（n=1）不套通膨（首年支出即為當前年度預算）
    const annualExpense = annualBase * (n === 1 ? 1 : Math.pow(1 + inf, n - 1)) * mult;

    // End-of-year model: compound then spend；策略實驗室現金流為定額名目年金（不通膨）
    nw = nw * (1 + r) - annualExpense + stratAnnualInflow;
    if (trackBaseline) nwBaseline = nwBaseline * (1 + r) - annualExpense;

    // 40–65 歲年度體驗預算
    if (expBudgetTWD > 0 && age >= 40 && age <= 65) {
      nw -= expBudgetTWD;
      if (trackBaseline) nwBaseline -= expBudgetTWD;
    }

    // One-time experience expenses (Bucket List + 規劃清單)
    _allDWZExpenses().filter(e => e.age === age).forEach(e => {
      nw -= e.amount * 10000;
      if (trackBaseline) nwBaseline -= e.amount * 10000;
    });

    // Life-time legacy gift deducted at giftAge
    if (age === giftAge && legacyTWD > 0) {
      nw -= legacyTWD;
      if (trackBaseline) nwBaseline -= legacyTWD;
    }

    // 第一年額外扣：手動 bucket list 排在 currentAge 的項目 + 生前贈與排在 currentAge 者
    if (age === currentAge + 1) {
      nw -= year0ManualTotal + year0GiftTotal;
      if (trackBaseline) nwBaseline -= year0ManualTotal + year0GiftTotal;
    }

    ages.push(age);
    wealth.push(Math.round(nw));
    if (trackBaseline) wealthBaseline.push(Math.round(nwBaseline));

    if (nw > peakNW) { peakNW = nw; peakAge = age; }
  }

  const finalWealth  = wealth[wealth.length - 1] || 0;
  const wealthAt80   = wealth[ages.indexOf(80)] ?? finalWealth;
  const wealthAt90   = wealth[ages.indexOf(90)] ?? finalWealth;

  // ── Life energy curve (100% at currentAge → 0% at lifeAge) ──
  const lifeEnergy = ages.map(a => Math.max(0, ((lifeAge - a) / totalYears) * 100));

  // ── Waste indicator: unspent surplus above safety floor at end of life ──
  const wastedWealth = Math.max(0, finalWealth - safeFloor);

  // ── Warning pill ──
  const warnEl = $('dwz-warning');
  if (warnEl) {
    if (wealthAt80 < 0) {
      warnEl.style.display = 'inline-flex';
      warnEl.className = 'dwz-pill dwz-pill-danger';
      const retireAge2 = ages.find((_a, i) => wealth[i] < 0);
      warnEl.innerHTML = `<em>缺口</em> <b>${retireAge2} 歲</b>歸零`;
      warnEl.title = '資金缺口預警：建議延後退休年齡或降低生活費倍率';
    } else if (wealthAt90 > 20000000) {
      warnEl.style.display = 'inline-flex';
      warnEl.className = 'dwz-pill dwz-pill-warn';
      warnEl.innerHTML = `<em>Over-worked</em> 90 歲剩 <b>${fmtWan(wealthAt90)}</b>`;
      warnEl.title = '你工作得太努力了，建議 45–65 歲大幅增加體驗支出';
    } else {
      warnEl.style.display = 'none';
    }
  }

  // ── Peak pill ──
  const peakEl = $('dwz-peak-info');
  if (peakEl && peakNW > -Infinity) {
    peakEl.style.display = 'inline-flex';
    peakEl.innerHTML = `<em>巔峰</em> <b>${peakAge} 歲</b> ${fmtWan(peakNW)}`;
    peakEl.title = `資產高點：${peakAge} 歲 ${fmtWan(peakNW)}`;
  }

  // ── Waste pill ──
  const wasteEl = $('dwz-waste-info');
  if (wasteEl) {
    if (wastedWealth > 0) {
      wasteEl.style.display = 'inline-flex';
      wasteEl.innerHTML = `<em>終局浪費</em> <b>${fmtWan(wastedWealth)}</b>`;
      wasteEl.title = `按目前規劃，${lifeAge} 歲時帶走 ${fmtWan(wastedWealth)} 未兌換的生命能量`;
    } else {
      wasteEl.style.display = 'none';
    }
  }

  // ── Chart ──
  const isDark    = document.documentElement.dataset.theme !== 'light';
  const primaryLine = isDark ? '#ffffff' : '#111111';
  const floorVal    = safeFloor;
  const allExps     = _allDWZExpenses();
  const expAgeSet   = new Set(allExps.map(e => e.age));
  const pointColors = wealth.map(w => w >= floorVal ? primaryLine : '#ef4444');

  if (_dwzChart) { _dwzChart.destroy(); _dwzChart = null; }
  const ctx = document.getElementById('dwz-chart');
  if (!ctx) return;
  const gridColor = isDark ? '#1a1a1a' : 'rgba(0,0,0,0.07)';

  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
  if (isDark) {
    grad.addColorStop(0, 'rgba(255,255,255,0.08)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    grad.addColorStop(0, 'rgba(24,24,27,0.12)');
    grad.addColorStop(1, 'rgba(24,24,27,0)');
  }

  _dwzChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ages,
      datasets: [
        // Main wealth curve
        {
          label: '可用資產',
          data: wealth,
          borderColor: primaryLine,
          backgroundColor: grad,
          borderWidth: 2,
          pointRadius: ages.map(a => expAgeSet.has(a) ? 6 : 2.5),
          pointBackgroundColor: ages.map((a, i) => expAgeSet.has(a) ? '#f59e0b' : pointColors[i]),
          pointBorderColor:     ages.map((a, i) => expAgeSet.has(a) ? '#f59e0b' : pointColors[i]),
          fill: true,
          tension: 0.35,
          segment: {
            borderColor: c => wealth[c.p1DataIndex] >= floorVal ? primaryLine : '#ef4444',
          },
          yAxisID: 'y',
          order: 1,
        },
        // Safety floor line
        {
          label: '生活保底線',
          data: ages.map(() => floorVal),
          borderColor: 'rgba(34,197,94,0.7)',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
          yAxisID: 'y',
          order: 2,
        },
        // Life energy curve (right axis, 0–100%)
        {
          label: '生命能量',
          data: lifeEnergy,
          borderColor: 'rgba(251,191,36,0.65)',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          tension: 0.4,
          yAxisID: 'y2',
          order: 3,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 180 },
      onClick: (evt, _els, chart) => {
        const pts = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
        if (pts.length) addDWZExpenseAtAge(ages[pts[0].index]);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: item => item.datasetIndex === 0,
          callbacks: {
            title: items => `${items[0].label} 歲`,
            label: item => {
              const v = item.raw;
              const exps = allExps.filter(e => e.age === ages[item.dataIndex]);
              const energy = Math.round(lifeEnergy[item.dataIndex]);
              const lines = [
                `資產：${v < 0 ? '−' : ''}${fmtWan(Math.abs(v))}${v < 0 ? '（財富功成身退）' : ''}`,
                `生命能量：${energy}%`,
              ];
              if (item.dataIndex > 0) {
                const delta = wealth[item.dataIndex] - wealth[item.dataIndex - 1];
                lines.push(`年變化：${delta >= 0 ? '+' : ''}${fmtWan(delta)}`);
              }
              exps.forEach(e => lines.push(`${e.name}：${e.amount} 萬`));
              if (ages[item.dataIndex] === giftAge && legacyTWD > 0)
                lines.push(`生前贈與：${fmtWan(legacyTWD)}`);
              return lines;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: {
            font: { size: 11 },
            callback: (_, i) => ages[i] % 5 === 0 ? `${ages[i]}歲` : '',
            maxRotation: 0,
          },
        },
        y: {
          grid: { color: gridColor },
          ticks: { font: { size: 11 }, callback: v => fmtWan(v) },
        },
        y2: {
          position: 'right',
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
          ticks: {
            font: { size: 10 },
            color: 'rgba(251,191,36,0.6)',
            callback: v => v % 25 === 0 ? `${v}%` : '',
          },
        },
      }
    }
  });

  // ── 智慧建議浮層 ──
  _renderDWZSmartTips({
    currentAge, lifeAge, wealthAt90, ages, wealth,
    wealthBaseline: trackBaseline ? wealthBaseline : null,
    strat4pctOn: !!$('strat-4pct')?.checked,
  });

  _renderDWZWindow(currentAge);
  _renderDWZExpensesList();
}

// 高體驗能力期門檻年齡（可由使用者編輯，存於 settings）
function _getPeakAge() {
  const v = parseInt(S.data.settings?.peak_experience_age);
  return v > 0 ? v : 65;
}

// 體驗窗口倒數：高體驗能力期 = 目前年齡 ~ peakAge 歲
function _renderDWZWindow(currentAge) {
  const card = $('dwz-window-card');
  if (!card) return;
  const peakAge  = _getPeakAge();
  document.querySelectorAll('.dwz-peak-age').forEach(el => el.textContent = peakAge);

  const yearsEl  = $('dwz-window-years');
  const fillEl   = $('dwz-window-fill');
  const pctEl    = $('dwz-window-pct');
  const monthsEl = $('dwz-window-months');

  if (currentAge >= peakAge) {
    card.classList.add('late');
    return;
  }
  card.classList.remove('late');

  const remainYears  = peakAge - currentAge;
  const remainMonths = remainYears * 12;
  const usedPct = Math.max(0, Math.min(100, currentAge / peakAge * 100));
  const colorCls = remainYears > 20 ? '' : (remainYears >= 10 ? 'warn' : 'bad');

  if (yearsEl)  yearsEl.textContent  = remainYears;
  if (fillEl)  {
    fillEl.style.width = usedPct.toFixed(1) + '%';
    fillEl.className = 'dwz-window-progress-fill' + (colorCls ? ' ' + colorCls : '');
  }
  if (pctEl)    pctEl.textContent    = Math.round(usedPct) + '%';
  if (monthsEl) monthsEl.textContent = remainMonths;
}

// inline 編輯高體驗能力期年齡
function _startEditPeakAge(ev) {
  const wrap = ev?.currentTarget;
  if (!wrap || wrap.querySelector('input')) return;
  const cur = _getPeakAge();
  const minAge = (_dwzParam('dwz-age') || 30) + 1;
  const maxAge = (_dwzParam('dwz-life') || 100) - 1;

  const restore = (val) => {
    wrap.innerHTML = `<b class="dwz-peak-age">${val}</b><span class="dwz-peak-pencil">✎</span>`;
  };

  wrap.innerHTML = `<input type="number" class="dwz-peak-input" min="${minAge}" max="${maxAge}" value="${cur}" onclick="event.stopPropagation()">`;
  const input = wrap.querySelector('input');
  input.focus();
  input.select();

  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    const val = parseInt(input.value);
    if (!val || val < minAge || val > maxAge) {
      showToast(`需介於 ${minAge}–${maxAge} 歲`, 'err');
      restore(cur);
      return;
    }
    if (val !== cur) {
      S.data.settings.peak_experience_age = val;
      const settRows = Object.entries(S.data.settings).map(([k, v]) => [k, v]);
      try { await saveSheet('settings', settRows); }
      catch (e) { showToast('儲存失敗', 'err'); restore(cur); return; }
      showToast(`已更新：${val} 歲`, 'ok');
    }
    restore(val);
    if (typeof renderDWZ === 'function') renderDWZ();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') {
      finished = true;
      input.removeEventListener('blur', finish);
      restore(cur);
    }
  });
}

// 依模擬結果產生智慧建議卡片（多條同時顯示，無建議時隱藏）
function _renderDWZSmartTips({ currentAge, lifeAge, wealthAt90, ages, wealth, wealthBaseline, strat4pctOn }) {
  const el = $('dwz-smart-tips');
  if (!el) return;
  const tips = [];

  // 條件 2 優先檢查：第一個 NW < 0 的年齡（只看死亡前）
  let bankruptAge = null;
  for (let i = 0; i < ages.length; i++) {
    if (ages[i] < lifeAge && wealth[i] < 0) { bankruptAge = ages[i]; break; }
  }

  // 條件 1：90 歲餘額 > 500 萬 → 體驗過剩
  if (wealthAt90 > 5000000) {
    const targetAge = currentAge + 5;
    tips.push({
      cls: 'dwz-tip-warn',
      html: `💰 90歲預估剩餘 <b>${fmtWan(wealthAt90)}</b>，建議在 <b>${targetAge} 歲</b>前增加體驗預算`,
    });
  }

  // 條件 2：破產風險
  if (bankruptAge !== null) {
    tips.push({
      cls: 'dwz-tip-bad',
      html: `⚠️ 模擬顯示 <b>${bankruptAge} 歲</b>資產歸零，建議降低支出或調高報酬率假設`,
    });
  }

  // 條件 3：4% 提領效益（需要 baseline）
  if (strat4pctOn && wealthBaseline) {
    const i90 = ages.indexOf(90);
    if (i90 >= 0) {
      const before = wealthBaseline[i90];
      const after = wealth[i90];
      const diffCls = after >= before ? 'dwz-tip-good' : 'dwz-tip-neg';
      tips.push({
        cls: diffCls,
        html: `📈 啟用提領後，90歲餘額從 <b>${fmtWan(before)}</b> 變為 <b>${fmtWan(after)}</b>`,
      });
    }
  }

  // 條件 4：健康狀態良好（年輕且無破產風險）
  if (currentAge < 55 && bankruptAge === null) {
    tips.push({
      cls: 'dwz-tip-good',
      html: `✅ 財務健康，現在是高體驗能力期，建議善用`,
    });
  }

  el.innerHTML = tips.map(t => `<div class="dwz-tip ${t.cls}">${t.html}</div>`).join('');
}

// ── Bucket List 渲染（DWZ 頁）──────────────────────────────────
function setBucketFilter(f) {
  _bucketFilter = f;
  document.querySelectorAll('.bucket-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === f);
  });
  _renderDWZExpensesList();
}

function _renderDWZExpensesList() {
  const el = $('dwz-expenses-list');
  const statsEl = $('bucket-stats');
  if (!el) return;

  const items = S.data.bucket_list.map(r => _bucketRow(r));

  // 統計列
  const total = items.length;
  const done  = items.filter(b => b.status === '已完成').length;
  const totalBudget = items.reduce((s, b) => s + b.amount, 0);
  const doneBudget  = items.filter(b => b.status === '已完成').reduce((s, b) => s + b.amount, 0);
  if (statsEl) {
    statsEl.innerHTML = total > 0
      ? `<span class="bucket-stat"><b>${done}/${total}</b> 完成</span>
         <span class="bucket-stat-sep">·</span>
         <span class="bucket-stat">總預算 <b>${totalBudget.toFixed(1)}萬</b></span>
         <span class="bucket-stat-sep">·</span>
         <span class="bucket-stat">已花 <b>${doneBudget.toFixed(1)}萬</b></span>`
      : '';
  }

  // 篩選
  let filtered = items;
  if (_bucketFilter === 'planning')   filtered = items.filter(b => b.status === '規劃中');
  else if (_bucketFilter === 'done')  filtered = items.filter(b => b.status === '已完成');
  else if (_bucketFilter === 'abandoned') filtered = items.filter(b => b.status === '放棄');

  if (filtered.length === 0) {
    el.innerHTML = '<div class="dwz-exp-empty">尚無體驗。點擊圖表上的年齡，或新增體驗。</div>';
    return;
  }

  // 年齡排序 + 5 年分組
  filtered.sort((a, b) => a.age - b.age);
  const groups = new Map();
  filtered.forEach(b => {
    const lo = Math.floor(b.age / 5) * 5;
    const key = `${lo}–${lo + 4} 歲`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });

  el.innerHTML = [...groups.entries()].map(([gk, gItems]) => `
    <div class="bucket-group">
      <div class="bucket-group-title">${gk}</div>
      ${gItems.map(b => _renderBucketItem(b)).join('')}
    </div>`).join('');
}

function _renderBucketItem(b) {
  const statusKey = b.status === '已完成' ? 'done' : (b.status === '放棄' ? 'abandoned' : 'planning');
  const statusOpts = BUCKET_STATUSES.map(s =>
    `<option value="${s}" ${s === b.status ? 'selected' : ''}>${s}</option>`).join('');
  const dateOrNote = b.date
    ? `<div class="bucket-note">${esc(b.date)}${b.notes ? ' · ' + esc(b.notes) : ''}</div>`
    : (b.notes ? `<div class="bucket-note">${esc(b.notes)}</div>` : '');
  return `
    <div class="bucket-item bucket-${statusKey}">
      <span class="bucket-age bucket-age-${statusKey}">${b.age}歲</span>
      <span class="bucket-cat bucket-cat-${b.category}">${esc(b.category)}</span>
      <div class="bucket-main">
        <div class="bucket-name">${esc(b.name)}</div>
        ${dateOrNote}
      </div>
      <span class="bucket-amt">${b.amount.toFixed(1)}萬</span>
      <select class="bucket-status-select" onchange="setBucketStatus('${b.id}', this.value)">${statusOpts}</select>
      <button class="btn-icon edit" onclick="editBucketItem('${b.id}')" title="編輯">✏</button>
      <button class="btn-icon del" onclick="deleteBucketItem('${b.id}')" title="刪除">✕</button>
    </div>`;
}

// 兩頁共用：bucket_list 變更後同步刷新
function _refreshBucketViews() {
  if (typeof renderExperiencePlan === 'function') renderExperiencePlan();
  if (_dwzInited) renderDWZ();
  renderKPIs();
}

async function setBucketStatus(id, newStatus) {
  const idx = _findBucketIdx(id);
  if (idx < 0) return;
  S.data.bucket_list[idx][5] = newStatus;
  try { await saveSheet('bucket_list', S.data.bucket_list); }
  catch (e) { showToast('儲存失敗', 'err'); return; }
  _refreshBucketViews();
}

async function setBucketPaid(id, paid) {
  const idx = _findBucketIdx(id);
  if (idx < 0) return;
  S.data.bucket_list[idx][7] = paid ? 'true' : 'false';
  try { await saveSheet('bucket_list', S.data.bucket_list); }
  catch (e) { showToast('儲存失敗', 'err'); return; }
  _refreshBucketViews();
}

function deleteBucketItem(id) {
  const idx = _findBucketIdx(id);
  if (idx < 0) return;
  const name = S.data.bucket_list[idx]?.[1] || '';
  openConfirm('刪除體驗', `確定要刪除「${name}」嗎？`, async () => {
    S.data.bucket_list.splice(idx, 1);
    await saveSheet('bucket_list', S.data.bucket_list);
    _refreshBucketViews();
    showToast('已刪除', 'ok');
  });
}

function addDWZExpense() {
  _openBucketModal({ id: '', age: '', name: '', amount: '', status: '規劃中', category: '其他', date: '', paid: false, notes: '' });
}

// 從圖表點擊年齡進入：預填年齡
function addDWZExpenseAtAge(age) {
  _openBucketModal({ id: '', age, name: '', amount: '', status: '規劃中', category: '其他', date: '', paid: false, notes: '' });
}

function editBucketItem(id) {
  const idx = _findBucketIdx(id);
  if (idx < 0) return;
  _openBucketModal(_bucketRow(S.data.bucket_list[idx]));
}

function _openBucketModal(b) {
  const editId = b.id || null;
  const minAge = _dwzParam('dwz-age') || 30;
  const maxAge = _dwzParam('dwz-life') || 100;
  const catOpts = BUCKET_CATEGORIES.map(c =>
    `<option value="${c}" ${c === b.category ? 'selected' : ''}>${c}</option>`).join('');
  const statusOpts = BUCKET_STATUSES.map(s =>
    `<option value="${s}" ${s === b.status ? 'selected' : ''}>${s}</option>`).join('');
  // date 內部存 YYYY/MM；input type=month 用 YYYY-MM
  const dateInput = b.date ? b.date.replace('/', '-') : '';
  $('modal-title').textContent = editId ? `編輯體驗 · ${b.name || ''}` : '新增體驗';
  $('modal-body').innerHTML = `
    <div class="dwz-modal-form">
      <div class="dwz-modal-group">
        <label class="dwz-modal-label">體驗名稱</label>
        <input id="m-bk-name" class="dwz-modal-input" value="${esc(b.name)}" placeholder="例：日本親子遊">
      </div>
      <div class="dwz-modal-group">
        <label class="dwz-modal-label">分類</label>
        <select id="m-bk-cat" class="dwz-modal-input">${catOpts}</select>
      </div>
      <div class="dwz-modal-group">
        <label class="dwz-modal-label">目標年齡</label>
        <input id="m-bk-age" class="dwz-modal-input" type="number" min="${minAge}" max="${maxAge}" value="${b.age || ''}" placeholder="例：45">
      </div>
      <div class="dwz-modal-group">
        <label class="dwz-modal-label">預算（萬元）</label>
        <input id="m-bk-amt" class="dwz-modal-input" type="number" min="0" step="0.1" value="${b.amount || ''}" placeholder="例：50">
      </div>
      <div class="dwz-modal-group">
        <label class="dwz-modal-label">預計日期（選填）</label>
        <input id="m-bk-date" class="dwz-modal-input" type="month" value="${dateInput}">
      </div>
      <div class="dwz-modal-group">
        <label class="dwz-modal-label">狀態</label>
        <select id="m-bk-status" class="dwz-modal-input">${statusOpts}</select>
      </div>
      <div class="dwz-modal-group">
        <label class="dwz-modal-label">備註（選填）</label>
        <textarea id="m-bk-notes" class="dwz-modal-input" rows="2">${esc(b.notes)}</textarea>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">取消</button>
      <button class="btn-ok" onclick="_confirmBucketItem('${editId || ''}')">${editId ? '更新' : '新增'}</button>
    </div>`;
  $('modal').classList.add('open');
  setTimeout(() => $('m-bk-name')?.focus(), 80);
}

async function _confirmBucketItem(editId) {
  const minAge = _dwzParam('dwz-age') || 30;
  const maxAge = _dwzParam('dwz-life') || 100;
  const name = $('m-bk-name')?.value.trim();
  const cat = $('m-bk-cat')?.value || '其他';
  const age = parseInt($('m-bk-age')?.value);
  const amt = parseFloat($('m-bk-amt')?.value);
  const dateRaw = $('m-bk-date')?.value || ''; // YYYY-MM
  const date = dateRaw ? dateRaw.replace('-', '/') : '';
  const status = $('m-bk-status')?.value || '規劃中';
  const notes = $('m-bk-notes')?.value.trim() || '';

  if (!name) { showToast('請填寫體驗名稱', 'err'); return; }
  if (!age || age < minAge || age > maxAge) { showToast(`年齡需介於 ${minAge}–${maxAge} 歲`, 'err'); return; }
  if (!amt || amt <= 0) { showToast('請填寫正確預算', 'err'); return; }

  if (editId) {
    const idx = _findBucketIdx(editId);
    if (idx < 0) { showToast('找不到項目', 'err'); return; }
    const old = S.data.bucket_list[idx];
    const paid = old[7] || 'false';
    S.data.bucket_list[idx] = [editId, name, cat, String(age), String(amt), status, date, paid, notes];
  } else {
    S.data.bucket_list.push([_newBucketId(), name, cat, String(age), String(amt), status, date, 'false', notes]);
  }
  // 排序：依年齡（同年齡依名稱）
  S.data.bucket_list.sort((a, b) => {
    const aa = parseInt(a[3]) || 0, bb = parseInt(b[3]) || 0;
    return aa !== bb ? aa - bb : (a[1] || '').localeCompare(b[1] || '');
  });

  try { await saveSheet('bucket_list', S.data.bucket_list); }
  catch (e) { showToast('儲存失敗', 'err'); return; }
  closeModal();
  _refreshBucketViews();
  showToast(editId ? '已更新' : '已新增', 'ok');
}

function switchTab(tab) {
  $('tab-overview').style.display   = tab==='overview'   ? 'block' : 'none';
  $('tab-management').style.display = tab==='management' ? 'block' : 'none';
  $('tab-dwz').style.display        = tab==='dwz'        ? 'block' : 'none';
  document.querySelectorAll('.tab-btn').forEach((b,i) => {
    b.classList.toggle('active',
      (i===0&&tab==='overview')||(i===1&&tab==='management')||(i===2&&tab==='dwz'));
  });
  // Sidebar nav
  const sO = $('snav-overview'), sM = $('snav-management'), sD = $('snav-dwz');
  if (sO) sO.classList.toggle('active', tab === 'overview');
  if (sM) sM.classList.toggle('active', tab === 'management');
  if (sD) sD.classList.toggle('active', tab === 'dwz');
  if (tab === 'management') renderManagement();
  if (tab === 'dwz') initDWZ();
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

// TWD 格式（所有台幣現值、合計）— 億 / 萬 / 千分位三段
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n), sign = n < 0 ? '-' : '';
  if (abs >= 100000000) {
    return sign + (abs/100000000).toLocaleString('zh-TW', {minimumFractionDigits:2,maximumFractionDigits:2}) + '億';
  }
  if (abs >= 10000) {
    return sign + (abs/10000).toLocaleString('zh-TW', {minimumFractionDigits:1,maximumFractionDigits:1}) + '萬';
  }
  return sign + Math.round(abs).toLocaleString('zh-TW');
}

// 萬元簡略格式（沿用 fmt 同一份規則；保留別名讓既有呼叫不動）
function fmtWan(n) { return fmt(n); }

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

    // 啟動時補快照：若今日無快照（用戶昨晚未開 app 導致昨日斷點），立即寫入當日開盤基準
    // 若今日已有快照但與即時值明顯偏離（例：早盤存的舊值 vs 美股收盤後的新值），也 upsert 覆寫
    {
      const _today = getNowTW8().slice(0, 10);
      const _existing = S.data.daily_snapshots.find(s => s[0] === _today);
      if (!_existing) {
        doSaveDailySnapshot(true);
      } else {
        const { twT, usT, cryT } = calcTotals();
        const storedInvest = (parseFloat(_existing[2]) || 0) + (parseFloat(_existing[3]) || 0) + (parseFloat(_existing[4]) || 0);
        const liveInvest = twT + usT + cryT;
        // 差異 > 1 萬 TWD 視為需要同步（避免極小價格浮動頻繁寫入）
        if (Math.abs(liveInvest - storedInvest) > 10000) {
          console.log('[snapshot] Stale today snapshot detected, upserting', { storedInvest, liveInvest });
          doSaveDailySnapshot(true);
        }
      }
    }

    renderCharts();
    showToast('載入完成', 'ok');

    scheduleDailySnapshot();

    // Auto-refresh every 10 minutes（force=true 繞過快取，確保定時刷新）
    setInterval(async () => {
      await fetchAllPrices(true);
      renderKPIs(); renderCharts();
      if ($('tab-management').style.display !== 'none') renderManagement();
      // 每次刷新後同步更新今日快照（upsert），讓 reload 後資料仍一致
      try { await doSaveDailySnapshot(true); } catch(e) { console.warn('Auto snapshot update failed:', e); }
    }, 10 * 60 * 1000);

  } catch(e) {
    if (e.message !== 'auth') showToast('載入失敗：' + e.message, 'err');
    console.error('initApp:', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // 一次性遷移到乾淨主題系統（清除舊 Phase 遷移 flag）
  if (!localStorage.getItem('theme_clean_v1')) {
    // 沿用使用者既有偏好（如果有），否則預設 dark
    const prev = localStorage.getItem('theme');
    localStorage.setItem('theme', prev === 'light' ? 'light' : 'dark');
    localStorage.setItem('theme_clean_v1', '1');
  }
  // Restore saved theme（預設深色）
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;
  Chart.defaults.color = savedTheme === 'light' ? '#666666' : 'rgba(255,255,255,0.88)';
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
