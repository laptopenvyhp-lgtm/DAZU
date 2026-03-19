// DAZU Messenger Server v2.0
// node server.js  |  PORT=3000

const http   = require('http');
const crypto = require('crypto');
const PORT   = process.env.PORT || 3000;
const MAX_BODY = 10 * 1024 * 1024; // 10MB to support base64 images

const inbox  = {};  // inbox[userId] = [msgs]
const online = {};  // online[userId] = { nodeIp, lastSeen }

function log(m) { console.log(`[${new Date().toISOString().slice(11,19)}] ${m}`); }

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function json(res, status, obj) {
  cors(res);
  res.writeHead(status, {'Content-Type':'application/json'});
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { resolve({}); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { resolve({}); }
    });
  });
}

function getParams(url) {
  const p = {};
  new URL(url, 'http://x').searchParams.forEach((v,k) => p[k]=v);
  return p;
}

function ensureInbox(uid) { if (!inbox[uid]) inbox[uid] = []; }

// Mark users offline if not pinged in 60s
setInterval(() => {
  const now = Date.now();
  for (const uid in online) {
    if (now - online[uid].lastSeen > 60000) delete online[uid];
  }
}, 15000);

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // ── GET /health
  if (req.method === 'GET' && path === '/health') {
    return json(res, 200, { ok: true, users: Object.keys(online).length,
      msgs: Object.values(inbox).reduce((a,b) => a + b.length, 0) });
  }

  // ── POST /register
  if (req.method === 'POST' && path === '/register') {
    const b = await readBody(req);
    const uid = b.userId || b.from || '';
    if (!uid) return json(res, 400, { error: 'userId required' });
    online[uid] = { nodeIp: b.nodeIp || '', lastSeen: Date.now(), name: b.name || uid };
    log(`ONLINE ${uid}`);
    return json(res, 200, { ok: true });
  }

  // ── POST /send
  if (req.method === 'POST' && path === '/send') {
    const b = await readBody(req);
    const from    = b.from    || b.sender   || '';
    const to      = b.to      || b.receiver || '';
    const content = b.content || b.body     || '';
    const type    = b.type    || 'text';
    if (!from || !to) return json(res, 400, { error: 'from y to requeridos' });

    // Handle delivery/read receipts — route back to sender
    if (type === 'delivered' || type === 'read') {
      ensureInbox(to);
      inbox[to].push({ id: b.id || crypto.randomUUID(), from, to,
        body: content, type, timestamp: b.timestamp || new Date().toISOString() });
      return json(res, 200, { ok: true });
    }

    const msg = {
      id:         b.id || crypto.randomUUID(),
      from,  to,
      body:       content,
      content:    content,
      type,
      timestamp:  b.timestamp || new Date().toISOString(),
      reactionTo: b.reactionTo || null,
    };

    ensureInbox(to);
    inbox[to].push(msg);
    if (inbox[to].length > 300) inbox[to].shift();

    // Update sender's last seen
    if (online[from]) online[from].lastSeen = Date.now();
    else online[from] = { lastSeen: Date.now(), nodeIp: '' };

    const preview = content.startsWith('data:') ? '[media]' : content.slice(0,40);
    log(`MSG ${from}→${to} [${type}]: ${preview}`);
    return json(res, 200, { ok: true, id: msg.id });
  }

  // ── GET /inbox?userId=XXX
  if (req.method === 'GET' && path === '/inbox') {
    const { userId } = getParams(req.url);
    if (!userId) return json(res, 400, { error: 'userId required' });

    // Update last seen
    online[userId] = { ...(online[userId] || {}), lastSeen: Date.now() };

    const messages = inbox[userId] || [];
    inbox[userId] = []; // clear after delivery

    // Build online users list (active in last 60s)
    const onlineList = Object.keys(online)
      .filter(uid => uid !== userId && Date.now() - online[uid].lastSeen < 60000);

    if (messages.length > 0) log(`INBOX ${userId} → ${messages.length} msgs`);
    return json(res, 200, { messages, online: onlineList });
  }

  // ── GET /online — who is online
  if (req.method === 'GET' && path === '/online') {
    const onlineList = Object.entries(online)
      .filter(([_, v]) => Date.now() - v.lastSeen < 60000)
      .map(([uid, v]) => ({ userId: uid, lastSeen: v.lastSeen }));
    return json(res, 200, { online: onlineList });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  log(`DAZU Server v2.0 on port ${PORT}`);
  log(`  POST /register  { userId, nodeIp? }`);
  log(`  POST /send      { from, to, content/body, type?, reactionTo? }`);
  log(`  GET  /inbox?userId=XXX`);
  log(`  GET  /online`);
  log(`  GET  /health`);
});