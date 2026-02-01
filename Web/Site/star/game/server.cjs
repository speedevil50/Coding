// server.cjs
process.chdir(__dirname);

const http = require("http");
const fs = require("fs");
const path = require("path");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, ".data");
const USERS_FILE = path.join(DATA_DIR, "usernames.json");
const NAME_SAVE_DELAY = 300;

// ----- Game sim (authoritative server) -----
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const len = (x, y) => Math.hypot(x, y);
const rnd = (a, b) => a + Math.random() * (b - a);

const WIN_SCORE = 20;
const MAX_PLAYERS_ENDLESS = 6;
const WORLD_W = 900;
const WORLD_H = 520;
const ENDLESS_EXPAND_STEP = 180;
const ENDLESS_EDGE_MARGIN = 90;
const TICK_RATE = 60;
const LOBBY_TTL_MS = 2 * 60 * 1000;
const RECONNECT_GRACE_MS = 20 * 1000;
const MAX_ENEMIES = 10;
const MAX_PARTICLES = 800;
const MAX_NODES = 220;
const SELL_VALUES = { ore: 12, crystal: 18, alloy: 26 };

const WEAPONS = {
  cannon: { cost: 0, fireRate: 0.6, damage: 15, speed: 720 },
  minigun: { cost: 120, fireRate: 0.09, damage: 6, heatMax: 1.4, overheat: 1.4 },
  plasma: { cost: 170, charges: 3, recharge: 4.5, damage: 42, speed: 620 },
  pulse: { cost: 150, maxCharge: 1.2, minDamage: 18, maxDamage: 55, speed: 650, cooldown: 0.9 },
  homing: { cost: 190, rockets: 4, damage: 18, speed: 420, lockRange: 240, cooldown: 1.4 },
};

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function makeToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function makeState(playerCount, mode) {
  return {
    t: 0,
    stars: [],
    lastStarId: 0,
    minerals: [],
    meteors: [],
    bodies: [],
    enemies: [],
    bullets: [],
    particles: [],
    ults: [],
    lastUltId: 0,
    lastBulletId: 0,
    lastParticleId: 0,
    lastMineralId: 0,
    lastMeteorId: 0,
    lastBodyId: 0,
    lastEnemyId: 0,
    score: Array.from({ length: playerCount }, () => 0),
    winner: mode === "Endless" ? null : null,
  };
}
function makePlayer(i, total, world) {
  const t = total || 2;
  const frac = (i + 1) / (t + 1);
  return {
    id: i,
    x: world.w * (0.2 + 0.6 * frac),
    y: world.h * 0.5,
    vx: 0,
    vy: 0,
    r: 16,
    dashCooldown: 0,
    dashTime: 0,
    bumpCooldown: 0,
    facing: i ? Math.PI : 0,
  };
}
function spawnStar(state, world) {
  const margin = 50;
  state.stars.push({
    id: ++state.lastStarId,
    x: rnd(margin, world.w - margin),
    y: rnd(margin, world.h - margin),
    r: rnd(8, 14),
    pulse: rnd(0, Math.PI * 2),
  });
}
function spawnMineral(state, world) {
  const margin = 60;
  state.minerals.push({
    id: ++state.lastMineralId,
    x: rnd(margin, world.w - margin),
    y: rnd(margin, world.h - margin),
    r: rnd(10, 16),
    value: Math.floor(rnd(8, 18)),
  });
}
function spawnMeteor(state, world) {
  const margin = 80;
  const r = rnd(14, 22);
  state.meteors.push({
    id: ++state.lastMeteorId,
    x: rnd(margin, world.w - margin),
    y: rnd(margin, world.h - margin),
    r,
    hp: Math.round(r * 6),
    maxHp: Math.round(r * 6),
    yield: Math.round(r * 3),
  });
}
function spawnBody(state, node) {
  const type = node.type;
  const base = type === "moon" ? 22 : type === "planet" ? 36 : 30;
  state.bodies.push({
    id: ++state.lastBodyId,
    x: node.x,
    y: node.y,
    r: base,
    type,
    hp: base * 10,
    maxHp: base * 10,
    yield: type === "planet" ? 20 : type === "moon" ? 12 : 25,
  });
}
function spawnEnemy(state, world) {
  const margin = 80;
  const types = ["flanker", "rusher", "sniper"];
  const factions = ["raiders", "corsairs", "remnant"];
  const type = types[Math.floor(rnd(0, types.length))];
  const faction = factions[Math.floor(rnd(0, factions.length))];
  state.enemies.push({
    id: ++state.lastEnemyId,
    x: rnd(margin, world.w - margin),
    y: rnd(margin, world.h - margin),
    vx: 0,
    vy: 0,
    r: rnd(14, 18),
    hp: 24,
    maxHp: 24,
    type,
    faction,
    shootCooldown: rnd(0.4, 1.2),
    aiSeed: rnd(0, 1000),
    bumpCooldown: 0,
  });
}
function spawnBullet(state, x, y, vx, vy, owner, damage, type, size) {
  state.bullets.push({
    id: ++state.lastBulletId,
    x,
    y,
    vx,
    vy,
    r: size || 3,
    owner,
    damage,
    type: type || "cannon",
    life: 0.8,
  });
}
function spawnRocket(state, x, y, targetId, owner, damage) {
  state.bullets.push({
    id: ++state.lastBulletId,
    x,
    y,
    vx: 0,
    vy: 0,
    r: 4,
    owner,
    damage,
    life: 1.8,
    type: "rocket",
    targetId,
  });
}
function spawnParticles(state, x, y, color, count, speed, life, size) {
  for (let i = 0; i < count; i++) {
    if (state.particles.length >= MAX_PARTICLES) break;
    const a = rnd(0, Math.PI * 2);
    const s = rnd(0.2, 1) * speed;
    state.particles.push({
      id: ++state.lastParticleId,
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life,
      maxLife: life,
      size,
      color,
    });
  }
}
function spawnUlt(state, x, y, r, owner) {
  state.ults.push({
    id: ++state.lastUltId,
    x,
    y,
    r,
    life: 0.8,
    maxLife: 0.8,
    owner,
  });
}
function resetLobby(lobby) {
  lobby.state = makeState(lobby.maxPlayers, lobby.mode);
  lobby.stateName = "lobby";
  lobby.players = Array.from({ length: lobby.maxPlayers }, (_, i) => makePlayer(i, lobby.maxPlayers, lobby.world));
  lobby.inputs = Array.from({ length: lobby.maxPlayers }, () => ({ ax: 0, ay: 0, dash: false, mine: false }));
  lobby.inputSeq = Array.from({ length: lobby.maxPlayers }, () => -1);
  lobby.inputTimes = Array.from({ length: lobby.maxPlayers }, () => 0);
  lobby.clientStates = Array.from({ length: lobby.maxPlayers }, () => "lobby");
  lobby.playerData = Array.from({ length: lobby.maxPlayers }, () => ({
    credits: 0,
    health: 100,
    maxHealth: 100,
    shootCooldown: 0,
    laserCooldown: 0,
    laserHeat: 0,
    laserOverheat: 0,
    weapon: "cannon",
    ownedWeapons: ["cannon"],
    weaponUpgrades: { minigun: 0, plasma: 0, pulse: 0, homing: 0 },
    weaponCooldown: 0,
    weaponSwitchCooldown: 0,
    shield: 0,
    maxShield: 0,
    shieldCooldown: 0,
    respawnTimer: 0,
    gunHeat: 0,
    gunOverheat: 0,
    plasmaCharges: WEAPONS.plasma.charges,
    plasmaRecharge: 0,
    pulseCharge: 0,
    wasShooting: false,
    inventory: { ore: 0, crystal: 0, alloy: 0 },
    inventoryCapacity: 80,
    customization: { primary: "#78c8ff", accent: "#ffffff", shape: "dart", hat: "none", trail: "ion" },
    upgrades: { laser: 0, speed: 0, dash: 0, cannon: 0, health: 0, magnet: 0, shield: 0, storage: 0 },
  }));
  lobby.state.stars = [];
  const startStars = Math.max(3, Math.min(20, lobby.rules?.startingStars ?? 6));
  for (let i = 0; i < startStars; i++) spawnStar(lobby.state, lobby.world);
    if (lobby.mode === "Endless") {
    for (let i = 0; i < 6; i++) spawnMineral(lobby.state, lobby.world);
    for (let i = 0; i < 2; i++) spawnEnemy(lobby.state, lobby.world);
  }
}

