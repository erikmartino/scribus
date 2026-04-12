#!/usr/bin/env node

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const rootDir = process.cwd();
const portArg = process.argv[2];
const parsedPort = Number(portArg);
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 8000;

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

const VENDOR_MAP = {
  '/vendor/harfbuzzjs/hb.wasm': 'https://cdn.jsdelivr.net/npm/harfbuzzjs@0.3.6/hb.wasm',
  '/vendor/harfbuzzjs/hbjs.js': 'https://cdn.jsdelivr.net/npm/harfbuzzjs@0.3.6/hbjs.js',
  '/vendor/hyphen/en.js': 'https://cdn.jsdelivr.net/npm/hyphen@1.10.4/en/+esm',
  '/vendor/fonts/EBGaramond.ttf': 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf',
  '/vendor/fonts/EBGaramond-Italic.ttf': 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf',
  '/vendor/wasm-vips/vips-es6.js': 'https://cdn.jsdelivr.net/npm/wasm-vips@0.0.17/lib/vips-es6.js',
  '/vendor/css-tree/index.js': 'https://cdn.jsdelivr.net/npm/css-tree@2.3.1/+esm',
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

function escapeHtml(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeResolvePath(requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const fullPath = path.resolve(rootDir, `.${decoded}`);
  const resolvedRoot = path.resolve(rootDir);
  if (!fullPath.startsWith(resolvedRoot)) return null;
  return fullPath;
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (readErr, data) => {
    if (readErr) {
      sendError(res, 404, 'Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    setIsolationHeaders(res);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  });
}

function handleVendorRequest(pathname, filePath, res) {
  const cdnUrl = VENDOR_MAP[pathname];
  if (!cdnUrl) {
    sendError(res, 404, 'Not Found');
    return;
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const fetchVendor = (url, depth = 0) => {
    if (depth > 5) {
      sendError(res, 508, 'Too Many Redirects');
      return;
    }

    console.log(`[VENDOR] ${depth === 0 ? 'Fetching' : 'Redirect to'} ${url}`);
    
    https.get(url, (cdnRes) => {
      if (cdnRes.statusCode === 301 || cdnRes.statusCode === 302) {
        const redirectUrl = cdnRes.headers.location;
        if (!redirectUrl) {
          sendError(res, 502, 'Bad Gateway: Missing Location Header');
          return;
        }
        fetchVendor(redirectUrl, depth + 1);
        return;
      }

      if (cdnRes.statusCode !== 200) {
        sendError(res, cdnRes.statusCode, `CDN Fetch Failed: ${cdnRes.statusCode}`);
        return;
      }

      const chunks = [];
      cdnRes.on('data', chunk => chunks.push(chunk));
      cdnRes.on('end', () => {
        const data = Buffer.concat(chunks);
        fs.writeFileSync(filePath, data);
        serveFile(filePath, res);
      });
    }).on('error', (err) => {
      sendError(res, 500, `CDN Fetch Error: ${err.message}`);
    });
  };

  fetchVendor(cdnUrl);
}

function serveDirectoryListing(dirPath, requestPath, res) {
  fs.readdir(dirPath, { withFileTypes: true }, (dirErr, entries) => {
    if (dirErr) {
      sendError(res, 404, 'Not Found');
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    const basePath = requestPath.endsWith('/') ? requestPath : `${requestPath}/`;
    const parentPath = basePath === '/' ? null : basePath.split('/').slice(0, -2).join('/') || '/';

    let links = '';
    if (parentPath) {
      links += `<li><a href="${encodeURI(parentPath)}">../</a></li>`;
    }

    for (const entry of entries) {
      const name = entry.name;
      const display = entry.isDirectory() ? `${name}/` : name;
      const href = `${basePath}${encodeURIComponent(name)}${entry.isDirectory() ? '/' : ''}`;
      links += `<li><a href="${href}">${escapeHtml(display)}</a></li>`;
    }

    const title = `Directory listing for ${requestPath}`;
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <hr>
  <ul>${links}</ul>
  <hr>
</body>
</html>`;

    res.statusCode = 200;
    setIsolationHeaders(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
}

const server = http.createServer((req, res) => {
  try {
    const parsed = new url.URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsed.pathname;
    const filePath = safeResolvePath(pathname);

    if (!filePath) {
      sendError(res, 403, 'Forbidden');
      return;
    }

    fs.stat(filePath, (statErr, stat) => {
      if (statErr) {
        if (pathname.startsWith('/vendor/')) {
          handleVendorRequest(pathname, filePath, res);
          return;
        }
        sendError(res, 404, 'Not Found');
        return;
      }

      if (stat.isDirectory()) {
        if (!pathname.endsWith('/')) {
          res.statusCode = 301;
          setIsolationHeaders(res);
          res.setHeader('Location', `${pathname}/${parsed.search}`);
          res.end();
          return;
        }

        const indexPath = path.join(filePath, 'index.html');
        fs.stat(indexPath, (indexErr, indexStat) => {
          if (!indexErr && indexStat.isFile()) {
            serveFile(indexPath, res);
            return;
          }
          serveDirectoryListing(filePath, pathname, res);
        });
        return;
      }

      serveFile(filePath, res);
    });
  } catch {
    sendError(res, 400, 'Bad Request');
  }
});

server.listen(port, () => {
  console.log(`Serving heavily-threaded webapps at http://localhost:${port}`);
  console.log('Cross-Origin-Isolation headers are ACTIVE (SAB enabled).');
});
