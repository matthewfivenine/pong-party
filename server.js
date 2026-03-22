import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';

const app = express();
const PORT = process.env.PORT || 10000;

// Serve static files
app.use(express.static('public'));

const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/party' });

const rooms = {}; // { roomName: { host: ws, guest: ws, state: {} } }

wss.on('connection', (ws, req) => {
  // room is passed in query string: ws://host/party?room=ROOMNAME
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomName = url.searchParams.get('room');
  if (!roomName) {
    ws.close();
    return;
  }

  if (!rooms[roomName]) {
    console.log(`🆕 Creating room ${roomName}`);
    rooms[roomName] = { host: ws, guest: null, state: null };
    ws.role = 'host';
    ws.send(JSON.stringify({ type: 'role', role: 'host' }));
  } else if (!rooms[roomName].guest) {
    rooms[roomName].guest = ws;
    ws.role = 'guest';
    ws.send(JSON.stringify({ type: 'role', role: 'guest' }));
    console.log(`🎯 Guest joined ${roomName}`);
    startGame(roomName);
  } else {
    ws.close(); // room full
    return;
  }

  ws.roomName = roomName;

  ws.on('message', (msg) => {
    // relay paddle updates to other player
    try {
      const data = JSON.parse(msg);
      const room = rooms[roomName];
      if (!room) return;
      if (ws.role === 'host' && room.guest?.ready) room.guest.send(msg);
      if (ws.role === 'guest' && room.host?.ready) room.host.send(msg);
    } catch (e) {
      console.error(e);
    }
  });

  ws.on('close', () => {
    const room = rooms[roomName];
    if (!room) return;
    console.log(`❌ Disconnect in ${roomName}`);
    if (ws.role === 'host' && room.guest) room.guest.send(JSON.stringify({ type: 'end' }));
    if (ws.role === 'guest' && room.host) room.host.send(JSON.stringify({ type: 'end' }));
    delete rooms[roomName];
  });
});

function startGame(roomName) {
  const room = rooms[roomName];
  if (!room || !room.host || !room.guest) return;

  console.log(`🚀 STARTING GAME ${roomName}`);

  // initial state
  const state = {
    ball: { x: 0.5, y: 0.5, vx: 0.005, vy: 0.003 },
    padLeft: 0.4,
    padRight: 0.4,
    scores: { left: 0, right: 0 },
  };
  room.state = state;

  // mark both ready
  room.host.ready = true;
  room.guest.ready = true;

  const tick = () => {
    const s = room.state;
    // move ball
    s.ball.x += s.ball.vx;
    s.ball.y += s.ball.vy;

    // bounce top/bottom
    if (s.ball.y < 0 || s.ball.y > 1) s.ball.vy *= -1;

    // bounce paddles
    if (s.ball.x < 0.02 && s.ball.y > s.padLeft && s.ball.y < s.padLeft + 0.18) s.ball.vx *= -1;
    if (s.ball.x > 0.98 && s.ball.y > s.padRight && s.ball.y < s.padRight + 0.18) s.ball.vx *= -1;

    // score
    if (s.ball.x < 0) { s.scores.right++; resetBall(s); }
    if (s.ball.x > 1) { s.scores.left++; resetBall(s); }

    // broadcast
    [room.host, room.guest].forEach((w) => {
      if (w && w.ready) w.send(JSON.stringify({ type: 'state', state: s }));
    });
  };

  const interval = setInterval(tick, 16); // ~60fps
  room.interval = interval;
}

function resetBall(s) {
  s.ball.x = 0.5;
  s.ball.y = 0.5;
  s.ball.vx = (Math.random() < 0.5 ? -1 : 1) * 0.005;
  s.ball.vy = (Math.random() < 0.5 ? -1 : 1) * 0.003;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});