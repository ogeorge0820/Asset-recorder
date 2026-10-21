const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function run(expression){
 const ctx=vm.createContext({document:{addEventListener(){}},localStorage:{getItem(){return null}},console,Chart:{register(){},defaults:{font:{}},Tooltip:{positioners:{}}},setTimeout(){},clearTimeout(){},setInterval(){},window:{addEventListener(){}}});
 vm.runInContext(source,ctx);
 return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`,ctx));
}
test('同幣合併、排除 USDT 並凍結規劃價格，不更動持倉來源',()=>{
 const out=run(`(()=>{const h=[['BTC',1],['BTC',2],['ETH',4],['USDT',500]];const p={BTC:100,ETH:50,USDT:1};const plan=createSalePlan(h,p,32,'2026-10','示意時間');p.BTC=1;return {plan,h}})()`);
 assert.equal(out.plan.rows[0].qty,3);assert.equal(out.plan.rows[0].price,3200);
 assert.equal(out.plan.rows.find(r=>r.symbol==='USDT').selected,false);
 assert.equal(out.h.length,4);
});
test('相同比例分配依市值、排除持倉、顆數不超額且精確到分',()=>{
 const out=run(`(()=>{let p=createSalePlan([['BTC',1],['ETH',2],['SOL',10]],{BTC:100,ETH:100,SOL:10},1,'2026-10','時間');p.target=100;p.rows[2].selected=false;return allocateSalePlan(p)})()`);
 assert.equal(out.rows[0].amount,33.33);assert.equal(out.rows[1].amount,66.67);assert.equal(out.rows[2].amount,0);
 assert.equal(out.rows.reduce((s,r)=>s+r.amount,0),100);
});
test('缺價格、異常匯率、超額與負金額皆拒絕，不產生無限顆數',()=>{
 assert.ok(run(`salePlanErrors(createSalePlan([['BTC',1]],{BTC:100},0,'2026-10','時間'))`).length);
 assert.ok(run(`(()=>{let p=createSalePlan([['BTC',1]],{},32,'2026-10','時間');p.target=5;return salePlanErrors(p)})()`).length);
 assert.throws(()=>run(`(()=>{let p=createSalePlan([['BTC',1]],{BTC:100},1,'2026-10','時間');p.target=101;return allocateSalePlan(p)})()`));
 assert.ok(run(`(()=>{let p=createSalePlan([['BTC',1]],{BTC:100},1,'2026-10','時間');p.rows[0].amount=-1;return salePlanErrors(p)})()`).length);
});
test('手動改單筆不連動其他幣，儲存副本保留月別、價格與排除設定',()=>{
 const out=run(`(()=>{let p=createSalePlan([['BTC',1],['ETH',2]],{BTC:100,ETH:100},1,'2026-10','時間');p.target=100;p=allocateSalePlan(p);p.rows[0].amount=20;return p})()`);
 assert.equal(out.rows[1].amount,66.67);assert.equal(out.month,'2026-10');
});
test('金額最多兩位小數，缺價取消勾選後可規劃其他幣種',()=>{
 assert.ok(run(`(()=>{let p=createSalePlan([['BTC',1]],{BTC:100},1,'2026-10','時間');p.target=1.001;return salePlanErrors(p)})()`).length);
 assert.deepEqual(run(`(()=>{let p=createSalePlan([['BTC',1],['ETH',1]],{BTC:100},1,'2026-10','時間');p.target=50;p.rows[1].selected=false;return salePlanErrors(p)})()`),[]);
});
test('本機儲存與還原保留排除及價格，不觸碰帳本；儲存失敗仍保留未儲存狀態',()=>{
 const values=new Map();let fail=false;const notices=[];
 const ctx=vm.createContext({document:{addEventListener(){}},localStorage:{getItem(k){return values.get(k)||null},setItem(k,v){if(fail)throw new Error('空間不足');values.set(k,v)}},console,Chart:{register(){},defaults:{font:{}},Tooltip:{positioners:{}}},setTimeout(){},clearTimeout(){},setInterval(){},window:{addEventListener(){}}});
 vm.runInContext(source,ctx);ctx.notice=m=>notices.push(m);
 vm.runInContext(`renderSalePlan=()=>{};showToast=m=>notice(m);S.data.crypto=[['BTC',1],['USDT',500]];S.prices.crypto={BTC:100,USDT:1};S.prices.usdtwd=32;SALE_PLAN=freshSalePlan('2026-10');SALE_PLAN.target=500;SALE_PLAN=allocateSalePlan(SALE_PLAN);SALE_DIRTY=true;saveSheet=()=>{throw new Error('不可寫帳本')};saveSalePlan();`,ctx);
 assert.equal(vm.runInContext('SALE_DIRTY',ctx),false);
 const saved=JSON.parse([...values.values()][0]);assert.equal(saved['2026-10'].rows[0].amount,500);
 vm.runInContext(`SALE_PLAN=null;loadSaleMonth('2026-10')`,ctx);
 assert.equal(vm.runInContext('SALE_PLAN.rows[0].price',ctx),3200);
 assert.equal(vm.runInContext('SALE_PLAN.rows[1].selected',ctx),false);
 assert.equal(vm.runInContext('S.data.crypto[0][1]',ctx),1);
 fail=true;vm.runInContext(`SALE_PLAN.rows[0].amount=400;SALE_DIRTY=true;saveSalePlan()`,ctx);
 assert.equal(vm.runInContext('SALE_DIRTY',ctx),true);assert.equal(vm.runInContext('SALE_PLAN.rows[0].amount',ctx),400);
 assert.equal(JSON.parse([...values.values()][0])['2026-10'].rows[0].amount,500);
 assert.ok(notices.at(-1).includes('儲存失敗'));
});
test('全選包含 USDT 且保留既有金額，全取消清零但不修改持倉',()=>{
 const out=run(`(()=>{renderSalePlan=()=>{};const holdings=[['BTC',1],['USDT',500]];SALE_PLAN=createSalePlan(holdings,{BTC:100,USDT:1},32,'2026-10','時間');SALE_PLAN.rows[0].amount=100;setSaleSelectionAll(true);const selected=JSON.parse(JSON.stringify(SALE_PLAN.rows));setSaleSelectionAll(false);return {selected,cleared:SALE_PLAN.rows,dirty:SALE_DIRTY,holdings}})()`);
 assert.ok(out.selected.every(r=>r.selected));assert.equal(out.selected[0].amount,100);
 assert.ok(out.cleared.every(r=>!r.selected&&r.amount===0));assert.equal(out.dirty,true);
 assert.deepEqual(out.holdings,[['BTC',1],['USDT',500]]);
});