function stepLobby(lobby, dt) {
  const BASE_ACC = 900;
  const DRAG = 3.2;
  const BASE_MAXS = 400;
  const BASE_DASH_SPEED = 820;
  const DASH_DURATION = 0.12;
  const BASE_DASH_COOLDOWN = 0.65;
  const active = new Set(lobby.slots.values());
  const addInventory = (pdata, key, amount) => {
    if (!pdata.inventory) pdata.inventory = { ore: 0, crystal: 0, alloy: 0 };
    const cap = pdata.inventoryCapacity || 80;
    const cur = pdata.inventory[key] || 0;
    const next = Math.min(cap, cur + amount);
    pdata.inventory[key] = next;
  };
  const applyDamage = (pdata, p, dmg) => {
    if (pdata.respawnTimer > 0) return false;
    let remaining = dmg;
    if ((pdata.shield || 0) > 0) {
      const absorbed = Math.min(pdata.shield, remaining);
      pdata.shield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining > 0) pdata.health -= remaining;
    pdata.shieldCooldown = 3;
    if (pdata.health <= 0) {
      const deathX = p ? p.x : 0;
      const deathY = p ? p.y : 0;
      pdata.health = pdata.maxHealth;
      pdata.credits = Math.max(0, pdata.credits - 20);
      pdata.respawnTimer = 1.2;
      if (p) {
        p.vx = 0;
        p.vy = 0;
      }
      spawnParticles(lobby.state, deathX, deathY, "rgba(255,140,120,0.95)", 36, 300, 0.8, 3.2);
      return true;
    }
    return false;
  };

  for (let i = 0; i < lobby.players.length; i++) {
    if (!active.has(i)) continue;
    const p = lobby.players[i];
    const inp = lobby.inputs[i] || { ax: 0, ay: 0, dash: false, mine: false };
    const stats = lobby.playerData?.[i] || {
      weapon: "cannon",
      ownedWeapons: ["cannon"],
      weaponUpgrades: { minigun: 0, plasma: 0, pulse: 0, homing: 0 },
      weaponCooldown: 0,
      weaponSwitchCooldown: 0,
      shield: 0,
      maxShield: 0,
      shieldCooldown: 0,
      respawnTimer: 0,
      gunHeat: 0,
      gunOverheat: 0,
      plasmaCharges: WEAPONS.plasma.charges,
      plasmaRecharge: 0,
      pulseCharge: 0,
      wasShooting: false,
      inventory: { ore: 0, crystal: 0, alloy: 0 },
      inventoryCapacity: 80,
      customization: { primary: "#78c8ff", accent: "#ffffff", shape: "dart", hat: "none", trail: "ion" },
      upgrades: { speed: 0, dash: 0, cannon: 0, laser: 0, health: 0, magnet: 0, shield: 0, storage: 0 },
      shootCooldown: 0,
      laserCooldown: 0,
      laserHeat: 0,
      laserOverheat: 0,
    };
    const speedLvl = stats.upgrades?.speed || 0;
    const dashLvl = stats.upgrades?.dash || 0;
    const cannonLvl = stats.upgrades?.cannon || 0;
    const wUp = stats.weaponUpgrades || { minigun: 0, plasma: 0, pulse: 0, homing: 0 };
    const ACC = BASE_ACC * (1 + 0.08 * speedLvl);
    const MAXS = BASE_MAXS * (1 + 0.06 * speedLvl);
    const DASH_SPEED = BASE_DASH_SPEED * (1 + 0.05 * speedLvl);
    const DASH_COOLDOWN = Math.max(0.25, BASE_DASH_COOLDOWN - 0.07 * dashLvl);
    const ultLevel = stats.upgrades?.laser || 0;
    const ultRadius = 1500 + ultLevel * 150;
    const ultCooldown = Math.max(8, 20 - ultLevel * 2);

    stats.weaponCooldown = Math.max(0, (stats.weaponCooldown || 0) - dt);
    stats.weaponSwitchCooldown = Math.max(0, (stats.weaponSwitchCooldown || 0) - dt);
    stats.plasmaRecharge = Math.max(0, (stats.plasmaRecharge || 0) - dt);
    stats.gunOverheat = Math.max(0, (stats.gunOverheat || 0) - dt);
    stats.gunHeat = Math.max(0, (stats.gunHeat || 0) - dt * 0.6);
    stats.laserCooldown = Math.max(0, (stats.laserCooldown || 0) - dt);
    stats.laserOverheat = Math.max(0, (stats.laserOverheat || 0) - dt);
    stats.laserHeat = Math.max(0, (stats.laserHeat || 0) - dt * 0.6);
    stats.shieldCooldown = Math.max(0, (stats.shieldCooldown || 0) - dt);
    p.bumpCooldown = Math.max(0, (p.bumpCooldown || 0) - dt);
    const shieldLvl = stats.upgrades?.shield || 0;
    const maxShield = shieldLvl * 25;
    stats.maxShield = maxShield;
    if (stats.shield > maxShield) stats.shield = maxShield;
    if (stats.shield < maxShield && stats.shieldCooldown === 0 && maxShield > 0) {
      stats.shield = Math.min(maxShield, stats.shield + 18 * dt);
    }
    const storageLvl = stats.upgrades?.storage || 0;
    stats.inventoryCapacity = 80 + storageLvl * 50;

    if (stats.respawnTimer > 0) {
      stats.respawnTimer = Math.max(0, stats.respawnTimer - dt);
      if (stats.respawnTimer === 0) {
        p.x = lobby.world.w * 0.5;
        p.y = lobby.world.h * 0.5;
        p.vx = 0;
        p.vy = 0;
        stats.shield = stats.maxShield;
      }
      continue;
    }
    if (stats.plasmaRecharge === 0 && stats.plasmaCharges === 0) {
      stats.plasmaCharges = WEAPONS.plasma.charges;
    }

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

    const hasAim = Number.isFinite(inp.aimX) && Number.isFinite(inp.aimY);
    if (hasAim) {
      const dx = inp.aimX - p.x;
      const dy = inp.aimY - p.y;
      if (Math.hypot(dx, dy) > 0.01) p.facing = Math.atan2(dy, dx);
    } else if (inp.ax !== 0 || inp.ay !== 0) {
      p.facing = Math.atan2(inp.ay, inp.ax);
    }
    const dirx = Math.cos(p.facing);
    const diry = Math.sin(p.facing);

    // Primary weapon (left click)
    if (inp.shootPrimary) stats.wasShooting = true;
    const weapon = stats.weapon || "cannon";
    if (weapon === "cannon" && inp.shootPrimary && stats.weaponCooldown === 0) {
      const dmg = WEAPONS.cannon.damage + cannonLvl * 3;
      spawnBullet(
        lobby.state,
        p.x + dirx * 18,
        p.y + diry * 18,
        dirx * WEAPONS.cannon.speed,
        diry * WEAPONS.cannon.speed,
        i,
        dmg,
        "cannon",
        3,
      );
      spawnParticles(lobby.state, p.x + dirx * 20, p.y + diry * 20, "rgba(255,220,140,0.9)", 6, 140, 0.25, 2);
      stats.weaponCooldown = WEAPONS.cannon.fireRate;
    } else if (weapon === "minigun") {
      if (inp.shootPrimary) stats.gunHeat += dt;
      if (stats.gunHeat >= WEAPONS.minigun.heatMax) {
        stats.gunHeat = 0;
        stats.gunOverheat = WEAPONS.minigun.overheat;
      }
      if (inp.shootPrimary && stats.weaponCooldown === 0 && stats.gunOverheat === 0) {
        const dmg = WEAPONS.minigun.damage + wUp.minigun * 1;
        spawnBullet(
          lobby.state,
          p.x + dirx * 18,
          p.y + diry * 18,
          dirx * 760,
          diry * 760,
          i,
          dmg,
          "minigun",
          2,
        );
        spawnParticles(lobby.state, p.x + dirx * 20, p.y + diry * 20, "rgba(255,200,120,0.8)", 4, 120, 0.2, 1.6);
        stats.weaponCooldown = Math.max(0.04, WEAPONS.minigun.fireRate - wUp.minigun * 0.005);
      }
    } else if (weapon === "plasma" && inp.shootPrimary && stats.weaponCooldown === 0) {
      if (stats.plasmaCharges > 0) {
        const dmg = WEAPONS.plasma.damage + wUp.plasma * 4;
        spawnBullet(
          lobby.state,
          p.x + dirx * 18,
          p.y + diry * 18,
          dirx * WEAPONS.plasma.speed,
          diry * WEAPONS.plasma.speed,
          i,
          dmg,
          "plasma",
          5,
        );
        spawnParticles(lobby.state, p.x + dirx * 20, p.y + diry * 20, "rgba(120,200,255,0.9)", 8, 160, 0.3, 2.2);
        stats.plasmaCharges -= 1;
        stats.weaponCooldown = 0.35;
        if (stats.plasmaCharges === 0) stats.plasmaRecharge = Math.max(2.5, WEAPONS.plasma.recharge - wUp.plasma * 0.3);
      }
    } else if (weapon === "pulse") {
      if (inp.shootPrimary) {
        stats.pulseCharge = Math.min(WEAPONS.pulse.maxCharge, (stats.pulseCharge || 0) + dt);
      } else if (stats.wasShooting && stats.pulseCharge > 0 && stats.weaponCooldown === 0) {
        const pct = stats.pulseCharge / WEAPONS.pulse.maxCharge;
        const dmg = WEAPONS.pulse.minDamage + (WEAPONS.pulse.maxDamage - WEAPONS.pulse.minDamage) * pct + wUp.pulse * 4;
        const speed = WEAPONS.pulse.speed + pct * 120;
        spawnBullet(lobby.state, p.x + dirx * 18, p.y + diry * 18, dirx * speed, diry * speed, i, dmg, "pulse", 4 + pct * 4);
        spawnParticles(lobby.state, p.x + dirx * 20, p.y + diry * 20, "rgba(200,200,255,0.9)", 10, 180, 0.35, 2.4);
        stats.weaponCooldown = Math.max(0.4, WEAPONS.pulse.cooldown + pct * 0.5 - wUp.pulse * 0.03);
        stats.pulseCharge = 0;
      }
    } else if (weapon === "homing" && inp.shootPrimary && stats.weaponCooldown === 0) {
      const ax = hasAim ? inp.aimX : p.x + dirx * 120;
      const ay = hasAim ? inp.aimY : p.y + diry * 120;
      const range = WEAPONS.homing.lockRange + wUp.homing * 10;
      const candidates = lobby.state.enemies
        .map((e) => ({ e, d: len(ax - e.x, ay - e.y) }))
        .filter((x) => x.d <= range)
        .sort((a, b) => a.d - b.d)
        .slice(0, WEAPONS.homing.rockets + wUp.homing);
      for (const c of candidates) {
        spawnRocket(lobby.state, p.x + dirx * 16, p.y + diry * 16, c.e.id, i, WEAPONS.homing.damage);
        spawnParticles(lobby.state, p.x + dirx * 18, p.y + diry * 18, "rgba(255,180,120,0.9)", 8, 160, 0.3, 2.2);
      }
      if (candidates.length > 0) stats.weaponCooldown = WEAPONS.homing.cooldown;
    }
    if (!inp.shootPrimary) stats.wasShooting = false;

    // Ultimate (right click) replaces laser
    if (inp.shootSecondary && ultLevel > 0 && stats.laserCooldown === 0) {
      const kills = [];
      for (let ei = lobby.state.enemies.length - 1; ei >= 0; ei--) {
        const e = lobby.state.enemies[ei];
        if (len(p.x - e.x, p.y - e.y) <= ultRadius) {
          lobby.state.enemies.splice(ei, 1);
          kills.push(e);
        }
      }
      if (kills.length > 0) {
        for (const e of kills) {
          spawnParticles(lobby.state, e.x, e.y, "rgba(255,170,90,0.9)", 16, 240, 0.6, 2.6);
          stats.credits += 15;
        }
      }
      spawnUlt(lobby.state, p.x, p.y, ultRadius, i);
      stats.laserCooldown = ultCooldown;
      stats.laserHeat = 0;
      stats.laserOverheat = 0;
    }

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
    if (p.x > lobby.world.w - pad) {
      p.x = lobby.world.w - pad;
      p.vx *= -0.45;
    }
    if (p.y < pad) {
      p.y = pad;
      p.vy *= -0.45;
    }
    if (p.y > lobby.world.h - pad) {
      p.y = lobby.world.h - pad;
      p.vy *= -0.45;
    }
  }

  for (let i = 0; i < lobby.players.length; i++) {
    if (!active.has(i)) continue;
    const p1 = lobby.players[i];
    const d1 = lobby.playerData?.[i];
    if (!p1 || !d1 || d1.respawnTimer > 0) continue;
    for (let j = i + 1; j < lobby.players.length; j++) {
      if (!active.has(j)) continue;
      const p2 = lobby.players[j];
      const d2 = lobby.playerData?.[j];
      if (!p2 || !d2 || d2.respawnTimer > 0) continue;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      const minDist = p1.r + p2.r;
      if (dist === 0 || dist >= minDist) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      p1.x -= nx * overlap * 0.5;
      p1.y -= ny * overlap * 0.5;
      p2.x += nx * overlap * 0.5;
      p2.y += ny * overlap * 0.5;
      const rel = (p2.vx - p1.vx) * nx + (p2.vy - p1.vy) * ny;
      if (rel < 0) {
        const impulse = -rel * 0.6 + 60;
        p1.vx -= impulse * nx;
        p1.vy -= impulse * ny;
        p2.vx += impulse * nx;
        p2.vy += impulse * ny;
      }
      if (p1.bumpCooldown === 0 && p2.bumpCooldown === 0) {
        applyDamage(d1, p1, 6);
        applyDamage(d2, p2, 6);
        const cx = (p1.x + p2.x) * 0.5;
        const cy = (p1.y + p2.y) * 0.5;
        spawnParticles(lobby.state, cx, cy, "rgba(255,200,140,0.85)", 10, 160, 0.35, 2.1);
        p1.bumpCooldown = 0.6;
        p2.bumpCooldown = 0.6;
      }
    }
  }

  for (let si = lobby.state.stars.length - 1; si >= 0; si--) {
    const s = lobby.state.stars[si];
    for (let pi = 0; pi < lobby.players.length; pi++) {
      if (!active.has(pi)) continue;
      const p = lobby.players[pi];
      const pdata = lobby.playerData?.[pi];
      const magnetLvl = pdata?.upgrades?.magnet || 0;
      const pickupRadius = p.r + s.r + magnetLvl * 6;
      if (len(p.x - s.x, p.y - s.y) < pickupRadius) {
        lobby.state.stars.splice(si, 1);
        if (lobby.mode === "Endless") {
          const pdata = lobby.playerData?.[pi];
          if (pdata) pdata.credits += Math.round(s.r * 2);
        } else {
          lobby.state.score[pi] += 1;
          if (lobby.state.score[pi] >= WIN_SCORE) lobby.state.winner = pi;
        }
        const burst = Math.max(1, Math.min(5, lobby.rules?.starBurst ?? 2));
        for (let i = 0; i < burst; i++) spawnStar(lobby.state, lobby.world);
        break;
      }
    }
  }

  if (lobby.mode === "Endless") {
    if (lobby.state.minerals.length < 18 && Math.random() < 0.08) {
      spawnMineral(lobby.state, lobby.world);
    }
    if (lobby.state.meteors.length < 8 && Math.random() < 0.04) {
      spawnMeteor(lobby.state, lobby.world);
    }
    const density = lobby.rules?.enemyDensity || "Normal";
    const targetEnemies = density === "High" ? 8 : density === "Low" ? 4 : 6;
    if (lobby.state.enemies.length < Math.min(targetEnemies, MAX_ENEMIES) && Math.random() < 0.04) {
      spawnEnemy(lobby.state, lobby.world);
    }

    // Minerals: pickup on contact
    for (let mi = lobby.state.minerals.length - 1; mi >= 0; mi--) {
      const m = lobby.state.minerals[mi];
      for (let pi = 0; pi < lobby.players.length; pi++) {
        if (!active.has(pi)) continue;
        const pdata = lobby.playerData?.[pi];
        if (!pdata) continue;
        const p = lobby.players[pi];
        if (len(p.x - m.x, p.y - m.y) < p.r + m.r + 6) {
          lobby.state.minerals.splice(mi, 1);
          pdata.credits += m.value;
          break;
        }
      }
    }

    // Mining (F key)
    for (let pi = 0; pi < lobby.players.length; pi++) {
      if (!active.has(pi)) continue;
      const pdata = lobby.playerData?.[pi];
      const p = lobby.players[pi];
      const inp = lobby.inputs[pi];
      if (!pdata || !p || !inp?.mine) continue;
      let target = null;
      let targetType = "";
      let best = Infinity;
      for (const m of lobby.state.meteors) {
        const d = len(p.x - m.x, p.y - m.y);
        if (d < 90 && d < best) {
          best = d;
          target = m;
          targetType = "meteor";
        }
      }
      for (const b of lobby.state.bodies) {
        const d = len(p.x - b.x, p.y - b.y);
        if (d < b.r + 60 && d < best) {
          best = d;
          target = b;
          targetType = b.type;
        }
      }
      if (!target) continue;
      target.hp -= 30 * dt;
      spawnParticles(lobby.state, target.x, target.y, "rgba(180,200,220,0.7)", 3, 80, 0.35, 1.8);
      if (target.hp <= 0) {
        if (targetType === "meteor") addInventory(pdata, "ore", target.yield || 10);
        else if (targetType === "moon") addInventory(pdata, "crystal", target.yield || 8);
        else if (targetType === "planet") addInventory(pdata, "alloy", target.yield || 12);
        else if (targetType === "civ") addInventory(pdata, "alloy", (target.yield || 12) + 6);
        if (targetType === "meteor") {
          lobby.state.meteors = lobby.state.meteors.filter((m) => m.id !== target.id);
        } else {
          lobby.state.bodies = lobby.state.bodies.filter((b) => b.id !== target.id);
        }
        spawnParticles(lobby.state, target.x, target.y, "rgba(220,180,120,0.9)", 14, 180, 0.5, 2.2);
      }
    }

    // Bullets
    for (let bi = lobby.state.bullets.length - 1; bi >= 0; bi--) {
      const b = lobby.state.bullets[bi];
      b.life -= dt;
      if (b.type === "rocket") {
        const target = lobby.state.enemies.find((e) => e.id === b.targetId);
        if (target) {
          const dx = target.x - b.x;
          const dy = target.y - b.y;
          const d = Math.hypot(dx, dy) || 1;
          const desiredVx = (dx / d) * WEAPONS.homing.speed;
          const desiredVy = (dy / d) * WEAPONS.homing.speed;
          b.vx += (desiredVx - b.vx) * 0.12;
          b.vy += (desiredVy - b.vy) * 0.12;
        }
        if (Math.random() < 0.5) {
          spawnParticles(lobby.state, b.x, b.y, "rgba(255,170,120,0.7)", 2, 60, 0.25, 1.4);
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > lobby.world.w || b.y > lobby.world.h) {
        lobby.state.bullets.splice(bi, 1);
        continue;
      }
      if (b.owner >= 0) {
        for (let mi = lobby.state.minerals.length - 1; mi >= 0; mi--) {
          const m = lobby.state.minerals[mi];
          if (len(b.x - m.x, b.y - m.y) < m.r + b.r) {
            const pdata = lobby.playerData?.[b.owner];
            if (pdata) pdata.credits += m.value || 5;
            lobby.state.minerals.splice(mi, 1);
            spawnParticles(lobby.state, m.x, m.y, "rgba(120,220,255,0.8)", 6, 140, 0.35, 2);
            lobby.state.bullets.splice(bi, 1);
            break;
          }
        }
        if (!lobby.state.bullets[bi]) continue;
        for (let mi = lobby.state.meteors.length - 1; mi >= 0; mi--) {
          const m = lobby.state.meteors[mi];
          if (len(b.x - m.x, b.y - m.y) < m.r + b.r) {
            m.hp -= b.damage || 10;
            const pdata = lobby.playerData?.[b.owner];
            if (m.hp <= 0) {
              lobby.state.meteors.splice(mi, 1);
              if (pdata) addInventory(pdata, "ore", m.yield || 10);
              spawnParticles(lobby.state, m.x, m.y, "rgba(220,180,120,0.9)", 10, 170, 0.5, 2.2);
            } else {
              spawnParticles(lobby.state, m.x, m.y, "rgba(180,160,140,0.7)", 4, 120, 0.3, 1.8);
            }
            lobby.state.bullets.splice(bi, 1);
            break;
          }
        }
        if (!lobby.state.bullets[bi]) continue;
        for (let bi2 = lobby.state.bodies.length - 1; bi2 >= 0; bi2--) {
          const body = lobby.state.bodies[bi2];
          if (len(b.x - body.x, b.y - body.y) < body.r + b.r) {
            body.hp -= b.damage || 10;
            const pdata = lobby.playerData?.[b.owner];
            if (body.hp <= 0) {
              lobby.state.bodies.splice(bi2, 1);
              if (pdata) {
                if (body.type === "moon") addInventory(pdata, "crystal", body.yield || 8);
                else addInventory(pdata, "alloy", body.yield || 12);
              }
              spawnParticles(lobby.state, body.x, body.y, "rgba(220,200,160,0.9)", 12, 180, 0.5, 2.4);
            } else {
              spawnParticles(lobby.state, body.x, body.y, "rgba(160,170,190,0.6)", 4, 120, 0.3, 1.6);
            }
            lobby.state.bullets.splice(bi, 1);
            break;
          }
        }
        if (!lobby.state.bullets[bi]) continue;
        for (let ei = lobby.state.enemies.length - 1; ei >= 0; ei--) {
          const e = lobby.state.enemies[ei];
          if (len(b.x - e.x, b.y - e.y) < e.r + b.r) {
            e.hp -= b.damage || 15;
            if (e.hp <= 0) {
              const boomColor = b.type === "rocket" ? "rgba(255,170,90,0.9)" : "rgba(255,140,120,0.9)";
              spawnParticles(lobby.state, e.x, e.y, boomColor, b.type === "rocket" ? 24 : 16, 220, 0.6, 2.6);
              lobby.state.enemies.splice(ei, 1);
              const pdata = lobby.playerData?.[b.owner];
              if (pdata) pdata.credits += 20;
            } else {
              const hitColor = b.type === "plasma" ? "rgba(120,200,255,0.8)" : "rgba(255,200,120,0.7)";
              spawnParticles(lobby.state, e.x, e.y, hitColor, 6, 120, 0.3, 2);
            }
            lobby.state.bullets.splice(bi, 1);
            break;
          }
        }
      } else if (b.owner === -1) {
        for (let pi = 0; pi < lobby.players.length; pi++) {
          if (!active.has(pi)) continue;
          const p = lobby.players[pi];
          if (len(b.x - p.x, b.y - p.y) < p.r + b.r) {
            const pdata = lobby.playerData?.[pi];
            if (pdata) {
              applyDamage(pdata, p, b.damage || 10);
            }
            spawnParticles(lobby.state, p.x, p.y, "rgba(255,90,90,0.8)", 8, 150, 0.4, 2);
            lobby.state.bullets.splice(bi, 1);
            break;
          }
        }
      }
    }

    for (let pi = 0; pi < lobby.players.length; pi++) {
      if (!active.has(pi)) continue;
      const pdata = lobby.playerData?.[pi];
      const p = lobby.players[pi];
      if (!pdata || !p) continue;
      const hpPct = pdata.health / Math.max(1, pdata.maxHealth);
      if (hpPct < 0.18) {
        applyDamage(pdata, p, 6 * dt);
      }
    }

    if (lobby.systems?.length) {
      for (const sys of lobby.systems) {
        if (sys.visited) continue;
        for (let pi = 0; pi < lobby.players.length; pi++) {
          if (!active.has(pi)) continue;
          const p = lobby.players[pi];
          if (len(p.x - sys.x, p.y - sys.y) < sys.r) {
            sys.visited = true;
            for (let i = 0; i < 2; i++) spawnEnemy(lobby.state, lobby.world);
            for (let i = 0; i < 2; i++) spawnMeteor(lobby.state, lobby.world);
            for (let i = 0; i < 2; i++) spawnStar(lobby.state, lobby.world);
            break;
          }
        }
      }
    }

    // Particles
    if (lobby.state.particles.length > MAX_PARTICLES) {
      lobby.state.particles.splice(0, lobby.state.particles.length - MAX_PARTICLES);
    }
    for (let pi = lobby.state.particles.length - 1; pi >= 0; pi--) {
      const p = lobby.state.particles[pi];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) lobby.state.particles.splice(pi, 1);
    }

    for (let ui = lobby.state.ults.length - 1; ui >= 0; ui--) {
      const u = lobby.state.ults[ui];
      u.life -= dt;
      if (u.life <= 0) lobby.state.ults.splice(ui, 1);
    }

    // Enemies: move toward nearest active player
    for (let ei = lobby.state.enemies.length - 1; ei >= 0; ei--) {
      const e = lobby.state.enemies[ei];
      e.bumpCooldown = Math.max(0, (e.bumpCooldown || 0) - dt);
      let target = null;
      let best = Infinity;
      for (let pi = 0; pi < lobby.players.length; pi++) {
        if (!active.has(pi)) continue;
        const p = lobby.players[pi];
        const pdata = lobby.playerData?.[pi];
        if (pdata?.respawnTimer > 0) continue;
        const d = len(p.x - e.x, p.y - e.y);
        if (d < best) {
          best = d;
          target = p;
        }
      }
      if (target) {
        const dirx = (target.x - e.x) / (best || 1);
        const diry = (target.y - e.y) / (best || 1);
        const type = e.type || "flanker";
        let vx = 0;
        let vy = 0;

        let avoidX = 0;
        let avoidY = 0;
        const avoidRadius = e.r + 24;
        for (let pi = 0; pi < lobby.players.length; pi++) {
          if (!active.has(pi)) continue;
          const p = lobby.players[pi];
          const pdata = lobby.playerData?.[pi];
          if (!p || pdata?.respawnTimer > 0) continue;
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < avoidRadius + p.r) {
            const t = (avoidRadius + p.r - d) / (avoidRadius + p.r);
            avoidX += (dx / d) * t;
            avoidY += (dy / d) * t;
          }
        }
        const avoidEnemyRadius = e.r + 18;
        for (let oi = 0; oi < lobby.state.enemies.length; oi++) {
          if (oi === ei) continue;
          const other = lobby.state.enemies[oi];
          if (!other) continue;
          const dx = e.x - other.x;
          const dy = e.y - other.y;
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < avoidEnemyRadius + other.r) {
            const t = (avoidEnemyRadius + other.r - d) / (avoidEnemyRadius + other.r);
            avoidX += (dx / d) * t;
            avoidY += (dy / d) * t;
          }
        }

        if (type === "rusher") {
          const speed = 170;
          vx = dirx * speed;
          vy = diry * speed;
        } else if (type === "sniper") {
          const desired = best < 220 ? -1 : 1;
          const speed = 140;
          vx = dirx * speed * desired;
          vy = diry * speed * desired;
        } else {
          const orbit = Math.sin((lobby.state.t + e.aiSeed) * 1.2);
          const strafeX = -diry * orbit;
          const strafeY = dirx * orbit;
          const speed = best < 180 ? 90 : 130;
          const jitter = Math.sin((lobby.state.t + e.aiSeed) * 3) * 0.35;
          vx = (dirx + strafeX * 0.6 + jitter) * speed;
          vy = (diry + strafeY * 0.6 + jitter) * speed;
        }

        const avoidScale = 220;
        e.vx = vx + avoidX * avoidScale;
        e.vy = vy + avoidY * avoidScale;

        e.shootCooldown = Math.max(0, e.shootCooldown - dt);
        const shootRange = type === "sniper" ? 340 : 260;
        if (best < shootRange && e.shootCooldown === 0) {
          spawnBullet(lobby.state, e.x + dirx * 16, e.y + diry * 16, dirx * 520, diry * 520, -1, 8, "enemy", 3);
          e.shootCooldown = type === "sniper" ? 1.3 + rnd(0, 0.6) : 0.95 + rnd(0, 0.4);
        }
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // Soft bounds
      e.x = clamp(e.x, 20, lobby.world.w - 20);
      e.y = clamp(e.y, 20, lobby.world.h - 20);
    }

    const deadEnemyIds = new Set();
    for (let ei = 0; ei < lobby.state.enemies.length; ei++) {
      const e = lobby.state.enemies[ei];
      if (!e || e.hp <= 0 || deadEnemyIds.has(e.id)) continue;
      for (let pi = 0; pi < lobby.players.length; pi++) {
        if (!active.has(pi)) continue;
        const p = lobby.players[pi];
        const pdata = lobby.playerData?.[pi];
        if (!p || !pdata || pdata.respawnTimer > 0) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        const minDist = e.r + p.r;
        if (dist === 0 || dist >= minDist) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        p.x -= nx * overlap * 0.5;
        p.y -= ny * overlap * 0.5;
        e.x += nx * overlap * 0.5;
        e.y += ny * overlap * 0.5;
        const rel = (e.vx - p.vx) * nx + (e.vy - p.vy) * ny;
        if (rel < 0) {
          const impulse = -rel * 0.6 + 60;
          p.vx -= impulse * nx;
          p.vy -= impulse * ny;
          e.vx += impulse * nx;
          e.vy += impulse * ny;
        }
        if ((p.bumpCooldown || 0) === 0 && (e.bumpCooldown || 0) === 0) {
          applyDamage(pdata, p, 6);
          e.hp -= 6;
          const cx = (p.x + e.x) * 0.5;
          const cy = (p.y + e.y) * 0.5;
          spawnParticles(lobby.state, cx, cy, "rgba(255,190,120,0.85)", 10, 160, 0.35, 2.1);
          p.bumpCooldown = 0.6;
          e.bumpCooldown = 0.6;
          if (e.hp <= 0) {
            spawnParticles(lobby.state, e.x, e.y, "rgba(255,140,120,0.9)", 16, 220, 0.6, 2.6);
            pdata.credits += 20;
            deadEnemyIds.add(e.id);
          }
        }
      }
    }

    for (let i = 0; i < lobby.state.enemies.length; i++) {
      const e1 = lobby.state.enemies[i];
      if (!e1 || e1.hp <= 0 || deadEnemyIds.has(e1.id)) continue;
      for (let j = i + 1; j < lobby.state.enemies.length; j++) {
        const e2 = lobby.state.enemies[j];
        if (!e2 || e2.hp <= 0 || deadEnemyIds.has(e2.id)) continue;
        const dx = e2.x - e1.x;
        const dy = e2.y - e1.y;
        const dist = Math.hypot(dx, dy);
        const minDist = e1.r + e2.r;
        if (dist === 0 || dist >= minDist) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        e1.x -= nx * overlap * 0.5;
        e1.y -= ny * overlap * 0.5;
        e2.x += nx * overlap * 0.5;
        e2.y += ny * overlap * 0.5;
        const rel = (e2.vx - e1.vx) * nx + (e2.vy - e1.vy) * ny;
        if (rel < 0) {
          const impulse = -rel * 0.6 + 50;
          e1.vx -= impulse * nx;
          e1.vy -= impulse * ny;
          e2.vx += impulse * nx;
          e2.vy += impulse * ny;
        }
        if ((e1.bumpCooldown || 0) === 0 && (e2.bumpCooldown || 0) === 0) {
          e1.hp -= 4;
          e2.hp -= 4;
          const cx = (e1.x + e2.x) * 0.5;
          const cy = (e1.y + e2.y) * 0.5;
          spawnParticles(lobby.state, cx, cy, "rgba(255,190,120,0.75)", 8, 150, 0.3, 2);
          e1.bumpCooldown = 0.6;
          e2.bumpCooldown = 0.6;
          if (e1.hp <= 0) {
            spawnParticles(lobby.state, e1.x, e1.y, "rgba(255,140,120,0.9)", 12, 200, 0.5, 2.4);
            deadEnemyIds.add(e1.id);
          }
          if (e2.hp <= 0) {
            spawnParticles(lobby.state, e2.x, e2.y, "rgba(255,140,120,0.9)", 12, 200, 0.5, 2.4);
            deadEnemyIds.add(e2.id);
          }
        }
      }
    }
    if (deadEnemyIds.size > 0) {
      lobby.state.enemies = lobby.state.enemies.filter((e) => !deadEnemyIds.has(e.id));
    }
  }
}

