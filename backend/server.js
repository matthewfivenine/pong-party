const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let rooms = {};

// ✅ FIXED: no socket objects in game state
function createGame(p1, p2) {
  return {
    players: {
      p1: { id: p1.id, username: p1.username },
      p2: { id: p2.id, username: p2.username }
    },
    paddles: { p1: 150, p2: 150 },
    ball: { x: 300, y: 200, vx: 4, vy: 3 }
  };
}

function updateBall(g) {
  let b = g.ball;

  b.x += b.vx;
  b.y += b.vy;

  if (b.y <= 0 || b.y >= 390) b.vy *= -1;

  if (b.x <= 20 && Math.abs(b.y - g.paddles.p1) < 60) {
    b.vx *= -1.05;
    b.vy *= 1.05;
  }

  if (b.x >= 580 && Math.abs(b.y - g.paddles.p2) < 60) {
    b.vx *= -1.05;
    b.vy *= 1.05;
  }

  if (b.x < 0) return "p2";
  if (b.x > 600) return "p1";

  return null;
}

function updateElo(w, l) {
  const K = 32;
  const Ew = 1 / (1 + Math.pow(10, (l - w) / 400));
  const El = 1 / (1 + Math.pow(10, (w - l) / 400));

  return [
    Math.round(w + K * (1 - Ew)),
    Math.round(l + K * (0 - El))
  ];
}

io.on("connection", (socket) => {
  console.log("CONNECTED:", socket.id);

  socket.on("join", ({ username, roomCode }) => {
    console.log("JOIN:", username, roomCode);

    socket.username = username;
    const room = roomCode || "default";

    socket.join(room);

    if (!rooms[room]) {
      rooms[room] = { players: [], game: null };
    }

    rooms[room].players.push(socket);

    console.log("ROOM SIZE:", rooms[room].players.length);

    if (rooms[room].players.length === 2) {
      const [p1, p2] = rooms[room].players;

      rooms[room].game = createGame(p1, p2);

      p1.room = room;
      p2.room = room;

      console.log("GAME STARTED:", room);
    }
  });

  socket.on("move", ({ y }) => {
    const room = socket.room;
    if (!room || !rooms[room]) return;

    const game = rooms[room].game;
    if (!game) return;

    // ✅ FIXED: compare by socket.id
    if (socket.id === game.players.p1.id) game.paddles.p1 = y;
    if (socket.id === game.players.p2.id) game.paddles.p2 = y;
  });

  socket.on("disconnect", () => {
    console.log("DISCONNECTED:", socket.id);

    const room = socket.room;
    if (!room || !rooms[room]) return;

    rooms[room].players = rooms[room].players.filter(p => p.id !== socket.id);

    setTimeout(() => {
      if (rooms[room] && rooms[room].players.length < 2) {
        delete rooms[room];
        console.log("ROOM CLEANED:", room);
      }
    }, 10000);
  });
});

// 🎮 Game loop
setInterval(() => {
  for (const room in rooms) {
    const game = rooms[room].game;
    if (!game) continue;

    const winner = updateBall(game);

    if (winner) {
      const loser = winner === "p1" ? "p2" : "p1";

      const winUser = game.players[winner].username;
      const loseUser = game.players[loser].username;

      db.get("SELECT elo FROM players WHERE username=?", [winUser], (_, wr) => {
        db.get("SELECT elo FROM players WHERE username=?", [loseUser], (_, lr) => {
          const wElo = wr?.elo || 1000;
          const lElo = lr?.elo || 1000;

          const [newW, newL] = updateElo(wElo, lElo);

          db.run("INSERT OR REPLACE INTO players(username, elo) VALUES(?,?)", [winUser, newW]);
          db.run("INSERT OR REPLACE INTO players(username, elo) VALUES(?,?)", [loseUser, newL]);
        });
      });

      delete rooms[room];
      continue;
    }

    // ✅ SAFE: now only plain JSON
    io.to(room).emit("state", game);
  }
}, 1000 / 60);

// leaderboard endpoint
app.get("/leaderboard", (req, res) => {
  db.all(
    "SELECT username, elo FROM players ORDER BY elo DESC LIMIT 10",
    [],
    (_, rows) => res.json(rows)
  );
});

server.listen(3000, () => {
  console.log("running");
});