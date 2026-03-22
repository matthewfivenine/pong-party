// server.js
import http from 'http';
import fs from 'fs';
import path from 'path';
import WebSocket, { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 10000;

// Simple HTTP server to serve index.html
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(process.cwd(), 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading index.html'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end('Not Found');
  }
});

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

const rooms = {}; // roomId -> { host, guest, ball, vel, padL, padR, scores, playing }

const BALL_R = 0.012;
const SPEED0 = 0.007;
const SPEED_MAX = 0.018;
const SPEED_INC = 0.00025;
const TICK = 1000 / 60; // ms per frame
const WIN = 7;

function newRoom() {
  return {
    host: null,
    guest: null,
    ball: { x: 0.5, y: 0.5 },
    vel: { x: 0, y: 0 },
    padL: 0.41,
    padR: 0.41,
    scores: { left: 0, right: 0 },
    playing: false
  };
}

function resetBall(r, dir = 1) {
  r.ball = { x: 0.5, y: 0.5 };
  const a = Math.random() * 0.5 - 0.25;
  r.vel = { x: Math.cos(a) * SPEED0 * dir, y: Math.sin(a) * SPEED0 };
}

function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  [room.host, room.guest].forEach(c => {
    if (c && c.readyState === WebSocket.OPEN) c.send(data);
  });
}

function startGame(roomId) {
  const room = rooms[roomId];
  if (!room || !room.host || !room.guest) return;

  room.playing = true;
  room.scores = { left: 0, right: 0 };
  room.padL = room.padR = 0.41;
  resetBall(room, Math.random() < 0.5 ? 1 : -1);

  // send start message to clients
  broadcast(room, { type: 'start' });

  // game loop
  const loop = () => {
    if (!room.playing) return;

    let b = room.ball, v = room.vel, pl = room.padL, pr = room.padR;

    // move ball
    b.x += v.x; b.y += v.y;

    // vertical collision
    if (b.y - BALL_R < 0) { b.y = BALL_R; v.y = Math.abs(v.y); }
    if (b.y + BALL_R > 1) { b.y = 1 - BALL_R; v.y = -Math.abs(v.y); }

    // paddle collision
    const padMargin = 0.025, padW = 0.014, padH = 0.18;

    // left
    if (v.x < 0 && b.x - BALL_R < padMargin + padW && b.x + BALL_R > padMargin && b.y > pl && b.y < pl + padH) {
      const rel = (b.y - (pl + padH / 2)) / (padH / 2);
      const spd = Math.min(Math.hypot(v.x, v.y) + SPEED_INC, SPEED_MAX);
      v.x = spd * Math.cos(rel * 0.75); v.y = spd * Math.sin(rel * 0.75);
      b.x = padMargin + padW + BALL_R;
    }

    // right
    if (v.x > 0 && b.x + BALL_R > 1 - padMargin - padW && b.x - BALL_R < 1 - padMargin && b.y > pr && b.y < pr + padH) {
      const rel = (b.y - (pr + padH / 2)) / (padH / 2);
      const spd = Math.min(Math.hypot(v.x, v.y) + SPEED_INC, SPEED_MAX);
      v.x = -spd * Math.cos(rel * 0.75); v.y = spd * Math.sin(rel * 0.75);
      b.x = 1 - padMargin - padW - BALL_R;
    }

    // scoring
    let scored = null;
    if (b.x + BALL_R < 0) { room.scores.right += 1; scored = 'right'; }
    if (b.x - BALL_R > 1) { room.scores.left += 1; scored = 'left'; }

    if (scored) {
      broadcast(room, { type: 'scored', side: scored, scores: room.scores });
      if (room.scores.left >= WIN || room.scores.right >= WIN) {
        room.playing = false;
        const winner = room.scores.left >= WIN ? 'left' : 'right';
        broadcast(room, { type: 'gameover', winner });
        return;
      }
      resetBall(room, room.scores.left > room.scores.right ? 1 : -1);
    } else {
      broadcast(room, { type: 'state', ball: b, padLeft: pl, padRight: pr, scores: room.scores });
    }

    setTimeout(loop, TICK);
  };

  loop();
}

// handle WS upgrade
server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/party\/(.+)/);
  if (!match) { socket.destroy(); return; }
  const roomId = decodeURIComponent(match[1]);

  wss.handleUpgrade(req, socket, head, ws => {
    if (!rooms[roomId]) rooms[roomId] = newRoom();
    const room = rooms[roomId];
    let role;
    if (!room.host) { room.host = ws; role = 'host'; }
    else if (!room.guest) { room.guest = ws; role = 'guest'; }
    else { ws.send(JSON.stringify({ type: 'spectator' })); ws.close(); return; }

    ws.on('message', msg => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'input') {
          if (role === 'host') room.padL = Math.max(0, Math.min(1 - 0.18, data.y));
          if (role === 'guest') room.padR = Math.max(0, Math.min(1 - 0.18, data.y));
        }
      } catch {}
    });

    ws.on('close', () => {
      if (role === 'host') room.host = null;
      if (role === 'guest') room.guest = null;
      room.playing = false;
      if (!room.host && !room.guest) delete rooms[roomId];
    });

    // if both players connected, start
    if (room.host && room.guest && !room.playing) {
      console.log(`🚀 STARTING GAME ${roomId}`);
      startGame(roomId);
    }

    ws.send(JSON.stringify({ type: 'assigned', role }));
    console.log(`${role === 'host' ? '👑 Host' : '🎯 Guest'} joined ${roomId}`);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));