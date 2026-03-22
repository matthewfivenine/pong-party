const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let socket;
let currentState, targetState;
let paddleY = 150;

function joinGame() {
  const username = document.getElementById("username").value;
  const room = document.getElementById("room").value;

  socket = io("https://pong-party.onrender.com");

  socket.emit("join", { username, roomCode: room });

  socket.on("state", (state) => targetState = state);
  socket.on("game_over", (winner) => alert("Winner: " + winner));
}

function lerp(a,b,t){return a+(b-a)*t;}

function interpolate(){
  if(!currentState || !targetState) return targetState;
  return {
    ...targetState,
    ball:{
      x: lerp(currentState.ball.x,targetState.ball.x,0.2),
      y: lerp(currentState.ball.y,targetState.ball.y,0.2)
    }
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

function draw(state){
  ctx.fillStyle="#020617";
  ctx.fillRect(0,0,600,400);

  ctx.strokeStyle="#334155";
  ctx.setLineDash([5,10]);
  ctx.beginPath();
  ctx.moveTo(300,0);
  ctx.lineTo(300,400);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle="white";
  ctx.font="30px Arial";
  ctx.fillText(state.score.p1,250,50);
  ctx.fillText(state.score.p2,330,50);

  ctx.fillStyle="#22c55e";
  ctx.beginPath();
  ctx.arc(state.ball.x,state.ball.y,6,0,Math.PI*2);
  ctx.fill();

  ctx.fillStyle="#38bdf8";
  ctx.fillRect(10,state.paddles.p1,10,60);

  ctx.fillStyle="#f97316";
  ctx.fillRect(580,state.paddles.p2,10,60);
}

function gameLoop(){
  ctx.clearRect(0,0,600,400);

  if(!targetState){
    ctx.fillStyle="white";
    ctx.fillText("Waiting for opponent...",200,200);
  } else {
    currentState = interpolate() || targetState;
    draw(currentState);
  }

  requestAnimationFrame(gameLoop);
}
gameLoop();
