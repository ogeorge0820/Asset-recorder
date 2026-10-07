const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const pluginSource=source.slice(source.indexOf("Chart.register({\n  id: 'doughnutCenter'"),source.indexOf('\nfunction renderCharts()'));
test('圓心長金額與標籤在小圓環內仍保留安全邊界',()=>{
 let plugin;
 vm.runInNewContext(pluginSource,{Chart:{register(p){plugin=p}},chartColors(){return {}}});
 for(const radius of [32,38,62]) for(const text of ['2,100.9萬','12,345.6萬','1.2億']) {
  const drawn=[];
  const ctx={save(){},restore(){},measureText(t){return {width:t.length*parseFloat(this.font.match(/([\d.]+)px/)[1])*.75}},fillText(t,x,y){drawn.push({width:this.measureText(t).width,y,size:parseFloat(this.font.match(/([\d.]+)px/)[1])})}};
  plugin.afterDraw({config:{type:'doughnut',options:{plugins:{doughnutCenter:{text,sub:'可用合計'}}}},ctx,chartArea:{left:0,right:140,top:0,bottom:140},getDatasetMeta(){return {data:[{innerRadius:radius}]}}});
  for(const d of drawn) assert.ok(Math.hypot(d.width/2,Math.abs(d.y-70)+d.size/2)<=radius-3,`${text} 超出半徑 ${radius}`);
 }
});
