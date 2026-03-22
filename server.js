// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8888;
const INDEX = path.join(__dirname, 'index.html');

// === Serve index.html ===
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/?room=')) {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading index.html'); return; }
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

// === WebSocket server ===
const wss = new WebSocket.Server({ noServer: true });
const rooms = {}; // { roomId: { host, guest, ball, vel, pad_l, pad_r, scores, playing } }

function newRoom() {
  return {
    host: null,
    guest: null,
    ball: { x: 0.5, y: 0.5 },
    vel: { x: 0, y: 0 },
    pad_l: 0.5 - 0.18/2,
    pad_r: 0.5 - 0.18/2,
    scores: { left:0, right:0 },
    playing: false,
    stop: false
  };
}

function resetBall(r, d=1) {
  r.ball = { x:0.5, y:0.5 };
  const a = (Math.random()-0.5)*0.5; // angle
  r.vel = { x: Math.cos(a)*0.007*d, y: Math.sin(a)*0.007 };
}

function broadcast(r, msg) {
  const data = JSON.stringify(msg);
  [r.host, r.guest].forEach(c => {
    if (c && c.readyState === WebSocket.OPEN) c.send(data);
  });
}

// === Game loop ===
function gameLoop(roomId) {
  const r = rooms[roomId];
  if (!r) return;

  const TICK = 1000/60;
  const BALL_R = 0.012, PAD_H = 0.18, PAD_W = 0.014, PAD_MARGIN=0.025;
  const SPEED_INC = 0.00025, SPEED_MAX=0.018, WIN=7;

  const loop = () => {
    if (!r.playing || r.stop) return;

    let b = r.ball, v = r.vel, pl = r.pad_l, pr = r.pad_r;

    b.x += v.x; b.y += v.y;

    // bounce top/bottom
    if (b.y - BALL_R < 0) { b.y = BALL_R; v.y = Math.abs(v.y); }
    if (b.y + BALL_R > 1) { b.y = 1-BALL_R; v.y = -Math.abs(v.y); }

    // bounce paddles
    const lx = PAD_MARGIN, rx = 1-PAD_MARGIN-PAD_W;

    if (v.x<0 && b.x-BALL_R<lx+PAD_W && b.x+BALL_R>lx && b.y>pl && b.y<pl+PAD_H) {
      const rel = (b.y-(pl+PAD_H/2))/(PAD_H/2);
      const spd = Math.min(Math.hypot(v.x,v.y)+SPEED_INC, SPEED_MAX);
      v.x = spd*Math.cos(rel*0.75);
      v.y = spd*Math.sin(rel*0.75);
      b.x = lx+PAD_W+BALL_R;
    }

    if (v.x>0 && b.x+BALL_R>rx && b.x-BALL_R<rx+PAD_W && b.y>pr && b.y<pr+PAD_H) {
      const rel = (b.y-(pr+PAD_H/2))/(PAD_H/2);
      const spd = Math.min(Math.hypot(v.x,v.y)+SPEED_INC, SPEED_MAX);
      v.x = -spd*Math.cos(rel*0.75);
      v.y = spd*Math.sin(rel*0.75);
      b.x = rx-BALL_R;
    }

    let scored = null;
    if (b.x+BALL_R<0) { r.scores.right++; scored="right"; }
    if (b.x-BALL_R>1) { r.scores.left++; scored="left"; }

    if (scored) {
      broadcast(r,{ type:'scored', side:scored, scores:r.scores });
      if (r.scores.left>=WIN || r.scores.right>=WIN) {
        const w = r.scores.left>=WIN?'left':'right';
        r.playing=false; broadcast(r,{type:'gameover', winner:w});
        return;
      }
      resetBall(r, r.scores.left>r.scores.right ? 1 : -1);
    } else {
      broadcast(r,{ type:'state', ball:b, padLeft:pl, padRight:pr, scores:r.scores });
    }

    setTimeout(loop, TICK);
  };
  loop();
}

// === Upgrade requests ===
server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/party\/(.+)/);
  if (!match) { socket.destroy(); return; }
  const roomId = decodeURIComponent(match[1]);

  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, roomId);
  });
});

// === WebSocket connection ===
wss.on('connection', (ws, roomId) => {
  if (!rooms[roomId]) rooms[roomId] = newRoom();
  const r = rooms[roomId];

  let role;
  if (!r.host) { r.host=ws; role='host'; ws.send(JSON.stringify({type:'assigned',role:'host'})); ws.send(JSON.stringify({type:'waiting'})); }
  else if (!r.guest) { r.guest=ws; role='guest'; r.scores={left:0,right:0}; r.pad_l=r.pad_r=0.5-0.18/2; r.playing=true; r.stop=false; resetBall(r, Math.random()>0.5?1:-1); broadcast(r,{type:'start'}); gameLoop(roomId); ws.send(JSON.stringify({type:'assigned',role:'guest'})); }
  else { role='spectator'; ws.send(JSON.stringify({type:'assigned',role:'spectator'})); }

  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      if (data.type==='input') {
        const y = Math.max(0, Math.min(1-0.18, data.y));
        if (role==='host') r.pad_l=y;
        if (role==='guest') r.pad_r=y;
      }
    } catch(e){}
  });

  ws.on('close', () => {
    if (r.host===ws) r.host=null;
    if (r.guest===ws) r.guest=null;
    r.playing=false; r.stop=true;
    if (!r.host && !r.guest) delete rooms[roomId];
    else broadcast(r,{type:'waiting'});
  });
});

server.listen(PORT, () => console.log(`Pong server running on port ${PORT}`));