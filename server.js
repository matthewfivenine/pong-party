// server.js
import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { randomInt } from 'crypto';

const PORT = process.env.PORT || 3000;

// --- Serve index.html ---

const server = http.createServer((req, res) => {
  // ✅ Let WebSocket routes pass through
  if (req.url.startsWith('/party/')) {
    // Do nothing — WS server will handle upgrade
    return;
  }

  // Serve index.html for everything else
  const filePath = path.join(process.cwd(), 'index.html');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading index.html');
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

// --- Game constants ---
const PAD_H = 0.18;
const PAD_MARGIN = 0.025;
const PAD_W = 0.014;
const BALL_R = 0.012;
const SPEED0 = 0.007;
const SPEED_MAX = 0.018;
const SPEED_INC = 0.00025;
const WIN = 7;
const TICK = 1000 / 60; // ms

// --- Rooms management ---
const rooms = new Map();

function newRoom() {
  return {
    host: null,
    guest: null,
    ball: { x: 0.5, y: 0.5 },
    vel: { x: 0, y: 0 },
    pad_l: 0.5 - PAD_H / 2,
    pad_r: 0.5 - PAD_H / 2,
    scores: { left: 0, right: 0 },
    playing: false,
    stop: false,
  };
}

function resetBall(r, dir = 1) {
  r.ball = { x: 0.5, y: 0.5 };
  const angle = Math.random() * 0.5 - 0.25;
  r.vel = { x: Math.cos(angle) * SPEED0 * dir, y: Math.sin(angle) * SPEED0 };
}

function broadcast(r, msg) {
  const data = JSON.stringify(msg);
  ['host', 'guest'].forEach(k => {
    const ws = r[k];
    if (ws && ws.readyState === ws.OPEN) ws.send(data);
  });
}

// --- Game loop ---
function gameLoop(roomId) {
  const r = rooms.get(roomId);
  if (!r) return;

  const loop = () => {
    if (r.stop || !r.playing) return;

    const b = r.ball, v = r.vel;
    const pl = r.pad_l, pr = r.pad_r;

    b.x += v.x;
    b.y += v.y;

    // Bounce top/bottom
    if (b.y - BALL_R < 0) { b.y = BALL_R; v.y = Math.abs(v.y); }
    if (b.y + BALL_R > 1) { b.y = 1 - BALL_R; v.y = -Math.abs(v.y); }

    const lx = PAD_MARGIN;
    const rx = 1 - PAD_MARGIN - PAD_W;

    // Left paddle
    if (v.x < 0 && b.x - BALL_R < lx + PAD_W && b.x + BALL_R > lx && pl < b.y && b.y < pl + PAD_H) {
      const rel = (b.y - (pl + PAD_H / 2)) / (PAD_H / 2);
      const spd = Math.min(Math.hypot(v.x, v.y) + SPEED_INC, SPEED_MAX);
      v.x = spd * Math.cos(rel * 0.75);
      v.y = spd * Math.sin(rel * 0.75);
      b.x = lx + PAD_W + BALL_R;
    }

    // Right paddle
    if (v.x > 0 && b.x + BALL_R > rx && b.x - BALL_R < rx + PAD_W && pr < b.y && b.y < pr + PAD_H) {
      const rel = (b.y - (pr + PAD_H / 2)) / (PAD_H / 2);
      const spd = Math.min(Math.hypot(v.x, v.y) + SPEED_INC, SPEED_MAX);
      v.x = -spd * Math.cos(rel * 0.75);
      v.y = spd * Math.sin(rel * 0.75);
      b.x = rx - BALL_R;
    }

    // Score check
    let scored = null;
    if (b.x + BALL_R < 0) { r.scores.right++; scored = 'right'; }
    if (b.x - BALL_R > 1) { r.scores.left++; scored = 'left'; }

    if (scored) {
      broadcast(r, { type: 'scored', side: scored, scores: r.scores });
      if (r.scores.left >= WIN || r.scores.right >= WIN) {
        const winner = r.scores.left >= WIN ? 'left' : 'right';
        r.playing = false;
        broadcast(r, { type: 'gameover', winner });
        return;
      }
      resetBall(r, r.scores.left > r.scores.right ? 1 : -1);
    } else {
      broadcast(r, { type: 'state', ball: b, padLeft: pl, padRight: pr, scores: r.scores });
    }

    setTimeout(loop, TICK);
  };

  loop();
}

// --- WebSocket server ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Parse room ID from URL: /party/ROOM
  const parts = req.url?.split('/') || [];
  if (parts[1] !== 'party' || !parts[2]) { ws.close(); return; }
  const roomId = decodeURIComponent(parts[2]);

  if (!rooms.has(roomId)) rooms.set(roomId, newRoom());
  const r = rooms.get(roomId);

  let role;
  if (!r.host) { r.host = ws; role = 'host'; ws.send(JSON.stringify({ type: 'assigned', role })); ws.send(JSON.stringify({ type: 'waiting' })); }
  else if (!r.guest) { r.guest = ws; role = 'guest'; ws.send(JSON.stringify({ type: 'assigned', role })); r.playing = true; r.stop = false; r.scores = { left: 0, right: 0 }; r.pad_l = r.pad_r = 0.5 - PAD_H / 2; resetBall(r, Math.random() > 0.5 ? 1 : -1); broadcast(r, { type: 'start' }); gameLoop(roomId); }
  else { role = 'spectator'; ws.send(JSON.stringify({ type: 'assigned', role })); }

  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'input') {
        const y = Math.max(0, Math.min(1 - PAD_H, data.y));
        if (role === 'host') r.pad_l = y;
        if (role === 'guest') r.pad_r = y;
      }
    } catch {}
  });

  ws.on('close', () => {
    if (r.host === ws) r.host = null;
    if (r.guest === ws) r.guest = null;
    r.playing = false;
    r.stop = true;
    if (!r.host && !r.guest) rooms.delete(roomId);
    else broadcast(r, { type: 'waiting' });
  });
});

// --- Start server ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pong-party server running on port ${PORT}`);
});