// A plain static server that imitates GitHub Pages: serves dist/ under /it-ends/ and sends no
// COOP/COEP headers, so cross-origin isolation has to come from coi-serviceworker.
//   node scripts/serve-pages.mjs [port]   ->  http://localhost:4174/it-ends/
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = join(import.meta.dirname, '..', 'dist');
const base = '/it-ends/';
const port = Number(process.argv[2] ?? 4174);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/' || url.pathname === '/it-ends') {
    res.writeHead(302, { location: base });
    return res.end();
  }
  if (!url.pathname.startsWith(base)) {
    res.writeHead(404);
    return res.end('not found');
  }
  let file = normalize(join(root, decodeURIComponent(url.pathname.slice(base.length))));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end();
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving dist/ at http://localhost:${port}${base} (no COOP/COEP headers)`));
