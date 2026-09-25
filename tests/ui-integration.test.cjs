const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.join(__dirname,'..');
const current=fs.readFileSync(path.join(root,'app.js'),'utf8');
const baseline=execFileSync('git',['show','v1.1:app.js'],{cwd:root,encoding:'utf8'});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function run(source,expression){
 const context=vm.createContext({document:{addEventListener(){}},localStorage:{getItem(){return null}},console, Chart:{register(){},defaults:{font:{}},Tooltip:{positioners:{}}}, setTimeout(){},clearTimeout(){},setInterval(){},window:{addEventListener(){}}});
 vm.runInContext(source,context);
 return JSON.parse(vm.runInContext(`
 S.data.cash=[['示意台幣',2400000,'TWD'],['示意美元',15000,'USD']];
 S.data.tw=[['2330',3000]]; S.prices.tw={'2330':1000};
 S.data.us=[['AAPL',100]]; S.prices.us={AAPL:250};
 S.data.crypto=[['USDT',10000],['BTC',0.04]]; S.prices.crypto={USDT:1,BTC:100000};
 S.data.settings={insurance_total:22455,realestate_total:9500000,debt:3500000};
 S.data.expense_budget=[['生活','示意開銷',33300]];
 JSON.stringify(${expression})`,context));
}
test('改版保留美元保險與 USDT 帳本口徑，總額與 v1.1 一致',()=>{
 const totals=run(current,'calcTotals()');
 assert.deepEqual(totals,run(baseline,'calcTotals()'));
 assert.equal(totals.ins,22455*32); assert.equal(totals.cryT,448000); assert.equal(totals.cashT,2880000);
});
test('改版保留現金流模擬結果',()=>{
 const expression="simulateMonthly({startBalance:3200000,monthlyBudget:33300,startYM:'2026-09',maxMonths:120})";
 assert.deepEqual(run(current,expression),run(baseline,expression));
});
test('保留所有原有總覽 DOM 掛載點及操作',()=>{
 const before=execFileSync('git',['show','v1.1:index.html'],{cwd:root,encoding:'utf8'});
 const overview=s=>s.split('<div id="tab-overview">')[1].split('</div><!-- /tab-overview -->')[0];
 for(const match of overview(before).matchAll(/(?:id|onclick)="([^"]+)"/g)) assert.ok(overview(html).includes(match[0]),match[0]);
});
test('新版六個導覽入口具備清楚的圖示與名稱',()=>{
 assert.equal((html.match(/class="nav-icon"/g)||[]).length,6);
 assert.ok(html.includes('看看資產的變化'));
 assert.equal((html.match(/id="kv-hero-monthly"/g)||[]).length,1);
});
test('桌機側欄與原頁尾使用獨立版本掛載點',()=>{
 assert.equal((html.match(/id="build-badge"/g)||[]).length,1);
 assert.equal((html.match(/id="sidebar-build-badge"/g)||[]).length,1);
});
test('管理頁保留全部資料掛載點、匯入與原有操作入口',()=>{
 const before=execFileSync('git',['show','v1.1:index.html'],{cwd:root,encoding:'utf8'});
 const management=s=>s.split('<div id="tab-management" style="display:none">')[1].split('</div><!-- /tab-management -->')[0];
 for(const m of management(before).matchAll(/(?:id|onclick)="([^"]+)"/g)) assert.ok(management(html).includes(m[0]),m[0]);
});
async function captureWrite(source, count, rows){
 const operations=[];
 const ctx=vm.createContext({document:{addEventListener(){},getElementById(){return {textContent:'',className:''}}},localStorage:{getItem(){return null}},console:{error(){}},Chart:{register(){},defaults:{font:{}},Tooltip:{positioners:{}}},setTimeout(){},clearTimeout(){},setInterval(){},window:{addEventListener(){}}});
 vm.runInContext(source,ctx);
 ctx.testRows=rows;
 ctx.testCount=count;
 ctx.capture=(method,range,values)=>operations.push({method,range,values:values?JSON.parse(JSON.stringify(values)):undefined});
 vm.runInContext("sheetGet=async()=>Array.from({length:testCount+1},()=>['示意']); sheetClear=async range=>capture('clear',range); sheetPut=async(range,values)=>capture('put',range,values);",ctx);
 let error=null;
 try { await vm.runInContext("saveSheet('cash_accounts',testRows)",ctx); } catch(e){error=e.message;}
 return {operations,error};
}
test('原本寫入流程的欄位、清除範圍與 v1.1 相同',async()=>{
 const rows=[['示意帳戶',10000,'TWD']];
 const result=await captureWrite(current,2,rows);
 assert.deepEqual(result,await captureWrite(baseline,2,rows));
 assert.deepEqual(result.operations[1].values,[['bank_name','amount','currency'],...rows]);
});
test('列數異常減少時仍拒寫，完全不清除資料',async()=>{
 const result=await captureWrite(current,8,[['示意帳戶',10000,'TWD']]);
 assert.match(result.error,/BLOCKED/);
 assert.deepEqual(result.operations,[]);
});

test('總覽展開持倉與分類合計一致，USDT 只顯示於現金且不改資料',()=>{
 const result=run(current,`(() => {
   const before=JSON.stringify(S.data);
   const categories=['cash','tw','us','crypto','insurance'];
   const rows=Object.fromEntries(categories.map(c=>[c,getOvxHoldings(c)]));
   return {rows,unchanged:before===JSON.stringify(S.data)};
 })()`);
 assert.equal(result.unchanged,true);
 assert.equal(result.rows.cash.reduce((s,r)=>s+r.value,0),3200000);
 assert.equal(result.rows.crypto.reduce((s,r)=>s+r.value,0),128000);
 assert.equal(result.rows.tw[0].value,3000000);
 assert.equal(result.rows.us[0].value,800000);
 assert.equal(result.rows.insurance[0].value,22455*32);
 assert.equal(result.rows.cash.filter(r=>r.name==='USDT').length,1);
 assert.equal(result.rows.crypto.some(r=>r.name==='USDT'),false);
});
test('日期選取只讀取對應淨資產，處理空資料、單點及越界',()=>{
 assert.equal(run(current,`trendPointAt([],[],0)`),null);
 assert.deepEqual(run(current,`trendPointAt(['2026/08'],[123456],99)`),{index:0,date:'2026/08',value:123456});
 assert.deepEqual(run(current,`trendPointAt(['2026/07','2026/08'],[100,200],-3)`),{index:0,date:'2026/07',value:100});
 assert.deepEqual(run(current,`trendPointAt(['2026/07','2026/08'],[100,200],'1')`),{index:1,date:'2026/08',value:200});
});

test('首頁漲跌呈現保留正負、缺值與來源期間，不把月底資料標成 24h',()=>{
 assert.match(run(current,`renderOvxChange({pct:1.25,delta:12500},'crypto')`),/ovx-change pos/);
 assert.match(run(current,`renderOvxChange({pct:-2,delta:-20000,win:'2026/08 月底'},'us')`),/-2.00%.*-2.0萬.*2026\/08 月底/);
 assert.match(run(current,`renderOvxChange(null,'tw')`),/暫無漲跌資料/);
 assert.doesNotMatch(run(current,`renderOvxChange({pct:2,delta:200,win:'2026/08 月底'},'crypto')`),/24h/);
 assert.equal(run(current,`renderOvxChange(null,'cash')`),'');
 assert.equal(run(current,`renderOvxChange(null,'insurance')`),'');
});
