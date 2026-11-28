#!/usr/bin/env node
/**
 * Serves out/ like GitHub Pages: directory index.html, trailing-slash redirects, and 404.html for
 * anything missing (the SPA fallback renders post-snapshot threads and members live).
 * Usage: node scripts/serve-static.mjs [port] [dir]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 8899);
const root = process.argv[3] ?? 'out';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
  '.pf_meta': 'application/octet-stream', '.pf_fragment': 'application/octet-stream', '.pf_index': 'application/octet-stream', '.pagefind': 'application/octet-stream' };

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, rel);
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!url.pathname.endsWith('/')) { res.writeHead(301, { location: `${url.pathname}/${url.search}` }); res.end(); return; }
    file = join(file, 'index.html');
  }
  const found = existsSync(file) && statSync(file).isFile();
  const target = found ? file : join(root, '404.html');
  res.writeHead(found ? 200 : 404, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
  res.end(readFileSync(target));
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
