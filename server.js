'use strict';

const path = require('path');
const crypto = require('crypto');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const WebSocket = require('ws');

const app = Fastify({ logger: true });
const PORT = Number(process.env.PORT || 3000);
const CHANNEL = normalizeChannel(process.env.KICK_CHANNEL || '');
let ADMIN_PIN = String(process.env.ADMIN_PIN || '1234');
const DEFAULT_HOT_WORDS = (process.env.HOT_WORDS || 'left,right,bonus,maxwin,retrigger,juice').split(',').map(s => s.trim()).filter(Boolean);
const MANUAL_CHATROOM_ID = (process.env.KICK_CHATROOM_ID || process.env.CHATROOM_ID || '').trim();
const PUBLIC_DIR = path.join(__dirname, 'public');

let hotWords = Array.from(new Set(DEFAULT_HOT_WORDS.map(w => w.toLowerCase())));
let counts = Object.fromEntries(hotWords.map(w => [w, 0]));
let userCounts = {}; // word -> username -> count
let recentHits = [];
let chatLog = [];
let status = {
  channel: CHANNEL,
  chatroomId: MANUAL_CHATROOM_ID || null,
  connected: false,
  connecting: false,
  lastMessageAt: null,
  startedAt: new Date().toISOString(),
  lastError: null,
  reconnects: 0,
  mode: 'kick-pusher'
};
const clients = new Set();

function normalizeChannel(ch) {
  return String(ch || '').trim().replace(/^https?:\/\/(www\.)?kick\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0].toLowerCase();
}

function ensureWord(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return null;
  if (!counts[w]) counts[w] = 0;
  if (!userCounts[w]) userCounts[w] = {};
  return w;
}

function compileWordRegex(word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // If phrase contains spaces, match phrase case-insensitively. If single word, use word boundaries.
  return word.includes(' ') ? new RegExp(escaped, 'gi') : new RegExp(`\\b${escaped}\\b`, 'gi');
}

function processChatMessage(username, message, source = 'kick') {
  username = String(username || 'unknown').trim() || 'unknown';
  message = String(message || '');
  const lower = message.toLowerCase();
  const now = new Date().toISOString();
  const hits = [];
  for (const word of hotWords) {
    ensureWord(word);
    const re = compileWordRegex(word);
    const matches = lower.match(re);
    if (matches && matches.length) {
      counts[word] += matches.length;
      userCounts[word][username] = (userCounts[word][username] || 0) + matches.length;
      hits.push({ word, count: matches.length });
    }
  }
  const entry = { username, message, source, at: now, hits };
  chatLog.unshift(entry);
  chatLog = chatLog.slice(0, 75);
  if (hits.length) {
    for (const hit of hits) recentHits.unshift({ username, word: hit.word, count: hit.count, message, at: now });
    recentHits = recentHits.slice(0, 50);
    broadcast();
  } else if (chatLog.length % 5 === 0) {
    broadcast();
  }
}

function snapshot() {
  const topWords = hotWords.map(word => ({ word, count: counts[word] || 0 })).sort((a,b)=>b.count-a.count);
  const topUsers = {};
  for (const word of hotWords) {
    const users = userCounts[word] || {};
    topUsers[word] = Object.entries(users).map(([username, count]) => ({ username, count })).sort((a,b)=>b.count-a.count).slice(0, 10);
  }
  return { status, hotWords, counts, topWords, topUsers, recentHits, chatLog };
}

