'use strict';

const express  = require('express');
const webpush  = require('web-push');
const WebSocket = require('ws');
const fs       = require('fs');
const path     = require('path');
const http     = require('http');

// ── VAPID Keys ────────────────────────────────────────────────────────────────
// Priority: environment variables (production) → vapid-keys.json (local dev)
let vapidKeys;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidKeys = {
    publicKey:  process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY
  };
} else {
  const VAPID_FILE = path.join(__dirname, 'vapid-keys.json');
  if (fs.existsSync(VAPID_FILE)) {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
  } else {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
    console.log('Generated new VAPID keys → vapid-keys.json');
  }
}
webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:admin@nadiacornishclassic.local',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// ── Static tournament data ────────────────────────────────────────────────────
const COURSE_HOLES = {
  day1: [
    {par:4},{par:4},{par:3},{par:4},{par:4},{par:4},{par:4},{par:3},{par:5},
    {par:4},{par:3},{par:3},{par:4},{par:4},{par:3},{par:3},{par:5},{par:4}
  ],
  day2: [
    {par:3},{par:4},{par:4},{par:4},{par:3},{par:4},{par:3},{par:4},{par:4},
    {par:4},{par:4},{par:5},{par:4},{par:4},{par:3},{par:5},{par:3},{par:4}
  ]
};

const TEAMS = {
  day1: [
    {id:0,team:['Baz','Jake']},  {id:1,team:['Sam','Mahon']},
    {id:2,team:['Phil','Chanks']},{id:3,team:['Ceej','LG']},
    {id:4,team:['Matt','Josh']}
  ],
  day2: [
    {id:0,team:['Matt','Josh']}, {id:1,team:['Baz','Jake']},
    {id:2,team:['Phil','Chanks']},{id:3,team:['Sam','Mahon']},
    {id:4,team:['Ceej','LG']}
  ]
};

// ── In-memory state ───────────────────────────────────────────────────────────
const scores  = { day1: {}, day2: {} };
const teeOffs = { day1: {}, day2: {} };
for (let id = 0; id < 5; id++) {
  scores.day1[id]  = Array(18).fill('');
  scores.day2[id]  = Array(18).fill('');
  teeOffs.day1[id] = Array(18).fill('');
  teeOffs.day2[id] = Array(18).fill('');
}

let subscriptions = []; // active push subscriptions

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Expose the VAPID public key so clients can subscribe
app.get('/api/public-key', (_req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// Return current full state (WebSocket handles real-time; this is a fallback)
app.get('/api/scores', (_req, res) => {
  res.json({ scores, teeOffs });
});

// Save a push subscription
app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  if (!subscriptions.some(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
  }
  console.log(`[push] subscribed — total: ${subscriptions.length}`);
  res.json({ ok: true });
});

// Remove a push subscription
app.delete('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  subscriptions = subscriptions.filter(s => s.endpoint !== endpoint);
  console.log(`[push] unsubscribed — total: ${subscriptions.length}`);
  res.json({ ok: true });
});

// Update a single hole score
app.post('/api/score', (req, res) => {
  const { day, teamId, holeIndex, score } = req.body;
  const tid    = parseInt(teamId, 10);
  const hi     = parseInt(holeIndex, 10);
  const dayKey = `day${day}`;

  if (!scores[dayKey] || scores[dayKey][tid] === undefined) {
    return res.status(400).json({ error: 'Invalid day or team' });
  }

  const prevScore = scores[dayKey][tid][hi];
  scores[dayKey][tid][hi] = score;

  // Detect birdie / eagle on new valid scores
  const par      = COURSE_HOLES[dayKey][hi].par;
  const scoreNum = parseInt(score, 10);
  const prevNum  = parseInt(prevScore, 10);
  let notifType  = null;

  if (scoreNum && !isNaN(scoreNum) && scoreNum !== prevNum) {
    const diff = par - scoreNum;
    if      (diff >= 3) notifType = 'albatross';
    else if (diff === 2) notifType = 'eagle';
    else if (diff === 1) notifType = 'birdie';
  }

  // Broadcast to all WebSocket clients
  broadcast({ type: 'score_update', allScores: scores, teeOffs });

  // Send push notifications on birdie / eagle / albatross
  if (notifType) {
    const team = TEAMS[dayKey].find(t => t.id === tid);
    const teamName = team ? team.team.join(' & ') : `Team ${tid + 1}`;
    const holeNum  = hi + 1;
    const label    = notifType === 'albatross' ? 'Albatross!'
                   : notifType === 'eagle'     ? 'Eagle!'
                   : 'Birdie!';
    const title = `${label} — ${teamName}`;
    const body  = `Hole ${holeNum}  ·  Score ${scoreNum}  ·  Par ${par}  ·  Day ${day}`;
    console.log(`[notif] ${title} | ${body}`);
    sendPush({ title, body, data: { day, teamId: tid, holeIndex: hi, notifType } });
  }

  res.json({ ok: true, notifType });
});

// Update a tee-off assignment
app.post('/api/teeoff', (req, res) => {
  const { day, teamId, holeIndex, player } = req.body;
  const tid    = parseInt(teamId, 10);
  const hi     = parseInt(holeIndex, 10);
  const dayKey = `day${day}`;

  if (!teeOffs[dayKey] || teeOffs[dayKey][tid] === undefined) {
    return res.status(400).json({ error: 'Invalid day or team' });
  }

  teeOffs[dayKey][tid][hi] = player;
  broadcast({ type: 'teeoff_update', allScores: scores, teeOffs });
  res.json({ ok: true });
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

wss.on('connection', ws => {
  // Send the full current state to the newly connected client
  ws.send(JSON.stringify({ type: 'init', allScores: scores, teeOffs }));
  ws.on('error', err => console.error('[ws error]', err.message));
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

function sendPush({ title, body, data }) {
  const payload  = JSON.stringify({ title, body, data });
  const invalid  = [];

  subscriptions.forEach(sub => {
    webpush.sendNotification(sub, payload).catch(err => {
      if (err.statusCode === 410 || err.statusCode === 404) {
        invalid.push(sub.endpoint); // expired / invalid subscription
      } else {
        console.error('[push error]', err.statusCode, err.message);
      }
    });
  });

  if (invalid.length) {
    subscriptions = subscriptions.filter(s => !invalid.includes(s.endpoint));
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n⛳  Nadia Cornish Classic — Live Server`);
  console.log(`   http://localhost:${PORT}\n`);
});
