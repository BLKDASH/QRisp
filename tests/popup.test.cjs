const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');require('../vendor/qr.js');
class Element{constructor(){this.listeners={};this.value='';this.hidden=false;this.disabled=false;this.attributes={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};}addEventListener(n,f){this.listeners[n]=f}setAttribute(n,v){this.attributes[n]=v}focus(){this.focused=true}appendChild(){}remove(){}getContext(){return {fillRect(){}}}toBlob(fn,type){fn(new Blob(['raster fixture'],{type}))}}
const ids=[...fs.readFileSync(require('node:path').join(__dirname,'../popup.html'),'utf8').matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
async function setup(fail=false,copyFail=false){
 const e=Object.fromEntries(ids.map(x=>[x,new Element()]));
 const tabs=new Element(), document=new Element(), firstFormat=new Element();
 const timers=new Map(), blobs=new Map(), downloads=[], copied=[], copiedImages=[];
 let tid=0;
 e['download-formats'].hidden=true;
 e['download-formats'].querySelector=()=>firstFormat;
 e['download-group'].contains=node=>[e.download,e['download-format'],firstFormat].includes(node);
 document.body=new Element();
 document.querySelector=()=>tabs;
 document.getElementById=id=>e[id];
 document.createElement=()=>{
  const element=new Element();
  element.click=()=>downloads.push({name:element.download,blob:blobs.get(element.href)});
  return element;
 };
 const ctx={
  TextEncoder,Blob,console,Date,LocalQR,document,
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
  chrome:{tabs:{query:async()=>{
   if(fail)throw Error('fail');
   return [{url:'https://www.figma.com/community',title:'Figma Community'}];
  }}},
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
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../popup.js'),'utf8'),ctx);
 await new Promise(resolve=>setImmediate(resolve));
 return {e,tabs,document,firstFormat,timers,copied,copiedImages,downloads};
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
console.log('PASS: current URL/title, live custom generation, default PNG and JPG/SVG downloads, format menu, Unicode limits, IME, keyboard, link and PNG clipboard copy, inaccessible-tab fallback.');})().catch(e=>{console.error(e);process.exitCode=1});
