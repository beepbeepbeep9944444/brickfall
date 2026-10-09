// Static file server for /public with ETags, gzip and a friendly 404 page.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { config } from './config.js';

const gzip = promisify(zlib.gzip);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);

// cache keyed by absolute path; re-read when the file's mtime or size changes
const cache = new Map();

async function load(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) return null;
  const hit = cache.get(file);
  if (hit && hit.mtime === stat.mtimeMs && hit.size === stat.size) return hit;
  const body = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase();
  const entry = {
    body,
    gz: COMPRESSIBLE.has(ext) && body.length > 1024 ? await gzip(body) : null,
    type: TYPES[ext] || 'application/octet-stream',
    etag: `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`,
    mtime: stat.mtimeMs,
    size: stat.size,
  };
  cache.set(file, entry);
  return entry;
}

function resolvePublic(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  if (p.includes('\0')) return null;
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(config.publicDir, p));
  return file.startsWith(config.publicDir + path.sep) ? file : null;
}

function send(req, res, status, entry) {
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const useGz = entry.gz && acceptsGzip;
  const headers = {
    'Content-Type': entry.type,
    // no hashed filenames, so always revalidate (cheap 304s thanks to the ETag)
    'Cache-Control': 'no-cache',
    ETag: entry.etag,
    Vary: 'Accept-Encoding',
  };
  if (useGz) headers['Content-Encoding'] = 'gzip';
  if (status === 200 && req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const body = useGz ? entry.gz : entry.body;
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function notFound(req, res) {
  const wantsHtml = (req.headers.accept || '').includes('text/html');
  if (wantsHtml) {
    try { return send(req, res, 404, await load(path.join(config.publicDir, '404.html'))); } catch { /* fall through */ }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

export async function serveStatic(req, res, url) {
  const file = resolvePublic(url.pathname);
  if (!file) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  let entry = null;
  try { entry = await load(file); } catch { entry = null; }
  if (!entry || path.basename(file) === '404.html') return notFound(req, res);
  send(req, res, 200, entry);
}
