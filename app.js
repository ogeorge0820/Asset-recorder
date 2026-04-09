// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════
// Build 時間：每次修改 code 後手動更新此時間（UTC+8 台北時間）
const BUILD_DATE = '2026/04/09 14:22';

const SPREADSHEET_ID = '1lpRpxVzWaYUqL-jVPOAJCtjsJUIedPYYyOx4gg4PPFU';
const CLIENT_ID = '149884248440-85f8dhc6ub9up10sv0f89e3e0itrnooj.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const PROXY = 'https://corsproxy.io/?';
const PROXY_BACKUP = 'https://api.allorigins.win/raw?url=';

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
  CRO:'crypto-com-chain', BGB:'bitget-token', IMX:'immutable-x', FET:'fetch-ai',
  TAO:'bittensor', USDT:'tether', USDC:'usd-coin', DAI:'dai',
};

const HEADERS = {
  snapshots: ['date','cash_total','stock_tw_total','stock_us_total','crypto_total','insurance_total','realestate_total','debt','net_assets'],
  daily_snapshots: ['date','cash_total','stock_tw_total','stock_us_total','crypto_total','insurance_total','realestate_total','debt','net_assets'],
  holdings_tw: ['symbol','shares'],
  holdings_us: ['symbol','shares'],
  holdings_crypto: ['symbol','quantity'],
  cash_accounts: ['bank_name','amount','currency'],
  settings: ['key','value'],
  crypto_rewards: ['date','symbol','quantity','price_usd','value_twd'],
  crypto_history: ['date','symbol','qty_before','qty_after','delta','price_usd','value_twd'],
  tw_history: ['date','symbol','qty_before','qty_after','delta','price_twd','value_twd'],
  us_history: ['date','symbol','qty_before','qty_after','delta','price_usd','value_twd'],
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
  const [cash, tw, us, crypto, snap, daily, sett, rw, hist, twHist, usHist] = await Promise.allSettled([
    sheetGet('cash_accounts!A:C'),
    sheetGet('holdings_tw!A:B'),
    sheetGet('holdings_us!A:B'),
    sheetGet('holdings_crypto!A:B'),
    sheetGet('snapshots!A:I'),
    sheetGet('daily_snapshots!A:I'),
    sheetGet('settings!A:B'),
    sheetGet('crypto_rewards!A:E'),
    sheetGet('crypto_history!A:G'),
    sheetGet('tw_history!A:G'),
    sheetGet('us_history!A:G'),
  ]);

  S.data.cash            = rows(cash);
  S.data.tw              = rows(tw);
  S.data.us              = rows(us);
  S.data.crypto          = rows(crypto);
  S.data.snapshots       = rows(snap);
  S.data.daily_snapshots = rows(daily);
  S.data.rewards         = rows(rw);
  S.data.crypto_history  = rows(hist);
  S.data.tw_history      = rows(twHist);
  S.data.us_history      = rows(usHist);

  S.data.settings = { insurance_total: 0, realestate_total: 0, debt: 0 };
  rows(sett).forEach(r => { if (r[0]) S.data.settings[r[0]] = parseFloat(r[1]) || 0; });
}

function rows(settled) {
  if (settled.status === 'rejected') return [];
  return (settled.value || []).slice(1).filter(r => r?.length && r[0] !== '');
}

async function saveSheet(name, dataRows) {
  const values = [HEADERS[name], ...dataRows.map(r => r.map(v => v ?? ''))];
  await sheetPut(`${name}!A1`, values);
}

// ══════════════════════════════════════════════════════════════
// PRICE FETCHING
// ══════════════════════════════════════════════════════════════
async function fetchAllPrices() {
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
  const ids = syms.map(s => COIN_MAP[s] || s.toLowerCase());
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
    const r = await proxyFetch(url);
    const d = await r.json();
    syms.forEach((sym, i) => {
      const id = ids[i];
      if (d[id]?.usd) { S.prices.crypto[sym] = d[id].usd; delete S.prices.errs[`c_${sym}`]; }
      else S.prices.errs[`c_${sym}`] = true;
    });
  } catch (e) {
    syms.forEach(s => { S.prices.errs[`c_${s}`] = true; });
    console.warn('Crypto:', e.message);
  }
}

