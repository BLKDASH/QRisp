const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');require('../vendor/qr.js');
class Element{constructor(){this.listeners={};this.value='';this.hidden=false;this.disabled=false;this.attributes={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};}addEventListener(n,f){this.listeners[n]=f}setAttribute(n,v){this.attributes[n]=v}focus(){this.focused=true}appendChild(){}remove(){}getContext(){return {fillRect(){}}}toBlob(fn,type){fn(new Blob(['raster fixture'],{type}))}}
const ids=[...fs.readFileSync(require('node:path').join(__dirname,'../popup.html'),'utf8').matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
async function setup(fail=false,copyFail=false,preview={}){
 const e=Object.fromEntries(ids.map(x=>[x,new Element()]));
 const tabs=new Element(), document=new Element(), firstFormat=new Element();
 const timers=new Map(), blobs=new Map(), downloads=[], copied=[], copiedImages=[];
 const queries=[], messages=[], encoded=[];
 let tid=0;
 e['download-formats'].hidden=true;
 e['download-formats'].querySelector=()=>firstFormat;
 e['download-group'].contains=node=>[e.download,e['download-format'],firstFormat].includes(node);
 e['selection-heading'].hidden=true;
 document.body=new Element();
 document.querySelector=()=>tabs;
 document.getElementById=id=>e[id];
 document.createElement=()=>{
  const element=new Element();
  element.click=()=>downloads.push({name:element.download,blob:blobs.get(element.href)});
  return element;
 };
 const windowId = 'windowId' in preview ? preview.windowId : 1;
 const ctx={
  TextEncoder,Blob,console,Date,document,URLSearchParams,
  location:{search:preview.search || ''},
  LocalQR:{encode(text){encoded.push(text);return LocalQR.encode(text);}},
  ClipboardItem:class {constructor(items){this.items=items;}},
  URL:{
   createObjectURL(blob){
    const url=`blob:${blobs.size}`;
    blobs.set(url,blob);
    return url;
   },
   revokeObjectURL(url){blobs.delete(url);}
  },
  setTimeout:(fn,ms)=>{timers.set(++tid,{fn,ms});return tid},
  clearTimeout:id=>timers.delete(id),
  chrome:{
   runtime:{sendMessage:async message=>{
    messages.push(typeof message==='object'&&message?{...message}:message);
    if(preview.error)throw Error('handoff unavailable');
    return preview.reply;
   }},
   tabs:{query:async options=>{
    queries.push(options);
    if(fail)throw Error('fail');
    return [{windowId,url:'https://www.figma.com/community',title:'Figma Community'}];
   }},
   windows:{getCurrent:async ()=>({id:windowId})}
  },
  navigator:{clipboard:{
   async writeText(text){
    if(copyFail)throw Error('fail');
    copied.push(text);
   },
   async write([item]){
    if(copyFail)throw Error('fail');
    copiedImages.push(item.items);
   }
  }}
 };
 vm.createContext(ctx);
 for(const file of ['qr-input.js','popup.js']){
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8'),ctx);
 }
 await new Promise(resolve=>setImmediate(resolve));
 return {e,tabs,document,firstFormat,timers,copied,copiedImages,downloads,queries,messages,encoded};
}
(async()=>{let t=await setup();const e=t.e;assert.equal(e['page-title'].textContent,'Figma Community');assert.equal(e.download.disabled,false);assert.equal(e.qr.hidden,false);await e.copy.listeners.click();assert.deepEqual(t.copied,['https://www.figma.com/community']);assert.equal(e['copy-label'].textContent,'✓ 已复制');const timer=[...t.timers.values()].find(x=>x.ms===1500);assert.ok(timer);timer.fn();assert.equal(e['copy-label'].textContent,'复制链接');await e.download.listeners.click();assert.equal(t.downloads.length,1);
assert.match(t.downloads[0].name,/\.png$/);
assert.equal(t.downloads[0].blob.type,'image/png');

const formatButton=e['download-format'], formatOptions=e['download-formats'];
assert.equal(formatButton.disabled,false);
formatButton.listeners.click();
assert.equal(formatOptions.hidden,false);
assert.equal(formatButton.attributes['aria-expanded'],'true');
assert.ok(t.firstFormat.focused);
e['download-group'].listeners.keydown({key:'Escape',preventDefault(){}});
assert.equal(formatOptions.hidden,true);
assert.equal(formatButton.attributes['aria-expanded'],'false');
assert.ok(formatButton.focused);
formatButton.listeners.click();
t.document.listeners.pointerdown({target:e.copy});
assert.equal(formatOptions.hidden,true);

e['custom-tab'].listeners.click();
assert.equal(e.download.disabled,true);
assert.equal(formatButton.disabled,true);
assert.equal(e.qr.hidden,true);
assert.equal(e['copy-label'].textContent,'复制二维码');
assert.equal(e.count,undefined);

function type(value){
 e.content.value=value;
 e.content.listeners.input();
}
type('你好 🌈\nhttps://example.com/?a=1&b=2');
assert.equal(e.qr.hidden,false);
assert.equal(e.download.disabled,false);
await e.copy.listeners.click();
assert.equal(t.copiedImages.length,1);
assert.deepEqual(Object.keys(t.copiedImages[0]),['image/png']);
assert.equal(t.copiedImages[0]['image/png'].type,'image/png');
assert.equal(t.copied.length,1);
assert.equal(e['copy-label'].textContent,'✓ 已复制');

const pendingCopy=e.copy.listeners.click();
type('更新后的文字');
await pendingCopy;
assert.equal(t.copiedImages.length,1);
assert.equal(e.qr.hidden,false);
assert.equal(e.download.disabled,false);
assert.equal(e['copy-label'].textContent,'复制二维码');
await e.copy.listeners.click();
assert.equal(t.copiedImages.length,2);
await e.download.listeners.click();
assert.equal(t.downloads.length,2);

for(const [value,mime] of [['jpg','image/jpeg'],['svg','image/svg+xml']]){
 formatButton.listeners.click();
 await formatOptions.listeners.click({target:{closest:()=>({value})}});
 const file=t.downloads.at(-1);
 assert.ok(file.name.endsWith('.'+value));
 assert.equal(file.blob.type,mime);
 assert.equal(formatOptions.hidden,true);
}
const svg=await t.downloads.at(-1).blob.text();
assert.match(svg,/<svg [^>]*viewBox="0 0 \d+ \d+"/);
assert.match(svg,/<rect [^>]*fill="#fff"/);
assert.match(svg,/d="M4 4h1v1h-1z/);
await e.download.listeners.click();
assert.equal(t.downloads.at(-1).blob.type,'image/png');

type('x'.repeat(999)+'😀');
assert.equal(e.download.disabled,false);
formatButton.listeners.click();
type('x'.repeat(1001));
assert.equal(e.download.disabled,true);
assert.equal(formatButton.disabled,true);
assert.equal(formatOptions.hidden,true);
assert.equal(e.copy.disabled,true);
assert.equal(e.qr.hidden,true);
assert.equal(e.status.textContent,'内容过长，请缩短文字或链接。');
type('中'.repeat(1000));
assert.equal(e.download.disabled,true);
assert.match(e.status.textContent,/容量/);

e.content.listeners.compositionstart();
type('😀'.repeat(100));
assert.equal(e.download.disabled,true);
assert.equal(e.qr.hidden,true);
e.content.listeners.compositionend();
assert.equal(e.download.disabled,false);
assert.equal(e.qr.hidden,false);

t.tabs.listeners.keydown({key:'Home',preventDefault(){}});
assert.equal(e['page-tab'].attributes['aria-selected'],'true');
assert.equal(e.download.disabled,false);
e['custom-tab'].listeners.click();
assert.equal(e.download.disabled,false);
assert.equal(e.qr.hidden,false);
type('   ');
assert.equal(e.download.disabled,true);
assert.equal(e.qr.hidden,true);
assert.equal(e.status.textContent,'');
type(' '.repeat(1001));
assert.equal(e.status.textContent,'内容过长，请缩短文字或链接。');
t=await setup(true);assert.equal(t.e.download.disabled,true);assert.equal(t.e['empty-title'].textContent,'无法读取当前页面');assert.equal(t.e.status.textContent,'');
t=await setup(false,true);
await t.e.copy.listeners.click();
assert.match(t.e.status.textContent,/复制失败/);
t.e['custom-tab'].listeners.click();
t.e.content.value='测试二维码';
t.e.content.listeners.input();
await t.e.copy.listeners.click();
assert.match(t.e.status.textContent,/复制二维码失败/);
assert.equal(t.queries.length,1);
assert.deepEqual(t.messages,[{type:'take-selection',windowId:1}]);

const selected='  中文 😀\n<tag> & https://example.test/?a=1  ';
t=await setup(false,false,{windowId:5,reply:{text:selected}});
assert.equal(t.tabs.hidden,false);
assert.equal(t.e['selection-heading'].hidden,true);
assert.equal(t.document.body.classes.has('selection'),false);
assert.equal(t.e['custom-tab'].attributes['aria-selected'],'true');
assert.equal(t.e['page-panel'].hidden,true);
assert.equal(t.e['custom-panel'].hidden,false);
assert.equal(t.e.content.value,selected);
assert.deepEqual(t.encoded,[selected]);
assert.deepEqual(t.messages,[{type:'take-selection',windowId:5}]);
assert.equal(t.queries.length,1);
assert.equal(t.e.qr.hidden,false);
assert.equal(t.e['copy-label'].textContent,'复制二维码');
await t.e.copy.listeners.click();
await t.e.download.listeners.click();
assert.equal(t.copied.length,0);
assert.equal(t.copiedImages.length,1);
assert.equal(t.downloads[0].blob.type,'image/png');
t.e['page-tab'].listeners.click();
assert.equal(t.encoded.at(-1),'https://www.figma.com/community');
t.e['custom-tab'].listeners.click();
assert.equal(t.e.content.value,selected);

t=await setup(true,false,{windowId:8,reply:{text:'标签页查询失败仍展示选区'}});
assert.equal(t.e.qr.hidden,false);
assert.deepEqual(t.encoded,['标签页查询失败仍展示选区']);

for(const [options,status] of [
 [{reply:{error:'内容过长，请缩短文字或链接。'}},/内容过长/],
 [{reply:{text:'   '}},/所选内容为空/]
]){
 t=await setup(false,false,options);
 assert.equal(t.tabs.hidden,false);
 assert.equal(t.e['custom-tab'].attributes['aria-selected'],'true');
 assert.equal(t.e.qr.hidden,true);
 assert.equal(t.e.download.disabled,true);
 assert.equal(t.e.copy.disabled,true);
 assert.match(t.e.status.textContent,status);
}

const search='?selection=test';
t=await setup(false,false,{search,reply:{text:selected}});
assert.ok(t.tabs.hidden);
assert.equal(t.e['selection-heading'].hidden,false);
assert.equal(t.document.body.classes.has('selection'),true);
assert.equal(t.e['page-panel'].hidden,true);
assert.equal(t.e.content.value,selected);
assert.deepEqual(t.encoded,[selected]);
assert.deepEqual(t.messages,['take-selection']);
assert.equal(t.queries.length,0);
assert.equal(t.e.qr.hidden,false);
t.e.content.value='编辑后的选区';
t.e.content.listeners.input();
assert.equal(t.encoded.at(-1),t.e.content.value);

for(const [options,status] of [
 [{reply:{error:'内容过长，请缩短文字或链接。'}},/内容过长/],
 [{reply:{text:'   '}},/所选内容为空/],
 [{},/选区已失效/],
 [{error:true},/选区已失效/]
]){
 t=await setup(false,false,{search,...options});
 assert.equal(t.queries.length,0);
 assert.equal(t.e.qr.hidden,true);
 assert.equal(t.e.download.disabled,true);
 assert.equal(t.e.copy.disabled,true);
 assert.equal(t.e.content.disabled,false);
 assert.match(t.e.status.textContent,status);
}
console.log('PASS: toolbar, toolbar selection handoff, fallback preview and recovery, live edits, PNG/JPG/SVG downloads, Unicode limits, IME, keyboard and clipboard actions.');})().catch(e=>{console.error(e);process.exitCode=1});
