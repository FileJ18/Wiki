// server.js
// Simple Node-only wiki with uploads, image positioning, thumbnails, comments, dark/light mode, and placeholder payment buttons.
// Run: node server.js
// Make sure node has permission to write to ./public/uploads

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Ensure upload dir exists
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// In-memory storage
let wikiPages = {
  'Home': `Welcome to the Node-only wiki!

Use the editor to add **bold**, *italic*, [links](https://example.com), and insert images/videos.
Upload images or webm via the Upload button in the edit interface.

You can position images/videos using metadata. Example inserted by toolbar:
![thumb](uploads/example.png){x:50,y:60,w:200}
`
};
let comments = {}; // comments[pageName] = [{id, author, text, time}]
let nextCommentId = 1;

// CSS (grey & white default) with dark mode support
const css = `
:root{
  --bg: #f5f6f8;
  --card: #fff;
  --text: #222;
  --muted: #666;
  --accent: #2b6cdf;
  --ui-border: #e2e4e8;
}
[data-theme="dark"]{
  --bg: #121418;
  --card: #17191c;
  --text: #e6eef8;
  --muted: #9aa6bd;
  --accent: #4ea1ff;
  --ui-border: #23272b;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0;font-family:Inter,system-ui,Segoe UI,Arial;background:var(--bg);color:var(--text)}
.app{
  display:flex;min-height:100vh;
}
/* sidebar */
.sidebar{
  width:220px;background:var(--card);border-right:1px solid var(--ui-border);padding:14px;display:flex;flex-direction:column;gap:10px;
}
.brand{font-weight:700;color:var(--accent);margin-bottom:6px}
.page-list{flex:1;overflow:auto;padding:0;margin:0;list-style:none}
.page-list li{margin:6px 0}
.page-list a{color:var(--text);text-decoration:none}
.page-list a:hover{text-decoration:underline;color:var(--accent)}
.new-page-btn{width:100%;padding:8px;border-radius:6px;border:1px solid var(--ui-border);background:transparent;color:var(--text);cursor:pointer}

/* main content */
.main{
  flex:1;padding:18px;display:flex;flex-direction:column;gap:12px;
}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:12px}
.controls{display:flex;gap:8px;align-items:center}
.theme-toggle{padding:6px 10px;border-radius:6px;border:1px solid var(--ui-border);background:transparent;cursor:pointer}

/* content card */
.card{background:var(--card);border:1px solid var(--ui-border);padding:16px;border-radius:8px;box-shadow:0 0 0 rgba(0,0,0,0)}
.title-row{display:flex;justify-content:space-between;gap:10px;align-items:center}
.title-row h1{margin:0;font-size:20px;color:var(--accent)}
.meta {color:var(--muted);font-size:13px}

/* display area */
.display-area{position:relative;min-height:240px;border-radius:6px;overflow:hidden}
.display-inner{padding:10px}

/* images positioned absolutely inside display-area */
.display-area img.pos, .display-area video.pos{position:absolute;border:2px solid rgba(0,0,0,0.06);background:#000}

/* thumbnail strip for uploaded uploads */
.thumb-strip{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.thumb{width:88px;height:64px;border-radius:6px;border:1px solid var(--ui-border);overflow:hidden;display:flex;align-items:center;justify-content:center;background:#fafafa}
.thumb img{max-width:100%;max-height:100%;display:block}

/* editor */
.editor {display:flex;flex-direction:column;gap:8px}
.toolbar{display:flex;gap:6px;flex-wrap:wrap}
.tb-btn{padding:6px 10px;border-radius:6px;border:1px solid var(--ui-border);background:transparent;cursor:pointer}
textarea.editor-text{width:100%;height:320px;padding:10px;font-family:monospace;border-radius:6px;border:1px solid var(--ui-border);background:var(--card);color:var(--text);resize:vertical}

/* preview pane */
.preview{background:var(--card);padding:10px;border-radius:6px;border:1px solid var(--ui-border);min-height:320px;overflow:auto}

/* comments */
.comments{margin-top:12px}
.comment{padding:10px;border-top:1px solid var(--ui-border);display:flex;flex-direction:column;gap:6px}
.comment .meta{font-size:12px;color:var(--muted)}
.comment-form{display:flex;gap:8px;margin-top:8px}
.comment-form input, .comment-form textarea{padding:8px;border-radius:6px;border:1px solid var(--ui-border);background:transparent;color:var(--text)}
.comment-form button{padding:8px 12px;border-radius:6px;background:var(--accent);color:#fff;border:none}

/* upload form */
.upload-row{display:flex;gap:8px;align-items:center}
.small{font-size:13px;color:var(--muted)}

/* payment placeholder modal */
.modal{
  position:fixed;left:0;top:0;right:0;bottom:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);z-index:50;
}
.modal .box{background:var(--card);padding:18px;border-radius:8px;border:1px solid var(--ui-border);width:360px}
.pay-btn{padding:8px 10px;border-radius:6px;border:1px solid var(--ui-border);background:transparent;cursor:pointer;width:100%;text-align:left}

/* helper */
.muted{color:var(--muted)}
.smallbtn{padding:6px 8px;border-radius:6px;border:1px solid var(--ui-border);background:transparent;cursor:pointer}
`;

