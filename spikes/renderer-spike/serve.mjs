import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const atlasRoot = path.resolve(root, '../blender-pipeline/results/windows-x64-desktop-hg8er1k/eevee-atlas');
const port = Number(process.argv[2] || 5174);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const safe = (base, urlPath) => {
  const decoded = decodeURIComponent(urlPath);
  const target = path.resolve(base, decoded.replace(/^[/\\]+/, ''));
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('path traversal');
  return target;
};
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    let base = root, pathname = u.pathname;
    if (pathname.startsWith('/atlas/')) { base = atlasRoot; pathname = pathname.slice(6); }
    else if (pathname.startsWith('/pixi.js/')) { base = path.resolve(path.dirname(require.resolve('pixi.js', { paths: [root] })), '../dist'); pathname = pathname.slice(9); }
    else if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    else if (pathname === '/') pathname = '/index.html';
    const file = safe(base, pathname);
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch (e) { res.writeHead(e.code === 'ENOENT' ? 404 : 400); res.end(String(e.message)); }
});
server.listen(port, '127.0.0.1', () => console.log(`renderer spike: http://127.0.0.1:${port}/`));
