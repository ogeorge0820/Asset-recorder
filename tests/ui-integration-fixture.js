// 僅供隔離伺服器載入，正式 index 不引用此檔。
S.initialized = true;
S.data.cash = [['示意台幣帳戶', 2400000, 'TWD'], ['示意美元帳戶', 15000, 'USD']];
S.data.tw = [['2330', 3000], ['0050', 10000]];
S.prices.tw = {'2330': 1000, '0050': 180};
S.data.us = [['AAPL', 100], ['MSFT', 375]];
S.prices.us = {AAPL: 250, MSFT: 250};
S.data.crypto = [['USDT', 10000], ['BTC', .04], ['ETH', 7]];
S.prices.crypto = {USDT: 1, BTC: 100000, ETH: 3000};
S.data.settings = {insurance_total: 6250, realestate_total: 9500000, debt: 3500000};
S.data.expense_budget = [['生活', '示意生活費', 33300, '現金', '', 'demo-budget']];
const fixtureToday = new Date();
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
document.documentElement.dataset.theme = 'light';
$('login-screen').style.display = 'none';
$('app').style.display = '';
$('header-rate-val').textContent = '32.00';
$('update-ts').textContent = '隔離測試・未讀取帳本';
renderKPIs();
renderCharts();
updateThemeBtn();
updateMobileBuildBar();
const fixtureBanner = document.createElement('div');
fixtureBanner.textContent = '整合驗證｜示意持倉・禁止連外・重新整理還原';
fixtureBanner.style.cssText = 'padding:10px 16px;background:var(--accent);color:var(--accent-fg);font-size:12px;text-align:center';
$('app-content').prepend(fixtureBanner);