/* ---------- helpers ---------- */

function escapeHtml (s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// parse our wiki syntax to HTML
// supports **bold**, *italic*, [text](url), image/video embedding:
//   ![alt](uploads/file.png){x:50,y:60,w:200}
// and bare mp3/mp4/png/jpg URLs on their own line -> auto embed
function parseContent (text) {
  if (!text) return '';
  let t = escapeHtml(text);

  // links
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // bold/italic (simple)
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // explicit image/video with positioning metadata (on same line)
  // pattern: ![alt](path){x:50,y:60,w:200}
  t = t.replace(/!\[([^\]]*)\]\(([^\)]+)\)\{([^}]+)\}/g, function(_, alt, src, meta){
    // parse meta like x:50,y:60,w:200
    const obj = {};
    meta.split(',').forEach(pair=>{
      const m = pair.split(':').map(s=>s.trim());
      if (m[0]) obj[m[0]] = parseFloat(m[1]) || 0;
    });
    const style = `left:${(obj.x||0)}px;top:${(obj.y||0)}px;${obj.w?('width:'+obj.w+'px;'):''}`;
    if (/\.(mp4|webm)$/i.test(src)) {
      return `<video class="pos" src="${src}" controls style="${style}"></video>`;
    } else {
      return `<img class="pos" src="${src}" alt="${escapeHtml(alt)}" style="${style}">`;
    }
  });

  // bare media URLs on their own lines -> embed
  t = t.replace(/^(https?:\/\/\S+\.(mp3|wav))$/gim, '<audio controls src="$1"></audio>');
  t = t.replace(/^(https?:\/\/\S+\.(mp4|webm))$/gim, '<video controls src="$1"></video>');
  t = t.replace(/^(https?:\/\/\S+\.(png|jpe?g|gif))$/gim, '<img class="inline" src="$1">');

  // convert remaining newlines to <br>
  t = t.replace(/\n/g, '<br>');
  return t;
}

/* ---------- small multipart parser for single file + fields ----------
   This parser handles form-data uploads with potentially one file field named "file".
   It's minimal and intended for demo/small files. Not production hardened.
---------------------------------------------------------------------- */
function parseMultipart (req, callback) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(.+)$/);
  if (!match) {
    // fallback: parse urlencoded
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      const parsed = {};
      const params = new URLSearchParams(body);
      for (const [k,v] of params) parsed[k] = v;
      callback(parsed, null);
    });
    return;
  }
  const boundary = '--' + match[1];
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const parts = buffer.toString('binary').split(boundary).slice(1,-1);
    const fields = {};
    let file = null;
    parts.forEach(part => {
      // split headers/body
      const [rawHeaders, ...rest] = part.split('\r\n\r\n');
      if (!rawHeaders) return;
      const body = rest.join('\r\n\r\n').slice(0,-2); // remove ending CRLF
      const headerLines = rawHeaders.split('\r\n').filter(Boolean).map(s=>s.trim());
      const cd = headerLines[0] || '';
      // name
      const nameMatch = cd.match(/name="([^"]+)"/);
      const filenameMatch = cd.match(/filename="([^"]+)"/);
      const contentTypeHeader = headerLines.find(h=>h.toLowerCase().startsWith('content-type:'));
      if (filenameMatch) {
        // file part
        const filename = path.basename(filenameMatch[1]);
        const contentType = contentTypeHeader ? contentTypeHeader.split(':')[1].trim() : 'application/octet-stream';
        // write binary body to disk (we used binary decoding)
        const bytes = Buffer.from(body, 'binary');
        file = { filename, contentType, data: bytes };
      } else if (nameMatch) {
        const name = nameMatch[1];
        fields[name] = body;
      }
    });
    callback(fields, file);
  });
}

