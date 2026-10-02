const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');

// 模擬一張 Google Sheet：讀取時去掉尾端空格與空列（同 Sheets API），寫入逐格覆蓋
function appWithSheet(name,initialRows){
 const sheet={rows:initialRows.map(r=>[...r]),failPut:false,blindRead:false};
 const ctx=vm.createContext({document:{addEventListener(){},getElementById(){return {textContent:'',className:''}}},localStorage:{getItem(){return null}},console:{error(){},log(){},warn(){}},Chart:{register(){},defaults:{font:{}},Tooltip:{positioners:{}}},setTimeout(){},clearTimeout(){},setInterval(){},window:{addEventListener(){}}});
 vm.runInContext(source,ctx);
 const read=range=>{
  const width=range.endsWith('!A:A')?1:26;
  const out=sheet.rows.map(r=>{const c=r.slice(0,width);while(c.length&&(c[c.length-1]===''||c[c.length-1]==null))c.pop();return c;});
  while(out.length&&!out[out.length-1].length)out.pop();
  return out;
 };
 ctx.fake={
  get:async range=>sheet.blindRead?[]:read(range),
  clear:async range=>{const from=Number((range.match(/!A(\d*):Z$/)||[])[1]||1)-1;for(let i=from;i<sheet.rows.length;i++)sheet.rows[i]=[];},
  put:async(range,values)=>{
   if(sheet.failPut)throw new Error('模擬斷線：寫入沒送達');
   const start=Number(range.match(/!A(\d+)$/)[1])-1;
   values.forEach((row,i)=>{const t=sheet.rows[start+i]||(sheet.rows[start+i]=[]);row.forEach((v,j)=>{t[j]=v;});});
  },
 };
 vm.runInContext('sheetGet=fake.get; sheetClear=fake.clear; sheetPut=fake.put;',ctx);
 return {ctx,sheet,read:range=>JSON.parse(JSON.stringify(read(range))),save:rows=>{ctx.rows=rows;return vm.runInContext(`saveSheet(${JSON.stringify(name)},rows)`,ctx);},header:JSON.parse(vm.runInContext(`JSON.stringify(HEADERS[${JSON.stringify(name)}])`,ctx))};
}

function dailyRows(n){
 return Array.from({length:n},(_,i)=>{
  const d=new Date(Date.UTC(2026,3,1+i));
  const ds=`${d.getUTCFullYear()}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}`;
  return [ds,'200000','600000','4700000','14400000','714900','13000000','9619094','24000000'];
 });
}

test('寫入途中斷線（手機切走、網路掉）也不留下空表',async()=>{
 const history=dailyRows(170);
 const app=appWithSheet('daily_snapshots',[app0Header(),...history]);
 app.sheet.failPut=true;
 await assert.rejects(app.save([...history,['2026/09/30','1','2','3','4','5','6','7','8']]));
 assert.equal(app.read('daily_snapshots!A:J').length-1,170,'歷史列必須原封不動');
});

test('刪除一列後表上不殘留舊尾列，也不殘留舊列的尾端欄位',async()=>{
 const app=appWithSheet('expense_budget',[]);
 const header=app.header;
 app.sheet.rows=[header,['固定','房貸','41039','信用卡','2027-01','b_1'],['浮動','電費','1500'],['浮動','水費','300']];
 await app.save([['浮動','電費','1500'],['浮動','水費','300']]);
 assert.deepEqual(app.read('expense_budget!A:Z'),[header,['浮動','電費','1500'],['浮動','水費','300']]);
});

test('Google 連續兩次誤報空表時，最多蓋掉一列，其餘歷史保留',async()=>{
 const history=dailyRows(170);
 const app=appWithSheet('daily_snapshots',[app0Header(),...history]);
 app.sheet.blindRead=true;
 await app.save([['2026/10/02','1','2','3','4','5','6','7','8','{}']]);
 app.sheet.blindRead=false;
 const after=app.read('daily_snapshots!A:J');
 assert.equal(after.length-1,170,'總列數不變，沒有被整片抹掉');
 assert.deepEqual(after.slice(2),history.slice(1),'被蓋掉的只有第一列，其餘 169 列原封不動');
});

test('新增一列照常寫入，表上內容與記憶體一致',async()=>{
 const history=dailyRows(20);
 const app=appWithSheet('daily_snapshots',[app0Header(),...history]);
 const next=[...history,['2026/04/21','1','2','3','4','5','6','7','8','{"tw":{}}']];
 await app.save(next);
 assert.deepEqual(app.read('daily_snapshots!A:J'),[app.header,...next]);
});

function app0Header(){
 return ['date','cash_total','stock_tw_total','stock_us_total','crypto_total','insurance_total','realestate_total','debt','net_assets','prices_json'];
}
