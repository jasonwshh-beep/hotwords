require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const CHANNEL = (process.env.KICK_CHANNEL || '').replace(/^@/, '').trim().toLowerCase();
const ADMIN_PIN = process.env.ADMIN_PIN || '';

let words = (process.env.HOT_WORDS || 'maxwin,bonus,retrigger')
  .split(',')
  .map(w => w.trim().toLowerCase())
  .filter(Boolean);

let counts = Object.fromEntries(words.map(w => [w, 0]));
let recentHits = [];
let recentMessages = [];
let connected = false;
let lastError = null;
let totalMessages = 0;
let startedAt = Date.now();
let kickClient = null;

function normalize(text) {
  return String(text || '').toLowerCase();
}

function snapshot() {
  const sorted = words.map(word => ({ word, count: counts[word] || 0 }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  return {
    channel: CHANNEL,
    connected,
    lastError,
    totalMessages,
    startedAt,
    words: sorted,
    recentHits: recentHits.slice(0, 25),
    recentMessages: recentMessages.slice(0, 25)
  };
}

function emitUpdate() {
  io.emit('state', snapshot());
}

function addMessage(username, text) {
  totalMessages++;
  const msg = normalize(text);
  recentMessages.unshift({ username, text, at: Date.now() });
  recentMessages = recentMessages.slice(0, 50);

  const hitWords = [];
  for (const word of words) {
    if (!word) continue;
    if (msg.includes(word)) {
      counts[word] = (counts[word] || 0) + 1;
      hitWords.push(word);
    }
  }

  if (hitWords.length) {
    recentHits.unshift({ username, text, words: hitWords, at: Date.now() });
    recentHits = recentHits.slice(0, 50);
  }
  emitUpdate();
}

function checkPin(req, res) {
  if (!ADMIN_PIN) return true;
  const pin = req.headers['x-admin-pin'] || req.body.pin || req.query.pin;
  if (pin !== ADMIN_PIN) {
    res.status(401).json({ error: 'Invalid admin PIN' });
    return false;
  }
  return true;
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/overlay', (req, res) => res.sendFile(path.join(__dirname, 'public', 'overlay.html')));
app.get('/api/state', (req, res) => res.json(snapshot()));

app.post('/api/reset', (req, res) => {
  if (!checkPin(req, res)) return;
  counts = Object.fromEntries(words.map(w => [w, 0]));
  recentHits = [];
  recentMessages = [];
  totalMessages = 0;
  startedAt = Date.now();
  emitUpdate();
  res.json({ ok: true });
});

app.post('/api/words', (req, res) => {
  if (!checkPin(req, res)) return;
  const input = Array.isArray(req.body.words) ? req.body.words : String(req.body.words || '').split(',');
  words = input.map(w => String(w).trim().toLowerCase()).filter(Boolean);
  counts = Object.fromEntries(words.map(w => [w, counts[w] || 0]));
  emitUpdate();
  res.json({ ok: true, words });
});

app.post('/api/test-message', (req, res) => {
  if (!checkPin(req, res)) return;
  addMessage(req.body.username || 'TestUser', req.body.text || 'bonus maxwin retrigger');
  res.json({ ok: true });
});

io.on('connection', socket => socket.emit('state', snapshot()));

async function connectKick() {
  if (!CHANNEL) {
    lastError = 'Missing KICK_CHANNEL environment variable';
    console.error(lastError);
    emitUpdate();
    return;
  }

  try {
    let KickClient;
    try {
      ({ KickClient } = require('@retconned/kick-js'));
    } catch (err) {
      lastError = 'Could not load @retconned/kick-js. Run npm install.';
      console.error(lastError, err.message);
      emitUpdate();
      return;
    }

    kickClient = new KickClient(CHANNEL, { logger: false, readOnly: true });

    kickClient.on('ready', () => {
      connected = true;
      lastError = null;
      console.log(`Connected to Kick chat: ${CHANNEL}`);
      emitUpdate();
    });

    kickClient.on('ChatMessage', message => {
      const username = message?.sender?.username || message?.username || message?.sender?.slug || 'unknown';
      const text = message?.content || message?.message || message?.text || '';
      if (text) addMessage(username, text);
    });

    kickClient.on('message', message => {
      const username = message?.sender?.username || message?.username || 'unknown';
      const text = message?.content || message?.message || message?.text || '';
      if (text) addMessage(username, text);
    });

    kickClient.on('error', err => {
      connected = false;
      lastError = err?.message || String(err);
      console.error('Kick error:', lastError);
      emitUpdate();
    });

    kickClient.on('close', () => {
      connected = false;
      lastError = 'Kick connection closed';
      emitUpdate();
    });

    if (typeof kickClient.login === 'function') await kickClient.login();
    else if (typeof kickClient.connect === 'function') await kickClient.connect();
    else throw new Error('Kick library did not expose login/connect method');
  } catch (err) {
    connected = false;
    lastError = err?.message || String(err);
    console.error('Kick connect failed:', lastError);
    emitUpdate();
    setTimeout(connectKick, 15000);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Hot Words app running on port ${PORT}`);
  console.log(`Dashboard: /`);
  console.log(`OBS overlay: /overlay`);
  connectKick();
});