function snapshot(lobby) {
  const active = new Set(lobby.slots.values());
  return {
    t: lobby.state.t,
    serverTick: lobby.tick,
    lobbyId: lobby.code,
    lobbyState: lobby.stateName,
    stars: lobby.state.stars,
    minerals: lobby.state.minerals,
    meteors: lobby.state.meteors,
    bodies: lobby.state.bodies,
    enemies: lobby.state.enemies,
    bullets: lobby.state.bullets,
    particles: lobby.state.particles,
    ults: lobby.state.ults,
    systems: lobby.systems || [],
    score: lobby.state.score,
    winner: lobby.state.winner,
    world: { w: lobby.world.w, h: lobby.world.h, win: WIN_SCORE, mode: lobby.mode },
    stats: lobby.playerData?.map((p) => ({
      credits: p.credits,
      upgrades: p.upgrades,
      health: p.health,
      maxHealth: p.maxHealth,
      shield: p.shield,
      maxShield: p.maxShield,
      shieldCooldown: p.shieldCooldown,
      laserOverheat: p.laserOverheat,
      weapon: p.weapon,
      ownedWeapons: p.ownedWeapons,
      weaponUpgrades: p.weaponUpgrades,
      plasmaCharges: p.plasmaCharges,
      plasmaRecharge: p.plasmaRecharge,
      weaponCooldown: p.weaponCooldown,
      laserCooldown: p.laserCooldown,
      weaponSwitchCooldown: p.weaponSwitchCooldown,
      pulseCharge: p.pulseCharge,
      gunOverheat: p.gunOverheat,
      gunHeat: p.gunHeat,
      inventory: p.inventory,
      inventoryCapacity: p.inventoryCapacity,
      respawnTimer: p.respawnTimer,
      customization: p.customization,
    })),
    players: lobby.players.map((p) => ({
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      facing: p.facing,
      dashCooldown: p.dashCooldown,
      dashTime: p.dashTime,
      active: active.has(p.id),
    })),
    playerNames: lobby.playerData?.map((_, idx) => {
      for (const [socketId, slot] of lobby.slots.entries()) {
        if (slot === idx) return lobby.members.get(socketId) || `P${idx + 1}`;
      }
      return `P${idx + 1}`;
    }),
  };
}

