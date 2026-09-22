// 僅供隔離伺服器載入，正式 index 不引用此檔。
S.initialized = true;
S.data.cash = [['示意台幣帳戶', 2400000, 'TWD'], ['示意美元帳戶', 15000, 'USD']];
S.data.tw = [['2330', 3000], ['0050', 10000]];
S.prices.tw = {'2330': 1000, '0050': 180};
S.data.us = [['AAPL', 100], ['MSFT', 375]];
S.prices.us = {AAPL: 250, MSFT: 250};
S.data.crypto = [['USDT', 10000], ['BTC', .04], ['ETH', 6.7], ['FET', 2000]];
S.prices.crypto = {USDT: 1, BTC: 100000, ETH: 3000, FET: 0.5};
S.data.settings = {insurance_total: 6250, realestate_total: 9500000, debt: 3500000};
S.data.expense_budget = [['固定', '示意生活費', 33300, '現金', '', 'demo-budget']];
const fixtureToday = new Date();
const fxY = fixtureToday.getFullYear(), fxM = String(fixtureToday.getMonth() + 1).padStart(2, '0');
S.data.rewards = [
  [`${fxY}/${fxM}`, 'ETH', 0.05, 3000, 4800, 'staking', '示意質押收益'],
  [`${fxY}/${fxM}`, 'USDT', 143.75, 1, 4600, 'interest', '示意美元活存利息'],
];
S.data.income_records = [
  ['demo-inc-1', '示意薪資', '薪資', 90000, `${fxY}-${fxM}-25`, '0', '', '', '示意公司'],
  ['demo-inc-2', '示意接案尾款', '接案', 25000, `${fxY + 1}-01-15`, '0', '', '', ''],
];
S.data.bucket_list = [
  ['demo-bk-1', '示意北歐極光之旅', '旅遊', 45, 20, '規劃中', `${fxY + 1}/02`, '', ''],
  ['demo-bk-2', '示意夏季家族露營', '家人', 43, 6, '規劃中', `${fxY + 1}/07`, '', ''],
];
for (let i = 17; i >= 0; i--) {
  const date = new Date(fixtureToday.getFullYear(), fixtureToday.getMonth() - i, 1);
  const key = `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}`;
  S.data.snapshots.push([key,2880000,4800000-i*45000,3800000-i*28000,1120000,200000,9500000,3500000,18800000-i*73000]);
}
for (let i = 29; i >= 0; i--) {
  const date = new Date(fixtureToday.getFullYear(), fixtureToday.getMonth(), fixtureToday.getDate()-i);
  const key = `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;
  S.data.daily_snapshots.push([key,2880000,4800000-i*5000,3800000-i*2000,1120000,200000,9500000,3500000,18800000-i*7000,JSON.stringify({tw:{'2330':1000-i,'0050':180},us:{AAPL:250-i/3,MSFT:250},crypto:{BTC:100000-i*10,ETH:3000,USDT:1},usdtwd:32})]);
}
// 僅替換 API 邊界，讓原本 saveSheet 防線與寫入格式完整執行。
const fixtureSheets = {};
const fixtureSheetMap = {cash_accounts:'cash',holdings_tw:'tw',holdings_us:'us',holdings_crypto:'crypto',snapshots:'snapshots',daily_snapshots:'daily_snapshots',expense_budget:'expense_budget',cash_history:'cash_history',tw_history:'tw_history',us_history:'us_history',crypto_history:'crypto_history',other_history:'other_history',income_records:'income_records',expense_planned:'expense_planned',experience_plan:'experience_plan',bucket_list:'bucket_list',staking_rewards:'rewards'};
for (const [name, headers] of Object.entries(HEADERS)) {
  fixtureSheets[name] = [headers, ...(S.data[fixtureSheetMap[name]] || [])].map(row => [...row]);
}
const fixtureWrites = [];
api = async (method, path, body) => {
  if (!path.startsWith('/values/')) throw new Error('隔離測試不支援此 API');
  const range = decodeURIComponent(path.slice('/values/'.length).split('?')[0].replace(/:clear$/, ''));
  const name = range.split('!')[0];
  if (!(name in fixtureSheets)) throw new Error('隔離測試未設定資料表：' + name);
  if (method === 'GET') return {values: fixtureSheets[name].map(row => [...row])};
  if (method === 'POST' && path.endsWith(':clear')) fixtureSheets[name] = [];
  else if (method === 'PUT') fixtureSheets[name] = body.values.map(row => [...row]);
  else throw new Error('隔離測試拒絕未知寫入');
  fixtureWrites.push({method,range,values:body?.values});
  document.getElementById('fixture-write-log').textContent = JSON.stringify(fixtureWrites, null, 2);
  return {};
};
const fixtureAudit = document.createElement('details');
fixtureAudit.innerHTML = '<summary>隔離寫入紀錄（僅記憶體）</summary><pre id="fixture-write-log">尚無寫入</pre>';
fixtureAudit.style.cssText = 'margin:16px 0;font-size:12px;overflow:auto;max-height:220px';
$('app-content').prepend(fixtureAudit);
document.documentElement.dataset.theme = 'light';
$('login-screen').style.display = 'none';
$('app').style.display = '';
$('header-rate-val').textContent = '32.00';
$('price-ts').textContent = '使用固定示意價格';
$('price-dot').classList.remove('spin');
$('update-ts').textContent = '隔離測試・未讀取帳本';
renderKPIs();
renderCharts();
updateThemeBtn();
updateMobileBuildBar();
const fixtureBanner = document.createElement('div');
fixtureBanner.textContent = '整合驗證｜示意持倉・禁止連外・重新整理還原';
fixtureBanner.style.cssText = 'padding:10px 16px;background:var(--accent);color:var(--accent-fg);font-size:12px;text-align:center';
$('app-content').prepend(fixtureBanner);

// 以網址參數驗收成功、空白與失敗畫面，正式頁面不會載入。
const fixtureView = new URLSearchParams(location.search);
if (fixtureView.has('market')) {
  S.data.indicators = [['coinbase_rank',30,getNowTW8().slice(0,10),'示意'],['google_trends',80,'2025/01/01','示意過期值'],['nupl',0.35,getNowTW8().slice(0,10),'示意'],['rainbow','綠',getNowTW8().slice(0,10),'示意']];
  S.btcMarket = {history:Array.from({length:730},(_,i)=>[Date.now()-(729-i)*86400000,60000+i*50]),dominance:56};
}
if (fixtureView.has('news')) {
  const newsMode = fixtureView.get('news');
  const newsItem = (title,source,minutes,desc='') => ({title,source,ts:Date.now()-minutes*60000,url:'https://example.com/',desc});
  S.news = {fetchedAt:Date.now(),errors:{},en:[],zh:[],x:[]};
  if (newsMode === 'demo') {
    S.news.en = [newsItem('Demo: Bitcoin market activity and the week ahead','示意英文媒體',20,'This is sample content for checking layout and reading rhythm, not a real report.'),newsItem('Demo: A closer look at long-term bitcoin holdings','示意研究媒體',45)];
    S.news.zh = [newsItem('示意新聞：比特幣市場觀察，從資金流向看近期變化','示意繁中媒體',30,'這是排版驗收用的虛構摘要，並非真實報導或市場資訊。'),newsItem('示意新聞：長期持有者如何看待市場波動','示意繁中媒體',90)];
    S.news.x = [newsItem('示意討論：價格之外，也關注市場參與者與長期持倉的變化。','@demo',10)];
  } else if (newsMode === 'error') S.news.errors = {en:'示意連線失敗',zh:'示意連線失敗',x:'示意連線失敗'};
}
if (fixtureView.has('snapshots')) {
  S.data.snapshots = fixtureView.get('snapshots') === 'empty' ? [] : S.data.snapshots.slice(-1);
  renderTrend();
}
