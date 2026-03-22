import http from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 10000;

const server = http.createServer(); // no express needed
const wss = new WebSocketServer({ server, path: '/party' });

const rooms = {}; // { roomName: { host: ws, guest: ws } }

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomName = url.pathname.split('/').pop(); // /party/ROOM

  if (!roomName) {
    ws.close(1008, 'No room specified');
    return;
  }

  console.log('🔌 Incoming WS:', url.pathname);

  if (!rooms[roomName]) rooms[roomName] = { host: null, guest: null };

  const room = rooms[roomName];
  let role;

  if (!room.host) {
    room.host = ws;
    role = 'host';
    console.log('👑 Host joined', roomName);
  } else if (!room.guest) {
    room.guest = ws;
    role = 'guest';
    console.log('🎯 Guest joined', roomName);

    // START GAME
    if (room.host.readyState === ws.OPEN) {
      room.host.send(JSON.stringify({ type: 'start' }));
    }
    if (room.guest.readyState === ws.OPEN) {
      room.guest.send(JSON.stringify({ type: 'start' }));
    }
    console.log('🚀 STARTING GAME', roomName);
  } else {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  ws.role = role;
  ws.roomName = roomName;

  ws.on('message', (msg) => {
    // Relay all messages to the other player
    try {
      const data = JSON.parse(msg);
      const other = role === 'host' ? room.guest : room.host;
      if (other && other.readyState === ws.OPEN) other.send(JSON.stringify(data));
    } catch (e) {
      console.error('⚠️ Invalid message', e);
    }
  });

  ws.on('close', () => {
    console.log('❌ Disconnect in', roomName);
    if (role === 'host') room.host = null;
    if (role === 'guest') room.guest = null;
    if (!room.host && !room.guest) {
      delete rooms[roomName];
      console.log('🗑️ Deleting room', roomName);
    }
  });
});

server.listen(PORT, '0.0.0.0', () =>
  console.log(`✅ WS server running on port ${PORT}`)
);