const activeUsernames = new Map(); // lowercased username -> socket.id
const knownUsernames = new Map(); // lowercased username -> { name, lastSeen }
let saveTimer = null;

function loadKnownUsernames() {
  try {
    if (!fs.existsSync(USERS_FILE)) return;
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.names) ? parsed.names : [];
    for (const item of list) {
      if (!item || !item.lower || !item.name) continue;
      knownUsernames.set(String(item.lower), {
        name: String(item.name),
        lastSeen: Number(item.lastSeen) || Date.now(),
        token: String(item.token || ""),
      });
    }
  } catch {
    // ignore
  }
}

function saveKnownUsernames() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const names = [];
    for (const [lower, info] of knownUsernames.entries()) {
      names.push({ lower, name: info.name, lastSeen: info.lastSeen, token: info.token });
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify({ names }, null, 2), "utf8");
  } catch {
    // ignore
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveKnownUsernames();
  }, NAME_SAVE_DELAY);
}

loadKnownUsernames();

app.prepare().then(() => {
  const server = http.createServer((req, res) => handle(req, res));

  const io = new Server(server, {
    cors: { origin: true, methods: ["GET", "POST"] },
  });
  const lobbies = new Map(); // code -> lobby

  function worldFromRules(rules) {
    const size = rules?.worldSize || "Medium";
    if (size === "Small") return { w: 720, h: 420 };
    if (size === "Large") return { w: 1200, h: 700 };
    return { w: WORLD_W, h: WORLD_H };
  }

  function generateWorldMap(lobby) {
    const seed = hashCode(lobby.code + ":" + lobby.name);
    const rand = mulberry32(seed);
    const density = lobby.rules?.worldSize === "Large" ? 1.35 : lobby.rules?.worldSize === "Small" ? 0.8 : 1;
    const count = Math.round(22 * density);
    const types = ["star", "planet", "moon", "station", "ruins", "anomaly", "nebula", "civ"];
    const namesA = ["Astra", "Orion", "Vega", "Nyx", "Kepler", "Helios", "Lyra", "Cygnus", "Draco", "Altair"];
    const namesB = ["Reach", "Outpost", "Gate", "Hollow", "Belt", "Harbor", "Spire", "Rift", "Crown", "Vale"];
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rand() * lobby.world.w);
      const y = Math.floor(rand() * lobby.world.h);
      const type = types[Math.floor(rand() * types.length)];
      const name = `${namesA[Math.floor(rand() * namesA.length)]} ${namesB[Math.floor(rand() * namesB.length)]}`;
      const node = { id: i + 1, x, y, type, name };
      if (type === "station") {
        const pool = ["minigun", "plasma", "pulse", "homing"];
        const a = pool[node.id % pool.length];
        const b = pool[(node.id + 1) % pool.length];
        node.shop = [a, b];
      }
      nodes.push(node);
    }
    return { w: lobby.world.w, h: lobby.world.h, nodes };
  }

  function generateSystems(lobby, rand, region) {
    const systems = [];
    const count = Math.max(2, Math.round((region.w * region.h) / 180000));
    const namesA = ["Astra", "Orion", "Vega", "Nyx", "Kepler", "Helios", "Lyra", "Cygnus", "Draco", "Altair"];
    const namesB = ["Reach", "Drift", "Breach", "Spiral", "Crown", "Vale", "Hollow", "Gale", "Arc", "Gate"];
    for (let i = 0; i < count; i++) {
      const x = region.x + Math.floor(rand() * region.w);
      const y = region.y + Math.floor(rand() * region.h);
      const r = Math.floor(220 + rand() * 220);
      const color = [
        Math.floor(80 + rand() * 120),
        Math.floor(80 + rand() * 140),
        Math.floor(120 + rand() * 120),
      ];
      const name = `${namesA[Math.floor(rand() * namesA.length)]} ${namesB[Math.floor(rand() * namesB.length)]}`;
      systems.push({ id: lobby.systemId++, x, y, r, color, name, visited: false });
    }
    return systems;
  }

  function addBodiesFromNodes(lobby, nodes) {
    for (const node of nodes) {
      if (node.type === "planet" || node.type === "moon" || node.type === "civ") {
        spawnBody(lobby.state, node);
      }
    }
  }

  function getStationById(lobby, id) {
    if (!lobby.worldMap?.nodes) return null;
    const node = lobby.worldMap.nodes.find((n) => n.id === id);
    if (!node || node.type !== "station") return null;
    return node;
  }

  function expandWorldIfNeeded(lobby) {
    if (lobby.mode !== "Endless") return;
    const activeSlots = new Set(lobby.slots.values());
    if (activeSlots.size === 0) return;
    let expandLeft = false;
    let expandTop = false;
    let expandRight = false;
    let expandBottom = false;
    for (const slot of activeSlots) {
      const p = lobby.players[slot];
      if (!p) continue;
      if (p.x > lobby.world.w - ENDLESS_EDGE_MARGIN) expandRight = true;
      if (p.y > lobby.world.h - ENDLESS_EDGE_MARGIN) expandBottom = true;
      if (p.x < ENDLESS_EDGE_MARGIN) expandLeft = true;
      if (p.y < ENDLESS_EDGE_MARGIN) expandTop = true;
    }
    if (!expandLeft && !expandRight && !expandTop && !expandBottom) return;

    const stepX = ENDLESS_EXPAND_STEP;
    const stepY = Math.round(ENDLESS_EXPAND_STEP * 0.65);
    const shiftX = expandLeft ? stepX : 0;
    const shiftY = expandTop ? stepY : 0;

    if (expandLeft || expandRight) lobby.world.w += stepX;
    if (expandTop || expandBottom) lobby.world.h += stepY;

    if (shiftX || shiftY) {
      const shiftAll = (arr, keyX, keyY) => {
        for (const item of arr) {
          item[keyX] += shiftX;
          item[keyY] += shiftY;
        }
      };
      shiftAll(lobby.players, "x", "y");
      shiftAll(lobby.state.stars, "x", "y");
      shiftAll(lobby.state.minerals, "x", "y");
      shiftAll(lobby.state.meteors, "x", "y");
      shiftAll(lobby.state.bodies, "x", "y");
      shiftAll(lobby.state.enemies, "x", "y");
      shiftAll(lobby.state.bullets, "x", "y");
      shiftAll(lobby.state.particles, "x", "y");
      shiftAll(lobby.state.ults, "x", "y");
      if (lobby.systems?.length) shiftAll(lobby.systems, "x", "y");
      if (lobby.worldMap?.nodes) shiftAll(lobby.worldMap.nodes, "x", "y");
    }
    let xRange = lobby.world.w;
    let yRange = lobby.world.h;
    let xOffset = 0;
    let yOffset = 0;
    if (lobby.worldMap) {
      lobby.worldMap.w = lobby.world.w;
      lobby.worldMap.h = lobby.world.h;
      const rand = mulberry32(hashCode(lobby.code + ":" + lobby.world.w + ":" + lobby.world.h + ":" + shiftX + ":" + shiftY));
      const extra = Math.max(4, Math.round(ENDLESS_EXPAND_STEP / 30));
      const types = ["star", "planet", "moon", "station", "ruins", "anomaly", "nebula", "civ"];
      const namesA = ["Astra", "Orion", "Vega", "Nyx", "Kepler", "Helios", "Lyra", "Cygnus", "Draco", "Altair"];
      const namesB = ["Reach", "Outpost", "Gate", "Hollow", "Belt", "Harbor", "Spire", "Rift", "Crown", "Vale"];
      const startId = lobby.worldMap.nodes.length + 1;
      xRange = expandLeft || expandRight ? stepX : lobby.world.w;
      yRange = expandTop || expandBottom ? stepY : lobby.world.h;
      xOffset = expandLeft ? 0 : expandRight ? lobby.world.w - stepX : 0;
      yOffset = expandTop ? 0 : expandBottom ? lobby.world.h - stepY : 0;
      for (let i = 0; i < extra; i++) {
        const x = Math.floor(rand() * xRange) + xOffset;
        const y = Math.floor(rand() * yRange) + yOffset;
        const type = types[Math.floor(rand() * types.length)];
        const name = `${namesA[Math.floor(rand() * namesA.length)]} ${namesB[Math.floor(rand() * namesB.length)]}`;
        const node = { id: startId + i, x, y, type, name };
        if (type === "station") {
          const pool = ["minigun", "plasma", "pulse", "homing"];
          const a = pool[node.id % pool.length];
          const b = pool[(node.id + 1) % pool.length];
          node.shop = [a, b];
        }
        if (type === "planet" || type === "moon" || type === "civ") {
          spawnBody(lobby.state, node);
        }
        lobby.worldMap.nodes.push(node);
      }
      if (lobby.worldMap.nodes.length > MAX_NODES) {
        const activePlayers = Array.from(lobby.slots.values())
          .map((slot) => lobby.players[slot])
          .filter(Boolean);
        const fallback = { x: lobby.world.w * 0.5, y: lobby.world.h * 0.5 };
        lobby.worldMap.nodes = lobby.worldMap.nodes
          .map((node) => {
            const anchor = activePlayers.length ? activePlayers : [fallback];
            let best = Infinity;
            for (const p of anchor) {
              const d = len(node.x - p.x, node.y - p.y);
              if (d < best) best = d;
            }
            return { node, d: best };
          })
          .sort((a, b) => a.d - b.d)
          .slice(0, MAX_NODES)
          .map((entry) => entry.node);
      }
    }

    if (lobby.systems) {
      const sysRand = mulberry32(hashCode(lobby.code + ":" + lobby.world.w + ":" + lobby.world.h + ":systems"));
      const region = { x: xOffset, y: yOffset, w: xRange, h: yRange };
      lobby.systems.push(...generateSystems(lobby, sysRand, region));
      if (lobby.systems.length > 24) lobby.systems = lobby.systems.slice(-24);
    }

    const burst = Math.max(2, Math.min(8, lobby.rules?.starBurst ?? 2));
    for (let i = 0; i < burst; i++) spawnStar(lobby.state, lobby.world);
    emitLobbyState(lobby);
  }

  function makeLobbyCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function assignSlot(lobby) {
    pruneReservations(lobby);
    const used = new Set(lobby.slots.values());
    for (const r of lobby.reserved || []) {
      used.add(r.slot);
    }
    for (let i = 0; i < lobby.maxPlayers; i++) {
      if (!used.has(i)) return i;
    }
    return null;
  }

  function pruneReservations(lobby) {
    const now = Date.now();
    lobby.reserved = (lobby.reserved || []).filter((r) => r.expires > now);
  }

  function reserveSlot(lobby, slot, username, token) {
    if (slot == null) return;
    pruneReservations(lobby);
    const existing = lobby.reserved.find((r) => r.slot === slot);
    const expires = Date.now() + RECONNECT_GRACE_MS;
    if (existing) {
      existing.username = username;
      existing.token = token;
      existing.expires = expires;
    } else {
      lobby.reserved.push({ slot, username, token, expires });
    }
  }

  function claimReservedSlot(lobby, username, token) {
    pruneReservations(lobby);
    const idx = lobby.reserved.findIndex((r) => r.username === username && r.token && r.token === token);
    if (idx === -1) return null;
    const slot = lobby.reserved[idx].slot;
    lobby.reserved.splice(idx, 1);
    return slot;
  }

  function pickHost(lobby) {
    const slots = Array.from(lobby.slots.entries()).sort((a, b) => a[1] - b[1]);
    const [socketId] = slots[0] || [];
    lobby.hostId = socketId || null;
    lobby.hostName = socketId ? lobby.members.get(socketId) || "" : "";
  }

  function updateLobbyStateName(lobby) {
    const states = new Set(lobby.clientStates || []);
    if (states.has("playing")) lobby.stateName = "playing";
    else if (states.has("loading")) lobby.stateName = "loading";
    else lobby.stateName = "lobby";
  }

  function isUsernameReserved(name, token) {
    const lower = String(name).toLowerCase();
    for (const lobby of lobbies.values()) {
      for (const r of lobby.reserved || []) {
        if (String(r.username).toLowerCase() !== lower) continue;
        if (!token || r.token !== token) return true;
      }
    }
    return false;
  }

  function ensureLobby({ name, isPublic, password, mode, rules }) {
    let code = makeLobbyCode();
    while (lobbies.has(code)) code = makeLobbyCode();
    const maxPlayers = mode === "Endless" ? MAX_PLAYERS_ENDLESS : 2;
    const safeRules = {
      startingStars: Math.max(3, Math.min(20, Number(rules?.startingStars) || 6)),
      starBurst: Math.max(1, Math.min(5, Number(rules?.starBurst) || 2)),
      enemyDensity: ["Low", "Normal", "High"].includes(rules?.enemyDensity) ? rules.enemyDensity : "Normal",
      worldSize: ["Small", "Medium", "Large"].includes(rules?.worldSize) ? rules.worldSize : "Medium",
      shopEnabled: rules?.shopEnabled !== false,
      shopPriceMult: Math.max(0.5, Math.min(2, Number(rules?.shopPriceMult) || 1)),
      shopRerollCost: Math.max(1, Math.min(10, Number(rules?.shopRerollCost) || 3)),
    };
    const world = worldFromRules(safeRules);
    const lobby = {
      code,
      name: name || "Lobby",
      public: !!isPublic,
      password: password || "",
      mode: mode || "Classic",
      maxPlayers,
      rules: safeRules,
      world,
      worldMap: null,
      createdAt: Date.now(),
      emptySince: null,
      stateName: "lobby",
      hostId: null,
      hostName: "",
      tick: 0,
      room: `lobby:${code}`,
      slots: new Map(),
      members: new Map(),
      reserved: [],
      systems: [],
      systemId: 1,
      chat: [],
      chatId: 0,
      inputs: [],
      state: makeState(maxPlayers, mode),
      players: [],
      last: Date.now(),
    };
    resetLobby(lobby);
    if (mode === "Endless") {
      lobby.worldMap = generateWorldMap(lobby);
      addBodiesFromNodes(lobby, lobby.worldMap.nodes);
      const rand = mulberry32(hashCode(lobby.code + ":systems"));
      lobby.systems = generateSystems(lobby, rand, { x: 0, y: 0, w: lobby.world.w, h: lobby.world.h });
    }
    lobbies.set(code, lobby);
    return lobby;
  }

  function lobbySummary(lobby) {
    return {
      code: lobby.code,
      name: lobby.name,
      public: lobby.public,
      count: lobby.slots.size,
      mode: lobby.mode,
      maxPlayers: lobby.maxPlayers,
    };
  }

  function lobbyState(lobby) {
    const players = [];
    for (const [socketId, slot] of lobby.slots.entries()) {
      players.push({ slot, name: lobby.members.get(socketId) || "Player" });
    }
    players.sort((a, b) => a.slot - b.slot);
    return {
      code: lobby.code,
      name: lobby.name,
      public: lobby.public,
      mode: lobby.mode,
      count: lobby.slots.size,
      maxPlayers: lobby.maxPlayers,
      rules: lobby.rules,
      map: lobby.worldMap,
      players,
    };
  }

  function emitLobbyState(lobby) {
    io.to(lobby.room).emit("lobby-state", lobbyState(lobby));
  }

  function pruneDisconnectedSockets(lobby) {
    let changed = false;
    for (const [socketId, slot] of lobby.slots.entries()) {
      if (!io.sockets.sockets.has(socketId)) {
        lobby.slots.delete(socketId);
        lobby.members.delete(socketId);
        lobby.inputs[slot] = { ax: 0, ay: 0, dash: false, mine: false };
        lobby.clientStates[slot] = "lobby";
        changed = true;
      }
    }
    if (changed) {
      if (lobby.hostId && !lobby.slots.has(lobby.hostId)) pickHost(lobby);
      updateLobbyStateName(lobby);
      if (lobby.slots.size === 0) lobby.emptySince = lobby.emptySince || Date.now();
      emitLobbyState(lobby);
    }
  }

  function leaveLobby(socket, opts = {}) {
    const code = socket.data.lobbyCode;
    if (!code) return;
    const lobby = lobbies.get(code);
    if (lobby) {
      const mySlot = lobby.slots.get(socket.id);
      lobby.slots.delete(socket.id);
      lobby.members.delete(socket.id);
      if (mySlot != null) {
        lobby.inputs[mySlot] = { ax: 0, ay: 0, dash: false, mine: false };
        lobby.clientStates[mySlot] = "lobby";
        if (opts.reserve && socket.data.username && socket.data.token) {
          reserveSlot(lobby, mySlot, socket.data.username, socket.data.token);
        }
      }
      if (lobby.hostId === socket.id) pickHost(lobby);
      if (lobby.slots.size === 0) {
        lobby.emptySince = lobby.emptySince || Date.now();
      }
      updateLobbyStateName(lobby);
      emitLobbyState(lobby);
    }
    socket.leave(`lobby:${code}`);
    socket.data.lobbyCode = null;
    socket.data.slot = null;
  }

  function joinLobby(socket, lobby, cb) {
    if (!socket.data.username) {
      cb?.({ ok: false, reason: "no-username" });
      return;
    }
    const slot = claimReservedSlot(lobby, socket.data.username, socket.data.token) ?? assignSlot(lobby);
    if (slot === null) {
      cb?.({ ok: false, reason: "full" });
      return;
    }
    leaveLobby(socket);
    lobby.slots.set(socket.id, slot);
    lobby.members.set(socket.id, socket.data.username);
    lobby.clientStates[slot] = "lobby";
    lobby.emptySince = null;
    if (!lobby.hostId) pickHost(lobby);
    updateLobbyStateName(lobby);
    if (socket.data.customization && lobby.playerData?.[slot]) {
      lobby.playerData[slot].customization = socket.data.customization;
    }
    socket.join(lobby.room);
    socket.data.lobbyCode = lobby.code;
    socket.data.slot = slot;
    socket.emit("slot", slot);
    socket.emit("snapshot", snapshot(lobby));
    if (lobby.chat?.length) socket.emit("chat-history", lobby.chat);
    emitLobbyState(lobby);
    cb?.({ ok: true, slot, code: lobby.code });
  }

  io.on("connection", (socket) => {
    socket.on("register-username", (rawName, cb) => {
      const name = String(rawName?.name ?? rawName ?? "").trim();
      if (!name) {
        cb?.({ ok: false, reason: "invalid" });
        return;
      }
      const incomingToken = rawName?.token ? String(rawName.token) : "";
      const key = name.toLowerCase();
      const existing = activeUsernames.get(key);
      if (existing && existing !== socket.id) {
        cb?.({ ok: false, reason: "taken" });
        return;
      }
      if (isUsernameReserved(name, incomingToken)) {
        cb?.({ ok: false, reason: "taken" });
        return;
      }
      activeUsernames.set(key, socket.id);
      const existingInfo = knownUsernames.get(key);
      if (existingInfo?.token && incomingToken && incomingToken !== existingInfo.token) {
        cb?.({ ok: false, reason: "taken" });
        return;
      }
      const token = existingInfo?.token || incomingToken || makeToken();
      knownUsernames.set(key, { name, lastSeen: Date.now(), token });
      scheduleSave();
      socket.data.username = name;
      socket.data.token = token;
      cb?.({ ok: true, token });
    });

    socket.on("list-lobbies", (cb) => {
      const list = [];
      for (const lobby of lobbies.values()) {
        if (lobby.public) list.push(lobbySummary(lobby));
      }
      cb?.({ ok: true, lobbies: list });
    });

    socket.on("create-lobby", (data, cb) => {
      if (!socket.data.username) {
        cb?.({ ok: false, reason: "no-username" });
        return;
      }
      const name = String(data?.name || "").trim();
      const mode = String(data?.mode || "Classic").trim();
      const isPublic = !!data?.public;
      const password = String(data?.password || "").trim();
      const rules = data?.rules || {};
      if (name.length < 3 || name.length > 32) {
        cb?.({ ok: false, reason: "invalid-name" });
        return;
      }
      if (!isPublic && password.length < 4) {
        cb?.({ ok: false, reason: "invalid-password" });
        return;
      }
      const lobby = ensureLobby({ name, isPublic, password, mode, rules });
      joinLobby(socket, lobby, cb);
    });

    socket.on("join-lobby", (data, cb) => {
      if (!socket.data.username) {
        cb?.({ ok: false, reason: "no-username" });
        return;
      }
      const code = String(data?.code || "").trim().toUpperCase();
      const password = String(data?.password || "").trim();
      const lobby = lobbies.get(code);
      if (!lobby) {
        cb?.({ ok: false, reason: "not-found" });
        return;
      }
      if (!lobby.public && lobby.password && lobby.password !== password) {
        cb?.({ ok: false, reason: "bad-password" });
        return;
      }
      joinLobby(socket, lobby, cb);
    });

    socket.on("leave-lobby", () => {
      leaveLobby(socket);
    });

    socket.on("set-customization", (raw) => {
      const primary = String(raw?.primary || "").trim();
      const accent = String(raw?.accent || "").trim();
      const shape = String(raw?.shape || "").trim();
      const hat = String(raw?.hat || "").trim();
      const trail = String(raw?.trail || "").trim();
      const ok = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
      const shapes = new Set(["dart", "orb", "hex"]);
      const hats = new Set(["none", "antenna", "cap", "crown"]);
      const trails = new Set(["ion", "sparks", "none"]);
      const customization = {
        primary: ok(primary) ? primary : "#78c8ff",
        accent: ok(accent) ? accent : "#ffffff",
        shape: shapes.has(shape) ? shape : "dart",
        hat: hats.has(hat) ? hat : "none",
        trail: trails.has(trail) ? trail : "ion",
      };
      socket.data.customization = customization;
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby) return;
      const mySlot = lobby.slots.get(socket.id);
      if (mySlot == null) return;
      if (lobby.playerData?.[mySlot]) lobby.playerData[mySlot].customization = customization;
    });

    socket.on("chat", (raw, cb) => {
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby) return;
      const now = Date.now();
      const last = socket.data.lastChatAt || 0;
      if (now - last < 400) return;
      socket.data.lastChatAt = now;
      const text = String(raw || "").trim();
      if (!text || text.length > 180) return;
      const entry = {
        id: ++lobby.chatId,
        name: socket.data.username || "Player",
        text,
        t: Date.now(),
      };
      lobby.chat.push(entry);
      if (lobby.chat.length > 50) lobby.chat.shift();
      io.to(lobby.room).emit("chat", entry);
      cb?.({ ok: true });
    });

    socket.on("client-state", (rawState) => {
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby) return;
      const mySlot = lobby.slots.get(socket.id);
      if (mySlot == null) return;
      const state = ["menu", "loading", "playing", "lobby"].includes(rawState) ? rawState : "lobby";
      lobby.clientStates[mySlot] = state;
      updateLobbyStateName(lobby);
    });

    socket.on("input", (msg) => {
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby) return;
      const mySlot = lobby.slots.get(socket.id);
      if (mySlot == null) return;
      const seq = Number(msg?.seq);
      if (!Number.isFinite(seq)) return;
      if ((lobby.inputSeq?.[mySlot] ?? -1) >= seq) return;
      lobby.inputSeq[mySlot] = seq;
      lobby.inputTimes[mySlot] = Number(msg?.clientTime) || 0;
      lobby.inputs[mySlot] = {
        ax: clamp(msg?.ax ?? 0, -1, 1),
        ay: clamp(msg?.ay ?? 0, -1, 1),
        dash: !!msg?.dash,
        shootPrimary: !!msg?.shootPrimary,
        shootSecondary: !!msg?.shootSecondary,
        mine: !!msg?.mine,
        aimX: Number(msg?.aimX),
        aimY: Number(msg?.aimY),
      };
    });

    socket.on("dock-station", (data, cb) => {
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby || lobby.mode !== "Endless") return;
      const mySlot = lobby.slots.get(socket.id);
      if (mySlot == null) return;
      const station = getStationById(lobby, Number(data?.id));
      if (!station) {
        cb?.({ ok: false, reason: "invalid" });
        return;
      }
      const p = lobby.players[mySlot];
      const dist = len(p.x - station.x, p.y - station.y);
      if (dist > 130) {
        cb?.({ ok: false, reason: "too-far" });
        return;
      }
      const pdata = lobby.playerData?.[mySlot];
      if (!pdata) return;
      const repairCost = 15;
      if (pdata.credits < repairCost) {
        cb?.({ ok: false, reason: "insufficient" });
        return;
      }
      pdata.credits -= repairCost;
      pdata.health = pdata.maxHealth;
      pdata.laserOverheat = 0;
      cb?.({ ok: true, credits: pdata.credits, health: pdata.health });
    });

    socket.on("sell-materials", (data, cb) => {
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby || lobby.mode !== "Endless") return;
      const mySlot = lobby.slots.get(socket.id);
      if (mySlot == null) return;
      const station = getStationById(lobby, Number(data?.stationId));
      if (!station) {
        cb?.({ ok: false, reason: "invalid" });
        return;
      }
      const p = lobby.players[mySlot];
      const dist = len(p.x - station.x, p.y - station.y);
      if (dist > 130) {
        cb?.({ ok: false, reason: "too-far" });
        return;
      }
      const pdata = lobby.playerData?.[mySlot];
      if (!pdata) return;
      if (!pdata.inventory) pdata.inventory = { ore: 0, crystal: 0, alloy: 0 };
      const item = String(data?.item || "");
      let gained = 0;
      if (item === "all") {
        for (const key of Object.keys(SELL_VALUES)) {
          const qty = pdata.inventory[key] || 0;
          if (qty > 0) {
            gained += qty * SELL_VALUES[key];
            pdata.inventory[key] = 0;
          }
        }
        if (gained === 0) {
          cb?.({ ok: false, reason: "empty" });
          return;
        }
      } else if (SELL_VALUES[item]) {
        let qty = Math.floor(Number(data?.amount) || 0);
        if (!Number.isFinite(qty) || qty <= 0) qty = pdata.inventory[item] || 0;
        qty = Math.min(qty, pdata.inventory[item] || 0);
        if (qty <= 0) {
          cb?.({ ok: false, reason: "empty" });
          return;
        }
        gained = qty * SELL_VALUES[item];
        pdata.inventory[item] = Math.max(0, (pdata.inventory[item] || 0) - qty);
      } else {
        cb?.({ ok: false, reason: "invalid" });
        return;
      }
      pdata.credits += gained;
      cb?.({ ok: true, credits: pdata.credits, inventory: pdata.inventory, gained });
    });

    socket.on("buy-upgrade", (data, cb) => {
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby || lobby.mode !== "Endless") return;
      const mySlot = lobby.slots.get(socket.id);
      if (mySlot == null) return;
      const pdata = lobby.playerData?.[mySlot];
      if (!pdata) return;

      const id = String(data?.id || "");
      const levels = pdata.upgrades || { laser: 0, speed: 0, dash: 0, cannon: 0, health: 0, magnet: 0, shield: 0, storage: 0 };
      const weaponLevels = pdata.weaponUpgrades || { minigun: 0, plasma: 0, pulse: 0, homing: 0 };
      const prices = { laser: 60, speed: 45, dash: 50, cannon: 70, health: 65, magnet: 55, shield: 60, storage: 75 };
      const weaponPrices = { minigun: 90, plasma: 110, pulse: 100, homing: 120 };
      let level = levels[id] || 0;
      let base = prices[id];
      let isWeaponUpgrade = false;
      if (!base && id.startsWith("w:")) {
        const wid = id.slice(2);
        if (!pdata.ownedWeapons?.includes(wid)) return;
        level = weaponLevels[wid] || 0;
        base = weaponPrices[wid];
        isWeaponUpgrade = true;
      }
      if (!base) return;
      const cost = Math.round(base * (1 + level * 0.6) * (lobby.rules?.shopPriceMult ?? 1));
      if (pdata.credits < cost) {
        cb?.({ ok: false, reason: "insufficient" });
        return;
      }
      pdata.credits -= cost;
      let newLevel = level + 1;
      if (isWeaponUpgrade) {
        const wid = id.slice(2);
        weaponLevels[wid] = newLevel;
        pdata.weaponUpgrades = weaponLevels;
      } else {
        levels[id] = newLevel;
        pdata.upgrades = levels;
      }
      if (id === "health") {
        pdata.maxHealth += 20;
        pdata.health = pdata.maxHealth;
      }
      cb?.({ ok: true, level: newLevel, credits: pdata.credits });
    });

    socket.on("cycle-weapon", (dir) => {
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby || lobby.mode !== "Endless") return;
      const mySlot = lobby.slots.get(socket.id);
      if (mySlot == null) return;
      const pdata = lobby.playerData?.[mySlot];
      if (!pdata || !Array.isArray(pdata.ownedWeapons)) return;
      if (pdata.weaponSwitchCooldown > 0) return;
      const list = pdata.ownedWeapons;
      if (list.length === 0) return;
      const idx = Math.max(0, list.indexOf(pdata.weapon));
      const step = Number(dir) >= 0 ? 1 : -1;
      const next = (idx + step + list.length) % list.length;
      pdata.weapon = list[next];
      pdata.weaponSwitchCooldown = 0.25;
    });

    socket.on("buy-weapon", (data, cb) => {
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby || lobby.mode !== "Endless") return;
      const mySlot = lobby.slots.get(socket.id);
      if (mySlot == null) return;
      const pdata = lobby.playerData?.[mySlot];
      if (!pdata) return;
      const weaponId = String(data?.weapon || "");
      const station = getStationById(lobby, Number(data?.stationId));
      if (!station || !station.shop || !station.shop.includes(weaponId)) {
        cb?.({ ok: false, reason: "unavailable" });
        return;
      }
      const p = lobby.players[mySlot];
      const dist = len(p.x - station.x, p.y - station.y);
      if (dist > 90) {
        cb?.({ ok: false, reason: "too-far" });
        return;
      }
      if (pdata.ownedWeapons?.includes(weaponId)) {
        cb?.({ ok: false, reason: "owned" });
        return;
      }
      const cost = WEAPONS[weaponId]?.cost;
      if (!cost) {
        cb?.({ ok: false, reason: "invalid" });
        return;
      }
      if (pdata.credits < cost) {
        cb?.({ ok: false, reason: "insufficient" });
        return;
      }
      pdata.credits -= cost;
      pdata.ownedWeapons.push(weaponId);
      pdata.weapon = weaponId;
      cb?.({ ok: true, credits: pdata.credits, weapon: pdata.weapon });
    });

    socket.on("restart", () => {
      const code = socket.data.lobbyCode;
      if (!code) return;
      const lobby = lobbies.get(code);
      if (!lobby) return;
      resetLobby(lobby);
      io.to(lobby.room).emit("snapshot", snapshot(lobby));
    });

    socket.on("disconnect", () => {
      leaveLobby(socket, { reserve: true });
      if (socket.data.username) {
        const key = String(socket.data.username).toLowerCase();
        if (activeUsernames.get(key) === socket.id) activeUsernames.delete(key);
        const token = socket.data.token || knownUsernames.get(key)?.token || "";
        knownUsernames.set(key, { name: socket.data.username, lastSeen: Date.now(), token });
        scheduleSave();
      }
    });
  });

  // Game loop @60
  setInterval(() => {
    const now = Date.now();
    for (const lobby of lobbies.values()) {
      try {
        pruneReservations(lobby);
        pruneDisconnectedSockets(lobby);
        if (lobby.slots.size === 0) {
          lobby.emptySince = lobby.emptySince || now;
          if (now - lobby.emptySince > LOBBY_TTL_MS) {
            lobbies.delete(lobby.code);
            continue;
          }
        } else {
          lobby.emptySince = null;
        }
        const dt = clamp((now - lobby.last) / 1000, 0, 1 / 20);
        lobby.last = now;
        lobby.tick += 1;
        lobby.state.t += dt;
        if (lobby.state.winner == null) stepLobby(lobby, dt);
        expandWorldIfNeeded(lobby);
        io.to(lobby.room).emit("snapshot", snapshot(lobby));
      } catch (err) {
        console.error("[lobby-tick]", lobby.code, err?.message || err);
      }
    }
  }, 1000 / TICK_RATE);
  server.listen(PORT, () => {
    console.log(`Next + Socket.IO running on http://localhost:${PORT}`);
  });
});
