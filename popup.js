'use strict';
const $ = id => document.getElementById(id);
const QUIET_ZONE = 4, QR_INK = '#171717', DOWNLOAD_SIZE = 1400;
const PNG_MIME = 'image/png';
let currentUrl = '', mode = 'page', matrix = null, encodedText = '', composing = false, copyTimer, generation = 0;
const downloadGroup = $('download-group');
const formatButton = $('download-format');
const formatOptions = $('download-formats');

function paint(canvas, cells, size) {
 const modules = cells.length + QUIET_ZONE * 2;
 const scale = Math.ceil(size / modules);
 canvas.width = canvas.height = modules * scale;
 const ctx = canvas.getContext('2d');
 ctx.fillStyle = '#fff';
 ctx.fillRect(0, 0, canvas.width, canvas.height);
 ctx.fillStyle = QR_INK;
 cells.forEach((row,y)=>row.forEach((on,x)=>{
  if(on)ctx.fillRect((x+QUIET_ZONE)*scale,(y+QUIET_ZONE)*scale,scale,scale);
 }));
}
function closeFormats(restoreFocus = false) {
 if(formatOptions.hidden)return;
 formatOptions.hidden = true;
 formatButton.setAttribute('aria-expanded','false');
 if(restoreFocus)formatButton.focus();
}
function resetCopy(){clearTimeout(copyTimer);$('copy').classList.remove('copied');$('copy-label').textContent=mode==='page'?'复制链接':'复制二维码';}
function invalidate(label='二维码预览') {
 generation++;matrix=null;encodedText='';$('qr').hidden=true;$('empty').hidden=false;$('empty-title').textContent=label;$('preview').classList.add('empty');
 $('download').disabled=formatButton.disabled=$('copy').disabled=true;
 closeFormats();
 $('status').textContent='';
 resetCopy();
}
function generate(text) {
 invalidate();
 const error=validateQrText(text, mode);
 if(error){
  $('status').textContent=error;
  return;
 }
 if(!text.trim()){
  if(mode==='page')$('empty-title').textContent='无法读取当前页面';
  return;
 }
 try {
  matrix=LocalQR.encode(text);
  encodedText=text;
  paint($('qr'),matrix,924);
  $('qr').hidden=false;
  $('empty').hidden=true;
  $('preview').classList.remove('empty');
  $('qr').setAttribute('aria-label',mode==='page'?'当前页面二维码':'自定义内容二维码');
  $('download').disabled=formatButton.disabled=$('copy').disabled=false;
 }
 catch {invalidate('内容过长');$('status').textContent='二维码容量不足，请缩短内容。';}
}
function inputChanged(){
 if(mode!=='custom')return;
 if(composing)invalidate();
 else generate($('content').value);
}
function setMode(next,focus=false){
 mode=next;
 for(const key of ['page','custom']){
  const selected=key===next;
  const tab=$(`${key}-tab`);
  tab.setAttribute('aria-selected',String(selected));
  tab.tabIndex=selected?0:-1;
  $(`${key}-panel`).hidden=!selected;
 }
 if(mode==='page')generate(currentUrl);
 else {
  inputChanged();
  if(focus)$('content').focus();
 }
}
$('page-tab').addEventListener('click',()=>setMode('page'));$('custom-tab').addEventListener('click',()=>setMode('custom',true));
document.querySelector('.tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'page':event.key==='End'?'custom':mode==='page'?'custom':'page';setMode(next);$(`${next}-tab`).focus();});
$('content').addEventListener('input',inputChanged);
$('content').addEventListener('compositionstart',()=>{
 composing=true;
 inputChanged();
});
$('content').addEventListener('compositionend',()=>{
 composing=false;
 inputChanged();
});
function rasterImage(cells, mime) {
 const canvas = document.createElement('canvas');
 paint(canvas,cells,DOWNLOAD_SIZE);
 return new Promise((resolve,reject)=>{
  canvas.toBlob(blob=>{
   if(blob?.type===mime)resolve(blob);
   else reject(new Error('Image encoding failed'));
  },mime,0.98);
 });
}
$('copy').addEventListener('click',async()=>{
 if(!matrix)return;
 const token = generation;
 const copyLink = mode==='page';
 const failure = copyLink?'复制失败，请重试或手动复制内容。':'复制二维码失败，请重试或下载图片。';
 try {
  if(copyLink)await navigator.clipboard.writeText(encodedText);
  else {
   const image = await rasterImage(matrix,PNG_MIME);
   if(token!==generation)return;
   await navigator.clipboard.write([new ClipboardItem({[PNG_MIME]:image})]);
  }
  if(token!==generation)return;
  if($('status').textContent===failure)$('status').textContent='';
  resetCopy();
  $('copy').classList.add('copied');
  $('copy-label').textContent='✓ 已复制';
  copyTimer=setTimeout(resetCopy,1500);
 } catch {
  if(token===generation)$('status').textContent=failure;
 }
});
function saveImage(blob, format) {
 const url = URL.createObjectURL(blob);
 const link = document.createElement('a');
 link.href = url;
 link.download = `QRisp-${new Date().toISOString().slice(0,10)}.${format}`;
 document.body.appendChild(link);
 link.click();
 link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function makeSvg(cells) {
 const size = cells.length + QUIET_ZONE * 2;
 const path = [];
 cells.forEach((row,y)=>row.forEach((on,x)=>{
  if(on)path.push(`M${x+QUIET_ZONE} ${y+QUIET_ZONE}h1v1h-1z`);
 }));
 const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DOWNLOAD_SIZE}" height="${DOWNLOAD_SIZE}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" fill="#fff"/>
<path fill="${QR_INK}" shape-rendering="crispEdges" d="${path.join('')}"/>
</svg>`;
 return new Blob([svg],{type:'image/svg+xml'});
}
async function downloadImage(format) {
 if(!matrix)return;
 const token = generation;
 try {
  const mime = format==='jpg'?'image/jpeg':PNG_MIME;
  const image = format==='svg'?makeSvg(matrix):await rasterImage(matrix,mime);
  saveImage(image,format);
 } catch {
  if(token===generation)$('status').textContent='导出失败，请重试。';
 }
}
$('download').addEventListener('click',()=>{
 closeFormats();
 return downloadImage('png');
});
formatButton.addEventListener('click',()=>{
 if(!matrix)return;
 if(!formatOptions.hidden){
  closeFormats(true);
  return;
 }
 formatOptions.hidden = false;
 formatButton.setAttribute('aria-expanded','true');
 formatOptions.querySelector('button').focus();
});
formatOptions.addEventListener('click',event=>{
 const option = event.target.closest('button[value]');
 if(!option)return;
 closeFormats(true);
 return downloadImage(option.value);
});
downloadGroup.addEventListener('keydown',event=>{
 if(event.key!=='Escape'||formatOptions.hidden)return;
 event.preventDefault();
 closeFormats(true);
});
downloadGroup.addEventListener('focusout',event=>{
 if(!downloadGroup.contains(event.relatedTarget))closeFormats();
});
document.addEventListener('pointerdown',event=>{
 if(!downloadGroup.contains(event.target))closeFormats();
});
function applySelection(selection) {
  const input = $('content');
  if (typeof selection?.text === 'string') {
    input.value = selection.text;
    setMode('custom');
    if (!selection.text.trim()) $('status').textContent = '所选内容为空，请重新选择或在此输入。';
    return;
  }
  input.value = '';
  setMode('custom');
  $('status').textContent = selection?.error || '选区已失效，请重新选中文字或在此输入。';
}

async function loadCurrentPage() {
  let windowId;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    windowId = tab?.windowId;
    currentUrl = tab?.url || '';
    $('page-title').textContent = tab?.title || '当前页面';
    $('page-title').title = tab?.title || '';
  } catch {
    $('page-title').textContent = '当前页面';
  }
  $('page-url').textContent = currentUrl || '未能获取链接';
  $('page-url').title = currentUrl;

  if (!Number.isInteger(windowId)) {
    try {
      windowId = (await chrome.windows?.getCurrent?.())?.id;
    } catch {}
  }

  if (Number.isInteger(windowId) && windowId >= 0) {
    let selection;
    try {
      selection = await chrome.runtime?.sendMessage?.({type: 'take-selection', windowId});
    } catch {}
    if (selection) {
      applySelection(selection);
      return;
    }
  }
  if (mode === 'page') generate(currentUrl);
}

async function loadSelection() {
  document.body.classList.add('selection');
  document.querySelector('.tabs').hidden = true;
  $('selection-heading').hidden = false;
  setMode('custom');

  const input = $('content');
  input.disabled = true;
  let selection;
  try {
    selection = await chrome.runtime.sendMessage('take-selection');
  } catch {
    // A restored window may outlive its one-time handoff.
  }
  input.disabled = false;
  applySelection(selection);
}

if (new URLSearchParams(location.search).has('selection')) {
  loadSelection();
} else {
  loadCurrentPage();
}