async function validateCoinGecko(symbol) {
  const id = COIN_MAP[symbol.toUpperCase()];
  if (id) return id;
  try {
    const r = await proxyFetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`);
    const d = await r.json();
    const coin = (d.coins || []).find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
    if (coin) { COIN_MAP[symbol.toUpperCase()] = coin.id; return coin.id; }
    return null;
  } catch { return null; }
}

function setPriceStatus(state) {
  // Management page bar
  const dot = $('price-dot'), ts = $('price-ts'), fail = $('price-fail-lbl');
  if (dot) dot.className = `dot ${state}`;
  // Header badge
  const hdrDot = $('update-dot'), hdrTs = $('update-ts');

  if (state === 'spin') {
    if (ts) ts.textContent = '價格更新中...';
    if (fail) fail.textContent = '';
    if (hdrDot) hdrDot.className = 'update-dot spin';
    if (hdrTs)  hdrTs.textContent = '更新中…';
  } else {
    const t = S.lastUpdate
      ? S.lastUpdate.toLocaleTimeString('zh-TW', {hour:'2-digit', minute:'2-digit'})
      : '—';
    if (ts) ts.textContent = `最後更新：${t}`;
    if (state === 'err') {
      if (fail) fail.innerHTML = '<span style="color:var(--red)">⚠ 部分價格更新失敗</span>';
      if (hdrDot) hdrDot.className = 'update-dot err';
    } else {
      if (fail) fail.textContent = '';
      if (hdrDot) hdrDot.className = 'update-dot ok';
    }
    if (hdrTs) hdrTs.textContent = `${t} 更新`;
  }
}

// ══════════════════════════════════════════════════════════════
// CALCULATIONS
// ══════════════════════════════════════════════════════════════
function calcTotals() {
  const rate = S.prices.usdtwd;
  const cashT = S.data.cash.reduce((s, r) => s + cashToTWD(r), 0);
  const twT   = S.data.tw.reduce((s, r) => s + (parseFloat(r[1]) || 0) * (S.prices.tw[r[0]] || 0), 0);
  const usT   = S.data.us.reduce((s, r) => s + (parseFloat(r[1]) || 0) * (S.prices.us[r[0]] || 0) * rate, 0);
  const cryT  = S.data.crypto.reduce((s, r) => s + (parseFloat(r[1]) || 0) * (S.prices.crypto[r[0]?.toUpperCase()] || 0) * rate, 0);
  const ins   = (S.data.settings.insurance_total || 0) * rate;  // stored in USD
  const re    = S.data.settings.realestate_total || 0;
  const debt  = S.data.settings.debt || 0;
  const total  = cashT + twT + usT + cryT + ins + re;
  const net    = total - debt;
  const liquid = total - re;
  return { cashT, twT, usT, cryT, ins, re, debt, total, net, liquid };
}

// ══════════════════════════════════════════════════════════════
// RENDER — KPIs
// ══════════════════════════════════════════════════════════════
function renderKPIs() {
  const { total, net, liquid } = calcTotals();
  const snaps = S.data.snapshots;

  setKPI('kv-total', fmt(total), 'ks-total', '');
  setKPI('kv-net', fmt(net), 'ks-net', '');
  setKPI('kv-liquid', fmt(liquid), 'ks-liquid', '總資產 − 房地產');

  if (snaps.length > 0) {
    const last = snaps[snaps.length - 1];
    const lastNet = parseFloat(last[7]) || 0;
    const diff = net - lastNet;
    const el = $('kv-monthly');
    el.textContent = (diff >= 0 ? '+' : '') + fmt(diff);
    el.className = `kpi-value ${diff >= 0 ? 'pos' : 'neg'}`;
    const card = $('card-monthly');
    if (card) card.className = `kpi-card ${diff >= 0 ? 'kpi-gain' : 'kpi-loss'}`;

    const first = snaps[0];
    const firstNet = parseFloat(first[7]) || 0;
    if (firstNet > 0) {
      const g = ((net - firstNet) / firstNet * 100);
      const ge = $('kv-growth');
      ge.textContent = (g >= 0 ? '+' : '') + g.toFixed(1) + '%';
      ge.className = `kpi-value ${g >= 0 ? 'pos' : 'neg'}`;
    } else {
      setKPI('kv-growth', '—', 'ks-growth', '尚無有效快照');
    }
  } else {
    setKPI('kv-monthly', '—', 'ks-monthly', '尚無快照');
    setKPI('kv-growth', '—', 'ks-growth', '尚無快照');
    const card = $('card-monthly');
    if (card) card.className = 'kpi-card';
  }

  const re = $('kv-rate');
  re.textContent = S.prices.usdtwd.toFixed(2);
  re.className = 'kpi-value';
  $('ks-rate').innerHTML = S.prices.errs.usdtwd
    ? 'USD/TWD <span class="price-err">更新失敗</span>'
    : 'USD/TWD';

  const buildBadge = $('build-badge');
  if (buildBadge) buildBadge.textContent = `版本 ${BUILD_DATE}`;

  const snapLast = $('last-snap-date');
  if (snapLast) {
    const snaps = S.data.snapshots;
    snapLast.textContent = snaps.length > 0
      ? `上次快照：${snaps[snaps.length - 1][0]}`
      : '尚未儲存任何快照';
  }
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
  renderCash(); renderTW(); renderUS(); renderCrypto(); renderRewards();
  $('inp-insurance').value   = S.data.settings.insurance_total || 0;
  $('inp-realestate').value  = S.data.settings.realestate_total || 0;
  $('inp-debt').value        = S.data.settings.debt || 0;
  updateInsTWD();
}

function renderCash() {
  const rows = S.data.cash;
  $('cnt-cash').textContent = rows.length;
  const sorted = rows.map((r,i) => ({r,i})).sort((a,b) => cashToTWD(b.r) - cashToTWD(a.r));
  $('tb-cash').innerHTML = sorted.length ? sorted.map(({r, i}) => {
    const ccy = (r[2] || 'TWD').toUpperCase();
    const amt = parseFloat(r[1]) || 0;
    const twd = cashToTWD(r);
    const isTWD = ccy === 'TWD';
    const errKey = `fx_${ccy}`;
    const hasErr = !isTWD && S.prices.errs[errKey];
    return `<tr>
      <td data-label="帳戶">${esc(r[0])}</td>
      <td data-label="幣別"><span class="sym-tag" style="font-size:0.78rem;color:var(--accent-light)">${esc(ccy)}</span></td>
      <td data-label="金額" class="amt">${fmtCashAmt(amt, ccy)}</td>
      <td data-label="台幣現值" class="amt">${fmt(twd)}${hasErr ? '<span class="price-err">匯率失敗</span>' : ''}</td>
      <td><button class="btn-icon edit" onclick="editItem('cash',${i})">✏</button><button class="btn-icon del" onclick="deleteItem('cash',${i})">✕</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted)">尚無帳戶</td></tr>';
  $('tot-cash').textContent = fmt(rows.reduce((s, r) => s + cashToTWD(r), 0));
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
      return `<tr>
        <td data-label="代號"><span class="sym-tag">${esc(r[0])}</span></td>
        <td data-label="股數">${(parseFloat(r[1]) || 0).toLocaleString()}</td>
        <td data-label="股價 (TWD)" class="amt">${priceCell}</td>
        <td data-label="現值 (TWD)" class="amt">${v !== null ? fmt(v) : skelSpan()}${err ? '<span class="price-err">更新失敗</span>' : ''}</td>
        <td><button class="btn-icon edit" onclick="editItem('tw',${i})">✏</button><button class="btn-icon del" onclick="deleteItem('tw',${i})">✕</button></td>
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
        <div class="asset-card-left">
          <div class="asset-card-sym">${esc(sym)}</div>
          <div class="asset-card-pct">${pctStr}</div>
        </div>
        <div class="asset-card-mid">
          <div class="asset-card-twd">${twdStr}</div>
          <div class="asset-card-detail">${detailStr}</div>
        </div>
      </div>`;
    }).join('');
  }

  $('tot-tw').textContent = fmt(totalTWTWD);
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
      return `<tr>
        <td data-label="代號"><span class="sym-tag">${esc(r[0])}</span></td>
        <td data-label="股數">${(parseFloat(r[1]) || 0).toLocaleString(undefined, {maximumFractionDigits:4})}</td>
        <td data-label="股價 (USD)" class="amt">${priceCell}</td>
        <td data-label="現值 (TWD)" class="amt">${v !== null ? fmt(v) : skelSpan()}${err ? '<span class="price-err">更新失敗</span>' : ''}</td>
        <td><button class="btn-icon edit" onclick="editItem('us',${i})">✏</button><button class="btn-icon del" onclick="deleteItem('us',${i})">✕</button></td>
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
        <div class="asset-card-left">
          <div class="asset-card-sym">${esc(sym)}</div>
          <div class="asset-card-pct">${pctStr}</div>
        </div>
        <div class="asset-card-mid">
          <div class="asset-card-twd">${twdStr}</div>
          <div class="asset-card-detail">${detailStr}</div>
        </div>
      </div>`;
    }).join('');
  }

  $('tot-us').textContent = fmt(totalUSTWD);
}

