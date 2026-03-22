import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;

// --- HTTP SERVER ---
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/party/')) return; // allow WS upgrade

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

// --- GAME CONSTANTS ---
const PAD_H = 0.18;
const PAD_MARGIN = 0.025;
const PAD_W = 0.014;
const BALL_R = 0.012;
const SPEED0 = 0.007;
const SPEED_MAX = 0.018;
const SPEED_INC = 0.00025;
const WIN = 7;
const TICK = 1000 / 60;

// --- ROOMS ---
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
    stop: false
  };
}

function resetBall(r, dir = 1) {
  const angle = Math.random() * 0.5 - 0.25;
  r.ball = { x: 0.5, y: 0.5 };
  r.vel = { x: Math.cos(angle) * SPEED0 * dir, y: Math.sin(angle) * SPEED0 };
}

function broadcast(r, msg) {
  const data = JSON.stringify(msg);
  ['host', 'guest'].forEach(k => {
    const ws = r[k];
    if (ws && ws.readyState === 1) ws.send(data);
  });
}

// --- GAME LOOP ---
function gameLoop(roomId) {
  const r = rooms.get(roomId);
  if (!r) return;

  console.log(`🎮 Game loop started for room ${roomId}`);

  const loop = () => {
    if (!r.playing || r.stop) return;

    const b = r.ball, v = r.vel;

    b.x += v.x;
    b.y += v.y;

    if (b.y < 0 || b.y > 1) v.y *= -1;

    let scored = null;
    if (b.x < 0) { r.scores.right++; scored = 'right'; }
    if (b.x > 1) { r.scores.left++; scored = 'left'; }

    if (scored) {
      console.log(`⚽ Score in ${roomId}:`, r.scores);
      broadcast(r, { type: 'scored', side: scored, scores: r.scores });

      if (r.scores.left >= WIN || r.scores.right >= WIN) {
        const winner = r.scores.left >= WIN ? 'left' : 'right';
        console.log(`🏁 Game over in ${roomId}: ${winner}`);
        r.playing = false;
        broadcast(r, { type: 'gameover', winner });
        return;
      }

      resetBall(r);
    } else {
      broadcast(r, {
        type: 'state',
        ball: b,
        padLeft: r.pad_l,
        padRight: r.pad_r,
        scores: r.scores
      });
    }

    setTimeout(loop, TICK);
  };

  loop();
}

// --- WS SERVER ---
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = req.url.split('?')[0];
  const parts = url.split('/');

  console.log('🔌 Incoming WS:', req.url);

  if (parts[1] !== 'party' || !parts[2]) {
    console.log('❌ Invalid WS path');
    ws.close();
    return;
  }

  const roomId = decodeURIComponent(parts[2]);

  if (!rooms.has(roomId)) {
    console.log(`🆕 Creating room ${roomId}`);
    rooms.set(roomId, newRoom());
  }

  const r = rooms.get(roomId);

  let role;

  if (!r.host) {
    r.host = ws;
    role = 'host';
    console.log(`👑 Host joined ${roomId}`);
    ws.send(JSON.stringify({ type: 'assigned', role }));
    ws.send(JSON.stringify({ type: 'waiting' }));
  } else if (!r.guest) {
    r.guest = ws;
    role = 'guest';
    console.log(`🎯 Guest joined ${roomId}`);

    ws.send(JSON.stringify({ type: 'assigned', role }));

    r.scores = { left: 0, right: 0 };
    r.pad_l = r.pad_r = 0.5 - PAD_H / 2;
    r.playing = true;
    r.stop = false;

    resetBall(r);

    console.log(`🚀 STARTING GAME ${roomId}`);
    broadcast(r, { type: 'start' });

    gameLoop(roomId);
  } else {
    role = 'spectator';
    console.log(`👀 Spectator joined ${roomId}`);
    ws.send(JSON.stringify({ type: 'assigned', role }));
  }

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
    console.log(`❌ Disconnect in ${roomId}`);

    if (r.host === ws) r.host = null;
    if (r.guest === ws) r.guest = null;

    r.playing = false;
    r.stop = true;

    if (!r.host && !r.guest) {
      console.log(`🗑️ Deleting room ${roomId}`);
      rooms.delete(roomId);
    } else {
      broadcast(r, { type: 'waiting' });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});