/* ---------- Server routes ---------- */

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Static file serving for public
  if (pathname.startsWith('/public/')) {
    const fp = path.join(__dirname, pathname.replace(/^\/public\//,'')); // allow /public/...
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(fp).toLowerCase();
      const mime = {
        '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webm':'video/webm',
        '.mp4':'video/mp4','.css':'text/css','.js':'application/javascript'
      }[ext] || 'application/octet-stream';
      res.writeHead(200, {'Content-Type': mime});
      res.end(data);
    });
    return;
  }

  // Root: redirect to a page (no bulky home)
  if (pathname === '/') {
    res.writeHead(302, { Location: '/page?name=Home' });
    res.end();
    return;
  }

  // List pages (for the sidebar fetch)
  if (pathname === '/pages') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(Object.keys(wikiPages)));
    return;
  }

  // Upload endpoint - multipart/form-data expected (field "file")
  if (req.method === 'POST' && pathname === '/upload') {
    parseMultipart(req, (fields, file) => {
      if (!file) {
        res.writeHead(400); res.end('No file');
        return;
      }
      // save file with timestamp prefix to avoid collisions
      const safe = Date.now() + '-' + file.filename.replace(/[^\w\-.]/g,'_');
      const outPath = path.join(UPLOAD_DIR, safe);
      fs.writeFile(outPath, file.data, (err) => {
        if (err) { res.writeHead(500); res.end('Write error'); return; }
        // respond with public path
        const publicPath = '/public/uploads/' + safe;
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ path: publicPath }));
      });
    });
    return;
  }

  // Add a page
  if (req.method === 'POST' && pathname === '/add') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const name = params.get('name');
      const content = params.get('content') || '';
      if (!name) { res.writeHead(400); res.end('Name required'); return; }
      wikiPages[name] = content;
      res.writeHead(302, { Location: '/page?name=' + encodeURIComponent(name) });
      res.end();
    });
    return;
  }

  // Save edits
  if (req.method === 'POST' && pathname === '/edit') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const name = params.get('name');
      const content = params.get('content') || '';
      if (!name || !wikiPages[name]) { res.writeHead(400); res.end('bad'); return; }
      wikiPages[name] = content;
      res.writeHead(302, { Location: '/page?name=' + encodeURIComponent(name) });
      res.end();
    });
    return;
  }

  // Delete page
  if (req.method === 'POST' && pathname === '/delete') {
    const q = parsed.query;
    const name = q.name;
    if (name && wikiPages[name]) {
      delete wikiPages[name];
      delete comments[name];
      res.writeHead(302, { Location: '/page?name=Home' });
      res.end();
    } else { res.writeHead(404); res.end('not found'); }
    return;
  }

  // Add comment AJAX
  if (req.method === 'POST' && pathname === '/comment') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      const p = new URLSearchParams(body);
      const page = p.get('page');
      const author = p.get('author') || 'anon';
      const text = p.get('text') || '';
      if (!page || !wikiPages[page]) { res.writeHead(400); res.end('bad'); return; }
      comments[page] = comments[page] || [];
      comments[page].push({ id: nextCommentId++, author: escapeHtml(author), text: escapeHtml(text), time: new Date().toISOString() });
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(comments[page]));
    });
    return;
  }

  // Serve page view / editor
  if (pathname === '/page' && req.method === 'GET') {
    const page = parsed.query.name || 'Home';
    if (!wikiPages[page]) {
      // quick create
      wikiPages[page] = '';
    }
    const pageContentHtml = parseContent(wikiPages[page]);
    const pageComments = comments[page] || [];
    // build upload thumbnails from uploads dir
    const uploads = fs.readdirSync(UPLOAD_DIR).map(f => '/public/uploads/' + f);

    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(page)}</title>
