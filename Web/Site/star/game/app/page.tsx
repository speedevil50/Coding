"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type Snap = {
  t: number;
  serverTick: number;
  lobbyId: string;
  lobbyState: string;
  stars: { id: number; x: number; y: number; r: number; pulse: number }[];
  minerals: { id: number; x: number; y: number; r: number; value: number }[];
  meteors: { id: number; x: number; y: number; r: number; hp: number; maxHp: number; yield: number }[];
  bodies: { id: number; x: number; y: number; r: number; hp: number; maxHp: number; yield: number; type: string }[];
  enemies: { id: number; x: number; y: number; r: number; hp: number; maxHp: number; faction?: string }[];
  bullets: { id: number; x: number; y: number; r: number; damage?: number; type?: string }[];
  particles: { id: number; x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string }[];
  ults: { id: number; x: number; y: number; r: number; life: number; maxLife: number; owner: number }[];
  systems: { id: number; x: number; y: number; r: number; color: number[]; name: string; visited?: boolean }[];
  score: number[];
  winner: number | null;
  world: { w: number; h: number; win: number; mode?: string };
  stats?: {
    credits: number;
    upgrades: { laser: number; speed: number; dash: number; cannon: number; health: number; magnet: number; shield: number; storage: number };
    health: number;
    maxHealth: number;
    shield: number;
    maxShield: number;
    shieldCooldown: number;
    laserOverheat: number;
    weapon: string;
    ownedWeapons: string[];
    weaponUpgrades: Record<WeaponUpgradeId, number>;
    plasmaCharges: number;
    plasmaRecharge: number;
    weaponCooldown: number;
    laserCooldown: number;
    weaponSwitchCooldown: number;
    pulseCharge: number;
    gunOverheat: number;
    gunHeat: number;
    inventory?: { ore: number; crystal: number; alloy: number };
    inventoryCapacity?: number;
    respawnTimer?: number;
    customization?: { primary: string; accent: string; shape: string; hat: string; trail: string };
  }[];
  players: { x: number; y: number; vx: number; vy: number; facing: number; dashCooldown: number; dashTime: number; active: boolean }[];
  playerNames?: string[];
};

