const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let socket;
let currentState, targetState;
let paddleY = 150;

function joinGame() {
  const username = document.getElementById("username").value;
  const room = document.getElementById("room").value;

  socket = io("https://pong-party.onrender.com", { transports: ["websocket"] });

  socket.emit("join", { username, roomCode: room });

  socket.on("state", (state) => targetState = state);
}

function lerp(a,b,t){return a+(b-a)*t;}

function interpolate(){
  if(!currentState || !targetState) return targetState;
  return {
    ball:{
      x: lerp(currentState.ball.x,targetState.ball.x,0.2),
      y: lerp(currentState.ball.y,targetState.ball.y,0.2)
    },
    paddles: targetState.paddles
  }
}

canvas.addEventListener("mousemove",(e)=>{
  const rect = canvas.getBoundingClientRect();
  paddleY = e.clientY - rect.top;
  if(socket) socket.emit("move",{y:paddleY});
});

canvas.addEventListener("touchmove",(e)=>{
  const rect = canvas.getBoundingClientRect();
  paddleY = e.touches[0].clientY - rect.top;
  if(socket) socket.emit("move",{y:paddleY});
});

function loop(){
  if(targetState){
    currentState = interpolate() || targetState;
    ctx.clearRect(0,0,600,400);
    ctx.fillRect(currentState.ball.x,currentState.ball.y,10,10);
    ctx.fillRect(10,currentState.paddles.p1,10,60);
    ctx.fillRect(580,currentState.paddles.p2,10,60);
  }
  requestAnimationFrame(loop);
}
loop();

async function loadLeaderboard(){
  const res = await fetch("https://YOUR-RENDER-URL.onrender.com/leaderboard");
  const data = await res.json();
  const list = document.getElementById("leaderboard");
  list.innerHTML="";
  data.forEach(p=>{
    const li=document.createElement("li");
    li.textContent=`${p.username} - ${p.elo}`;
    list.appendChild(li);
  });
}
loadLeaderboard();
