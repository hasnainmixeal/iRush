const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const iosBridge = require('./lib/ios-bridge');

const PORT = process.env.PORT || 54321;
const PUBLIC_DIR = path.join(__dirname, 'public');

const sseClients = new Set();
let hasHadClient = false;
let shutdownTimeout = null;

function broadcastEvent(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function checkAutoShutdown() {
  if (hasHadClient && sseClients.size === 0) {
    if (!shutdownTimeout) {
      shutdownTimeout = setTimeout(() => {
        if (sseClients.size === 0) {
          console.log('UI window closed. Shutting down iRush server...');
          process.exit(0);
        }
      }, 2500);
    }
  } else {
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
      shutdownTimeout = null;
    }
  }
}

iosBridge.on('device-connected', (data) => broadcastEvent('device-connected', data));
iosBridge.on('device-disconnected', () => broadcastEvent('device-disconnected', {}));
iosBridge.on('scan-error', (msg) => broadcastEvent('scan-error', { error: msg }));
iosBridge.on('host-app-changed', (app) => broadcastEvent('host-app-changed', app));

iosBridge.startMonitoring(2000);

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Size, X-File-Name');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // 1. Status API
  if (url.pathname === '/api/status' && req.method === 'GET') {
    hasHadClient = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(iosBridge.getStatus()));
    return;
  }

  // 2. Apps API
  if (url.pathname === '/api/apps' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      current: iosBridge.primaryApp,
      available: iosBridge.availableApps || []
    }));
    return;
  }

  // 3. Switch Host App API
  if (url.pathname === '/api/set-app' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const selected = iosBridge.setHostApp(parsed.id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: !!selected, app: selected }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 4. Real-time Events Stream (SSE)
  if (url.pathname === '/api/events' && req.method === 'GET') {
    hasHadClient = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    checkAutoShutdown();

    req.on('close', () => {
      sseClients.delete(res);
      checkAutoShutdown();
    });
    return;
  }

  // 5. Graceful Shutdown on Window Close
  if (url.pathname === '/api/shutdown' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    setTimeout(() => {
      console.log('UI closed. Exiting server...');
      process.exit(0);
    }, 400);
    return;
  }

  // 6. Pure High-Speed USB File Upload (Automatic Classification & Buffering)
  if (url.pathname === '/api/upload-raw' && req.method === 'POST') {
    const status = iosBridge.getStatus();
    if (!status.connected) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No iPhone connected. Connect your iPhone via USB cable.' }));
      return;
    }

    const filename = decodeURIComponent(url.searchParams.get('filename') || req.headers['x-file-name'] || 'file');
    const fileSize = parseInt(req.headers['x-file-size'] || req.headers['content-length'] || '0', 10);

    broadcastEvent('transfer-start', { filename, fileSize });

    try {
      const result = await iosBridge.transferFile({
        filename,
        fileSize,
        readStream: req,
        onProgress: (progress) => {
          broadcastEvent('transfer-progress', progress);
        }
      });
      broadcastEvent('transfer-complete', result);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, file: result }));
    } catch (err) {
      console.error('USB Transfer Error:', err);
      broadcastEvent('transfer-error', { filename, error: err.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 7. Static Files (HTML, CSS, JS)
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`iRush server running on http://127.0.0.1:${PORT}`);
});
