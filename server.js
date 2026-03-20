// DAZU Messenger Server v2.1
const http   = require('http');
const crypto = require('crypto');
const PORT   = process.env.PORT || 3000;
const MAX_BODY = 12 * 1024 * 1024; // 12MB

const inbox   = {};   // inbox[userId] = [msgs]
const online  = {};   // online[userId] = { lastSeen, name, nodeIp }
const photos  = {};   // photos[userId] = base64 string (temp, cleared after delivery)
const sentPhotosTo = {}; // sentPhotosTo[userId] = Set of recipients already sent photo

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
    const chunks = []; let size = 0;
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

// Mark offline if no ping in 65s
setInterval(() => {
  const now = Date.now();
  for (const uid in online) {
    if (now - online[uid].lastSeen > 65000) delete online[uid];
  }
}, 15000);

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // GET /health
  if (req.method === 'GET' && path === '/health') {
    return json(res, 200, { ok: true,
      users: Object.keys(online).length,
      msgs:  Object.values(inbox).reduce((a,b) => a+b.length, 0) });
  }

  // POST /register  { userId, name, nodeIp, photo? }
  if (req.method === 'POST' && path === '/register') {
    const b = await readBody(req);
    const uid = b.userId || b.from || '';
    if (!uid) return json(res, 400, { error: 'userId required' });
    online[uid] = { nodeIp: b.nodeIp || '', lastSeen: Date.now(), name: b.name || uid };
    // Store photo if provided (base64)
    if (b.photo) {
      photos[uid] = b.photo;
      // Reset "already sent" tracker so all contacts get the new photo
      sentPhotosTo[uid] = new Set();
      log(`PHOTO updated for ${uid}`);
    }
    log(`ONLINE ${uid}`);
    return json(res, 200, { ok: true });
  }

  // POST /send
  if (req.method === 'POST' && path === '/send') {
    const b = await readBody(req);
    const from    = b.from    || b.sender   || '';
    const to      = b.to      || b.receiver || '';
    const content = b.content || b.body     || '';
    const type    = b.type    || 'text';
    if (!from || !to) return json(res, 400, { error: 'from y to requeridos' });

    // Receipts — route back to sender
    if (type === 'delivered' || type === 'read') {
      ensureInbox(to);
      inbox[to].push({ id: b.id || crypto.randomUUID(), from, to,
        body: content, type, timestamp: b.timestamp || new Date().toISOString() });
      return json(res, 200, { ok: true });
    }

    const msg = {
      id:         b.id || crypto.randomUUID(),
      from, to,
      body:       content,
      content:    content,
      type,
      timestamp:  b.timestamp || new Date().toISOString(),
      reactionTo: b.reactionTo || null,
    };

    // Attach sender photo if recipient hasn't received it yet
    if (photos[from]) {
      if (!sentPhotosTo[from]) sentPhotosTo[from] = new Set();
      if (!sentPhotosTo[from].has(to)) {
        msg.senderPhoto = photos[from];
        sentPhotosTo[from].add(to);
        log(`PHOTO sent ${from}→${to}`);
        // Delete photo from memory after all contacts have received it
        // (keep for 10 min max)
        setTimeout(() => {
          if (sentPhotosTo[from] && sentPhotosTo[from].size > 0) {
            // Only delete if no new contacts need it
            delete photos[from];
            delete sentPhotosTo[from];
          }
        }, 10 * 60 * 1000);
      }
    }

    ensureInbox(to);
    inbox[to].push(msg);
    if (inbox[to].length > 300) inbox[to].shift();

    if (online[from]) online[from].lastSeen = Date.now();
    else online[from] = { lastSeen: Date.now(), nodeIp: '' };

    const preview = content.startsWith('data:') ? '[media]' : content.slice(0,40);
    log(`MSG ${from}→${to} [${type}]: ${preview}`);
    return json(res, 200, { ok: true, id: msg.id });
  }

  // GET /inbox?userId=XXX
  if (req.method === 'GET' && path === '/inbox') {
    const { userId } = getParams(req.url);
    if (!userId) return json(res, 400, { error: 'userId required' });

    online[userId] = { ...(online[userId] || {}), lastSeen: Date.now() };

    const messages = inbox[userId] || [];
    inbox[userId] = [];

    const onlineList = Object.keys(online)
      .filter(uid => uid !== userId && Date.now() - online[uid].lastSeen < 65000);

    if (messages.length > 0) log(`INBOX ${userId} → ${messages.length} msgs`);
    return json(res, 200, { messages, online: onlineList });
  }

  // GET /online
  if (req.method === 'GET' && path === '/online') {
    const list = Object.entries(online)
      .filter(([_, v]) => Date.now() - v.lastSeen < 65000)
      .map(([uid, v]) => ({ userId: uid, lastSeen: v.lastSeen }));
    return json(res, 200, { online: list });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  log(`DAZU Server v2.1 on port ${PORT}`);
});
