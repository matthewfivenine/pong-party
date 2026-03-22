// server.js
import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 10000;

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

const rooms = {};

function createRoom(name) {
  if (!rooms[name]) rooms[name] = { host: null, guest: null };
  return rooms[name];
}

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (!url.startsWith('/party/')) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const roomName = decodeURIComponent(req.url.split('/party/')[1]);
  const room = createRoom(roomName);

  if (!room.host) {
    room.host = ws;
    ws.role = 'host';
    ws.send(JSON.stringify({ type: 'assigned', role: 'host' }));
    console.log(`👑 Host joined ${roomName}`);
  } else if (!room.guest) {
    room.guest = ws;
    ws.role = 'guest';
    ws.send(JSON.stringify({ type: 'assigned', role: 'guest' }));
    console.log(`🎯 Guest joined ${roomName}`);
  } else {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  // Start game when both players are connected
  if (room.host && room.guest) {
    const initialState = { ball: { x: 0.5, y: 0.5 }, padLeft: 0.41, padRight: 0.41, scores: { left: 0, right: 0 } };
    room.host.send(JSON.stringify({ type: 'start', state: initialState }));
    room.guest.send(JSON.stringify({ type: 'start', state: initialState }));
    console.log(`🚀 STARTING GAME ${roomName}`);
  }

  ws.on('message', msg => {
    // Forward messages to other player
    try {
      const data = JSON.parse(msg);
      if (ws.role === 'host' && room.guest) room.guest.send(JSON.stringify(data));
      if (ws.role === 'guest' && room.host) room.host.send(JSON.stringify(data));
    } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    if (ws.role === 'host') room.host = null;
    if (ws.role === 'guest') room.guest = null;
    if (!room.host && !room.guest) delete rooms[roomName];
    console.log(`❌ Disconnect in ${roomName}`);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));