const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const len = (x, y) => Math.hypot(x, y);
const rnd = (a, b) => a + Math.random() * (b - a);

const WIN_SCORE = 20;

let clients = new Map(); // ws -> { slot }
let inputs = [{ ax: 0, ay: 0, dash: false }, { ax: 0, ay: 0, dash: false }];

let state = makeState();
let players = [makePlayer(0), makePlayer(1)];

function makeState() {
  return { t: 0, stars: [], lastStarId: 0, score: [0, 0], winner: null };
}

function makePlayer(i) {
  return {
    id: i,
    x: 900 * (i ? 0.7 : 0.3),
    y: 520 * 0.5,
    vx: 0,
    vy: 0,
    r: 16,
    dashCooldown: 0,
    dashTime: 0,
    facing: i ? Math.PI : 0,
  };
}

function spawnStar(width = 900, height = 520) {
  const margin = 50;
  state.stars.push({
    id: ++state.lastStarId,
    x: rnd(margin, width - margin),
    y: rnd(margin, height - margin),
    r: rnd(8, 14),
    pulse: rnd(0, Math.PI * 2),
  });
}

function reset(width = 900, height = 520) {
  state = makeState();
  players = [makePlayer(0), makePlayer(1)];
  players[0].x = width * 0.3;
  players[0].y = height * 0.5;
  players[1].x = width * 0.7;
  players[1].y = height * 0.5;
  state.stars = [];
  for (let i = 0; i < 6; i++) spawnStar(width, height);
}

reset();

function step(dt, width = 900, height = 520) {
  const ACC = 900;
  const DRAG = 4.5;
  const MAXS = 380;
  const DASH_SPEED = 800;
  const DASH_DURATION = 0.12;
  const DASH_COOLDOWN = 0.65;

  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const inp = inputs[i] || { ax: 0, ay: 0, dash: false };

    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.dashTime = Math.max(0, p.dashTime - dt);

    if (inp.dash && p.dashCooldown === 0 && p.dashTime === 0) {
      let dx = inp.ax,
        dy = inp.ay;
      if (dx === 0 && dy === 0) {
        dx = Math.cos(p.facing);
        dy = Math.sin(p.facing);
      }
      p.vx = dx * DASH_SPEED;
      p.vy = dy * DASH_SPEED;
      p.dashTime = DASH_DURATION;
      p.dashCooldown = DASH_COOLDOWN;
    }

    if (inp.ax !== 0 || inp.ay !== 0) p.facing = Math.atan2(inp.ay, inp.ax);

    const dashFactor = p.dashTime > 0 ? 0.25 : 1.0;
    p.vx += inp.ax * ACC * dashFactor * dt;
    p.vy += inp.ay * ACC * dashFactor * dt;

    p.vx -= p.vx * DRAG * dt;
    p.vy -= p.vy * DRAG * dt;

    const sp = Math.hypot(p.vx, p.vy);
    if (sp > MAXS && p.dashTime <= 0) {
      p.vx = (p.vx / sp) * MAXS;
      p.vy = (p.vy / sp) * MAXS;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const pad = p.r + 6;
    if (p.x < pad) {
      p.x = pad;
      p.vx *= -0.45;
    }
    if (p.x > width - pad) {
      p.x = width - pad;
      p.vx *= -0.45;
    }
    if (p.y < pad) {
      p.y = pad;
      p.vy *= -0.45;
    }
    if (p.y > height - pad) {
      p.y = height - pad;
      p.vy *= -0.45;
    }
  }

  for (let si = state.stars.length - 1; si >= 0; si--) {
    const s = state.stars[si];
    for (let pi = 0; pi < 2; pi++) {
      const p = players[pi];
      if (len(p.x - s.x, p.y - s.y) < p.r + s.r) {
        state.stars.splice(si, 1);
        state.score[pi] += 1;
        if (state.score[pi] >= WIN_SCORE) state.winner = pi;
        spawnStar(width, height);
        spawnStar(width, height);
        break;
      }
    }
  }
}

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients.keys()) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function snapshot() {
  return {
    type: "snapshot",
    t: state.t,
    stars: state.stars,
    score: state.score,
    winner: state.winner,
    players: players.map((p) => ({
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      facing: p.facing,
      dashCooldown: p.dashCooldown,
      dashTime: p.dashTime,
    })),
  };
}

const WORLD_W = 900;
const WORLD_H = 520;

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = clamp((now - last) / 1000, 0, 1 / 20);
  last = now;
  state.t += dt;

  if (state.winner == null) step(dt, WORLD_W, WORLD_H);

  broadcast(snapshot());
}, 1000 / 60);

function assignSlot() {
  const used = new Set([...clients.values()].map((v) => v.slot));
  if (!used.has(0)) return 0;
  if (!used.has(1)) return 1;
  return null;
}

wss.on("connection", (ws) => {
  const slot = assignSlot();
  if (slot == null) {
    ws.send(JSON.stringify({ type: "full" }));
    ws.close();
    return;
  }

  clients.set(ws, { slot });
  ws.send(JSON.stringify({ type: "slot", slot }));
  ws.send(JSON.stringify(snapshot()));

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    if (msg.type === "input" && msg.slot === slot) {
      inputs[slot] = {
        ax: clamp(msg.ax ?? 0, -1, 1),
        ay: clamp(msg.ay ?? 0, -1, 1),
        dash: !!msg.dash,
      };
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", sentAt: msg.sentAt }));
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    inputs[slot] = { ax: 0, ay: 0, dash: false };
  });
});

console.log(`Star Snatch server running on ws://localhost:${PORT}`);