<style>${css}</style>
</head>
<body data-theme="light">
<div class="app">
  <div class="sidebar">
    <div class="brand">NodeWiki</div>
    <ul class="page-list" id="pageList"></ul>
    <button class="new-page-btn" onclick="newPage()">+ New Page</button>
    <div style="margin-top:auto">
      <div class="small muted">Theme</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="theme-toggle" onclick="toggleTheme()">Toggle dark/light</button>
      </div>
    </div>
  </div>

  <div class="main">
    <div class="topbar">
      <div class="controls">
        <div class="meta">Viewing <strong>${escapeHtml(page)}</strong></div>
      </div>
      <div>
        <button class="smallbtn" onclick="location.href='/edit?name=${encodeURIComponent(page)}'">Edit</button>
        <button class="smallbtn" onclick="if(confirm('Delete page?')) fetch('/delete?name=${encodeURIComponent(page)}',{method:'POST'}).then(()=>location.href='/page?name=Home')">Delete</button>
      </div>
    </div>

    <div class="card">
      <div class="title-row">
        <h1>${escapeHtml(page)}</h1>
        <div class="meta">Auto preview | Grey & white UI</div>
      </div>

      <div class="display-area" id="displayArea" style="height:360px;">
        <div class="display-inner">${pageContentHtml}</div>
      </div>

      <div style="margin-top:12px">
        <div class="small muted">Uploaded files (click to insert into editor)</div>
        <div class="thumb-strip">
          ${uploads.map(u => `<div class="thumb"><img src="${u}" loading="lazy" onclick="insertUpload('${u}')"></div>`).join('')}
        </div>
      </div>

      <div class="comments">
        <h3>Comments</h3>
        <div id="commentsWrap">
          ${pageComments.map(c => `<div class="comment"><div class="meta">${escapeHtml(c.author)} • ${escapeHtml(new Date(c.time).toLocaleString())}</div><div>${escapeHtml(c.text)}</div></div>`).join('')}
        </div>

        <div style="margin-top:8px">
          <form id="commentForm" onsubmit="submitComment(event)">
            <div style="display:flex;gap:8px">
              <input name="author" placeholder="Name" style="flex:0 0 140px">
              <input name="text" placeholder="Your comment" style="flex:1">
              <button type="submit">Post</button>
            </div>
          </form>
        </div>
      </div>
    </div>

  </div>
</div>

<!-- payment modal placeholder -->
<div class="modal" id="payModal"><div class="box">
  <h3>Payment (Demo)</h3>
  <p class="small muted">These are demo placeholders — no real processing here.</p>
  <button class="pay-btn" onclick="alert('PayPal placeholder')">PayPal</button>
  <button class="pay-btn" onclick="alert('Mastercard placeholder')">Mastercard</button>
  <button class="pay-btn" onclick="alert('CVS placeholder')">CVS</button>
  <div style="text-align:right;margin-top:8px"><button class="smallbtn" onclick="closePay()">Close</button></div>
</div></div>

<script>
// fetch page list for sidebar
function refreshPageList(){
  fetch('/pages').then(r=>r.json()).then(list=>{
    const ul = document.getElementById('pageList');
    ul.innerHTML = list.map(p=>'<li><a href="/page?name='+encodeURIComponent(p)+'">'+p+'</a> - <a href="/edit?name='+encodeURIComponent(p)+'" style="font-size:0.9em">[edit]</a></li>').join('');
  });
}
refreshPageList();

function newPage(){
  const n = prompt('New page name:');
  if(!n) return;
  // create blank page
  fetch('/add', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'name='+encodeURIComponent(n)+'&content='}).then(()=>location.href='/edit?name='+encodeURIComponent(n));
}

