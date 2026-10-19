const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'ui');
const allowed = new Map([['/', ['index.html','text/html; charset=utf-8']], ['/renderer.js',['renderer.js','text/javascript; charset=utf-8']], ['/style.css',['style.css','text/css; charset=utf-8']], ['/icon.png',['icon.png','image/png']]]);
http.createServer((req,res) => {
  const target = allowed.get(req.url);
  if (!target) { res.writeHead(404).end(); return; }
  res.writeHead(200, {'Content-Type':target[1]}); res.end(fs.readFileSync(path.join(root,target[0])));
}).listen(4317, '127.0.0.1', () => console.log('시너지 화면 미리보기: http://127.0.0.1:4317'));