function renderCrypto() {
  const rows = S.data.crypto, rate = S.prices.usdtwd;
  $('cnt-crypto').textContent = rows.length;
  const sorted = rows.map((r,i) => ({r,i})).sort((a,b) => {
    const val = r => (parseFloat(r[1])||0) * (S.prices.crypto[r[0]?.toUpperCase()]||0) * rate;
    return val(b.r) - val(a.r);
  });

  // 計算總值（用於百分比）
  const totalCryptoTWD = rows.reduce((s, r) => {
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
      return `<tr>
        <td data-label="代號"><span class="sym-tag">${esc(sym)}</span></td>
        <td data-label="數量">${qty.toFixed(2)}</td>
        <td data-label="幣價 (USD)" class="amt">${priceCell}</td>
        <td data-label="現值 (TWD)" class="amt">${v !== null ? fmt(v) : skelSpan()}${err ? '<span class="price-err">更新失敗</span>' : ''}</td>
        <td><button class="btn-icon edit" onclick="editItem('crypto',${i})">✏</button><button class="btn-icon del" onclick="deleteItem('crypto',${i})">✕</button></td>
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
        ? `持有 ${qty.toFixed(2)}`
        : `持有 ${qty.toFixed(2)} · ${p !== undefined ? fmtFloor3(p) : '—'}`;
      return `<div class="asset-card${err ? ' err' : ''}" onclick="openAssetDetail('crypto',${i})" role="button" tabindex="0">
        <div class="asset-card-left">
          <div class="asset-card-sym">${esc(sym)}</div>
          <div class="asset-card-pct">${pctStr}</div>
        </div>
        <div class="asset-card-mid">
          <div class="asset-card-twd">${twdStr}</div>
          <div class="asset-card-detail">${detailStr}</div>
        </div>
      </div>`;
    }).join('');
  }

  const tot = rows.reduce((s, r) => s + (parseFloat(r[1]) || 0) * (S.prices.crypto[r[0]?.toUpperCase()] || 0) * rate, 0);
  $('tot-crypto').textContent = fmt(tot);
}

// ── 質押/活存收益記錄 ──────────────────────────────────────────
function renderRewards() {
  const rw = S.data.rewards;
  if ($('cnt-rewards')) $('cnt-rewards').textContent = rw.length;

  const now = new Date();
  const curMonth = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}`;

  $('tb-rewards').innerHTML = rw.length ? rw.map((r, i) => `<tr>
    <td data-label="月份">${esc(r[0])}</td>
    <td data-label="幣種"><span class="sym-tag">${esc(r[1])}</span></td>
    <td data-label="增加數量" class="amt">${(parseFloat(r[2])||0).toFixed(2)}</td>
    <td data-label="幣價 (USD)" class="amt">${fmtUSD(parseFloat(r[3]))}</td>
    <td data-label="收益 (TWD)" class="amt">${fmt(parseFloat(r[4]))}</td>
    <td><button class="btn-icon edit" onclick="editReward(${i})">✏</button><button class="btn-icon del" onclick="deleteReward(${i})">✕</button></td>
  </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--muted)">尚無收益記錄</td></tr>';

  const monthTot = rw.filter(r => r[0] === curMonth).reduce((s, r) => s + (parseFloat(r[4])||0), 0);
  if ($('tot-rewards-month')) $('tot-rewards-month').textContent = monthTot > 0 ? fmt(monthTot) : '—';
}

function rewardSyncPrice() {
  const sym = $('mf-symbol')?.value?.toUpperCase();
  if (sym && S.prices.crypto[sym] !== undefined) {
    $('mf-price_usd').value = S.prices.crypto[sym];
  }
  rewardSyncValue();
}

function rewardSyncValue() {
  const qty = parseFloat($('mf-quantity')?.value) || 0;
  const price = parseFloat($('mf-price_usd')?.value) || 0;
  const twd = qty * price * S.prices.usdtwd;
  const el = $('mf-value_twd');
  if (el) el.value = twd > 0 ? fmt(twd) : '';
}

function openRewardModal(title, defaults, onSave) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const symOptions = [...new Set(S.data.crypto.map(r => r[0]?.toUpperCase()).filter(Boolean))];
  const sel = defaults.symbol || symOptions[0] || '';
  const priceDefault = defaults.price_usd !== undefined ? defaults.price_usd : (S.prices.crypto[sel] ?? '');
  const monthVal = defaults.date ? defaults.date.replace('/', '-') : defaultMonth;

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
      <div class="field"><label>增加數量</label>
        <input id="mf-quantity" type="number" step="any" min="0" value="${esc(String(defaults.quantity??''))}" placeholder="0" oninput="rewardSyncValue()">
      </div>
      <div class="field"><label>當時幣價 (USD)</label>
        <input id="mf-price_usd" type="number" step="any" min="0" value="${esc(String(priceDefault))}" placeholder="0" oninput="rewardSyncValue()">
      </div>
      <div class="field"><label>收益價值 (TWD)　<small style="color:var(--muted)">(自動計算)</small></label>
        <input id="mf-value_twd" type="text" readonly value="${esc(defaults.value_twd??'')}" placeholder="—">
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
    const price = parseFloat($('mf-price_usd')?.value) || 0;

    if (!rawMonth || !sym || qty <= 0) {
      showToast('請填寫月份、幣種與數量', 'err'); return;
    }
    const date = rawMonth.replace('-', '/');  // YYYY-MM → YYYY/MM
    const valueTWD = qty * price * S.prices.usdtwd;

    btnLoading(btn);
    try {
      await onSave(date, sym, qty, price, valueTWD);
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
  openRewardModal('新增收益記錄', {}, async (date, sym, qty, price, twd) => {
    S.data.rewards.push([date, sym, qty, price, Math.round(twd)]);
    S.data.rewards.sort((a, b) => b[0].localeCompare(a[0]));
    await saveSheet('crypto_rewards', S.data.rewards);
    renderRewards(); renderRewardsSummary();
    showToast('收益記錄已新增', 'ok');
  });
}

function editReward(idx) {
  const r = S.data.rewards[idx];
  openRewardModal('編輯收益記錄', { date: r[0], symbol: r[1], quantity: r[2], price_usd: r[3], value_twd: fmt(parseFloat(r[4])) }, async (date, sym, qty, price, twd) => {
    S.data.rewards[idx] = [date, sym, qty, price, Math.round(twd)];
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

  // group by symbol
  const grouped = {};
  monthRw.forEach(r => {
    const sym = r[1];
    if (!grouped[sym]) grouped[sym] = { qty: 0, twd: 0 };
    grouped[sym].qty += parseFloat(r[2]) || 0;
    grouped[sym].twd += parseFloat(r[4]) || 0;
  });

  el.innerHTML = `<table class="data-table" style="margin-top:4px">
    <thead><tr>
      <th>幣種</th>
      <th style="text-align:right">本月增量</th>
      <th style="text-align:right">收益價值 (TWD)</th>
    </tr></thead>
    <tbody>
      ${Object.entries(grouped).map(([sym, v]) => `<tr>
        <td><span class="sym-tag">${esc(sym)}</span></td>
        <td class="amt">${v.qty.toLocaleString(undefined,{maximumFractionDigits:8})}</td>
        <td class="amt">${fmt(v.twd)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
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
    grid:        light ? 'rgba(0,0,0,.06)'    : 'rgba(255,255,255,.04)',
    tick:        light ? '#8c7055'             : '#64748b',
    legend:      light ? '#8c7055'             : '#94a3b8',
    center_text: light ? '#2c1e12'             : '#e2e8f0',
    center_sub:  light ? '#8c7055'             : '#94a3b8',
    nodata:      light ? '#8c7055'             : '#475569',
    border:      light ? '#ffffff'             : '#1a1d2e',
  };
}

// Tooltip Positioner: 永遠出現在扇形外緣，不遮住中心文字
Chart.Tooltip.positioners.doughnutOutside = function(elements) {
  if (!elements.length) return false;
  const arc = elements[0].element;
  const midAngle = (arc.startAngle + arc.endAngle) / 2;
  // 外緣再加 24px 偏移，確保不與圓環重疊
  const r = arc.outerRadius + 24;
  return {
    x: arc.x + Math.cos(midAngle) * r,
    y: arc.y + Math.sin(midAngle) * r,
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
    ctx.fillStyle = cc.center_text;
    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(opts.text, cx, cy - 12);
    ctx.fillStyle = cc.center_sub;
    ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(opts.sub || '', cx, cy + 14);
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
  if (!snaps.length) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (nodata) nodata.style.display = 'flex';
    return;
  }
  if (nodata) nodata.style.display = 'none';

  // Show last 90 days max for readability
  const recent = snaps.slice(-90);

  const cc = chartColors();
  S.charts.dailyTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: recent.map(s => s[0]),
      datasets: [
        { label:'總資產', data: recent.map(s => [1,2,3,4,5,6].reduce((a,i)=>a+(parseFloat(s[i])||0), 0)),
          borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.08)', fill:true, tension:.3, pointRadius:2, borderWidth:2 },
        { label:'淨資產', data: recent.map(s => parseFloat(s[8])||0),
          borderColor:'#22c55e', backgroundColor:'transparent', borderDash:[4,3], tension:.3, pointRadius:2, borderWidth:2 },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { labels:{ color:cc.legend, font:{size:11}, usePointStyle:true } },
        tooltip: { callbacks: { label(c) { return ` ${c.dataset.label}: ${fmt(c.parsed.y)}`; } } },
      },
      scales: {
        x: { grid:{ color:cc.grid }, ticks:{ color:cc.tick, font:{size:9}, maxTicksLimit:10 } },
        y: { grid:{ color:cc.grid }, ticks:{ color:cc.tick, font:{size:10}, callback:v=>fmt(v) } },
      },
    },
  });
}

function renderPie() {
  const { cashT, twT, usT, cryT, ins, re, total } = calcTotals();
  const entries = [
    { label:'流動現金', value:cashT, color:'#22c55e' },
    { label:'台股',     value:twT,   color:'#6366f1' },
    { label:'美股',     value:usT,   color:'#3b82f6' },
    { label:'加密貨幣', value:cryT,  color:'#f59e0b' },
    { label:'儲蓄險',   value:ins,   color:'#ec4899' },
    { label:'房地產',   value:re,    color:'#14b8a6' },
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
          // 手機：底部橫排，字體縮小，itemGap 拉開
          ? {
              position: 'bottom',
              labels: {
                color: cc.legend,
                padding: 10,
                font: { size: 11 },
                boxWidth: 10,
                usePointStyle: true,
              },
            }
          // 桌面：右側垂直排列，每項清晰對齊
          : {
              position: 'right',
              align: 'center',
              labels: {
                color: cc.legend,
                padding: 18,
                font: { size: 13 },
                boxWidth: 12,
                usePointStyle: true,
              },
            },
        tooltip: {
          // 自訂 positioner：tooltip 永遠出現在扇形外緣，不蓋住中心數值
          position: 'doughnutOutside',
          callbacks: { label(c) {
            const tot = c.dataset.data.reduce((a,b)=>a+b,0);
            return ` ${c.label}: ${fmt(c.parsed)} (${(c.parsed/tot*100).toFixed(1)}%)`;
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

  const cc = chartColors();
  S.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: snaps.map(s => s[0]),
      datasets: [
        { label:'總資產', data: snaps.map(s => [1,2,3,4,5].reduce((a,i)=>a+(parseFloat(s[i])||0), 0)),
          borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.1)', fill:true, tension:.3, pointRadius:3 },
        { label:'淨資產', data: snaps.map(s => parseFloat(s[7])||0),
          borderColor:'#22c55e', backgroundColor:'transparent', borderDash:[5,3], tension:.3, pointRadius:3 },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend: { labels:{ color:cc.legend, font:{size:11}, usePointStyle:true } },
        tooltip: { callbacks: { label(c) { return ` ${c.dataset.label}: ${fmt(c.parsed.y)}`; } } },
      },
      scales: {
        x: { grid:{ color:cc.grid }, ticks:{ color:cc.tick, font:{size:10} } },
        y: { grid:{ color:cc.grid }, ticks:{ color:cc.tick, font:{size:10}, callback:v=>fmt(v) } },
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
    vals.push((parseFloat(snaps[i][7])||0) - (parseFloat(snaps[i-1][7])||0));
  }

  S.charts.monthly = new Chart(ctx, {
    type:'bar',
    data: {
      labels,
      datasets: [{
        label:'月收益', data:vals,
        backgroundColor: vals.map(v=>v>=0?'rgba(34,197,94,.65)':'rgba(239,68,68,.65)'),
        borderColor: vals.map(v=>v>=0?'#22c55e':'#ef4444'),
        borderWidth:1, borderRadius:4,
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{display:false},
        tooltip:{ callbacks:{ label(c){ return ` ${c.parsed.y>=0?'+':''}${fmt(c.parsed.y)}`; } } },
      },
      scales: {
        x:{ grid:{color:cc.grid}, ticks:{color:cc.tick,font:{size:10}} },
        y:{ grid:{color:cc.grid}, ticks:{color:cc.tick,font:{size:10},callback:v=>fmt(v)} },
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
      S.data.cash[idx] = [vals.bank_name, parseFloat(vals.amount)||0, vals.currency||'TWD'];
      await persistAndRefresh(type);
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
    showToast('已更新', 'ok');
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

async function saveSettings(btn) {
  if (btn) btnLoading(btn);
  try {
    S.data.settings.insurance_total  = parseFloat($('inp-insurance').value)  || 0;
    S.data.settings.realestate_total = parseFloat($('inp-realestate').value) || 0;
    S.data.settings.debt             = parseFloat($('inp-debt').value)        || 0;
    const rows = Object.entries(S.data.settings).map(([k,v])=>[k,v]);
    await saveSheet('settings', rows);
    renderKPIs(); renderCharts();
    if (btn) btnDone(btn);
    showToast('設定已儲存', 'ok');
  } catch(e) {
    if (btn) btnReset(btn);
    showToast('儲存失敗：' + e.message, 'err');
  }
}

// ══════════════════════════════════════════════════════════════
// SNAPSHOT
// ══════════════════════════════════════════════════════════════
function confirmSnapshot() {
  const now = new Date();
  const ms = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}`;
  openConfirm('儲存快照', `儲存 ${ms} 快照？\n（同月份資料將被覆蓋）`, doSaveSnapshot);
}

async function doSaveSnapshot() {
  const snapBtn = $('btn-snapshot');
  if (snapBtn) btnLoading(snapBtn, '儲存中…');
  try {
    const { cashT, twT, usT, cryT, ins, re, debt, net } = calcTotals();
    const now = new Date();
    const ds = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}`;
    const row = [ds, cashT.toFixed(0), twT.toFixed(0), usT.toFixed(0), cryT.toFixed(0), ins.toFixed(0), re.toFixed(0), debt.toFixed(0), net.toFixed(0)];
    const idx = S.data.snapshots.findIndex(s => s[0] === ds);
    if (idx >= 0) S.data.snapshots[idx] = row;
    else { S.data.snapshots.push(row); S.data.snapshots.sort((a,b) => a[0].localeCompare(b[0])); }
    await saveSheet('snapshots', S.data.snapshots);
    renderKPIs(); renderCharts();
    if (snapBtn) btnDone(snapBtn, '✓ 已儲存');
    showToast(`${ds} 快照已儲存`, 'ok');
  } catch(e) {
    if (snapBtn) btnReset(snapBtn);
    showToast('快照儲存失敗：' + e.message, 'err');
  }
}

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
      if (!v && f.type !== 'number' && f.type !== 'select') { el.classList.add('invalid'); ok = false; }
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

// 通用歷史寫入（支援 crypto / tw / us）
async function appendHistory(type, sym, qtyBefore, qtyAfter) {
  const delta = qtyAfter - qtyBefore;
  let price = '', valueTwd = '';
  if (type === 'crypto') {
    const p = S.prices.crypto[sym];
    price = p !== undefined ? p : '';
    valueTwd = p !== undefined ? delta * p * S.prices.usdtwd : '';
  } else if (type === 'tw') {
    const p = S.prices.tw[sym];
    price = p !== undefined ? p : '';
    valueTwd = p !== undefined ? delta * p : '';
  } else if (type === 'us') {
    const p = S.prices.us[sym];
    price = p !== undefined ? p : '';
    valueTwd = p !== undefined ? delta * p * S.prices.usdtwd : '';
  }
  const histKey = `${type}_history`;
  const row = [getNowTW8(), sym, qtyBefore, qtyAfter, delta, price, valueTwd];
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
  const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
  const r = dataMap[type]?.[idx];
  if (!r) return;

  const qty = parseFloat(r[1]) || 0;
  let valueTwd = null, subText = '';

  if (type === 'crypto') {
    const p = S.prices.crypto[sym];
    valueTwd = p !== undefined ? qty * p * S.prices.usdtwd : null;
    subText = `持有 ${qty.toFixed(4)} ${sym}　·　${p !== undefined ? fmtUSD(p, 4) : '—'}`;
  } else if (type === 'tw') {
    const p = S.prices.tw[sym];
    valueTwd = p !== undefined ? qty * p : null;
    subText = `持有 ${qty.toLocaleString()} 股　·　${p !== undefined ? p.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' TWD' : '—'}`;
  } else if (type === 'us') {
    const p = S.prices.us[sym];
    valueTwd = p !== undefined ? qty * p * S.prices.usdtwd : null;
    subText = `持有 ${qty.toLocaleString(undefined,{maximumFractionDigits:4})} 股　·　${p !== undefined ? fmtUSD(p) + ' USD' : '—'}`;
  }

  $('cp-value').textContent = valueTwd !== null ? fmt(valueTwd) + ' TWD' : '—';
  $('cp-value-sub').textContent = subText;
  renderHistoryInPanel(type, sym);
}

// 通用：開啟 panel
function openAssetDetail(type, idx) {
  _panelAssetType = type;
  _panelIdx = idx;
  const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
  const r = dataMap[type][idx];
  const sym = r[0]?.toUpperCase();
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

// 通用歷史記錄渲染
function renderHistoryInPanel(type, sym) {
  const histKey = `${type}_history`;
  const hist = (S.data[histKey] || []).filter(r => r[1] === sym);
  hist.sort((a, b) => b[0] > a[0] ? 1 : -1);

  if (!hist.length) {
    $('cp-history').innerHTML = '<div class="cp-history-empty">尚無變動記錄</div>';
    return;
  }

  $('cp-history').innerHTML = hist.map(r => {
    const delta = parseFloat(r[4]);
    const isPos = delta >= 0;
    const isCrypto = type === 'crypto';
    const deltaStr = (isPos ? '+' : '') + (isCrypto ? delta.toFixed(4) : delta.toLocaleString(undefined,{maximumFractionDigits:4}));
    const qtyAfter = parseFloat(r[3]);
    const qtyStr = isCrypto ? qtyAfter.toFixed(4) : qtyAfter.toLocaleString();
    let priceStr = '—';
    if (r[5] !== '') {
      const p = parseFloat(r[5]);
      priceStr = type === 'tw'
        ? p.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' TWD'
        : fmtUSD(p, isCrypto ? 4 : 2);
    }
    return `<div class="cp-history-item">
      <span class="cp-history-date">${esc(r[0])}</span>
      <span class="cp-history-delta ${isPos ? 'pos' : 'neg'}">${deltaStr}</span>
      <span class="cp-history-qty">→ ${qtyStr}</span>
      <span class="cp-history-price">${priceStr}</span>
    </div>`;
  }).join('');
}

// 向下相容
function renderCryptoHistory(sym) { renderHistoryInPanel('crypto', sym); }

// 通用：增減數量
async function adjustAssetQty() {
  if (_panelIdx === null) return;
  const type = _panelAssetType;
  const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
  const r = dataMap[type][_panelIdx];
  const sym = r[0]?.toUpperCase();
  const qtyBefore = parseFloat(r[1]) || 0;
  const unit = type === 'crypto' ? '' : '股';
  openModal(`增減數量 · ${sym}`, [
    { id: 'delta', label: `變動${unit ? unit : '數量'}（正為增加，負為減少）`, type: 'number', step: 'any', ph: unit ? '例如 100 或 -50' : '例如 0.5 或 -0.1' }
  ], async vals => {
    const delta = parseFloat(vals.delta);
    if (isNaN(delta) || delta === 0) { showToast('請輸入有效的變動數量', 'err'); return false; }
    const qtyAfter = qtyBefore + delta;
    if (qtyAfter < 0) { showToast('數量不能小於 0', 'err'); return false; }
    dataMap[type][_panelIdx] = [sym, qtyAfter];
    const sheetMap = { crypto:'holdings_crypto', tw:'holdings_tw', us:'holdings_us' };
    await saveSheet(sheetMap[type], dataMap[type]);
    await appendHistory(type, sym, qtyBefore, qtyAfter);
    renderKPIs(); renderCharts(); renderManagement();
    _refreshPanelDisplay(sym);
    showToast('已更新', 'ok');
    return true;
  });
}

// 向下相容
async function adjustCryptoQty() { return adjustAssetQty(); }

// 通用：設定餘額
async function setAssetQty() {
  if (_panelIdx === null) return;
  const type = _panelAssetType;
  const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
  const r = dataMap[type][_panelIdx];
  const sym = r[0]?.toUpperCase();
  const qtyBefore = parseFloat(r[1]) || 0;
  openModal(`設定餘額 · ${sym}`, [
    { id: 'quantity', label: type === 'crypto' ? '新數量' : '新股數', type: 'number', val: r[1], min: 0, step: 'any' }
  ], async vals => {
    const qtyAfter = parseFloat(vals.quantity);
    if (isNaN(qtyAfter) || qtyAfter < 0) { showToast('請輸入有效數量', 'err'); return false; }
    dataMap[type][_panelIdx] = [sym, qtyAfter];
    const sheetMap = { crypto:'holdings_crypto', tw:'holdings_tw', us:'holdings_us' };
    await saveSheet(sheetMap[type], dataMap[type]);
    await appendHistory(type, sym, qtyBefore, qtyAfter);
    renderKPIs(); renderCharts(); renderManagement();
    _refreshPanelDisplay(sym);
    showToast('已更新', 'ok');
    return true;
  });
}

// 向下相容
async function setCryptoQty() { return setAssetQty(); }

// 通用：從 panel 刪除
function deleteAssetFromPanel() {
  if (_panelIdx === null) return;
  const type = _panelAssetType;
  const dataMap = { crypto: S.data.crypto, tw: S.data.tw, us: S.data.us };
  const sym = dataMap[type][_panelIdx]?.[0]?.toUpperCase();
  const sheetMap = { crypto:'holdings_crypto', tw:'holdings_tw', us:'holdings_us' };
  openConfirm('刪除 ' + sym, `確定要從持倉中移除 ${sym} 嗎？`, async () => {
    dataMap[type].splice(_panelIdx, 1);
    await saveSheet(sheetMap[type], dataMap[type]);
    renderKPIs(); renderCharts(); renderManagement();
    closeAssetDetail();
    showToast('已刪除 ' + sym, 'ok');
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
  const el = $('mobile-build-bar');
  if (el) el.textContent = `版本 ${BUILD_DATE}`;
}

function updateThemeBtn() {
  const btn = $('btn-theme');
  if (!btn) return;
  const isLight = document.documentElement.dataset.theme === 'light';
  btn.textContent = isLight ? '🌙' : '☀';
  btn.title = isLight ? '切換為深色模式' : '切換為淺色模式';
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
  if (tab === 'management') renderManagement();
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

function updateInsTWD() {
  const usd = parseFloat($('inp-insurance')?.value) || 0;
  const el = $('ins-twd');
  if (!el) return;
  el.textContent = usd > 0 ? `≈ TWD ${fmt(usd * S.prices.usdtwd)}` : '';
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

    showToast('抓取即時價格…');
    await fetchAllPrices();

    renderKPIs();
    renderCharts();
    showToast('載入完成', 'ok');

    scheduleDailySnapshot();

    // Auto-refresh every 5 minutes
    setInterval(async () => {
      await fetchAllPrices();
      renderKPIs(); renderCharts();
      if ($('tab-management').style.display !== 'none') renderManagement();
    }, 5 * 60 * 1000);

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