function insertUpload(path){
  // open editor if user is on editor page; otherwise copy path to clipboard
  if (confirm('Insert into editor? Click OK to copy URL to clipboard (paste into editor or edit mode).')) {
    navigator.clipboard?.writeText(path).then(()=>alert('URL copied: '+path));
  }
}

// comments
function submitComment(e){
  e.preventDefault();
  const f = document.getElementById('commentForm');
  const d = new FormData(f);
  fetch('/comment', {method:'POST', body: new URLSearchParams({page: '${encodeURIComponent(page)}', author: d.get('author'), text: d.get('text')})})
    .then(r=>r.json()).then(arr=>{
      const w = document.getElementById('commentsWrap');
      w.innerHTML = arr.map(c=>'<div class="comment"><div class="meta">'+c.author+' • '+(new Date(c.time)).toLocaleString()+'</div><div>'+c.text+'</div></div>').join('');
      f.reset();
    });
}

// theme toggle (persist in localStorage)
function toggleTheme(){
  const root = document.documentElement;
  const cur = document.body.getAttribute('data-theme') || 'light';
  const next = cur === 'light' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem('nw_theme', next);
}
(function(){
  const pref = localStorage.getItem('nw_theme') || 'light';
  document.body.setAttribute('data-theme', pref);
})();

// payment modal
function openPay(){ document.getElementById('payModal').style.display='flex'; }
function closePay(){ document.getElementById('payModal').style.display='none'; }
</script>

