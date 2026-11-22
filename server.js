/*
 * Print Test — A4 barcode print test tool + mobile validator
 * Minimal dependency-free HTTP server (static files + session API).
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PORT = process.env.PORT || 8080;
const HTTPS_PORT = process.env.HTTPS_PORT || 8443;
const HOST = process.env.HOST || '0.0.0.0';
const CERT_DIR = path.join(__dirname, 'cert');
const CERT_KEY = path.join(CERT_DIR, 'server.key');
const CERT_CRT = path.join(CERT_DIR, 'server.crt');

// iOS Safari exposes navigator.mediaDevices (getUserMedia) only in a secure
// context, i.e. over HTTPS. Generate a self-signed cert once so the phone can
// open the validator via https:// and use the camera.
function ensureCert() {
  try {
    if (fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT)) return true;
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const cn = (lanIPs()[0] || 'localhost');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '3650', '-nodes',
      '-keyout', CERT_KEY, '-out', CERT_CRT,
      '-subj', '/CN=' + cn,
      '-addext', 'subjectAltName=DNS:localhost,IP:' + cn + ',IP:127.0.0.1'
    ], { stdio: 'ignore' });
    return true;
  } catch (e) {
    console.error('HTTPS disabled (could not create self-signed cert):', e.message);
    return false;
  }
}

function lanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}
const PUBLIC = path.join(__dirname, 'public');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

// ---- session store (file-backed) ----
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (_) {}

function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions)); } catch (e) {
    console.error('Could not persist sessions:', e.message);
  }
}

function makeCode() {
  // 4-char code from unambiguous alphabet
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do {
    c = Array.from({ length: 4 }, () => alpha[crypto.randomInt(alpha.length)]).join('');
  } while (sessions[c]);
  return c;
}

function send(res, status, type, body, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type }, extra || {}));
  res.end(body);
}

function sendJSON(res, status, obj) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), {
    'Cache-Control': 'no-store'
  });
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let p = urlPath === '/' ? '/index.html' : urlPath;
  p = p.split('?')[0].split('#')[0];
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'text/plain', 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err && !path.extname(file)) {
      // extensionless URL -> try .html
      return fs.readFile(file + '.html', (err2, data2) => {
        if (err2) return send(res, 404, 'text/plain; charset=utf-8', '404 Not Found: ' + p);
        send(res, 200, MIME['.html'], data2, { 'Cache-Control': 'no-cache' });
      });
    }
    if (err) return send(res, 404, 'text/plain; charset=utf-8', '404 Not Found: ' + p);
    send(res, 200, MIME[path.extname(file)] || 'application/octet-stream', data, {
      'Cache-Control': file.includes('/vendor/') ? 'public, max-age=86400' : 'no-cache'
    });
  });
}

const httpHandler = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // ---- API: create session ----
    if (p === '/api/sessions' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return sendJSON(res, 400, { error: 'items[] required' });
      }
      const code = makeCode();
      sessions[code] = {
        code,
        created: new Date().toISOString(),
        title: String(body.title || 'A4 Barcode Test Sheet').slice(0, 120),
        opts: body.opts || {},
        items: body.items
      };
      saveSessions();
      return sendJSON(res, 200, { code });
    }

    // ---- API: config (does the phone need the https:// URL for camera?) ----
    if (p === '/api/config' && req.method === 'GET') {
      return sendJSON(res, 200, { https: httpsReady, httpsPort: Number(HTTPS_PORT) });
    }

    // ---- API: read session ----
    const m = p.match(/^\/api\/sessions\/([A-Z0-9]{3,8})$/i);
    if (m && req.method === 'GET') {
      const s = sessions[m[1].toUpperCase()];
      if (!s) return sendJSON(res, 404, { error: 'Unknown session code' });
      return sendJSON(res, 200, s);
    }

    // ---- short link: /v/CODE -> /validate#CODE ----
    const v = p.match(/^\/v\/([A-Z0-9]{3,8})$/i);
    if (v && req.method === 'GET') {
      res.writeHead(302, { Location: '/validate#' + v[1].toUpperCase() });
      return res.end();
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'text/plain', 'Method not allowed');
    }
    return serveStatic(req, res, p);
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: e.message });
  }
};

const server = http.createServer(httpHandler);

const httpsReady = ensureCert();

server.listen(PORT, HOST, () => {
  const ips = lanIPs();
  console.log('==========================================================');
  console.log('  Print Test — barcode print tester & mobile validator');
  console.log('==========================================================');
  console.log('  Local:    http://localhost:' + PORT);
  for (const ip of ips) {
    console.log('  Network:  http://' + ip + ':' + PORT);
    if (httpsReady) {
      console.log('  Phone:    https://' + ip + ':' + HTTPS_PORT + '   <-- use THIS on your phone (camera needs HTTPS)');
    }
  }
  if (httpsReady) {
    console.log('  Note:     self-signed cert — on iOS tap "Show Details" > "visit this website" to accept it.');
  } else {
    console.log('  Note:     no HTTPS (openssl missing?) — phone camera will NOT work over http; use manual result buttons.');
  }
  console.log('  Desktop:  /           (generate & print A4 test sheet)');
  console.log('  Mobile:   /validate   (scan & verify printed barcodes)');
  console.log('==========================================================');
});

if (httpsReady) {
  try {
    https.createServer({ key: fs.readFileSync(CERT_KEY), cert: fs.readFileSync(CERT_CRT) }, httpHandler).listen(HTTPS_PORT, HOST, () => {
      console.log('  HTTPS:    listening on port ' + HTTPS_PORT);
    });
  } catch (e) {
    console.error('HTTPS server failed to start:', e.message);
  }
}
