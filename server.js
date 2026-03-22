import express from 'express';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io',
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 10000;

const rooms = {};

io.on('connection', (socket) => {
  console.log('🔌 Incoming WS:', socket.handshake.url);

  socket.on('join-room', (roomName) => {
    roomName = roomName.toUpperCase();
    if (!rooms[roomName]) rooms[roomName] = { host: null, guest: null };

    const room = rooms[roomName];
    let role;

    if (!room.host) {
      room.host = socket;
      role = 'host';
      console.log('👑 Host joined', roomName);
    } else if (!room.guest) {
      room.guest = socket;
      role = 'guest';
      console.log('🎯 Guest joined', roomName);

      // Start game
      room.host.emit('start');
      room.guest.emit('start');
      console.log('🚀 STARTING GAME', roomName);
    } else {
      socket.emit('full');
      socket.disconnect();
      return;
    }

    socket.role = role;
    socket.roomName = roomName;

    socket.on('game-data', (data) => {
      const other = role === 'host' ? room.guest : room.host;
      if (other) other.emit('game-data', data);
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnect in', roomName);
      if (role === 'host') room.host = null;
      if (role === 'guest') room.guest = null;
      if (!room.host && !room.guest) {
        delete rooms[roomName];
        console.log('🗑️ Deleting room', roomName);
      }
    });
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));