#!/usr/bin/env node

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const rootDir = process.cwd();
const storeDir = path.join(rootDir, 'store');
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
  // DTP / print-relevant formats
  '.pdf': 'application/pdf',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.eps': 'application/postscript',
  '.ai': 'application/postscript',
  '.psd': 'image/vnd.adobe.photoshop',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.icc': 'application/vnd.iccprofile',
  '.icm': 'application/vnd.iccprofile',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
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

// ---------------------------------------------------------------------------
// Document store — GET / PUT / DELETE under /store/{user}/{doc}/{path...}
// ---------------------------------------------------------------------------

function safeResolveStorePath(pathname) {
  // Strip the /store prefix and resolve against storeDir.
  const relative = pathname.replace(/^\/store\/?/, '');
  const decoded = decodeURIComponent(relative);
  const fullPath = path.resolve(storeDir, decoded);
  if (!fullPath.startsWith(path.resolve(storeDir))) return null;
  return fullPath;
}

// Recursively list all files under `dir`, returning paths relative to `base`.
function listFilesRecursive(dir, base, callback) {
  const results = [];
  const walk = (current, done) => {
    fs.readdir(current, { withFileTypes: true }, (err, entries) => {
      if (err) { done(err); return; }
      let pending = entries.length;
      if (pending === 0) { done(null); return; }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full, (walkErr) => {
            if (walkErr) { done(walkErr); return; }
            if (--pending === 0) done(null);
          });
        } else {
          results.push(path.relative(base, full));
          if (--pending === 0) done(null);
        }
      }
    });
  };
  walk(dir, (err) => callback(err, results));
}

// Aggregate JSON entries from a directory.  Collects from two sources:
//   1. Any .json files directly in the directory  (flat collections)
//   2. meta.json inside each immediate subdirectory (per-entry folders)
// Returns them as a single sorted array via callback(err, items).
function aggregateJsonFiles(dirPath, callback) {
  fs.readdir(dirPath, { withFileTypes: true }, (err, entries) => {
    if (err) { callback(err, null); return; }

    // Build list of JSON file paths to read, keyed for sort order.
    const filesToRead = []; // { sortKey, filePath }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        filesToRead.push({ sortKey: entry.name, filePath: path.join(dirPath, entry.name) });
      } else if (entry.isDirectory()) {
        const metaPath = path.join(dirPath, entry.name, 'meta.json');
        filesToRead.push({ sortKey: entry.name, filePath: metaPath });
      }
    }

    filesToRead.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    if (filesToRead.length === 0) { callback(null, []); return; }

    const results = [];
    let pending = filesToRead.length;
    let failed = false;

    for (let i = 0; i < filesToRead.length; i++) {
      const { filePath: fp, sortKey } = filesToRead[i];
      const idx = i;
      fs.readFile(fp, 'utf-8', (readErr, data) => {
        if (failed) return;
        if (readErr) {
          // Subdirectory without meta.json — skip silently.
          results[idx] = null;
          if (--pending === 0) callback(null, results.filter(r => r !== null));
          return;
        }
        try {
          results[idx] = JSON.parse(data);
        } catch (parseErr) {
          failed = true;
          callback(new Error(`Bad JSON in ${sortKey}: ${parseErr.message}`), null);
          return;
        }
        if (--pending === 0) callback(null, results.filter(r => r !== null));
      });
    }
  });
}

// Recursively copy a directory tree from `src` to `dest`.
// Calls callback(err) when done.
function copyDirRecursive(src, dest, callback) {
  fs.mkdir(dest, { recursive: true }, (mkdirErr) => {
    if (mkdirErr) { callback(mkdirErr); return; }
    fs.readdir(src, { withFileTypes: true }, (readErr, entries) => {
      if (readErr) { callback(readErr); return; }
      if (entries.length === 0) { callback(null); return; }
      let pending = entries.length;
      let failed = false;
      for (const entry of entries) {
        if (failed) return;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          copyDirRecursive(srcPath, destPath, (err) => {
            if (failed) return;
            if (err) { failed = true; callback(err); return; }
            if (--pending === 0) callback(null);
          });
        } else {
          fs.copyFile(srcPath, destPath, (cpErr) => {
            if (failed) return;
            if (cpErr) { failed = true; callback(cpErr); return; }
            if (--pending === 0) callback(null);
          });
        }
      }
    });
  });
}