</body>
</html>`);
    return;
  }

  // edit page UI (full wiki-like edit experience)
  if (pathname === '/edit' && req.method === 'GET') {
    const page = parsed.query.name || 'Home';
    if (!wikiPages[page]) wikiPages[page] = '';
    // show editor with toolbar, upload form and live preview
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Edit ${escapeHtml(page)}</title><style>${css}</style></head>
<body data-theme="light">
<div style="padding:18px;max-width:1100px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <h2>Editing: ${escapeHtml(page)}</h2>
    <div>
      <button onclick="location.href='/page?name=${encodeURIComponent(page)}'" class="smallbtn">Cancel</button>
      <button onclick="openPay()" class="smallbtn">Donate</button>
    </div>
  </div>

  <div class="card">
    <div class="toolbar">
      <button class="tb-btn" onclick="wrap('**','**')">Bold</button>
      <button class="tb-btn" onclick="wrap('*','*')">Italic</button>
      <button class="tb-btn" onclick="insertLink()">Link</button>
      <button class="tb-btn" onclick="insertPosImage()">Insert positioned image</button>
      <button class="tb-btn" onclick="insertPosVideo()">Insert positioned video (webm/mp4)</button>
      <form id="uploadForm" style="display:inline-block;margin-left:8px" enctype="multipart/form-data">
        <input id="fileInput" type="file" name="file" accept=".png,.jpg,.jpeg,.webm,.mp4">
        <button type="button" onclick="doUpload()">Upload</button>
        <span id="upStatus" class="small muted"></span>
      </form>
    </div>

    <form method="POST" action="/edit">
      <input type="hidden" name="name" value="${escapeHtml(page)}">
      <div style="display:flex;gap:12px">
        <div style="flex:1">
          <textarea id="editor" class="editor-text" name="content" oninput="updatePreview()">${escapeHtml(wikiPages[page])}</textarea>
        </div>
        <div style="width:46%;min-width:320px">
          <div class="small muted">Preview</div>
          <div id="preview" class="preview"></div>
          <div style="margin-top:8px">
            <button type="submit" class="smallbtn">Save</button>
            <button type="button" onclick="location.href='/page?name=${encodeURIComponent(page)}'" class="smallbtn">Cancel</button>
            <button type="button" onclick="openPay()" class="smallbtn">Donate</button>
          </div>
        </div>
      </div>
    </form>

    <div style="margin-top:12px" class="small muted">Tip: You can place images/videos absolutely by inserting metadata like:
      <code>![alt](uploads/your.png){x:50,y:80,w:200}</code>
    </div>

  </div>
</div>

<!-- payment modal reused -->
<div class="modal" id="payModal"><div class="box">
  <h3>Payment (Demo)</h3>
  <p class="small muted">These are demo placeholders — no real processing here.</p>
  <button class="pay-btn" onclick="alert('PayPal placeholder')">PayPal</button>
  <button class="pay-btn" onclick="alert('Mastercard placeholder')">Mastercard</button>
  <button class="pay-btn" onclick="alert('CVS placeholder')">CVS</button>
  <div style="text-align:right;margin-top:8px"><button class="smallbtn" onclick="closePay()">Close</button></div>
</div></div>

<script>
function updatePreview(){
  const text = document.getElementById('editor').value;
  fetch('/preview?text=' + encodeURIComponent(text)).then(r=>r.text()).then(html=>{
    document.getElementById('preview').innerHTML = html;
    // positionable elements will be absolutely inside preview; keep preview scrollable
  });
}
function wrap(pre, post){
  const el = document.getElementById('editor');
  const s = el.selectionStart, e = el.selectionEnd;
  const inside = el.value.substring(s,e) || (pre==='**' ? 'bold text' : 'italic text');
  el.setRangeText(pre + inside + post, s, e, 'end');
  updatePreview();
}
function insertLink(){
  const url = prompt('URL (https://...)');
  if(!url) return;
  const text = prompt('Link text') || url;
  const el = document.getElementById('editor');
  const pos = el.selectionStart;
  el.setRangeText('['+text+']('+url+')', pos, pos, 'end');
  updatePreview();
}
function insertPosImage(){
  const url = prompt('Uploaded image path (use Upload button first, e.g. /public/uploads/123.png)');
  if(!url) return;
  const x = prompt('x (px)', '20');
  const y = prompt('y (px)', '20');
  const w = prompt('width (px, optional)', '200');
  const insert = '\\n!['+ (prompt('alt text','') || '') +']('+url+'){x:'+x+',y:'+y+(w?(',w:'+w):'')+'}\\n';
  const el = document.getElementById('editor');
  el.setRangeText(insert, el.selectionStart, el.selectionStart, 'end');
  updatePreview();
}
function insertPosVideo(){
  const url = prompt('Uploaded video path (e.g. /public/uploads/abc.webm)');
  if(!url) return;
  const x = prompt('x (px)', '20');
  const y = prompt('y (px)', '20');
  const w = prompt('width (px, optional)', '320');
  const insert = '\\n!['+ (prompt('poster alt','') || '') +']('+url+'){x:'+x+',y:'+y+',w:'+w+'}\\n';
  const el = document.getElementById('editor');
  el.setRangeText(insert, el.selectionStart, el.selectionStart, 'end');
  updatePreview();
}

// upload
function doUpload(){
  const fi = document.getElementById('fileInput');
  const file = fi.files[0];
  if(!file){ alert('Choose a file'); return; }
  const fd = new FormData();
  fd.append('file', file);
  document.getElementById('upStatus').textContent = ' uploading...';
  fetch('/upload', { method: 'POST', body: fd }).then(r=>r.json()).then(j=>{
    document.getElementById('upStatus').textContent = ' uploaded: ' + j.path;
    // auto-insert small thumbnail url
    const el = document.getElementById('editor');
    el.setRangeText('\\n'+j.path+'\\n', el.selectionStart, el.selectionStart, 'end');
    updatePreview();
  }).catch(e=>{
    document.getElementById('upStatus').textContent = ' upload failed';
  });
}

// preview endpoint fetch on load
updatePreview();

// theme persisted
(function(){ const t=localStorage.getItem('nw_theme')||'light'; document.body.setAttribute('data-theme', t); })();
function openPay(){ document.getElementById('payModal').style.display='flex'; }
function closePay(){ document.getElementById('payModal').style.display='none'; }
</script>
</body></html>`);
    return;
  }

  // preview route used by editor preview (server-side parse)
  if (pathname === '/preview') {
    const text = parsed.query.text || '';
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end(parseContent(text));
    return;
  }

  // fallback
  res.writeHead(404, {'Content-Type':'text/plain'});
  res.end('Not found');
});

server.listen(3000, () => {
  console.log('NodeWiki running at http://localhost:3000');
});