function broadcast() {
  const payload = JSON.stringify({ type: 'snapshot', data: snapshot() });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function requirePin(req, reply) {
  const pin = req.headers['x-admin-pin'] || (req.body && req.body.pin) || (req.query && req.query.pin);
  if (String(pin || '') !== ADMIN_PIN) {
    reply.code(401).send({ ok: false, error: 'Bad admin PIN' });
    return false;
  }
  return true;
}

app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/' });

app.get('/', (_, reply) => reply.sendFile('index.html'));
app.get('/overlay', (_, reply) => reply.sendFile('overlay.html'));
app.get('/api/state', async () => snapshot());
app.post('/api/test-message', async (req, reply) => {
  if (!requirePin(req, reply)) return;
  const { username = 'TestUser', message = 'left right bonus', source = 'test' } = req.body || {};
  processChatMessage(username, message, source);
  return { ok: true };
});
app.post('/api/reset', async (req, reply) => {
  if (!requirePin(req, reply)) return;
  counts = Object.fromEntries(hotWords.map(w => [w, 0]));
  userCounts = {};
  recentHits = [];
  chatLog = [];
  broadcast();
  return { ok: true };
});
app.post('/api/words', async (req, reply) => {
  if (!requirePin(req, reply)) return;
  const words = Array.isArray(req.body?.words) ? req.body.words : String(req.body?.words || '').split(',');
  hotWords = Array.from(new Set(words.map(w => String(w).trim().toLowerCase()).filter(Boolean)));
  for (const w of hotWords) ensureWord(w);
  // remove counts for words no longer tracked
  counts = Object.fromEntries(hotWords.map(w => [w, counts[w] || 0]));
  userCounts = Object.fromEntries(hotWords.map(w => [w, userCounts[w] || {}]));
  broadcast();
  return { ok: true, hotWords };
});
app.get('/api/export.csv', async (_, reply) => {
  const rows = [['word','username','count']];
  for (const word of hotWords) {
    for (const [username, count] of Object.entries(userCounts[word] || {})) rows.push([word, username, count]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  reply.header('Content-Type', 'text/csv').header('Content-Disposition', 'attachment; filename="hotwords.csv"').send(csv);
});

app.server.on('upgrade', (request, socket, head) => {
  if (!request.url.startsWith('/live')) return socket.destroy();
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});
const wss = new WebSocket.Server({ noServer: true });
wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'snapshot', data: snapshot() }));
  ws.on('close', () => clients.delete(ws));
});

async function getChatroomId(channel) {
  if (MANUAL_CHATROOM_ID) return MANUAL_CHATROOM_ID;
  if (!channel) throw new Error('Missing KICK_CHANNEL. Add it in Railway variables.');
  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(channel)}`
  ];
  let lastText = '';
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 KickHotWords/1.0', 'Accept': 'application/json,text/plain,*/*' } });
      lastText = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${lastText.slice(0, 120)}`);
      const data = JSON.parse(lastText);
      const id = data?.chatroom?.id || data?.chatroom_id || data?.livestream?.chatroom_id || data?.user?.chatroom_id;
      if (id) return String(id);
    } catch (err) { status.lastError = `Channel lookup failed at ${url}: ${err.message}`; }
  }
  throw new Error(`Could not find chatroom ID for ${channel}. Kick may be blocking server lookup. Set KICK_CHATROOM_ID manually. Last response: ${lastText.slice(0,150)}`);
}

function parsePusherMessage(raw) {
  let outer;
  try { outer = JSON.parse(raw); } catch { return null; }
  if (outer.event === 'pusher:pong' || outer.event === 'pusher_internal:subscription_succeeded') return null;
  let data = outer.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch {}
  }
  const candidates = [data, data?.message, data?.data, outer];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const content = c.content || c.message || c.text || c.body;
    const sender = c.sender || c.user || c.author || c.chatter || {};
    const username = sender.username || sender.name || sender.slug || c.username || c.sender_username;
    if (content) return { username: username || 'unknown', message: stripHtml(String(content)) };
  }
  return null;
}
function stripHtml(s) { return s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim(); }

async function connectKickLoop() {
  while (true) {
    try {
      status.connecting = true; status.connected = false; broadcast();
      const chatroomId = await getChatroomId(CHANNEL);
      status.chatroomId = chatroomId;
      const protocol = 7;
      const client = 'js';
      const version = '7.6.0';
      const wsUrl = `wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=${protocol}&client=${client}&version=${version}&flash=false`;
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl, { headers: { 'User-Agent': 'Mozilla/5.0 KickHotWords/1.0' } });
        let pingTimer;
        ws.on('open', () => {
          const subscribe = { event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}.v2` } };
          ws.send(JSON.stringify(subscribe));
          pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: 'pusher:ping', data: {} })); }, 30000);
          status.connected = true; status.connecting = false; status.lastError = null; status.reconnects += 1; broadcast();
        });
        ws.on('message', buf => {
          const parsed = parsePusherMessage(buf.toString());
          if (parsed) { status.lastMessageAt = new Date().toISOString(); processChatMessage(parsed.username, parsed.message, 'kick'); }
        });
        ws.on('error', err => { status.lastError = err.message; reject(err); });
        ws.on('close', (code, reason) => { clearInterval(pingTimer); status.connected = false; status.connecting = false; status.lastError = `Kick websocket closed: ${code} ${reason || ''}`; broadcast(); resolve(); });
      });
    } catch (err) {
      status.connected = false; status.connecting = false; status.lastError = err.message; broadcast();
      console.error('Kick connection error:', err);
    }
    await new Promise(r => setTimeout(r, 8000));
  }
}

app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`Kick Hot Words Pro running on port ${PORT}`);
  console.log(`Dashboard: /`);
  console.log(`Overlay: /overlay`);
  connectKickLoop();
}).catch(err => { console.error(err); process.exit(1); });
