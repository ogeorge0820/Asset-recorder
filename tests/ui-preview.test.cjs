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
