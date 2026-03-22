const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const cors=require("cors");
const db=require("./db");

const app=express();
app.use(cors());
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});

let rooms={};

function createGame(p1,p2){
  return {
    players:{
      p1:{id:p1.id,username:p1.username},
      p2:{id:p2.id,username:p2.username}
    },
    paddles:{p1:150,p2:150},
    ball:{x:300,y:200,vx:4,vy:3},
    score:{p1:0,p2:0}
  };
}

function resetBall(g){
  g.ball={x:300,y:200,vx:(Math.random()>0.5?4:-4),vy:(Math.random()*4-2)};
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

io.on("connection",(s)=>{
  s.on("join",({username,roomCode})=>{
    s.username=username;
    const room=roomCode||"default";
    s.join(room);

    if(!rooms[room]) rooms[room]={players:[],game:null};
    rooms[room].players.push(s);

    if(rooms[room].players.length===2){
      const [p1,p2]=rooms[room].players;
      rooms[room].game=createGame(p1,p2);
      p1.room=room; p2.room=room;
    }
  });

  s.on("move",({y})=>{
    const r=s.room;
    if(!r||!rooms[r]) return;
    const g=rooms[r].game;
    if(!g) return;

    if(s.id===g.players.p1.id) g.paddles.p1=y;
    if(s.id===g.players.p2.id) g.paddles.p2=y;
  });
});

setInterval(()=>{
  for(const r in rooms){
    const g=rooms[r].game;
    if(!g) continue;

    const scorer=updateBall(g);

    if(scorer){
      g.score[scorer]++;
      if(g.score[scorer]>=5){
        io.to(r).emit("game_over", g.players[scorer].username);
        g.score={p1:0,p2:0};
      }
      resetBall(g);
    }

    io.to(r).emit("state",g);
  }
},1000/60);

server.listen(3000);
