// Throwaway server for rendering store covers: serves the game's public/ files plus cover.html,
// and saves PNGs posted to /save?name=... into <project>/covers/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(process.argv[2]), here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(project, 'covers');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/save') {
    const name = url.searchParams.get('name').replace(/[^\w.-]/g, '');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      fs.writeFileSync(path.join(out, name), url.searchParams.get('raw') ? body : Buffer.from(body.toString().replace(/^data:image\/png;base64,/, ''), 'base64'));
      res.end('saved ' + name);
    });
    return;
  }
  const page = { '/': 'cover.html', '/cover.html': 'cover.html', '/video.html': 'video.html' }[url.pathname];
  const file = path.resolve(page ? path.join(here, page) : url.pathname.startsWith('/covers/') ? path.join(project, url.pathname) : path.join(project, 'public', url.pathname));
  if (!file.startsWith(project) && !file.startsWith(here)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(8130, () => console.log('cover server on http://localhost:8130'));
