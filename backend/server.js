const express = require("express");
const http = require("http");
const {Server} = require("socket.io");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server,{cors:{origin:"*"}});

let rooms={};

function createGame(p1,p2){
  return {
    players:{p1,p2},
    paddles:{p1:150,p2:150},
    ball:{x:300,y:200,vx:4,vy:3}
  }
}

function updateBall(g){
  let b=g.ball;
  b.x+=b.vx; b.y+=b.vy;

  if(b.y<=0||b.y>=390) b.vy*=-1;

  if(b.x<=20 && Math.abs(b.y-g.paddles.p1)<60){b.vx*=-1.05;b.vy*=1.05;}
  if(b.x>=580 && Math.abs(b.y-g.paddles.p2)<60){b.vx*=-1.05;b.vy*=1.05;}

  if(b.x<0) return "p2";
  if(b.x>600) return "p1";
  return null;
}

function elo(w,l){
  const K=32;
  const Ew=1/(1+Math.pow(10,(l-w)/400));
  const El=1/(1+Math.pow(10,(w-l)/400));
  return [Math.round(w+K*(1-Ew)),Math.round(l+K*(0-El))];
}

io.on("connection",(s)=>{
  s.on("join",({username,roomCode})=>{
    s.username=username;
    const room=roomCode||s.id;
    s.join(room);

    if(!rooms[room]) rooms[room]={players:[s],game:null};
    else{
      rooms[room].players.push(s);
      if(rooms[room].players.length===2){
        const [p1,p2]=rooms[room].players;
        rooms[room].game=createGame(p1,p2);
        p1.room=room; p2.room=room;
      }
    }
  });

  s.on("move",({y})=>{
    const r=s.room;
    if(!r||!rooms[r]) return;
    let g=rooms[r].game;
    if(!g) return;
    if(s===g.players.p1) g.paddles.p1=y;
    if(s===g.players.p2) g.paddles.p2=y;
  });
});

setInterval(()=>{
  for(const r in rooms){
    const g=rooms[r].game;
    if(!g) continue;

    const win=updateBall(g);
    if(win){
      const wUser=g.players[win].username;
      const lUser=g.players[win==="p1"?"p2":"p1"].username;

      db.get("SELECT elo FROM players WHERE username=?",[wUser],(_,wr)=>{
        db.get("SELECT elo FROM players WHERE username=?",[lUser],(_,lr)=>{
          const [nw,nl]=elo(wr?.elo||1000,lr?.elo||1000);
          db.run("INSERT OR REPLACE INTO players(username,elo) VALUES(?,?)",[wUser,nw]);
          db.run("INSERT OR REPLACE INTO players(username,elo) VALUES(?,?)",[lUser,nl]);
        });
      });

      delete rooms[r];
      continue;
    }
    io.to(r).emit("state",g);
  }
},1000/60);

app.get("/leaderboard",(req,res)=>{
  db.all("SELECT username,elo FROM players ORDER BY elo DESC LIMIT 10",[],(_,rows)=>res.json(rows));
});

server.listen(3000,()=>console.log("running"));
