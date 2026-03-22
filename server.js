// server.js
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path:'/socket.io' });

// serve static files
app.use(express.static('public'));

const rooms = {}; // roomName -> room state

function createRoom(name){
  if(!rooms[name]){
    rooms[name] = {
      clients: [],
      padL: 0.41,
      padR: 0.41,
      ball: {x:0.5,y:0.5,vx:0.003,vy:0.003},
      scores:{left:0,right:0},
      interval:null
    };
  }
  return rooms[name];
}

// simple clamp helper
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

function broadcast(room,data){
  const msg = JSON.stringify(data);
  room.clients.forEach(c=>{
    if(c.ws.readyState===c.ws.OPEN) c.ws.send(msg);
  });
}

// game loop per room
function startGame(room){
  if(room.interval) return;

  room.interval = setInterval(()=>{
    // update ball
    const b = room.ball;
    b.x += b.vx;
    b.y += b.vy;

    // top/bottom
    if(b.y<=0 || b.y>=1) b.vy*=-1;

    // left paddle collision
    if(b.x<=0.02 && b.y>=room.padL && b.y<=room.padL+0.18){
      b.vx*=-1;
      b.x=0.02;
    }

    // right paddle collision
    if(b.x>=0.98 && b.y>=room.padR && b.y<=room.padR+0.18){
      b.vx*=-1;
      b.x=0.98;
    }

    // score
    if(b.x<0){ room.scores.right++; resetBall(b); }
    if(b.x>1){ room.scores.left++; resetBall(b); }

    // broadcast state
    broadcast(room,{
      type:'game-data',
      ball:b,
      padLeft:room.padL,
      padRight:room.padR,
      scores:room.scores
    });
  },16);
}

function resetBall(b){
  b.x=0.5; b.y=0.5; b.vx=0.003*(Math.random()>0.5?1:-1); b.vy=0.003*(Math.random()>0.5?1:-1);
}

wss.on('connection', (ws, req)=>{
  let currentRoom=null, role=null;

  ws.on('message', msg=>{
    try{
      const data = JSON.parse(msg);

      // join room
      if(data.join){
        const roomName = data.join.toUpperCase();
        const room = createRoom(roomName);
        currentRoom = room;

        // assign role
        role = room.clients.length===0?'host':'guest';
        room.clients.push({ws,role});

        ws.send(JSON.stringify({type:'assign-role', r:role}));
        if(room.clients.length>=2) startGame(room);
      }

      // paddle move
      if(data.y!==undefined && currentRoom && role){
        if(role==='host') currentRoom.padL=clamp(data.y,0,1-0.18);
        if(role==='guest') currentRoom.padR=clamp(data.y,0,1-0.18);
      }

    }catch(e){}
  });

  ws.on('close', ()=>{
    if(currentRoom){
      currentRoom.clients = currentRoom.clients.filter(c=>c.ws!==ws);
      if(currentRoom.clients.length===0){
        clearInterval(currentRoom.interval);
        delete rooms[currentRoom];
      }
    }
  });
});

server.listen(process.env.PORT||3000, ()=>{
  console.log('Server running on port', process.env.PORT||3000);
});