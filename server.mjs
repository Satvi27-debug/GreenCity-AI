import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api/handler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const distRoot = resolve(__dirname, 'dist');
const envPath = resolve(__dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  if (!existsSync(distRoot)) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Build not found. Run `npm run build` first.');
    return;
  }
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const requestedPath = decodeURIComponent(requestUrl.pathname);
  const candidate = resolve(join(distRoot, requestedPath));
  const safePath = relative(distRoot, candidate);
  const isInside = safePath === '' || (!safePath.startsWith('..') && !safePath.includes(`..${'/'}`));
  let filePath = isInside ? candidate : join(distRoot, 'index.html');
  if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = join(distRoot, 'index.html');
  try {
    const body = readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeTypes[extname(filePath)] || 'application/octet-stream');
    res.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600');
    res.end(body);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Unable to read file: ${error.message}`);
  }
}

const server = createServer(async (req, res) => {
  await handleApi(req, res, () => serveStatic(req, res));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Green City AI running at http://127.0.0.1:${port}`);
});
