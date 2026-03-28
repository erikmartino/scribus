#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const rootDir = process.cwd();
const portArg = process.argv[2];
const port = Number.isInteger(Number(portArg)) && Number(portArg) > 0 ? Number(portArg) : 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function setIsolationHeaders(res) {
  // Cross-origin isolation for SharedArrayBuffer + WASM threading.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  // Keep cross-origin fetches (CDN, blobs) flexible for demos.
  res.setHeader('Access-Control-Allow-Origin', '*');
}

function sendError(res, code, message) {
  res.statusCode = code;
  setIsolationHeaders(res);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

function safeResolvePath(requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const normalized = path.normalize(decoded).replace(/^([.][.][/\\])+/, '');
  const candidate = path.resolve(rootDir, `.${normalized.startsWith('/') ? normalized : `/${normalized}`}`);
  if (!candidate.startsWith(path.resolve(rootDir))) return null;
  return candidate;
}

const server = http.createServer((req, res) => {
  try {
    const parsed = new url.URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = parsed.pathname;

    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = safeResolvePath(pathname);
    if (!filePath) {
      sendError(res, 403, 'Forbidden');
      return;
    }

    fs.stat(filePath, (statErr, stat) => {
      if (statErr) {
        sendError(res, 404, 'Not Found');
        return;
      }

      let finalPath = filePath;
      if (stat.isDirectory()) {
        finalPath = path.join(filePath, 'index.html');
      }

      fs.readFile(finalPath, (readErr, data) => {
        if (readErr) {
          sendError(res, 404, 'Not Found');
          return;
        }

        const ext = path.extname(finalPath).toLowerCase();
        res.statusCode = 200;
        setIsolationHeaders(res);
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.end(data);
      });
    });
  } catch {
    sendError(res, 400, 'Bad Request');
  }
});

server.listen(port, () => {
  console.log(`Serving heavily-threaded webapps at http://localhost:${port}`);
  console.log('Cross-Origin-Isolation headers are ACTIVE (SAB enabled).');
});
