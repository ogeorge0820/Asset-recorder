const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function model() {
  const file = path.join(__dirname, '..', 'ui-preview.html');
  assert.ok(fs.existsSync(file), '應提供獨立預覽頁');
  const html = fs.readFileSync(file, 'utf8');
  const script = html.match(/<script id="preview-model">([\s\S]*?)<\/script>/);
  assert.ok(script, '應提供預覽資料模型');
  const context = vm.createContext({});
  vm.runInContext(script[1], context);
  return expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

test('分類切換只篩選畫面資料，不改寫持倉或總額', () => {
  const run = model();
  assert.equal(run("selectAssets('all').length"), 5);
  assert.deepEqual(run("selectAssets('us').map(a => a.id)"), ['us']);
  assert.equal(run("selectAssets('cash')[0].value"), 320);
  assert.equal(run("selectAssets('missing').length"), 0);
  assert.equal(run("selectAssets('all').reduce((sum, a) => sum + a.value, 0)"), 1280);
});

test('期間切換依日期選資料，仍保留最新一期', () => {
  const run = model();
  assert.equal(run("selectHistory('6m').length"), 6);
  assert.equal(run("selectHistory('1y').length"), 12);
  assert.equal(run("selectHistory('all').length"), 18);
  assert.equal(run("selectHistory('6m').at(-1).value"), 1280);
  assert.equal(run("selectHistory('all').length"), 18);
});

test('圖表能處理無資料與單點，座標不產生 NaN', () => {
  const run = model();
  assert.deepEqual(run('chartPoints([])'), []);
  assert.deepEqual(run('chartPoints([{value: 100}])'), [{ x: 50, y: 130 }]);
  assert.equal(run('chartPoints([{value: 100}, {value: 100}]).every(p => Number.isFinite(p.x) && Number.isFinite(p.y))'), true);
});

test('管理頁修改假持倉後，分類合計同步；USDT 顯示歸現金', () => {
  const run = model();
  assert.equal(run("assetSummary(createDemoState()).find(a => a.id === 'cash').value"), 320);
  assert.equal(run("assetSummary(createDemoState()).find(a => a.id === 'crypto').value"), 80);
  assert.equal(run("assetSummary(createDemoState()).reduce((n,a)=>n+a.value,0)"), 1280);
  assert.equal(run("(() => {const s=createDemoState(); applyDemoRecord(s,'accounts',{...s.accounts[0],amount:2500000}); return assetSummary(s).find(a=>a.id==='cash').value;})()"), 330);
  assert.equal(run("assetSummary(createDemoState()).find(a=>a.id==='insurance').value"), 20);
});

test('示意記錄編輯、刪除與還原互不污染，無效金額拒絕', () => {
  const run = model();
  assert.equal(run("(() => {const s=createDemoState(); applyDemoRecord(s,'budget',{id:'test',name:'測試',amount:1000}); removeDemoRecord(s,'budget','test'); return s.budget.some(r=>r.id==='test');})()"), false);
  assert.equal(run("(() => {const s=createDemoState(); try {applyDemoRecord(s,'budget',{id:'test',name:'測試',amount:-1});} catch(e) {return s.budget.some(r=>r.id==='test');} return true;})()"), false);
  assert.equal(run("(() => {const s=createDemoState(); try {applyDemoRecord(s,'accounts',{...s.accounts[0],currency:'INVALID'});} catch(e) {return s.accounts[0].currency;} return '未阻擋';})()"), 'TWD');
  assert.equal(run("(() => {const a=createDemoState(); a.accounts[0].amount=1; return createDemoState().accounts[0].amount;})()"), 2400000);
});

test('簡化人生試算依支出改變，歸零後不產生負資產或非數字', () => {
  const run = model();
  assert.equal(run("previewProjection({age:35,life:37,retire:60,start:100,spend:10,rate:0,inflation:0,income:0}).at(-1).value"), 80);
  assert.equal(run("previewProjection({age:35,life:37,retire:60,start:100,spend:20,rate:0,inflation:0,income:0}).at(-1).value"), 60);
  assert.equal(run("previewProjection({age:35,life:40,retire:60,start:5,spend:10,rate:0,inflation:0,income:0}).at(-1).value"), 0);
  assert.equal(run("previewProjection({age:35,life:34,retire:60,start:100,spend:10,rate:0,inflation:0,income:0}).length"), 0);
});

test('指標空值不算零分，超出範圍限制到邊界', () => {
  const run = model();
  assert.equal(run('demoTemperature([{value:null,min:0,max:100},{value:50,min:0,max:100}])'), 50);
  assert.equal(run('demoTemperature([{value:200,min:0,max:100}])'), 100);
  assert.equal(run('demoTemperature([{value:null,min:0,max:100}])'), null);
});

test('編輯名稱中的 HTML 僅顯示為文字', () => {
  const run = model();
  assert.equal(run('escapeText(\'<img src=x onerror="alert(1)">\')'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('試算任何一個欄位空白或超限時，不接受其他欄位的更新', () => {
  const run = model();
  assert.equal(run("validatedProjectionValues([{key:'spend',value:'',min:0,max:10000},{key:'rate',value:'4',min:-20,max:30}])"), null);
  assert.equal(run("validatedProjectionValues([{key:'spend',value:'10001',min:0,max:10000},{key:'rate',value:'4',min:-20,max:30}])"), null);
  assert.deepEqual(run("validatedProjectionValues([{key:'spend',value:'0',min:0,max:10000},{key:'rate',value:'4',min:-20,max:30}])"), {spend:0,rate:4});
});

test('持倉數量由分類決定，不受單價恰好為一影響', () => {
  const run = model();
  assert.equal(run("isQuantityRecord({category:'us',currency:'USD',price:1})"), true);
  assert.equal(run("isQuantityRecord({category:'crypto',currency:'USDT',price:1})"), false);
  assert.equal(run("isQuantityRecord({category:'insurance',currency:'USD',price:1})"), false);
});
