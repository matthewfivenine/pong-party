import http from 'http';
import fs from 'fs';
import url from 'url';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 10000;
const HTML = fs.readFileSync('./index.html', 'utf-8');

const rooms = new Map();

function newRoom() {
  return {
    host: null,
    guest: null,
    ball: { x: 0.5, y: 0.5 },
    vel: { x: 0, y: 0 },
    padLeft: 0.41,
    padRight: 0.41,
    scores: { left: 0, right: 0 },
    playing: false,
    stop: false
  };
}

function resetBall(r, dir = 1) {
  const angle = (Math.random() - 0.5) * Math.PI / 2;
  r.ball = { x: 0.5, y: 0.5 };
  r.vel = { x: Math.cos(angle) * 0.007 * dir, y: Math.sin(angle) * 0.007 };
}

function broadcast(r, msg) {
  const data = JSON.stringify(msg);
  [r.host, r.guest].forEach(sock => {
    if (sock && sock.readyState === sock.OPEN) sock.send(data);
  });
}

function gameLoop(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const TICK = 1000 / 60; // 60fps
  const BALL_R = 0.012, PAD_H = 0.18, PAD_W = 0.014, PAD_MARGIN = 0.025;
  const SPEED_INC = 0.00025, SPEED_MAX = 0.018, WIN = 7;

  function loop() {
    if (!room.playing || room.stop) return;

    const b = room.ball;
    const v = room.vel;
    const pl = room.padLeft;
    const pr = room.padRight;

    b.x += v.x;
    b.y += v.y;

    // bounce top/bottom
    if (b.y - BALL_R < 0) { b.y = BALL_R; v.y = Math.abs(v.y); }
    if (b.y + BALL_R > 1) { b.y = 1 - BALL_R; v.y = -Math.abs(v.y); }

    // left paddle
    const lx = PAD_MARGIN;
    if (v.x < 0 && b.x - BALL_R < lx + PAD_W && b.x + BALL_R > lx && b.y > pl && b.y < pl + PAD_H) {
      const rel = (b.y - (pl + PAD_H / 2)) / (PAD_H / 2);
      const spd = Math.min(Math.hypot(v.x, v.y) + SPEED_INC, SPEED_MAX);
      v.x = spd * Math.cos(rel * 0.75);
      v.y = spd * Math.sin(rel * 0.75);
      b.x = lx + PAD_W + BALL_R;
    }

    // right paddle
    const rx = 1 - PAD_MARGIN - PAD_W;
    if (v.x > 0 && b.x + BALL_R > rx && b.x - BALL_R < rx + PAD_W && b.y > pr && b.y < pr + PAD_H) {
      const rel = (b.y - (pr + PAD_H / 2)) / (PAD_H / 2);
      const spd = Math.min(Math.hypot(v.x, v.y) + SPEED_INC, SPEED_MAX);
      v.x = -spd * Math.cos(rel * 0.75);
      v.y = spd * Math.sin(rel * 0.75);
      b.x = rx - BALL_R;
    }

    // scoring
    let scored = null;
    if (b.x + BALL_R < 0) { room.scores.right++; scored = 'right'; }
    if (b.x - BALL_R > 1) { room.scores.left++; scored = 'left'; }

    if (scored) {
      broadcast(room, { type: 'scored', side: scored, scores: room.scores });
      if (room.scores.left >= WIN || room.scores.right >= WIN) {
        const winner = room.scores.left >= WIN ? 'left' : 'right';
        room.playing = false;
        broadcast(room, { type: 'gameover', winner });
        return;
      }
      resetBall(room, room.scores.left > room.scores.right ? 1 : -1);
    } else {
      broadcast(room, { type: 'state', ball: b, padLeft: pl, padRight: pr, scores: room.scores });
    }

    setTimeout(loop, TICK);
  }
  loop();
}

const server = http.createServer((req, res) => {
  const p = url.parse(req.url, true);
  if (p.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
  } else {
    res.writeHead(404); res.end();
  }
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, request, roomId) => {
  let room = rooms.get(roomId);
  if (!room) { room = newRoom(); rooms.set(roomId, room); console.log(`🆕 Creating room ${roomId}`); }

  let role = null;
  if (!room.host) { room.host = ws; role = 'host'; console.log(`👑 Host joined ${roomId}`); }
  else if (!room.guest) { room.guest = ws; role = 'guest'; console.log(`🎯 Guest joined ${roomId}`); }
  else { role = 'spectator'; console.log(`👀 Spectator joined ${roomId}`); }

  if (role === 'guest') {
    room.scores = { left: 0, right: 0 };
    room.padLeft = room.padRight = 0.41;
    room.playing = true;
    room.stop = false;
    resetBall(room, Math.random() > 0.5 ? 1 : -1);
    broadcast(room, { type: 'start' });
    console.log(`🚀 STARTING GAME ${roomId}`);
    gameLoop(roomId);
  }

  ws.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'input') {
        if (role === 'host') room.padLeft = Math.max(0, Math.min(1 - 0.18, msg.y));
        if (role === 'guest') room.padRight = Math.max(0, Math.min(1 - 0.18, msg.y));
      }
    } catch {}
  });

  ws.on('close', () => {
    console.log(`❌ Disconnect in ${roomId}`);
    if (room.host === ws) room.host = null;
    if (room.guest === ws) room.guest = null;
    room.playing = false; room.stop = true;
    if (!room.host && !room.guest) rooms.delete(roomId);
  });
});

server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/party\/([^\/?]+)/);
  if (!match) { socket.destroy(); console.log('❌ Invalid WS path'); return; }
  const roomId = match[1];
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, roomId));
});

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));