type Lobby = { code: string; name: string; public: boolean; count: number; mode: string; maxPlayers: number };
type LobbyState = {
  code: string;
  name: string;
  public: boolean;
  mode: string;
  count: number;
  maxPlayers: number;
  rules?: {
    startingStars: number;
    starBurst: number;
    enemyDensity: string;
    worldSize: string;
    shopEnabled: boolean;
    shopPriceMult: number;
    shopRerollCost: number;
  };
  map?: { w: number; h: number; nodes: { id: number; x: number; y: number; type: string; name: string; shop?: string[] }[] };
  players: { slot: number; name: string }[];
};
type ChatEntry = { id: number; name: string; text: string; t: number };
type WeaponUpgradeId = "minigun" | "plasma" | "pulse" | "homing";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const mouseRef = useRef({ x: 0, y: 0, left: false, right: false });
  const mobileRef = useRef({ active: false, ax: 0, ay: 0, fire: false, ult: false, dash: false, mine: false });
  const playerPosRef = useRef({ x: 0, y: 0 });

  const [mode, setMode] = useState<"Local" | "Online">("Online");
  const [slot, setSlot] = useState<number | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [ping, setPing] = useState<number | null>(null);
  const [socketReady, setSocketReady] = useState(false);

  const [menu, setMenu] = useState<"main" | "play" | "settings" | "about" | "online" | "offline" | "lobby" | "playing">("main");
  const menuRef = useRef(menu);
  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);
  const [username, setUsername] = useState("");
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [registeredName, setRegisteredName] = useState("");
  const [serverCode, setServerCode] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [lobbyError, setLobbyError] = useState("");
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [worldMap, setWorldMap] = useState<LobbyState["map"] | null>(null);
  const [lobbyName, setLobbyName] = useState("");
  const [lobbyPublic, setLobbyPublic] = useState(true);
  const [lobbyPassword, setLobbyPassword] = useState("");
  const [lobbyMode, setLobbyMode] = useState("Classic");
  const [endlessStars, setEndlessStars] = useState(6);
  const [endlessBurst, setEndlessBurst] = useState(2);
  const [endlessWorldSize, setEndlessWorldSize] = useState("Medium");
  const [endlessEnemyDensity, setEndlessEnemyDensity] = useState("Normal");
  const [endlessShopEnabled, setEndlessShopEnabled] = useState(true);
  const [endlessShopPrice, setEndlessShopPrice] = useState(1);
  const [endlessShopReroll, setEndlessShopReroll] = useState(3);
  const [shopOpen, setShopOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const camRef = useRef({ x: 0, y: 0 });
  const shakeRef = useRef({ x: 0, y: 0, t: 0 });
  const prevHealthRef = useRef<number | null>(null);
  const snapRef = useRef<Snap | null>(null);
  const snapRafRef = useRef<number | null>(null);
  const lastSnapTickRef = useRef<number | null>(null);
  const snapBufferRef = useRef<{ snap: Snap; time: number }[]>([]);
  const inputSeqRef = useRef(0);
  const fpsRef = useRef({ frames: 0, last: 0, fps: 0 });
  const snapshotRateRef = useRef({ count: 0, last: 0, rate: 0 });
  const clientStateRef = useRef("menu");
  const playedUltRef = useRef<Set<number>>(new Set());
  const [nearStation, setNearStation] = useState<{ id: number; name: string; shop?: string[] } | null>(null);
  const nearStationRef = useRef<{ id: number; name: string; shop?: string[] } | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockError, setDockError] = useState("");
  const [shipPrimary, setShipPrimary] = useState("#78c8ff");
  const [shipAccent, setShipAccent] = useState("#ffffff");
  const [shipShape, setShipShape] = useState("dart");
  const [shipHat, setShipHat] = useState("none");
  const [shipTrail, setShipTrail] = useState("ion");
  const [isTouch, setIsTouch] = useState(false);
  const [stick, setStick] = useState({ x: 0, y: 0, active: false, id: -1, baseX: 0, baseY: 0 });
  const [chatOpen, setChatOpen] = useState(true);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [chatLog, setChatLog] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatFocused, setChatFocused] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [interpOn, setInterpOn] = useState(true);
  const [debugOn, setDebugOn] = useState(false);
  const authRef = useRef<{ name: string; token: string } | null>(null);

  const keys = useMemo(() => new Set<string>(), []);

  const USERNAME_MIN = 6;
  const USERNAME_MAX = 24;
  const MODES = ["Classic", "Endless", "PvP"];
  const isRegistering = !!username && !registeredName;
  const shopEnabled = lobbyState?.rules?.shopEnabled ?? endlessShopEnabled;
  const shopPriceMult = lobbyState?.rules?.shopPriceMult ?? endlessShopPrice;
  const inventory = snap?.stats?.[slot ?? 0]?.inventory;
  const inventoryCap = snap?.stats?.[slot ?? 0]?.inventoryCapacity ?? 0;
  const inventoryTotal = (inventory?.ore || 0) + (inventory?.crystal || 0) + (inventory?.alloy || 0);
  const canSwitchWeapon = (snap?.stats?.[slot ?? 0]?.ownedWeapons?.length ?? 0) > 1;
  const WEAPON_LABELS: Record<string, string> = {
    cannon: "Cannon",
    minigun: "Minigun",
    plasma: "Plasma Beam",
    pulse: "Pulse Cannon",
    homing: "Homing Barrage",
  };
  const WEAPON_COSTS: Record<string, number> = {
    minigun: 120,
    plasma: 170,
    pulse: 150,
    homing: 190,
  };
  const WEAPON_BASE_COOLDOWN: Record<string, number> = {
    cannon: 0.6,
    minigun: 0.09,
    plasma: 0.35,
    pulse: 0.9,
    homing: 1.4,
  };
  const WEAPON_UPGRADE_COSTS: Record<WeaponUpgradeId, number> = {
    minigun: 90,
    plasma: 110,
    pulse: 100,
    homing: 120,
  };
  const MAX_RENDER_PARTICLES = 400;
  const MAX_RENDER_BULLETS = 300;
  const MATERIAL_SELL_VALUES: Record<string, number> = {
    ore: 12,
    crystal: 18,
    alloy: 26,
  };
  const INTERP_DELAY_MS = 80;
  const ULT_SFX = [
    "/sfx/ult/science-fiction-effect-011-305477.mp3",
    "/sfx/ult/science-fiction-effect-014-305476.mp3",
    "/sfx/ult/science-fiction-effect-019-305479.mp3",
  ];

  const upgradeDescription = (id: string, level: number) => {
    const next = level + 1;
    if (id === "laser") {
      const radius = 1500 + next * 150;
      const cd = Math.max(8, 20 - next * 2);
      return `Ultimate radius ${radius}px, cooldown ${cd.toFixed(0)}s.`;
    }
    if (id === "speed") return `Accel +${next * 8}% and max speed +${next * 6}%.`;
    if (id === "dash") {
      const cd = Math.max(0.25, 0.65 - next * 0.07);
      return `Dash cooldown ${cd.toFixed(2)}s.`;
    }
    if (id === "cannon") return `Cannon damage +${next * 3}.`;
    if (id === "health") return `Max health +${next * 20}.`;
    if (id === "magnet") return `Pickup radius +${next * 6}px.`;
    if (id === "shield") return `Max shield +${next * 25}.`;
    if (id === "storage") return `Inventory capacity ${80 + next * 50}.`;
    return "";
  };

  const hexToRgba = (hex: string, alpha: number) => {
    const clean = hex.replace("#", "");
    if (clean.length !== 6) return `rgba(120,200,255,${alpha})`;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const drawShipPreview = () => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const pr = 14;
    const primary = shipPrimary;
    const accent = shipAccent;
    ctx.fillStyle = hexToRgba(primary, 0.12);
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = primary;
    if (shipShape === "orb") {
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.fill();
    } else if (shipShape === "hex") {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * 2 * i) / 6 - Math.PI / 6;
        const x = cx + Math.cos(a) * pr;
        const y = cy + Math.sin(a) * pr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx + pr, cy);
      ctx.lineTo(cx - pr, cy - pr * 0.7);
      ctx.lineTo(cx - pr * 0.6, cy);
      ctx.lineTo(cx - pr, cy + pr * 0.7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx + pr * 0.6, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (shipHat === "antenna") {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - pr);
      ctx.lineTo(cx, cy - pr - 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy - pr - 12, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (shipHat === "cap") {
      ctx.fillRect(cx - 6, cy - pr - 6, 12, 6);
    } else if (shipHat === "crown") {
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy - pr - 2);
      ctx.lineTo(cx - 3, cy - pr - 10);
      ctx.lineTo(cx + 2, cy - pr - 2);
      ctx.lineTo(cx + 7, cy - pr - 10);
      ctx.lineTo(cx + 12, cy - pr - 2);
      ctx.closePath();
      ctx.fill();
    }
    if (shipTrail !== "none") {
      ctx.strokeStyle = shipTrail === "sparks" ? "rgba(255,200,140,0.8)" : "rgba(120,200,255,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - pr - 10, cy);
      ctx.lineTo(cx - pr - 30, cy);
      ctx.stroke();
    }
  };

  const playUltSfx = () => {
    if (!ULT_SFX.length) return;
    const src = ULT_SFX[Math.floor(Math.random() * ULT_SFX.length)];
    const audio = new Audio(src);
    audio.volume = 0.7;
    audio.play().catch(() => {});
  };

  const normalizeName = (name: string) => name.trim();

  const makeRandomName = () => {
    const adj = ["Nova", "Crimson", "Silent", "Solar", "Void", "Rapid", "Arc", "Stellar", "Quantum", "Lunar"];
    const noun = ["Rider", "Comet", "Voyager", "Falcon", "Warden", "Spark", "Drifter", "Rogue", "Pioneer", "Specter"];
    const a = adj[Math.floor(Math.random() * adj.length)];
    const b = noun[Math.floor(Math.random() * noun.length)];
    const n = Math.floor(100 + Math.random() * 900);
    return `${a}${b}${n}`;
  };

  const submitUsername = () => {
    const nextName = normalizeName(usernameDraft);
    if (nextName.length < USERNAME_MIN) {
      setUsernameError(`Username must be at least ${USERNAME_MIN} characters.`);
      return;
    }
    if (nextName.length > USERNAME_MAX) {
      setUsernameError(`Username must be at most ${USERNAME_MAX} characters.`);
      return;
    }
    setUsername(nextName);
    setUsernameError("");
    setRegisteredName("");
  };

  const requestLobbies = () => {
    const s = socketRef.current;
    if (!s || !socketReady || !registeredName) return;
    s.emit("list-lobbies", (res: { ok: boolean; lobbies?: Lobby[] }) => {
      if (!res?.ok) {
        setLobbyError("Failed to load lobbies.");
        return;
      }
      setLobbyError("");
      setLobbies(res.lobbies || []);
    });
  };

  const disconnectSocket = () => {
    if (pingTimerRef.current != null) window.clearInterval(pingTimerRef.current);
    pingTimerRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setSocketReady(false);
    setSlot(null);
    setRegisteredName("");
    setLobbyState(null);
    setWorldMap(null);
    setChatLog([]);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("star-rush-auth");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.name && parsed?.token) authRef.current = { name: String(parsed.name), token: String(parsed.token) };
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const check = () => setIsTouch(window.matchMedia?.("(pointer: coarse)")?.matches || "ontouchstart" in window);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("star-rush-ship");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.primary) setShipPrimary(String(parsed.primary));
      if (parsed?.accent) setShipAccent(String(parsed.accent));
      if (parsed?.shape) setShipShape(String(parsed.shape));
      if (parsed?.hat) setShipHat(String(parsed.hat));
      if (parsed?.trail) setShipTrail(String(parsed.trail));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!socketReady || !username || registeredName === username) return;
    const s = socketRef.current;
    if (!s) return;
    const auth = authRef.current;
    const token = auth && auth.name.toLowerCase() === username.toLowerCase() ? auth.token : "";
    s.emit("register-username", { name: username, token }, (res: { ok: boolean; reason?: string; token?: string }) => {
      if (!res?.ok) {
        setUsername("");
        setRegisteredName("");
        setUsernameError(res?.reason === "taken" ? "That username is already taken." : "Invalid username.");
        return;
      }
      setRegisteredName(username);
      setUsernameError("");
      if (res?.token) {
        authRef.current = { name: username, token: res.token };
        try {
          localStorage.setItem("star-rush-auth", JSON.stringify({ name: username, token: res.token }));
        } catch {
          // ignore
        }
      }
    });
  }, [socketReady, username, registeredName]);

  useEffect(() => {
    if (menu !== "online" || !socketReady || !registeredName) return;
    requestLobbies();
  }, [menu, socketReady, registeredName]);

  useEffect(() => {
    if (menu !== "playing" || !snap || !worldMap || slot == null || snap.world.mode !== "Endless") {
      setNearStation(null);
      return;
    }
    const me = snap.players[slot];
    if (!me) {
      setNearStation(null);
      return;
    }
    let closest: { id: number; name: string; shop?: string[] } | null = null;
    let best = Infinity;
    for (const node of worldMap.nodes) {
      if (node.type !== "station") continue;
      const d = Math.hypot(me.x - node.x, me.y - node.y);
      if (d < 110 && d < best) {
        best = d;
        closest = { id: node.id, name: node.name, shop: node.shop };
      }
    }
    const prev = nearStationRef.current;
    if (prev?.id !== closest?.id) {
      nearStationRef.current = closest;
      setNearStation(closest);
    }
  }, [menu, snap, worldMap, slot]);

  useEffect(() => {
    if (menu !== "playing") {
      setSnap(null);
      snapBufferRef.current = [];
      inputSeqRef.current = 0;
      lastSnapTickRef.current = null;
    }
  }, [menu]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatLog]);

  useEffect(() => {
    drawShipPreview();
  }, [shipPrimary, shipAccent, shipShape, shipHat, shipTrail]);

  useEffect(() => {
    if (menu !== "playing") setPaused(false);
  }, [menu]);

  useEffect(() => {
    if (menu !== "playing") setDockOpen(false);
  }, [menu]);
  useEffect(() => {
    if (!dockOpen) setDockError("");
  }, [dockOpen]);

  useEffect(() => {
    const s = socketRef.current;
    if (!s || !socketReady) return;
    const state = menu === "playing" ? (snap ? "playing" : "loading") : menu === "lobby" ? "lobby" : "menu";
    if (clientStateRef.current !== state) {
      clientStateRef.current = state;
      s.emit("client-state", state);
    }
  }, [menu, snap, socketReady]);

  useEffect(() => {
    const s = socketRef.current;
    if (!s || !socketReady) return;
    s.emit("set-customization", { primary: shipPrimary, accent: shipAccent, shape: shipShape, hat: shipHat, trail: shipTrail });
    try {
      localStorage.setItem(
        "star-rush-ship",
        JSON.stringify({ primary: shipPrimary, accent: shipAccent, shape: shipShape, hat: shipHat, trail: shipTrail }),
      );
    } catch {
      // ignore
    }
  }, [shipPrimary, shipAccent, shipShape, shipHat, shipTrail, socketReady]);

  useEffect(() => {
    if (menu !== "playing") return;
    const onWheel = (e: WheelEvent) => {
      const s = socketRef.current;
      if (!s) return;
      e.preventDefault();
      s.emit("cycle-weapon", e.deltaY > 0 ? 1 : -1);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [menu]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code === "F3") {
        e.preventDefault();
        setDebugOn((prev) => !prev);
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      keys.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => keys.delete(e.code);
    const clear = () => keys.clear();
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) mouseRef.current.left = true;
      if (e.button === 2) mouseRef.current.right = true;
    };
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) mouseRef.current.left = false;
      if (e.button === 2) mouseRef.current.right = false;
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clear();
    });
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [keys]);

  function inputFor(playerIndex: number) {
    let ax = 0, ay = 0, dash = false;
    if (mobileRef.current.active) {
      ax = mobileRef.current.ax;
      ay = mobileRef.current.ay;
    } else {
      if (keys.has("KeyW")) ay -= 1;
      if (keys.has("KeyS")) ay += 1;
      if (keys.has("KeyA")) ax -= 1;
      if (keys.has("KeyD")) ax += 1;
    }
    dash = mobileRef.current.dash || keys.has("ShiftLeft") || keys.has("ShiftRight");
    const shootPrimary = mobileRef.current.fire || keys.has("Space") || mouseRef.current.left;
    const shootSecondary = mobileRef.current.ult || mouseRef.current.right;
    const mine = mobileRef.current.mine || keys.has("KeyF");
    const m = Math.hypot(ax, ay) || 1;
    const cam = camRef.current;
    let aimX = cam.x + mouseRef.current.x;
    let aimY = cam.y + mouseRef.current.y;
    if (isTouch) {
      const pos = playerPosRef.current;
      const snap = snapRef.current;
      let target = null;
      let best = Infinity;
      if (snap?.enemies?.length) {
        for (const e of snap.enemies) {
          const dx = e.x - pos.x;
          const dy = e.y - pos.y;
          const d = Math.hypot(dx, dy);
          if (d < best && d < 520) {
            best = d;
            target = e;
          }
        }
      }
      if (target) {
        aimX = target.x;
        aimY = target.y;
      } else if (mobileRef.current.active) {
        const dirx = ax / m;
        const diry = ay / m;
        aimX = pos.x + dirx * 160;
        aimY = pos.y + diry * 160;
      } else {
        aimX = pos.x + 140;
        aimY = pos.y;
      }
    }
    return { ax: ax / m, ay: ay / m, dash, shootPrimary, shootSecondary, mine, aimX, aimY };
  }

  // Connect when entering online/playing
  useEffect(() => {
    const shouldConnect = menu === "online" || menu === "lobby" || menu === "playing";
    if (!shouldConnect || socketRef.current) return;
    const s = io({
      path: "/socket.io",
      transports: ["websocket"],
    });

    socketRef.current = s;

    s.on("connect", () => {
      setMode("Online");
      setSocketReady(true);
    });
    s.on("disconnect", () => {
      setSocketReady(false);
      setSlot(null);
      snapBufferRef.current = [];
      lastSnapTickRef.current = null;
    });
    s.on("slot", (n: number) => setSlot(n));
    s.on("snapshot", (x: Snap) => {
      if (menuRef.current !== "playing") return;
      const now = performance.now();
      const buf = snapBufferRef.current;
      buf.push({ snap: x, time: now });
      if (buf.length > 3) buf.shift();
      if (x.ults?.length) {
        const active = new Set(x.ults.map((u) => u.id));
        for (const id of Array.from(playedUltRef.current)) {
          if (!active.has(id)) playedUltRef.current.delete(id);
        }
        for (const u of x.ults) {
          if (playedUltRef.current.has(u.id)) continue;
          playedUltRef.current.add(u.id);
          if (slot != null && u.owner === slot) playUltSfx();
        }
      }
      if (!snapshotRateRef.current.last) snapshotRateRef.current.last = now;
      snapshotRateRef.current.count += 1;
      if (now - snapshotRateRef.current.last >= 1000) {
        snapshotRateRef.current.rate = snapshotRateRef.current.count;
        snapshotRateRef.current.count = 0;
        snapshotRateRef.current.last = now;
      }
      snapRef.current = x;
      if (slot != null && x.players?.[slot]) {
        playerPosRef.current = { x: x.players[slot].x, y: x.players[slot].y };
      }
      if (snapRafRef.current != null) return;
      snapRafRef.current = requestAnimationFrame(() => {
        snapRafRef.current = null;
        if (menuRef.current === "playing" && snapRef.current) {
          const tick = snapRef.current.serverTick;
          if (lastSnapTickRef.current === tick) return;
          lastSnapTickRef.current = tick;
          setSnap(snapRef.current);
        }
      });
    });
    s.on("lobby-state", (state: LobbyState) => {
      setLobbyState(state);
      if (state?.map) setWorldMap(state.map);
    });
    s.on("chat-history", (list: ChatEntry[]) => {
      setChatLog(Array.isArray(list) ? list.slice(-50) : []);
    });
    s.on("chat", (entry: ChatEntry) => {
      setChatLog((prev) => [...prev, entry].slice(-60));
    });

    // lightweight ping
    pingTimerRef.current = window.setInterval(() => {
      const start = performance.now();
      s.timeout(500).emit("ping-check", () => {
        setPing(performance.now() - start);
      });
    }, 1000);
  }, [menu]);

  useEffect(() => {
    return () => {
      if (snapRafRef.current != null) cancelAnimationFrame(snapRafRef.current);
      disconnectSocket();
    };
  }, []);

  useEffect(() => {
    const shouldConnect = menu === "online" || menu === "lobby" || menu === "playing";
    if (shouldConnect) return;
    if (socketRef.current) disconnectSocket();
  }, [menu]);

  // Send input @60
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = socketRef.current;
      if (s && s.connected && slot != null && menu === "playing" && !paused && !shopOpen && !chatFocused) {
        const seq = (inputSeqRef.current += 1);
        s.emit("input", { ...inputFor(slot), seq, clientTime: performance.now() });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slot, menu]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const context = ctx;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    if (menu !== "playing") {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      return () => {
        window.removeEventListener("resize", resize);
      };
    }

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const lerpAngle = (a: number, b: number, t: number) => {
      let d = b - a;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    };
    const interpolateSnap = (a: Snap, b: Snap, t: number): Snap => {
      const enemiesById = new Map(a.enemies.map((e) => [e.id, e]));
      const bulletsById = new Map(a.bullets.map((e) => [e.id, e]));
      const particlesById = new Map(a.particles.map((e) => [e.id, e]));
      return {
        ...b,
        t: lerp(a.t, b.t, t),
        players: b.players.map((p, i) => {
          const ap = a.players[i];
          if (!ap) return p;
          return {
            ...p,
            x: lerp(ap.x, p.x, t),
            y: lerp(ap.y, p.y, t),
            vx: lerp(ap.vx, p.vx, t),
            vy: lerp(ap.vy, p.vy, t),
            facing: lerpAngle(ap.facing, p.facing, t),
          };
        }),
        enemies: b.enemies.map((e) => {
          const ae = enemiesById.get(e.id);
          if (!ae) return e;
          return { ...e, x: lerp(ae.x, e.x, t), y: lerp(ae.y, e.y, t) };
        }),
        bullets: b.bullets.map((blt) => {
          const ab = bulletsById.get(blt.id);
          if (!ab) return blt;
          return { ...blt, x: lerp(ab.x, blt.x, t), y: lerp(ab.y, blt.y, t) };
        }),
        particles: b.particles.map((pt) => {
          const ap = particlesById.get(pt.id);
          if (!ap) return pt;
          return { ...pt, x: lerp(ap.x, pt.x, t), y: lerp(ap.y, pt.y, t) };
        }),
      };
    };
    const getRenderSnap = () => {
      if (!interpOn || !snap) return snap;
      const buf = snapBufferRef.current;
      if (buf.length < 2) return snap;
      const now = performance.now();
      const target = now - INTERP_DELAY_MS;
      let older = buf[0];
      let newer = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].time <= target && buf[i + 1].time >= target) {
          older = buf[i];
          newer = buf[i + 1];
          break;
        }
      }
      const span = Math.max(1, newer.time - older.time);
      const t = clamp((target - older.time) / span, 0, 1);
      if (t >= 1 && target > newer.time) {
        const dt = clamp((target - newer.time) / 1000, 0, 0.05);
        return {
          ...newer.snap,
          players: newer.snap.players.map((p) => ({
            ...p,
            x: p.x + p.vx * dt,
            y: p.y + p.vy * dt,
          })),
        };
      }
      return interpolateSnap(older.snap, newer.snap, t);
    };

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const renderSnap = getRenderSnap();

      let systemColor: number[] | null = null;
      if (renderSnap?.systems?.length && slot != null) {
        const me = renderSnap.players[slot];
        if (me) {
          let best = Infinity;
          for (const sys of renderSnap.systems) {
            const d = Math.hypot(me.x - sys.x, me.y - sys.y);
            if (d < sys.r && d < best) {
              best = d;
              systemColor = sys.color;
            }
          }
        }
      }
      if (systemColor) {
        const grad = ctx.createLinearGradient(0, 0, window.innerWidth, window.innerHeight);
        grad.addColorStop(0, `rgba(${systemColor[0]},${systemColor[1]},${systemColor[2]},0.25)`);
        grad.addColorStop(1, "rgba(8,12,24,0.85)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      }

      // HUD background vibe
      ctx.globalAlpha = 0.18;
      for (let i = 0; i < 80; i++) {
        const t = (renderSnap?.t ?? 0);
        const x = (i * 97 + t * 15) % window.innerWidth;
        const y = (i * 193 + t * 7) % window.innerHeight;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;

      if (!renderSnap) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "600 18px ui-sans-serif, system-ui";
        ctx.fillText("Connecting…", 16, 28);
        raf = requestAnimationFrame(draw);
        return;
      }

      // camera center on player (no zoom)
      const scale = 1;
      const me = slot != null ? renderSnap.players[slot] : null;
      const targetX = me ? clamp(me.x - window.innerWidth / 2, 0, Math.max(0, renderSnap.world.w - window.innerWidth)) : 0;
      const targetY = me ? clamp(me.y - window.innerHeight / 2, 0, Math.max(0, renderSnap.world.h - window.innerHeight)) : 0;
      const cam = camRef.current;
      const smooth = 0.16;
      cam.x += (targetX - cam.x) * smooth;
      cam.y += (targetY - cam.y) * smooth;
      const shake = shakeRef.current;
      shake.t = Math.max(0, shake.t - 1 / 60);
      const sx = shake.t > 0 ? (Math.random() - 0.5) * 6 : 0;
      const sy = shake.t > 0 ? (Math.random() - 0.5) * 6 : 0;
      const ox = -cam.x + sx;
      const oy = -cam.y + sy;

      const W2S = (x: number, y: number) => [ox + x * scale, oy + y * scale] as const;
      const pad = 200;
      const viewLeft = cam.x - pad;
      const viewRight = cam.x + window.innerWidth + pad;
      const viewTop = cam.y - pad;
      const viewBottom = cam.y + window.innerHeight + pad;
      const inWorld = (x: number, y: number) => x > viewLeft && y > viewTop && x < viewRight && y < viewBottom;

      // Stars
      for (const st of renderSnap.stars) {
        if (!inWorld(st.x, st.y)) continue;
        const [x, y] = W2S(st.x, st.y);
        const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((renderSnap.t ?? 0) * 2 + st.pulse));
        const r = st.r * scale * (0.9 + 0.15 * pulse);

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,240,170,0.95)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,240,170,0.12)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Space map nodes (Endless)
      if (renderSnap.world.mode === "Endless" && worldMap) {
        for (const node of worldMap.nodes) {
          if (!inWorld(node.x, node.y)) continue;
          const [x, y] = W2S(node.x, node.y);
          const type = node.type;
          if (type === "station") {
            const pulse = 0.7 + 0.3 * Math.sin((renderSnap.t ?? 0) * 2);
            ctx.fillStyle = "rgba(180,220,255,0.9)";
            ctx.fillRect(x - 6, y - 6, 12, 12);
            ctx.strokeStyle = `rgba(180,220,255,${0.4 + 0.3 * pulse})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 10, y - 10, 20, 20);
          } else if (type === "planet") {
            ctx.fillStyle = "rgba(140,200,140,0.9)";
            ctx.beginPath();
            ctx.arc(x, y, 7, 0, Math.PI * 2);
            ctx.fill();
          } else if (type === "moon") {
            ctx.fillStyle = "rgba(200,200,200,0.9)";
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
          } else if (type === "civ") {
            ctx.strokeStyle = "rgba(220,180,120,0.9)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(x - 6, y - 4, 12, 8);
            ctx.stroke();
          } else if (type === "ruins") {
            ctx.fillStyle = "rgba(200,180,140,0.9)";
            ctx.beginPath();
            ctx.moveTo(x, y - 7);
            ctx.lineTo(x + 6, y);
            ctx.lineTo(x, y + 7);
            ctx.lineTo(x - 6, y);
            ctx.closePath();
            ctx.fill();
          } else if (type === "anomaly") {
            ctx.strokeStyle = "rgba(170,140,255,0.9)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.stroke();
          } else if (type === "nebula") {
            ctx.fillStyle = "rgba(120,140,255,0.25)";
            ctx.beginPath();
            ctx.arc(x, y, 14, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = "rgba(255,240,170,0.9)";
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Minerals
      if (renderSnap.minerals?.length) {
        for (const m of renderSnap.minerals) {
          if (!inWorld(m.x, m.y)) continue;
          const [x, y] = W2S(m.x, m.y);
          ctx.beginPath();
          ctx.arc(x, y, m.r * scale, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(140,220,255,0.85)";
          ctx.fill();
        }
      }

      if (renderSnap.systems?.length) {
        for (const sys of renderSnap.systems) {
          if (!inWorld(sys.x, sys.y)) continue;
          const [x, y] = W2S(sys.x, sys.y);
          ctx.strokeStyle = `rgba(${sys.color[0]},${sys.color[1]},${sys.color[2]},0.25)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, sys.r * scale, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Meteors
      if (renderSnap.meteors?.length) {
        for (const m of renderSnap.meteors) {
          if (!inWorld(m.x, m.y)) continue;
          const [x, y] = W2S(m.x, m.y);
          ctx.fillStyle = "rgba(160,140,120,0.9)";
          ctx.beginPath();
          ctx.arc(x, y, m.r * scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Planets/Moons/Civs
      if (renderSnap.bodies?.length) {
        for (const b of renderSnap.bodies) {
          if (!inWorld(b.x, b.y)) continue;
          const [x, y] = W2S(b.x, b.y);
          ctx.beginPath();
          ctx.arc(x, y, b.r * scale, 0, Math.PI * 2);
          ctx.fillStyle =
            b.type === "planet"
              ? "rgba(120,180,220,0.9)"
              : b.type === "moon"
                ? "rgba(200,200,200,0.9)"
                : "rgba(220,180,120,0.9)";
          ctx.fill();
        }
      }

      // Enemies
      if (renderSnap.enemies?.length) {
        for (const e of renderSnap.enemies) {
          if (!inWorld(e.x, e.y)) continue;
          const [x, y] = W2S(e.x, e.y);
          ctx.beginPath();
          ctx.arc(x, y, e.r * scale, 0, Math.PI * 2);
          const faction = e.faction || "raiders";
          ctx.fillStyle =
            faction === "corsairs"
              ? "rgba(255,160,90,0.9)"
              : faction === "remnant"
                ? "rgba(160,180,255,0.9)"
                : "rgba(255,90,90,0.9)";
          ctx.fill();

          const hpPct = clamp(e.hp / Math.max(1, e.maxHp), 0, 1);
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(x - 12, y - e.r * scale - 10, 24, 4);
          ctx.fillStyle = "rgba(255,110,110,0.9)";
          ctx.fillRect(x - 12, y - e.r * scale - 10, 24 * hpPct, 4);
        }
      }

      // Particles
      if (renderSnap.particles?.length) {
        let drawn = 0;
        for (const p of renderSnap.particles) {
          if (!inWorld(p.x, p.y)) continue;
          const [x, y] = W2S(p.x, p.y);
          const alpha = clamp(p.life / Math.max(0.001, p.maxLife), 0, 1);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(x, y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          drawn += 1;
          if (drawn >= MAX_RENDER_PARTICLES) break;
        }
      }

      if (renderSnap.ults?.length) {
        for (const u of renderSnap.ults) {
          if (!inWorld(u.x, u.y)) continue;
          const [x, y] = W2S(u.x, u.y);
          const alpha = clamp(u.life / Math.max(0.001, u.maxLife), 0, 1);
          const r = u.r * (1 - 0.15 * alpha);
          ctx.save();
          ctx.globalAlpha = 0.5 * alpha;
          ctx.strokeStyle = "rgba(140,220,255,0.9)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Bullets
      if (renderSnap.bullets?.length) {
        let drawn = 0;
        for (const b of renderSnap.bullets) {
          if (!inWorld(b.x, b.y)) continue;
          const [x, y] = W2S(b.x, b.y);
          if (b.type === "plasma") ctx.fillStyle = "rgba(120,200,255,0.9)";
          else if (b.type === "pulse") ctx.fillStyle = "rgba(200,200,255,0.9)";
          else if (b.type === "minigun") ctx.fillStyle = "rgba(255,220,140,0.9)";
          else if (b.type === "rocket") ctx.fillStyle = "rgba(255,190,120,0.9)";
          else ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fillRect(x - (b.r || 2), y - (b.r || 2), (b.r || 2) * 2, (b.r || 2) * 2);
          drawn += 1;
          if (drawn >= MAX_RENDER_BULLETS) break;
        }
      }

      // Players
      for (let i = 0; i < renderSnap.players.length; i++) {
        const p = renderSnap.players[i];
        if (!p.active) continue;
        const stats = renderSnap.stats?.[i];
        if ((stats?.respawnTimer || 0) > 0) continue;
        if (!inWorld(p.x, p.y)) continue;
        const [x, y] = W2S(p.x, p.y);
        const pr = 16 * scale;
        const hp = stats?.health ?? 0;
        const maxHp = stats?.maxHealth ?? 100;
        const hpPct = clamp(hp / Math.max(1, maxHp), 0, 1);
        const shield = stats?.shield ?? 0;
        const maxShield = stats?.maxShield ?? 0;
        const shieldPct = maxShield > 0 ? clamp(shield / Math.max(1, maxShield), 0, 1) : 0;
        const primary = stats?.customization?.primary || ["#78c8ff", "#ff8cc8", "#78ffbe", "#ffd278", "#be8cff", "#ff7878"][i % 6];
        const accent = stats?.customization?.accent || "#ffffff";
        const shape = stats?.customization?.shape || "dart";
        const hat = stats?.customization?.hat || "none";
        const trail = stats?.customization?.trail || "ion";

        if (shieldPct > 0) {
          ctx.save();
          ctx.strokeStyle = hexToRgba(primary, 0.7);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, pr + 6, -Math.PI / 2, -Math.PI / 2 + shieldPct * Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        if (hpPct < 0.35) {
          ctx.save();
          const smoke = 2 + Math.floor((0.35 - hpPct) * 10);
          for (let s = 0; s < smoke; s++) {
            const a = (renderSnap.t ?? 0) * 4 + s + i;
            const rx = x + Math.cos(a) * (pr + 6);
            const ry = y + Math.sin(a * 1.3) * (pr + 4);
            ctx.fillStyle = "rgba(90,90,90,0.5)";
            ctx.beginPath();
            ctx.arc(rx, ry, 3 + (s % 2), 0, Math.PI * 2);
            ctx.fill();
          }
          if (hpPct < 0.18) {
            ctx.fillStyle = "rgba(255,120,70,0.7)";
            ctx.beginPath();
            ctx.arc(x + Math.sin((renderSnap.t ?? 0) * 8 + i) * 6, y - pr - 2, 5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(x, y, pr * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(primary, 0.12);
        ctx.fill();

        ctx.fillStyle = primary;
        if (shape === "orb") {
          ctx.beginPath();
          ctx.arc(x, y, pr, 0, Math.PI * 2);
          ctx.fill();
        } else if (shape === "hex") {
          ctx.beginPath();
          for (let si = 0; si < 6; si++) {
            const a = (Math.PI * 2 * si) / 6 - Math.PI / 6;
            const hx = x + Math.cos(a) * pr;
            const hy = y + Math.sin(a) * pr;
            if (si === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(x + pr, y);
          ctx.lineTo(x - pr, y - pr * 0.7);
          ctx.lineTo(x - pr * 0.6, y);
          ctx.lineTo(x - pr, y + pr * 0.7);
          ctx.closePath();
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x + Math.cos(p.facing) * pr * 0.9, y + Math.sin(p.facing) * pr * 0.9, 5 * scale, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();

        if (hat !== "none") {
          ctx.fillStyle = accent;
          if (hat === "antenna") {
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y - pr);
            ctx.lineTo(x, y - pr - 10);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, y - pr - 12, 2, 0, Math.PI * 2);
            ctx.fill();
          } else if (hat === "cap") {
            ctx.fillRect(x - 6, y - pr - 6, 12, 6);
          } else if (hat === "crown") {
            ctx.beginPath();
            ctx.moveTo(x - 8, y - pr - 2);
            ctx.lineTo(x - 3, y - pr - 10);
            ctx.lineTo(x + 2, y - pr - 2);
            ctx.lineTo(x + 7, y - pr - 10);
            ctx.lineTo(x + 12, y - pr - 2);
            ctx.closePath();
            ctx.fill();
          }
        }

        if (trail !== "none") {
          ctx.strokeStyle = trail === "sparks" ? "rgba(255,200,140,0.8)" : hexToRgba(primary, 0.8);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(p.facing) * pr * 1.2, y - Math.sin(p.facing) * pr * 1.2);
          ctx.lineTo(x - Math.cos(p.facing) * pr * 2.2, y - Math.sin(p.facing) * pr * 2.2);
          ctx.stroke();
        }

        if (p.dashCooldown > 0) {
          const cd = clamp(p.dashCooldown / 0.65, 0, 1);
          ctx.beginPath();
          ctx.arc(x, y, pr + 8 * scale, -Math.PI / 2, -Math.PI / 2 + (1 - cd) * Math.PI * 2);
          ctx.strokeStyle = "rgba(255,255,255,0.35)";
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        // Name + health
        const name = renderSnap.playerNames?.[i] || `P${i + 1}`;
        const max = renderSnap.stats?.[i]?.maxHealth ?? 100;
        const nameHpPct = clamp(hp / Math.max(1, max), 0, 1);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "600 12px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(name, x, y - pr - 18);
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(x - 16, y - pr - 12, 32, 4);
        ctx.fillStyle = "rgba(120,255,170,0.9)";
        ctx.fillRect(x - 16, y - pr - 12, 32 * nameHpPct, 4);
      }

      if (renderSnap.world.mode === "Endless" && worldMap) {
        const mapW = 180;
        const mapH = 120;
        const pad = 10;
        const mapX = window.innerWidth - mapW - pad;
        const mapY = pad + 44;
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "rgba(10,14,24,0.75)";
        ctx.fillRect(mapX, mapY, mapW, mapH);
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.strokeRect(mapX, mapY, mapW, mapH);

        const scaleX = mapW / worldMap.w;
        const scaleY = mapH / worldMap.h;

        for (const node of worldMap.nodes) {
          const nx = mapX + node.x * scaleX;
          const ny = mapY + node.y * scaleY;
          ctx.fillStyle = "rgba(255,240,170,0.7)";
          ctx.fillRect(nx - 1, ny - 1, 2, 2);
        }

        for (let i = 0; i < renderSnap.players.length; i++) {
          const p = renderSnap.players[i];
          if (!p.active) continue;
          const stats = renderSnap.stats?.[i];
          const primary =
            stats?.customization?.primary || ["#78c8ff", "#ff8cc8", "#78ffbe", "#ffd278", "#be8cff", "#ff7878"][i % 6];
          const px = mapX + p.x * scaleX;
          const py = mapY + p.y * scaleY;
          ctx.fillStyle = primary;
          ctx.fillRect(px - 2, py - 2, 4, 4);
        }
        ctx.restore();
      }

      // Scores
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "700 16px ui-sans-serif, system-ui";
      const activePlayers = renderSnap.players
        .map((p, i) => ({ i, active: p.active }))
        .filter((p) => p.active);
      const list = activePlayers.length > 0 ? activePlayers : renderSnap.players.map((_, i) => ({ i, active: true }));
      list.slice(0, 6).forEach((p, idx) => {
        const label =
          renderSnap.world.mode === "Endless"
            ? `P${p.i + 1}: ${renderSnap.stats?.[p.i]?.credits ?? 0} cr`
            : `P${p.i + 1}: ${renderSnap.score[p.i] ?? 0}`;
        ctx.fillText(label, 12, window.innerHeight - 18 - idx * 18);
      });

      if (renderSnap.world.mode === "Endless" && slot != null && renderSnap.stats?.[slot]) {
        const cy = window.innerHeight - 18 - list.slice(0, 6).length * 18 - 8;
        ctx.fillStyle = "rgba(10,14,30,0.85)";
        ctx.fillRect(10, cy - 16, 180, 20);
        ctx.strokeStyle = "rgba(120,200,255,0.35)";
        ctx.strokeRect(10, cy - 16, 180, 20);
        ctx.fillStyle = "rgba(140,220,255,0.95)";
        ctx.font = "700 13px ui-sans-serif, system-ui";
        ctx.fillText(`CREDITS  ${renderSnap.stats[slot].credits}`, 16, cy);
        const inv = renderSnap.stats[slot].inventory;
        if (inv) {
          const cap = renderSnap.stats[slot].inventoryCapacity ?? 0;
          ctx.fillStyle = "rgba(10,14,30,0.85)";
          ctx.fillRect(10, cy + 6, 220, 18);
          ctx.strokeStyle = "rgba(120,200,255,0.25)";
          ctx.strokeRect(10, cy + 6, 220, 18);
          ctx.fillStyle = "rgba(200,230,255,0.85)";
          ctx.font = "600 11px ui-sans-serif, system-ui";
          ctx.fillText(`ORE ${inv.ore}  CRYSTAL ${inv.crystal}  ALLOY ${inv.alloy}  CAP ${cap}`, 16, cy + 18);
        }
      }

      if (slot != null && renderSnap.stats?.[slot]) {
        const curHealth = renderSnap.stats[slot].health;
        const prev = prevHealthRef.current;
        if (prev != null && curHealth < prev) {
          shakeRef.current.t = 0.18;
        }
        prevHealthRef.current = curHealth;

        const weapon = renderSnap.stats[slot].weapon;
        const charges = renderSnap.stats[slot].plasmaCharges;
        const pulseCharge = renderSnap.stats[slot].pulseCharge || 0;
        if (renderSnap.world.mode === "Endless" && weapon) {
          const wy = window.innerHeight - 46 - list.slice(0, 6).length * 18;
          ctx.fillStyle = "rgba(10,14,30,0.85)";
          ctx.fillRect(10, wy - 16, 220, 20);
          ctx.strokeStyle = "rgba(120,200,255,0.35)";
          ctx.strokeRect(10, wy - 16, 220, 20);
          ctx.fillStyle = "rgba(190,240,255,0.95)";
          ctx.font = "700 12px ui-sans-serif, system-ui";
          const displayWeapon = WEAPON_LABELS[weapon] ?? weapon;
          let label = `WEAPON  ${displayWeapon}`;
          if (weapon === "plasma") label += `  CHG ${charges}`;
          if (weapon === "pulse") label += `  CHG ${Math.round(pulseCharge * 100)}%`;
          ctx.fillText(label, 16, wy);
        }
        const hp = renderSnap.stats[slot].health;
        const max = renderSnap.stats[slot].maxHealth;
        const pct = clamp(hp / Math.max(1, max), 0, 1);
        ctx.fillStyle = "rgba(10,14,30,0.9)";
        ctx.fillRect(12, 10, 190, 18);
        ctx.strokeStyle = "rgba(120,200,255,0.35)";
        ctx.strokeRect(12, 10, 190, 18);
        ctx.fillStyle = "rgba(30,40,70,0.9)";
        ctx.fillRect(16, 14, 180, 10);
        ctx.fillStyle = `rgba(${Math.round(255 * (1 - pct))},${Math.round(220 * pct)},120,0.95)`;
        ctx.fillRect(16, 14, 180 * pct, 10);
        ctx.strokeStyle = "rgba(140,200,255,0.5)";
        ctx.strokeRect(16, 14, 180, 10);
        ctx.fillStyle = "rgba(200,230,255,0.85)";
        ctx.font = "700 11px ui-sans-serif, system-ui";
        ctx.fillText("HULL", 22, 23);

        const shield = renderSnap.stats[slot].shield ?? 0;
        const maxShield = renderSnap.stats[slot].maxShield ?? 0;
        if (maxShield > 0) {
          const spct = clamp(shield / Math.max(1, maxShield), 0, 1);
          ctx.fillStyle = "rgba(10,14,30,0.9)";
          ctx.fillRect(12, 30, 190, 8);
          ctx.strokeStyle = "rgba(120,200,255,0.25)";
          ctx.strokeRect(12, 30, 190, 8);
          ctx.fillStyle = "rgba(120,200,255,0.9)";
          ctx.fillRect(16, 32, 180 * spct, 4);
          ctx.fillStyle = "rgba(200,230,255,0.75)";
          ctx.font = "700 9px ui-sans-serif, system-ui";
          ctx.fillText("SHIELD", 22, 37);
        }
      }

      if (renderSnap.world.mode === "Endless" && slot != null && renderSnap.stats?.[slot]) {
        const cd = renderSnap.stats[slot].laserCooldown || 0;
        if (cd > 0.1) {
          ctx.fillStyle = "rgba(140,220,255,0.9)";
          ctx.font = "700 12px ui-sans-serif, system-ui";
          ctx.fillText("ULTIMATE COOLDOWN", 12, 36);
        }
      }

      if (menu === "playing" && !paused && !shopOpen && !dockOpen && renderSnap.world.mode === "Endless") {
        ctx.fillStyle = "rgba(10,14,30,0.8)";
        ctx.fillRect(window.innerWidth - 260, 12, 248, 44);
        ctx.strokeStyle = "rgba(120,200,255,0.35)";
        ctx.strokeRect(window.innerWidth - 260, 12, 248, 44);
        ctx.fillStyle = "rgba(200,230,255,0.85)";
        ctx.font = "700 11px ui-sans-serif, system-ui";
        ctx.fillText("CONTROLS", window.innerWidth - 250, 28);
        ctx.font = "500 11px ui-sans-serif, system-ui";
      if (!isTouch) {
        ctx.fillText("LMB Fire  RMB Ultimate  Shift Dash  F Mine", window.innerWidth - 250, 42);
      }
      }

      if (slot != null && renderSnap.stats?.[slot]) {
        const hp = renderSnap.stats[slot].health;
        const max = renderSnap.stats[slot].maxHealth;
        const hpPct = clamp(hp / Math.max(1, max), 0, 1);
        if (hpPct < 0.35) {
          const alpha = clamp((0.35 - hpPct) / 0.35, 0.1, 0.7);
          ctx.save();
          const grad = ctx.createRadialGradient(
            window.innerWidth / 2,
            window.innerHeight / 2,
            Math.min(window.innerWidth, window.innerHeight) * 0.2,
            window.innerWidth / 2,
            window.innerHeight / 2,
            Math.max(window.innerWidth, window.innerHeight) * 0.7,
          );
          grad.addColorStop(0, "rgba(255,0,0,0)");
          grad.addColorStop(1, `rgba(200,20,20,${alpha})`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
          if (hpPct < 0.2) {
            const pulse = 0.5 + 0.5 * Math.sin((renderSnap.t ?? 0) * 10);
            ctx.fillStyle = `rgba(255,80,80,${0.6 + 0.4 * pulse})`;
            ctx.font = "800 20px ui-sans-serif, system-ui";
            ctx.textAlign = "center";
            ctx.fillText("CRITICAL DAMAGE TAKEN", window.innerWidth / 2, 56);
            ctx.font = "600 12px ui-sans-serif, system-ui";
            ctx.fillText("PLEASE EVADE ENEMY FIRE AND SEEK SPACE STATION", window.innerWidth / 2, 76);
            ctx.textAlign = "left";
          }
          ctx.restore();
        }
      }

      if (slot != null && renderSnap.stats?.[slot]?.respawnTimer) {
        const t = renderSnap.stats[slot].respawnTimer ?? 0;
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.fillStyle = "rgba(255,200,160,0.95)";
        ctx.font = "800 32px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText("SHIP DESTROYED", window.innerWidth / 2, window.innerHeight / 2 - 10);
        ctx.font = "600 14px ui-sans-serif, system-ui";
        ctx.fillText(`RESPAWNING IN ${t.toFixed(1)}s`, window.innerWidth / 2, window.innerHeight / 2 + 18);
        ctx.textAlign = "left";
        ctx.restore();
      }

      // Custom cursor (crosshair)
      if (menu === "playing") {
        const cx = mouseRef.current.x;
        const cy = mouseRef.current.y;
        ctx.save();
        ctx.strokeStyle = "rgba(180,220,255,0.9)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 10, cy);
        ctx.lineTo(cx - 3, cy);
        ctx.moveTo(cx + 3, cy);
        ctx.lineTo(cx + 10, cy);
        ctx.moveTo(cx, cy - 10);
        ctx.lineTo(cx, cy - 3);
        ctx.moveTo(cx, cy + 3);
        ctx.lineTo(cx, cy + 10);
        ctx.stroke();

        if (renderSnap.stats?.[slot ?? 0]) {
          const s = renderSnap.stats[slot ?? 0];
          const weapon = s.weapon || "cannon";
          const cd = s.weaponCooldown || 0;
          const baseCd = WEAPON_BASE_COOLDOWN[weapon] || 0.6;
          if (cd > 0) {
            const pct = clamp(1 - cd / baseCd, 0, 1);
            ctx.strokeStyle = "rgba(120,220,255,0.7)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 12, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
            ctx.stroke();
          }
          if (weapon === "plasma") {
            ctx.fillStyle = "rgba(120,200,255,0.9)";
            ctx.font = "700 10px ui-sans-serif, system-ui";
            ctx.textAlign = "center";
            ctx.fillText(`${s.plasmaCharges ?? 0}`, cx, cy + 22);
          } else if (weapon === "pulse") {
            ctx.fillStyle = "rgba(200,200,255,0.9)";
            ctx.font = "700 10px ui-sans-serif, system-ui";
            ctx.textAlign = "center";
            ctx.fillText(`${Math.round((s.pulseCharge || 0) * 100)}%`, cx, cy + 22);
          } else if (weapon === "minigun" && (s.gunOverheat || 0) > 0) {
            const pct = clamp((s.gunOverheat || 0) / 1.4, 0, 1);
            ctx.strokeStyle = "rgba(255,120,90,0.8)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 14, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
            ctx.stroke();
          }
          const ultLevel = s.upgrades?.laser || 0;
          if (ultLevel > 0 && (s.laserCooldown || 0) > 0) {
            const maxUlt = Math.max(8, 20 - ultLevel * 2);
            const pct = clamp(1 - (s.laserCooldown || 0) / maxUlt, 0, 1);
            ctx.strokeStyle = "rgba(140,220,255,0.7)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 18, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
            ctx.stroke();
          }
          ctx.textAlign = "left";
        }
        ctx.restore();
      }

      const now = performance.now();
      if (!fpsRef.current.last) fpsRef.current.last = now;
      fpsRef.current.frames += 1;
      if (now - fpsRef.current.last >= 1000) {
        fpsRef.current.fps = fpsRef.current.frames;
        fpsRef.current.frames = 0;
        fpsRef.current.last = now;
      }

      if (debugOn) {
        const activeCount = renderSnap.players.filter((p) => p.active).length;
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(10, 10, 220, 110);
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.strokeRect(10, 10, 220, 110);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "600 12px ui-sans-serif, system-ui";
        ctx.fillText(`FPS: ${fpsRef.current.fps}`, 18, 28);
        ctx.fillText(`Server tick: ${renderSnap.serverTick}`, 18, 44);
        ctx.fillText(`Snapshots: ${snapshotRateRef.current.rate}/s`, 18, 60);
        ctx.fillText(`Lobby: ${renderSnap.lobbyId}`, 18, 76);
        ctx.fillText(
          `Ent: P${activeCount} E${renderSnap.enemies.length} B${renderSnap.bullets.length} FX${renderSnap.particles.length}`,
          18,
          92,
        );
        ctx.restore();
      }

      if (renderSnap.winner != null) {
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "800 44px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(`PLAYER ${renderSnap.winner + 1} WINS!`, window.innerWidth / 2, window.innerHeight / 2 - 10);
        ctx.font = "500 16px ui-sans-serif, system-ui";
        ctx.fillText(`Press R to restart`, window.innerWidth / 2, window.innerHeight / 2 + 26);
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "r" || e.key === "R") && snap?.winner != null) {
        socketRef.current?.emit("restart");
      }
      if ((e.key === "e" || e.key === "E") && snap?.world.mode === "Endless") {
        if (nearStation) {
          setDockOpen(true);
        } else {
          setShopOpen((v) => !v);
        }
      }
      if (e.key === "Escape" || e.key === "p" || e.key === "P") {
        setPaused((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [snap, menu, worldMap, interpOn, debugOn]);

  const showMenu = menu !== "playing";

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#0b1020", overflow: "hidden", cursor: menu === "playing" ? "none" : "auto" }}>
      <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh", display: "block" }} />
      {menu === "playing" && isTouch && (
        <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 30 }}>
          <div
            style={{
              position: "absolute",
              left: 24,
              bottom: 24,
              width: 120,
              height: 120,
              borderRadius: 999,
              background: "rgba(12,16,28,0.5)",
              border: "1px solid rgba(120,200,255,0.35)",
              touchAction: "none",
              pointerEvents: "auto",
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const baseX = rect.left + rect.width / 2;
              const baseY = rect.top + rect.height / 2;
              const dx = e.clientX - baseX;
              const dy = e.clientY - baseY;
              const dist = Math.hypot(dx, dy) || 1;
              const r = Math.min(40, dist);
              const nx = (dx / dist) * r;
              const ny = (dy / dist) * r;
              setStick({ x: nx, y: ny, active: true, id: e.pointerId, baseX, baseY });
              mobileRef.current.active = true;
              mobileRef.current.ax = nx / 40;
              mobileRef.current.ay = ny / 40;
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!stick.active || stick.id !== e.pointerId) return;
              const dx = e.clientX - stick.baseX;
              const dy = e.clientY - stick.baseY;
              const dist = Math.hypot(dx, dy) || 1;
              const r = Math.min(40, dist);
              const nx = (dx / dist) * r;
              const ny = (dy / dist) * r;
              setStick((prev) => ({ ...prev, x: nx, y: ny }));
              mobileRef.current.ax = nx / 40;
              mobileRef.current.ay = ny / 40;
            }}
            onPointerUp={(e) => {
              if (stick.id !== e.pointerId) return;
              setStick({ x: 0, y: 0, active: false, id: -1, baseX: 0, baseY: 0 });
              mobileRef.current.active = false;
              mobileRef.current.ax = 0;
              mobileRef.current.ay = 0;
            }}
            onPointerCancel={() => {
              setStick({ x: 0, y: 0, active: false, id: -1, baseX: 0, baseY: 0 });
              mobileRef.current.active = false;
              mobileRef.current.ax = 0;
              mobileRef.current.ay = 0;
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 56,
                height: 56,
                borderRadius: 999,
                transform: `translate(${stick.x - 28}px, ${stick.y - 28}px)`,
                background: "rgba(120,200,255,0.35)",
                border: "1px solid rgba(120,200,255,0.6)",
              }}
            />
          </div>

          <div
            onPointerDown={() => {
              mobileRef.current.fire = true;
            }}
            onPointerUp={() => {
              mobileRef.current.fire = false;
            }}
            onPointerLeave={() => {
              mobileRef.current.fire = false;
            }}
            onPointerCancel={() => {
              mobileRef.current.fire = false;
            }}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: "45vw",
              pointerEvents: "auto",
              touchAction: "none",
            }}
          />

          <div style={{ position: "absolute", right: 24, bottom: 24, display: "grid", gap: 10, zIndex: 1 }}>
            <div style={{ fontSize: 11, opacity: 0.7, textAlign: "right", color: "#eaf0ff" }}>Hold right side to fire</div>
            <button
              onClick={() => {
                if (!canSwitchWeapon) return;
                socketRef.current?.emit("cycle-weapon", 1);
              }}
              style={{
                width: 96,
                height: 44,
                borderRadius: 12,
                border: "1px solid rgba(120,200,255,0.5)",
                background: canSwitchWeapon ? "rgba(12,16,28,0.7)" : "rgba(12,16,28,0.4)",
                color: "#eaf0ff",
                fontWeight: 700,
                pointerEvents: "auto",
                touchAction: "none",
                opacity: canSwitchWeapon ? 1 : 0.6,
              }}
            >
              SWITCH
            </button>
            {[
              { label: "ULT", key: "ult" },
              { label: "DASH", key: "dash" },
              { label: "MINE", key: "mine" },
            ].map((b) => (
              <button
                key={b.key}
                onPointerDown={() => {
                  mobileRef.current[b.key as "ult" | "dash" | "mine"] = true;
                }}
                onPointerUp={() => {
                  mobileRef.current[b.key as "ult" | "dash" | "mine"] = false;
                }}
                onPointerLeave={() => {
                  mobileRef.current[b.key as "ult" | "dash" | "mine"] = false;
                }}
                onPointerCancel={() => {
                  mobileRef.current[b.key as "ult" | "dash" | "mine"] = false;
                }}
                style={{
                  width: 96,
                  height: 44,
                  borderRadius: 12,
                  border: "1px solid rgba(120,200,255,0.5)",
                  background: "rgba(12,16,28,0.7)",
                  color: "#eaf0ff",
                  fontWeight: 700,
                  pointerEvents: "auto",
                  touchAction: "none",
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {(menu === "lobby" || menu === "playing") && (
        <div style={{ position: "fixed", right: 12, bottom: 12, zIndex: 20, pointerEvents: "none" }}>
          <button
            onClick={() => setChatOpen((v) => !v)}
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(8,12,22,0.35)",
              color: "#eaf0ff",
              pointerEvents: "auto",
              cursor: "pointer",
            }}
          >
            <i className="fa-solid fa-comment" />
          </button>
          {chatOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                bottom: 56,
                width: 280,
                background: "rgba(8,12,22,0.15)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                padding: "8px 10px",
                color: "#eaf0ff",
                fontFamily: "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial",
                pointerEvents: "none",
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 6 }}>Chat</div>
              <div
                ref={chatScrollRef}
                style={{ maxHeight: 140, overflow: "auto", display: "grid", gap: 4, fontSize: 12, pointerEvents: "auto" }}
              >
                {chatLog.length === 0 ? <div style={{ opacity: 0.6 }}>No messages yet.</div> : null}
                {chatLog.map((m) => (
                  <div key={m.id} style={{ display: "flex", gap: 6 }}>
                    <span style={{ color: "#9fd2ff" }}>{m.name}:</span>
                    <span>{m.text}</span>
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = chatInput.trim();
                  if (!text) return;
                  socketRef.current?.emit("chat", text);
                  setChatInput("");
                }}
                style={{ display: "flex", gap: 6, marginTop: 6, pointerEvents: "auto" }}
              >
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onFocus={() => setChatFocused(true)}
                  onBlur={() => setChatFocused(false)}
                  placeholder="Type message..."
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(0,0,0,0.3)",
                    color: "#eaf0ff",
                    fontSize: 12,
                    pointerEvents: "auto",
                  }}
                />
                <button type="submit" style={{ padding: "6px 10px", borderRadius: 8, pointerEvents: "auto" }}>
                  Send
                </button>
              </form>
            </div>
          )}
        </div>
      )}
      {menu === "playing" && snap?.world.mode === "Endless" && nearStation && (
        <div
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            background: "rgba(12,16,28,0.85)",
            color: "#eaf0ff",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "8px 10px",
            fontFamily: "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial",
            fontSize: 12,
            zIndex: 12,
          }}
        >
          Dock at {nearStation.name} (Press E)
        </div>
      )}
      {menu === "playing" && paused && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(5,8,16,0.65)",
            color: "#eaf0ff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 20,
            fontFamily: "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial",
          }}
        >
          <div
            style={{
              width: "min(360px, 86vw)",
              background: "rgba(15,20,35,0.95)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 14,
              padding: "16px 18px",
              display: "grid",
              gap: 10,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700 }}>Paused</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Press Esc or P to resume</div>
            <button onClick={() => setPaused(false)} style={{ padding: "8px 12px", borderRadius: 10 }}>
              Resume
            </button>
            <button
              onClick={() => {
                socketRef.current?.emit("leave-lobby");
                setLobbyState(null);
                setSlot(null);
                setPaused(false);
                setMenu("online");
              }}
              style={{ padding: "8px 12px", borderRadius: 10 }}
            >
              Leave Match
            </button>
          </div>
        </div>
      )}
      {menu === "playing" && shopOpen && snap?.world.mode === "Endless" && shopEnabled && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            width: 280,
            background: "rgba(12,16,28,0.95)",
            color: "#eaf0ff",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: "12px 14px",
            zIndex: 15,
            fontFamily: "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Shop</div>
            <button onClick={() => setShopOpen(false)} style={{ padding: "4px 8px", borderRadius: 8 }}>
              Close
            </button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>
            Credits: {snap.stats?.[slot ?? 0]?.credits ?? 0}
          </div>
          {(["laser", "speed", "dash", "cannon", "health", "magnet", "shield", "storage"] as const).map((id) => {
            const level = snap.stats?.[slot ?? 0]?.upgrades?.[id] ?? 0;
            const base =
              id === "laser"
                ? 60
                : id === "speed"
                  ? 45
                  : id === "dash"
                    ? 50
                    : id === "cannon"
                      ? 70
                      : id === "health"
                        ? 65
                        : id === "magnet"
                          ? 55
                          : id === "storage"
                            ? 75
                            : 60;
            const cost = Math.round(base * (1 + level * 0.6) * shopPriceMult);
            return (
              <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, textTransform: "capitalize" }}>{id === "laser" ? "Ultimate" : id}</div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>Level {level}</div>
                  <div style={{ fontSize: 10, opacity: 0.65 }}>{upgradeDescription(id, level)}</div>
                </div>
                <button
                  onClick={() => {
                    socketRef.current?.emit("buy-upgrade", { id }, (res: { ok: boolean; reason?: string }) => {
                      if (!res?.ok) setLobbyError(res?.reason === "insufficient" ? "Not enough credits." : "Purchase failed.");
                    });
                  }}
                  style={{ padding: "6px 10px", borderRadius: 8 }}
                >
                  {cost}
                </button>
              </div>
            );
          })}
          {snap?.stats?.[slot ?? 0]?.ownedWeapons?.length ? (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>Weapon Mods</div>
              {snap.stats[slot ?? 0].ownedWeapons.filter((w) => w !== "cannon").map((w) => {
                const wid = w as WeaponUpgradeId;
                const level = snap.stats?.[slot ?? 0]?.weaponUpgrades?.[wid] ?? 0;
                const base = WEAPON_UPGRADE_COSTS[wid] ?? 100;
                const cost = Math.round(base * (1 + level * 0.6) * shopPriceMult);
                return (
                  <div key={`mod-${w}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className={`icon icon-${w}`} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{WEAPON_LABELS[w] ?? w} Mod</div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>Level {level}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        socketRef.current?.emit("buy-upgrade", { id: `w:${w}` }, (res: { ok: boolean; reason?: string }) => {
                          if (!res?.ok) setLobbyError(res?.reason === "insufficient" ? "Not enough credits." : "Upgrade failed.");
                        });
                      }}
                      style={{ padding: "6px 10px", borderRadius: 8 }}
                    >
                      {cost}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Press E to toggle shop</div>
        </div>
      )}
      {menu === "playing" && dockOpen && nearStation && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            width: 280,
            background: "rgba(12,16,28,0.95)",
            color: "#eaf0ff",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 14,
            padding: "12px 14px",
            zIndex: 16,
            fontFamily: "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>{nearStation.name}</div>
            <button onClick={() => setDockOpen(false)} style={{ padding: "4px 8px", borderRadius: 8 }}>
              Close
            </button>
          </div>
          {dockError && <div style={{ color: "#ffb2b2", fontSize: 12, marginBottom: 6 }}>{dockError}</div>}
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>Repair ship for 15 credits</div>
          <button
            onClick={() => {
              socketRef.current?.emit("dock-station", { id: nearStation.id }, (res: { ok: boolean; reason?: string }) => {
                if (!res?.ok) setDockError(res?.reason === "insufficient" ? "Not enough credits." : "Dock failed.");
              });
            }}
            style={{ padding: "8px 10px", borderRadius: 8, width: "fit-content" }}
          >
            Repair
          </button>
          {inventory ? (
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>Sell materials</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                Inventory: {inventoryTotal}/{inventoryCap}
              </div>
              {(["ore", "crystal", "alloy"] as const).map((key) => {
                const qty = inventory?.[key] ?? 0;
                const value = MATERIAL_SELL_VALUES[key] ?? 0;
                return (
                  <div key={`sell-${key}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                    <span>
                      {key} ({qty}) - {value} cr
                    </span>
                    <button
                      disabled={qty <= 0}
                      onClick={() => {
                        socketRef.current?.emit(
                          "sell-materials",
                          { stationId: nearStation.id, item: key },
                          (res: { ok: boolean; reason?: string }) => {
                            if (!res?.ok) {
                              const msg = res?.reason === "too-far" ? "Move closer to the station." : "Nothing to sell.";
                              setDockError(msg);
                              return;
                            }
                            setDockError("");
                          },
                        );
                      }}
                      style={{ padding: "6px 10px", borderRadius: 8 }}
                    >
                      Sell
                    </button>
                  </div>
                );
              })}
              <button
                disabled={inventoryTotal <= 0}
                onClick={() => {
                  socketRef.current?.emit(
                    "sell-materials",
                    { stationId: nearStation.id, item: "all" },
                    (res: { ok: boolean; reason?: string }) => {
                      if (!res?.ok) {
                        const msg = res?.reason === "too-far" ? "Move closer to the station." : "Nothing to sell.";
                        setDockError(msg);
                        return;
                      }
                      setDockError("");
                    },
                  );
                }}
                style={{ padding: "6px 10px", borderRadius: 8, width: "fit-content" }}
              >
                Sell all
              </button>
            </div>
          ) : null}
          {nearStation.shop?.length ? (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>Weapon vendor</div>
              {nearStation.shop.map((w) => {
                const owned = snap?.stats?.[slot ?? 0]?.ownedWeapons?.includes(w);
                const cost = WEAPON_COSTS[w] ?? 0;
                return (
                  <div key={w} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className={`icon icon-${w}`} />
                      {WEAPON_LABELS[w] ?? w}
                    </span>
                    <button
                      disabled={owned}
                      onClick={() => {
                        socketRef.current?.emit(
                          "buy-weapon",
                          { stationId: nearStation.id, weapon: w },
                          (res: { ok: boolean; reason?: string }) => {
                            if (!res?.ok) {
                              const msg =
                                res?.reason === "insufficient"
                                  ? "Not enough credits."
                                  : res?.reason === "owned"
                                    ? "Already owned."
                                    : res?.reason === "too-far"
                                      ? "Move closer to the station."
                                    : "Purchase failed.";
                              setDockError(msg);
                              return;
                            }
                            setDockError("");
                          },
                        );
                      }}
                      style={{ padding: "6px 10px", borderRadius: 8 }}
                    >
                      {owned ? "Owned" : cost}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Shop with E when undocked</div>
        </div>
      )}
      {showMenu && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8,12,22,0.82)",
            color: "#eaf0ff",
            fontFamily: "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 10,
          }}
        >
          <div className="menu-bg" aria-hidden="true">
            <div className="stars" />
            <div className="stars stars2" />
            <div className="ship ship1" />
            <div className="ship ship2" />
            <div className="target target1" />
            <div className="target target2" />
          </div>
          <div
            style={{
              width: "min(720px, 92vw)",
              background: "rgba(15,20,35,0.9)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 18,
              padding: "22px 24px",
              maxHeight: "86vh",
              overflow: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Star Rush</div>
            {menu === "main" && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button onClick={() => setMenu("play")} style={{ padding: "10px 16px", borderRadius: 10 }}>Play</button>
                <button onClick={() => setMenu("online")} style={{ padding: "10px 16px", borderRadius: 10 }}>Customize Ship</button>
                <button onClick={() => setMenu("settings")} style={{ padding: "10px 16px", borderRadius: 10 }}>Settings</button>
                <button onClick={() => setMenu("about")} style={{ padding: "10px 16px", borderRadius: 10 }}>About</button>
              </div>
            )}
            {menu === "play" && (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ fontWeight: 600 }}>Choose a mode</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setMenu("online")} style={{ padding: "10px 16px", borderRadius: 10 }}>Online</button>
                  <button onClick={() => { setMode("Local"); setMenu("offline"); }} style={{ padding: "10px 16px", borderRadius: 10 }}>Offline</button>
                </div>
                <button onClick={() => setMenu("main")} style={{ padding: "8px 12px", borderRadius: 8, width: "fit-content" }}>Back</button>
              </div>
            )}
            {menu === "settings" && (
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={interpOn} onChange={(e) => setInterpOn(e.target.checked)} />
                  Snapshot interpolation
                </label>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Toggle debug overlay with F3.</div>
                <button onClick={() => setMenu("main")} style={{ padding: "8px 12px", borderRadius: 8, width: "fit-content" }}>Back</button>
              </div>
            )}
            {menu === "about" && (
              <div style={{ display: "grid", gap: 10 }}>
                <div>Fast, competitive star collecting. Built with Next.js + Socket.IO.</div>
                <button onClick={() => setMenu("main")} style={{ padding: "8px 12px", borderRadius: 8, width: "fit-content" }}>Back</button>
              </div>
            )}
            {menu === "offline" && (
              <div style={{ display: "grid", gap: 10 }}>
                <div>Offline mode uses local input only.</div>
                <button onClick={() => setMenu("main")} style={{ padding: "8px 12px", borderRadius: 8, width: "fit-content" }}>Back</button>
              </div>
            )}
            {menu === "online" && (
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>Ship customization</div>
                  <canvas ref={previewRef} width={160} height={90} style={{ width: 160, height: 90, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)" }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    Primary
                    <input type="color" value={shipPrimary} onChange={(e) => setShipPrimary(e.target.value)} />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    Accent
                    <input type="color" value={shipAccent} onChange={(e) => setShipAccent(e.target.value)} />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    Shape
                    <select value={shipShape} onChange={(e) => setShipShape(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8 }}>
                      {["dart", "orb", "hex"].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    Hat
                    <select value={shipHat} onChange={(e) => setShipHat(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8 }}>
                      {["none", "antenna", "cap", "crown"].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    Trail
                    <select value={shipTrail} onChange={(e) => setShipTrail(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8 }}>
                      {["ion", "sparks", "none"].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!registeredName && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>Create username</div>
                    <form
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitUsername();
                      }}
                      style={{ display: "grid", gap: 8 }}
                    >
                      <input
                        type="text"
                        value={usernameDraft}
                        onChange={(e) => setUsernameDraft(e.target.value)}
                        placeholder="Enter a username"
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                      />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="submit" style={{ padding: "10px 16px", borderRadius: 10 }}>
                          Continue
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nextName = makeRandomName();
                            setUsernameDraft(nextName);
                            setUsernameError("");
                          }}
                          style={{ padding: "10px 16px", borderRadius: 10 }}
                        >
                          Random name
                        </button>
                      </div>
                    </form>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {usernameDraft.length}/{USERNAME_MAX}
                  </div>
                  {isRegistering && !usernameError && (
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      {socketReady ? "Registering username..." : "Waiting for connection..."}
                    </div>
                  )}
                  {usernameError && (
                    <div style={{ color: "#ffb2b2", fontSize: 12 }}>{usernameError}</div>
                  )}
                </div>
              )}
                {registeredName && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontWeight: 600 }}>Server browser</div>
                      <button onClick={requestLobbies} style={{ padding: "6px 10px", borderRadius: 8 }}>
                        Refresh
                      </button>
                    </div>
                    {lobbyError && <div style={{ color: "#ffb2b2", fontSize: 12 }}>{lobbyError}</div>}
                    {lobbies.length === 0 ? (
                      <div style={{ opacity: 0.8, fontSize: 12 }}>No public lobbies yet.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 6 }}>
                        {lobbies.map((lobby) => (
                          <div
                            key={lobby.code}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "8px 10px",
                              borderRadius: 10,
                              background: "rgba(255,255,255,0.06)",
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 600 }}>{lobby.name}</div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                {lobby.mode} • {lobby.count}/{lobby.maxPlayers} • {lobby.code}
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                const s = socketRef.current;
                                if (!s) return;
                                s.emit("join-lobby", { code: lobby.code }, (res: { ok: boolean; reason?: string }) => {
                                  if (!res?.ok) {
                                    setLobbyError("Failed to join lobby.");
                                    return;
                                  }
                                  setLobbyError("");
                                  setMenu("lobby");
                                });
                              }}
                              style={{ padding: "6px 10px", borderRadius: 8 }}
                            >
                              Join
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      <div style={{ fontWeight: 600 }}>Join via code</div>
                      <input
                        value={serverCode}
                        onChange={(e) => setServerCode(e.target.value)}
                        placeholder="Enter lobby code"
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                      />
                      <input
                        value={serverPassword}
                        onChange={(e) => setServerPassword(e.target.value)}
                        placeholder="Password (if required)"
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                      />
                      <button
                        onClick={() => {
                          const s = socketRef.current;
                          if (!s) return;
                          s.emit("join-lobby", { code: serverCode, password: serverPassword }, (res: { ok: boolean; reason?: string }) => {
                            if (!res?.ok) {
                              setLobbyError(res?.reason === "bad-password" ? "Incorrect password." : "Failed to join lobby.");
                              return;
                            }
                            setLobbyError("");
                            setMenu("lobby");
                          });
                        }}
                        style={{ padding: "10px 16px", borderRadius: 10, width: "fit-content" }}
                      >
                        Join
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      <div style={{ fontWeight: 600 }}>Create lobby</div>
                      <input
                        value={lobbyName}
                        onChange={(e) => setLobbyName(e.target.value)}
                        placeholder="Lobby name"
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                      />
                      <select
                        value={lobbyMode}
                        onChange={(e) => setLobbyMode(e.target.value)}
                        style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                      >
                        {MODES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      {lobbyMode === "Endless" && (
                        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                          <div style={{ fontWeight: 600 }}>Endless gamerules</div>
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            Starting stars
                            <select
                              value={endlessStars}
                              onChange={(e) => setEndlessStars(Number(e.target.value))}
                              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                            >
                              {[4, 6, 8, 10, 12, 14].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            Star burst
                            <select
                              value={endlessBurst}
                              onChange={(e) => setEndlessBurst(Number(e.target.value))}
                              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                            >
                              {[1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            World size
                            <select
                              value={endlessWorldSize}
                              onChange={(e) => setEndlessWorldSize(e.target.value)}
                              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                            >
                              {["Small", "Medium", "Large"].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            Enemy density
                            <select
                              value={endlessEnemyDensity}
                              onChange={(e) => setEndlessEnemyDensity(e.target.value)}
                              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                            >
                              {["Low", "Normal", "High"].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            Shop enabled
                            <input
                              type="checkbox"
                              checked={endlessShopEnabled}
                              onChange={(e) => setEndlessShopEnabled(e.target.checked)}
                            />
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            Shop price multiplier
                            <select
                              value={endlessShopPrice}
                              onChange={(e) => setEndlessShopPrice(Number(e.target.value))}
                              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                            >
                              {[0.8, 1, 1.2, 1.5].map((n) => (
                                <option key={n} value={n}>
                                  {n}x
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            Shop reroll cost
                            <select
                              value={endlessShopReroll}
                              onChange={(e) => setEndlessShopReroll(Number(e.target.value))}
                              style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                            >
                              {[1, 2, 3, 4, 5].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <input type="checkbox" checked={lobbyPublic} onChange={(e) => setLobbyPublic(e.target.checked)} />
                        Public lobby
                      </label>
                      {!lobbyPublic && (
                        <input
                          value={lobbyPassword}
                          onChange={(e) => setLobbyPassword(e.target.value)}
                          placeholder="Lobby password"
                          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.3)", color: "#eaf0ff" }}
                        />
                      )}
                      <button
                        onClick={() => {
                          const s = socketRef.current;
                          if (!s) return;
                          s.emit(
                            "create-lobby",
                            {
                              name: lobbyName,
                              public: lobbyPublic,
                              password: lobbyPassword,
                              mode: lobbyMode,
                              rules:
                                lobbyMode === "Endless"
                                  ? {
                                      startingStars: endlessStars,
                                      starBurst: endlessBurst,
                                      worldSize: endlessWorldSize,
                                      enemyDensity: endlessEnemyDensity,
                                      shopEnabled: endlessShopEnabled,
                                      shopPriceMult: endlessShopPrice,
                                      shopRerollCost: endlessShopReroll,
                                    }
                                  : undefined,
                            },
                            (res: { ok: boolean; reason?: string }) => {
                              if (!res?.ok) {
                                if (res?.reason === "invalid-name") setLobbyError("Lobby name must be 3-32 characters.");
                                else if (res?.reason === "invalid-password") setLobbyError("Password must be at least 4 characters.");
                                else setLobbyError("Failed to create lobby.");
                                return;
                              }
                              setLobbyError("");
                              setMenu("lobby");
                            },
                          );
                        }}
                        style={{ padding: "10px 16px", borderRadius: 10, width: "fit-content" }}
                      >
                        Create
                      </button>
                    </div>
                  </>
                )}
                <button onClick={() => setMenu("play")} style={{ padding: "8px 12px", borderRadius: 8, width: "fit-content" }}>Back</button>
              </div>
            )}
            {menu === "lobby" && (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>Lobby</div>
                {lobbyState ? (
                  <>
                    <div style={{ display: "grid", gap: 6, fontSize: 13, opacity: 0.9 }}>
                      <div>
                        <b>Name</b>: {lobbyState.name}
                      </div>
                      <div>
                        <b>Code</b>: {lobbyState.code}
                      </div>
                      <div>
                        <b>Mode</b>: {lobbyState.mode}
                      </div>
                      <div>
                        <b>Players</b>: {lobbyState.count}/{lobbyState.maxPlayers}
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 600 }}>Players</div>
                      {lobbyState.players.length === 0 ? (
                        <div style={{ opacity: 0.7, fontSize: 12 }}>Waiting for players...</div>
                      ) : (
                        <div style={{ display: "grid", gap: 4 }}>
                          {lobbyState.players.map((p) => (
                            <div
                              key={`${p.slot}-${p.name}`}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "6px 8px",
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.06)",
                                fontSize: 13,
                              }}
                            >
                              <span>P{p.slot + 1}</span>
                              <span>{p.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {lobbyState.mode === "Endless" && lobbyState.rules && (
                      <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                        <div style={{ fontWeight: 600 }}>Gamerules</div>
                        <div>Starting stars: {lobbyState.rules.startingStars}</div>
                        <div>Star burst: {lobbyState.rules.starBurst}</div>
                        <div>World size: {lobbyState.rules.worldSize}</div>
                        <div>Enemy density: {lobbyState.rules.enemyDensity}</div>
                        <div>Shop enabled: {lobbyState.rules.shopEnabled ? "Yes" : "No"}</div>
                        <div>Shop price mult: {lobbyState.rules.shopPriceMult}x</div>
                        <div>Shop reroll cost: {lobbyState.rules.shopRerollCost}</div>
                      </div>
                    )}
                    {lobbyState.mode === "Endless" && worldMap && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>Sector map</div>
                        <div
                          style={{
                            position: "relative",
                            width: "100%",
                            maxWidth: 520,
                            height: 200,
                            background: "rgba(10,14,24,0.75)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 12,
                            overflow: "hidden",
                          }}
                        >
                          {worldMap.nodes.map((node, idx) => {
                            const x = (node.x / worldMap.w) * 100;
                            const y = (node.y / worldMap.h) * 100;
                            return (
                              <div
                                key={`${node.id}-${idx}`}
                                title={`${node.name} (${node.type})`}
                                style={{
                                  position: "absolute",
                                  left: `${x}%`,
                                  top: `${y}%`,
                                  width: 6,
                                  height: 6,
                                  transform: "translate(-50%, -50%)",
                                  borderRadius: 999,
                                  background: "rgba(255,240,170,0.85)",
                                  boxShadow: "0 0 6px rgba(255,230,150,0.6)",
                                }}
                              />
                            );
                          })}
                        </div>
                        <div style={{ display: "grid", gap: 4, maxHeight: 160, overflow: "auto", fontSize: 12 }}>
                          {worldMap.nodes.map((node, idx) => (
                            <div
                              key={`list-${node.id}-${idx}`}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "6px 8px",
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.06)",
                              }}
                            >
                              <span>{node.name}</span>
                              <span style={{ opacity: 0.7 }}>{node.type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => setMenu("playing")} style={{ padding: "10px 16px", borderRadius: 10 }}>
                        Enter Match
                      </button>
                      <button
                        onClick={() => {
                          socketRef.current?.emit("leave-lobby");
                          setLobbyState(null);
                          setSlot(null);
                          setMenu("online");
                        }}
                        style={{ padding: "10px 16px", borderRadius: 10 }}
                      >
                        Leave Lobby
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ opacity: 0.7, fontSize: 12 }}>Loading lobby...</div>
                )}
              </div>
            )}
          </div>
          <style jsx>{`
            .menu-bg {
              position: absolute;
              inset: 0;
              overflow: hidden;
              pointer-events: none;
            }
            .icon {
              width: 16px;
              height: 16px;
              border-radius: 4px;
              background: rgba(255,255,255,0.15);
              background-image: url("/sprites/ui.png");
              background-size: 128px 16px;
              display: inline-block;
            }
            .icon-minigun { background-position: 0 0; }
            .icon-plasma { background-position: -16px 0; }
            .icon-pulse { background-position: -32px 0; }
            .icon-homing { background-position: -48px 0; }
            .stars,
            .stars2 {
              position: absolute;
              inset: -20%;
              background-image:
                radial-gradient(2px 2px at 20% 30%, rgba(255,255,255,0.6), transparent 40%),
                radial-gradient(1px 1px at 70% 20%, rgba(255,255,255,0.5), transparent 45%),
                radial-gradient(2px 2px at 80% 70%, rgba(255,255,255,0.5), transparent 45%),
                radial-gradient(1px 1px at 35% 80%, rgba(255,255,255,0.4), transparent 45%),
                radial-gradient(2px 2px at 55% 55%, rgba(255,220,150,0.6), transparent 45%);
              animation: drift 18s linear infinite;
              opacity: 0.8;
            }
            .stars2 {
              animation-duration: 26s;
              opacity: 0.5;
              filter: blur(0.5px);
            }
            .ship {
              position: absolute;
              width: 18px;
              height: 18px;
              border-radius: 50% 50% 30% 30%;
              background: radial-gradient(circle at 30% 30%, #fff, #88c6ff 45%, #2a5cff 70%);
              box-shadow: 0 0 18px rgba(110,170,255,0.6);
            }
            .ship::after {
              content: "";
              position: absolute;
              top: 6px;
              left: -16px;
              width: 18px;
              height: 6px;
              background: linear-gradient(90deg, rgba(60,140,255,0.0), rgba(120,190,255,0.7), rgba(120,190,255,0.0));
              filter: blur(0.4px);
            }
            .ship1 {
              animation: run1 6s ease-in-out infinite;
            }
            .ship2 {
              animation: run2 7.5s ease-in-out infinite;
            }
            .target {
              position: absolute;
              width: 10px;
              height: 10px;
              border-radius: 50%;
              background: rgba(255,240,170,0.95);
              box-shadow: 0 0 18px rgba(255,230,150,0.6);
              animation: pulse 2.2s ease-in-out infinite;
            }
            .target1 {
              left: 70%;
              top: 35%;
            }
            .target2 {
              left: 35%;
              top: 70%;
              animation-delay: 0.6s;
            }
            @keyframes drift {
              from { transform: translate3d(0, 0, 0); }
              to { transform: translate3d(-6%, 4%, 0); }
            }
            @keyframes run1 {
              0% { transform: translate3d(10%, 75%, 0) scale(1); }
              50% { transform: translate3d(65%, 40%, 0) scale(1.05); }
              100% { transform: translate3d(10%, 75%, 0) scale(1); }
            }
            @keyframes run2 {
              0% { transform: translate3d(80%, 20%, 0) scale(0.95); }
              50% { transform: translate3d(40%, 65%, 0) scale(1.05); }
              100% { transform: translate3d(80%, 20%, 0) scale(0.95); }
            }
            @keyframes pulse {
              0%, 100% { transform: scale(0.85); opacity: 0.8; }
              50% { transform: scale(1.2); opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
