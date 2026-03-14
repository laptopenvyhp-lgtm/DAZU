const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const fspath = require('path');

const PORT = 3000;

const inbox = {};
const online = {};

function ensureInbox(userId) {
  if (!inbox[userId]) inbox[userId] = [];
}

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

function readBody(req) {
  return new Promise((res) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { res(JSON.parse(data || '{}')); }
      catch { res({}); }
    });
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function getParams(url) {
  const u = new URL(url, 'http://localhost');
  const p = {};
  u.searchParams.forEach((v, k) => p[k] = v);
  return p;
}

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    const htmlPath = fspath.join(__dirname, 'index.html');
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      json(res, 404, { error: 'index.html not found' });
    }
    return;
  }

  if (req.method === 'GET' && path === '/info') {
    json(res, 200, { server: 'DAZU', version: '1.0.0', users: Object.keys(online).length, uptime: Math.floor(process.uptime()) });
    return;
  }

  if (req.method === 'POST' && path === '/register') {
    const body = await readBody(req);
    const { userId, nodeIp } = body;
    if (!userId) return json(res, 400, { error: 'userId requerido' });
    online[userId] = { nodeIp: nodeIp || null, lastSeen: Date.now() };
    ensureInbox(userId);
    log(`REGISTER ${userId} nodeIp=${nodeIp || 'app'}`);
    json(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'POST' && path === '/send') {
    const body = await readBody(req);
    const from    = body.from    || body.sender   || '';
    const to      = body.to      || body.receiver || '';
    const content = body.content || body.body     || '';
    if (!from || !to) return json(res, 400, { error: 'from y to requeridos' });
    const msg = { id: body.id || crypto.randomUUID(), from, to, body: content, type: body.type || 'text', timestamp: body.timestamp || new Date().toISOString() };
    ensureInbox(to);
    inbox[to].push(msg);
    if (inbox[to].length > 200) inbox[to].shift();
    log(`MSG ${from} ? ${to}: "${content.slice(0, 40)}"`);
    json(res, 200, { status: 'ok', id: msg.id });
    return;
  }

  if (req.method === 'GET' && path === '/inbox') {
    const { userId } = getParams(req.url);
    if (!userId) return json(res, 400, { error: 'userId requerido' });
    ensureInbox(userId);
    if (!online[userId]) online[userId] = {};
    online[userId].lastSeen = Date.now();
    const messages = [...inbox[userId]];
    inbox[userId] = [];
    if (messages.length > 0) log(`INBOX ${userId} ? ${messages.length} mensajes`);
    json(res, 200, { messages, acks: [] });
    return;
  }

  if (req.method === 'POST' && path === '/ack') {
    json(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET' && path === '/online') {
    const now = Date.now();
    const active = Object.entries(online).filter(([, v]) => now - v.lastSeen < 30000).map(([userId, v]) => ({ userId, nodeIp: v.nodeIp }));
    json(res, 200, { users: active });
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  log(`DAZU Server corriendo en http://localhost:${PORT}`);
});