function handleStoreRequest(req, res, pathname) {
  const method = req.method;

  // --- /edit suffix: serve the story editor for a store story ---
  // GET /store/{user}/{doc}/stories/{storyId}/edit
  //   → serve story-editor/index.html (the editor reads its own URL to
  //     derive the document path and story id).
  if (method === 'GET' && pathname.endsWith('/edit')) {
    const editorPath = path.join(rootDir, 'story-editor', 'index.html');
    serveFile(editorPath, res);
    return;
  }

  // --- Aggregation via virtual file extension ---
  // GET .../styles/paragraph.aggregate.json
  //   → read all .json files in .../styles/paragraph/ and return as array.
  if (method === 'GET' && pathname.endsWith('.aggregate.json')) {
    const dirPathname = pathname.slice(0, -'.aggregate.json'.length);
    const dirPath = safeResolveStorePath(dirPathname);
    if (!dirPath) {
      sendError(res, 400, 'Bad Request: invalid path');
      return;
    }
    fs.stat(dirPath, (statErr, stat) => {
      if (statErr || !stat.isDirectory()) {
        sendError(res, 404, 'Not Found');
        return;
      }
      aggregateJsonFiles(dirPath, (aggErr, items) => {
        if (aggErr) {
          sendError(res, 500, `Aggregation failed: ${aggErr.message}`);
          return;
        }
        res.statusCode = 200;
        setIsolationHeaders(res);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(items, null, 2));
      });
    });
    return;
  }

  // --- POST: copy (instantiate) a document from a template ---
  // POST /store/{user}/{newDoc}
  // Body: { "from": "{user}/{sourceDoc}" }
  // Recursively copies the source document directory to the target path.
  // Returns 409 if the target already exists, 404 if source is missing.
  // Updates document.json with fresh created/modified timestamps.
  if (method === 'POST') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      } catch {
        sendError(res, 400, 'Bad Request: invalid JSON body');
        return;
      }
      if (!body.from || typeof body.from !== 'string') {
        sendError(res, 400, 'Bad Request: "from" field is required');
        return;
      }

      const destPath = safeResolveStorePath(pathname);
      const srcPath = safeResolveStorePath(`/store/${body.from}`);
      if (!destPath || !srcPath) {
        sendError(res, 400, 'Bad Request: invalid path');
        return;
      }

      // Source must exist and be a directory
      fs.stat(srcPath, (srcErr, srcStat) => {
        if (srcErr || !srcStat.isDirectory()) {
          sendError(res, 404, `Source not found: ${body.from}`);
          return;
        }

        // Destination must not already exist
        fs.stat(destPath, (destErr) => {
          if (!destErr) {
            sendError(res, 409, `Conflict: ${pathname.replace(/^\/store\//, '')} already exists`);
            return;
          }

          copyDirRecursive(srcPath, destPath, (copyErr) => {
            if (copyErr) {
              sendError(res, 500, `Copy failed: ${copyErr.message}`);
              return;
            }

            // Update document.json timestamps
            const docJsonPath = path.join(destPath, 'document.json');
            fs.readFile(docJsonPath, 'utf-8', (readErr, data) => {
              if (readErr) {
                // No document.json — still a valid copy, just skip patching
                res.statusCode = 201;
                setIsolationHeaders(res);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ path: pathname.replace(/^\/store\//, '') }));
                return;
              }
              try {
                const doc = JSON.parse(data);
                const now = new Date().toISOString();
                doc.created = now;
                doc.modified = now;
                fs.writeFile(docJsonPath, JSON.stringify(doc, null, 2) + '\n', (writeErr) => {
                  if (writeErr) {
                    sendError(res, 500, `Copy succeeded but failed to update document.json: ${writeErr.message}`);
                    return;
                  }
                  res.statusCode = 201;
                  setIsolationHeaders(res);
                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                  res.end(JSON.stringify({ path: pathname.replace(/^\/store\//, '') }));
                });
              } catch (parseErr) {
                // Malformed document.json — copy is still valid
                res.statusCode = 201;
                setIsolationHeaders(res);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ path: pathname.replace(/^\/store\//, '') }));
              }
            });
          });
        });
      });
    });
    return;
  }

  const filePath = safeResolveStorePath(pathname);
  if (!filePath) {
    sendError(res, 400, 'Bad Request: invalid path');
    return;
  }

  // --- PUT: write a file, creating parent dirs as needed ---
  if (method === 'PUT') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const data = Buffer.concat(chunks);
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
      } catch (mkdirErr) {
        sendError(res, 500, `Cannot create directory: ${mkdirErr.message}`);
        return;
      }
      const existed = fs.existsSync(filePath);
      fs.writeFile(filePath, data, (writeErr) => {
        if (writeErr) {
          sendError(res, 500, `Write failed: ${writeErr.message}`);
          return;
        }
        res.statusCode = existed ? 200 : 201;
        setIsolationHeaders(res);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(existed ? 'Updated' : 'Created');
      });
    });
    return;
  }

  // --- DELETE: remove a file ---
  if (method === 'DELETE') {
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) {
        sendError(res, 404, 'Not Found');
        return;
      }
      res.statusCode = 204;
      setIsolationHeaders(res);
      res.end();
    });
    return;
  }

  // --- GET: serve file or directory listing ---
  if (method !== 'GET') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  fs.stat(filePath, (statErr, stat) => {
    if (statErr) {
      sendError(res, 404, 'Not Found');
      return;
    }

    if (stat.isDirectory()) {
      listFilesRecursive(filePath, filePath, (listErr, files) => {
        if (listErr) {
          sendError(res, 500, `Listing failed: ${listErr.message}`);
          return;
        }
        files.sort();
        res.statusCode = 200;
        setIsolationHeaders(res);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(files, null, 2));
      });
      return;
    }

    serveFile(filePath, res);
  });
}

// ---------------------------------------------------------------------------
// Main request handler
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  try {
    const parsed = new url.URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsed.pathname;

    // Document store routes.
    if (pathname.startsWith('/store')) {
      handleStoreRequest(req, res, pathname);
      return;
    }

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
  console.log(`Document store API at http://localhost:${port}/store/`);
});
