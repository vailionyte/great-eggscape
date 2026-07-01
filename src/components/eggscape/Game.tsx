import { useCallback, useEffect, useRef, useState } from "react";
import eggAsset from "@/assets/egg.png.asset.json";
import panAsset from "@/assets/pan.png.asset.json";
import potAsset from "@/assets/pot.png.asset.json";
import whiskAsset from "@/assets/whisk.png.asset.json";
import spatulaAsset from "@/assets/spatula.png.asset.json";
import handGrabAsset from "@/assets/hand-grab.png.asset.json";
import friedAsset from "@/assets/fried.png.asset.json";
import toastedImg from "@/assets/toasted.png";
import boiledAsset from "@/assets/boiled.png.asset.json";
import whiskedAsset from "@/assets/whisked.png.asset.json";
import spatulaHitAsset from "@/assets/spatula-hit.png.asset.json";
import cartonAsset from "@/assets/carton.png.asset.json";
import kitchenBgAsset from "@/assets/kitchen-bg.png.asset.json";
import nestLandAsset from "@/assets/nest_land.png.asset.json";
import nestCrackAsset from "@/assets/nest_crack.png.asset.json";
import nestHatchAsset from "@/assets/nest_hatch.png.asset.json";
import rainbowAsset from "@/assets/rainbow.png.asset.json";
import starAsset from "@/assets/star.png.asset.json";
import shieldAsset from "@/assets/shield.png.asset.json";
import toasterAsset from "@/assets/toaster.png.asset.json";
import toasterSheetAsset from "@/assets/toaster-sheet.png.asset.json";
import { audio } from "./audio";

type Phase = "idle" | "intro" | "running" | "nesting" | "gameover" | "victory";

// Nesting outro timeline (ms since entering "nesting")
const NEST_FLY_MS = 750;     // egg arcs into the nest
const NEST_LAND_MS = 850;    // sit in nest
const NEST_CRACK_MS = 850;   // shell cracks
const NEST_HATCH_MS = 1400;  // chick hatches
const NEST_TOTAL_MS = NEST_FLY_MS + NEST_LAND_MS + NEST_CRACK_MS + NEST_HATCH_MS;
type ObstacleKind = "pan" | "pot" | "whisk" | "spatula" | "toaster";
type Difficulty = "easy" | "normal";

type Obstacle = { kind: ObstacleKind; x: number; w: number; h: number; scored: boolean; flying?: boolean; spawnT?: number };
type Powerup = { kind: "rainbow" | "double" | "nest"; x: number; y: number; taken: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string };

const GAME_OVER_IMG: Record<ObstacleKind, string> = {
  pan: friedAsset.url,
  pot: boiledAsset.url,
  whisk: whiskedAsset.url,
  spatula: spatulaHitAsset.url,
  toaster: toastedImg,
};

const GAME_OVER_COPY: Record<ObstacleKind, { title: string; sub: string }> = {
  pan:     { title: "You're Fried!",   sub: "That pan had other plans." },
  pot:     { title: "You're Boiled!",  sub: "Too hot to handle." },
  whisk:   { title: "Whisked Away!",   sub: "You never saw it coming." },
  spatula: { title: "Flipped Out!",    sub: "That was quite the toss." },
  toaster: { title: "Toasted!",        sub: "You popped up at the wrong time." },
};

const OBSTACLE_BASE: Record<ObstacleKind, { w: number; h: number; src: string }> = {
  pan:     { w: 150, h: 95,  src: panAsset.url },
  pot:     { w: 140, h: 130, src: potAsset.url },
  whisk:   { w: 95,  h: 135, src: whiskAsset.url },
  spatula: { w: 100, h: 150, src: spatulaAsset.url },
  toaster: { w: 140, h: 130, src: toasterAsset.url },
};

// ===== Spawn progression (per difficulty) =====
type SpawnCfg = {
  unlockScore: Record<ObstacleKind, number>;
  weightTiers: Array<{ upTo: number; w: Record<ObstacleKind, number> }>;
  introSequence: ObstacleKind[];
  earlyHeavyWindowMs: number;
  earlyHeavyEarliestMs: number;
  earlyHeavyLatestMs: number;
  earlyHeavyKinds: ObstacleKind[];
};

const SPAWN_CFG: Record<Difficulty, SpawnCfg> = {
  easy: {
    // Teach jump → stay low → wider jump, then open the full kitchen.
    introSequence: ["whisk", "spatula", "pan"],
    unlockScore: { spatula: 0, pan: 0, whisk: 0, pot: 3, toaster: 7 },
    weightTiers: [
      { upTo: 15, w: { whisk: 28, spatula: 26, pan: 24, pot: 14, toaster: 8 } },
      { upTo: 35, w: { whisk: 26, spatula: 22, pan: 22, pot: 18, toaster: 12 } },
      { upTo: Infinity, w: { spatula: 12, pan: 20, whisk: 25, pot: 23, toaster: 20 } },
    ],
    earlyHeavyWindowMs: 22000,
    earlyHeavyEarliestMs: 9000,
    earlyHeavyLatestMs: 18000,
    earlyHeavyKinds: ["pot", "toaster"],
  },
  normal: {
    // Hard mode: varied from the first few spawns, ramps faster.
    introSequence: ["whisk", "spatula", "pot"],
    unlockScore: { spatula: 0, pan: 0, whisk: 0, pot: 0, toaster: 4 },
    weightTiers: [
      { upTo: 12, w: { whisk: 26, spatula: 22, pan: 22, pot: 18, toaster: 12 } },
      { upTo: 35, w: { whisk: 24, spatula: 20, pan: 20, pot: 20, toaster: 16 } },
      { upTo: Infinity, w: { spatula: 12, pan: 20, whisk: 25, pot: 23, toaster: 20 } },
    ],
    earlyHeavyWindowMs: 15000,
    earlyHeavyEarliestMs: 5000,
    earlyHeavyLatestMs: 12000,
    earlyHeavyKinds: ["toaster"],
  },
};

// Toaster sprite sheet: 1530x369, 6 cols x 1 row (6 frames). Body is bottom-aligned in each frame.
const TOASTER_SHEET = { cols: 6, rows: 1, frameW: 1530 / 6, frameH: 369, frames: 6, fps: 6 };

const GAP_MIN_SEC_LO = 1.0;
const GAP_MIN_SEC_HI = 0.65;
const GAP_MAX_SEC_LO = 2.5;
const GAP_MAX_SEC_HI = 1.5;
const GAP_BASE_MUL = 0.6;               // global gap scale (shorter clear stretches)
const SPEED_BUFFER_FACTOR = 14; // px per (speed unit) safety buffer
const COMBO_BASE_CHANCE = 0.20;
const COMBO_MAX_CHANCE  = 0.35;
const HEAVY_KINDS: ObstacleKind[] = ["pot", "pan", "toaster"];
const LIGHT_KINDS: ObstacleKind[] = ["whisk", "spatula"];
// Flying whisk variant: hangs overhead. Player must STAY GROUNDED (don't jump).
const FLYING_WHISK_CHANCE_LO = 0.25;
const FLYING_WHISK_CHANCE_HI = 0.6;
const FLYING_WHISK_RAMP_SCORE = 60; // score at which chance reaches HI
const FLYING_WHISK_BOTTOM_OFFSET = 60; // px above GROUND_Y where whisk bottom hangs

function gapScaleFor(cfg: DifficultyCfg, score: number): number {
  let scale = GAP_BASE_MUL * cfg.gapMul;
  if (score < cfg.earlyGapUntil) scale *= cfg.earlyGapBonus;
  return scale;
}

function pickWeighted<T extends string>(weights: Record<T, number>, eligible: T[]): T {
  let total = 0;
  for (const k of eligible) total += weights[k] || 0;
  if (total <= 0) return eligible[0];
  let r = Math.random() * total;
  for (const k of eligible) {
    r -= (weights[k] || 0);
    if (r <= 0) return k;
  }
  return eligible[eligible.length - 1];
}

function pickObstacleKind(
  spawnCfg: SpawnCfg,
  score: number,
  runMs: number,
  introSpawnIndex: number,
  heavyIntroShown: boolean,
  earlyHeavyKind: ObstacleKind,
  earlyHeavyDueMs: number,
  lastSpawnKind: ObstacleKind | null,
): { kind: ObstacleKind; introSpawnIndex: number; heavyIntroShown: boolean } {
  if (introSpawnIndex < spawnCfg.introSequence.length) {
    return {
      kind: spawnCfg.introSequence[introSpawnIndex],
      introSpawnIndex: introSpawnIndex + 1,
      heavyIntroShown,
    };
  }

  const inHeavyWindow = runMs < spawnCfg.earlyHeavyWindowMs;
  if (inHeavyWindow && !heavyIntroShown && runMs >= earlyHeavyDueMs) {
    return { kind: earlyHeavyKind, introSpawnIndex, heavyIntroShown: true };
  }

  const allKinds: ObstacleKind[] = ["pan", "pot", "whisk", "spatula", "toaster"];
  let eligible = allKinds.filter((k) => score >= spawnCfg.unlockScore[k]);
  if (inHeavyWindow) {
    eligible = eligible.filter((k) => !spawnCfg.earlyHeavyKinds.includes(k));
  }

  const tier = spawnCfg.weightTiers.find((t) => score < t.upTo) || spawnCfg.weightTiers[spawnCfg.weightTiers.length - 1];
  const weights = { ...tier.w } as Record<ObstacleKind, number>;
  if (lastSpawnKind && eligible.includes(lastSpawnKind)) {
    weights[lastSpawnKind] = (weights[lastSpawnKind] || 0) * 0.3;
  }

  return { kind: pickWeighted(weights, eligible), introSpawnIndex, heavyIntroShown };
}

const W = 1280;
const H = 480;
const GROUND_Y = 400;

// Kid-mode physics (defaults). Normal mode applies multipliers below.
const GRAVITY = 0.68;                   // slightly stronger pull → tighter arc
const JUMP_V = -13.5;                   // matched to gravity for a compact peak
const JUMP_HOLD_BOOST = -0.55;
const JUMP_HOLD_MAX = 15;               // shorter hold window → more predictable height
const COYOTE_FRAMES = 12;
const BUFFER_FRAMES = 14;

// ===== Jump-feel tunables (game-feel: anticipation, stretch, hang, landing) =====
const JUMP_ANTICIPATION_FRAMES = 3;     // coil frames before liftoff
const JUMP_ANTICIPATION_SQUASH = 0.18;  // sy down, sx up while coiling
const JUMP_RISE_STRETCH = 0.18;         // vertical stretch on the way up
const JUMP_FALL_SQUASH = 0.10;          // vertical squash on the way down
const HANG_VY_THRESHOLD = 2.8;          // |vy| under this counts as "near apex"
const HANG_GRAVITY_MUL = 0.58;          // less float at the top
const LANDING_SQUASH_FRAMES = 6;        // duration of landing squash
const LANDING_SQUASH_AMOUNT = 0.28;     // peak squash on touchdown
const LANDING_SHAKE_INTENSITY = 2.5;    // tiny canvas shake on landing
const JUMP_CUT_VY = -7;                 // release early → clamp upward vy to this
const ROLL_ANGULAR_BASE = 0.0015;       // rad/ms per speed unit (tied to scroll speed)
const TRAVEL_SPEED_MUL = 1.5;           // world scroll 50% faster at all difficulty levels

type DifficultyCfg = {
  baseSpeed: number; topSpeed: number; ramp: number; warmup: number;
  victory: number; gapMul: number; sizeMul: number; sizeStart: number;
  hitboxEgg: number; hitboxObs: number; freeHit: boolean;
  gapBufferMul: number;   // extra jump-reach safety margin in gap calc
  earlyGapBonus: number;  // temporary gap widen while score < earlyGapUntil
  earlyGapUntil: number;
  comboFromScore: number;
  flyingWhiskUnlock: number;
};

const OBSTACLE_BOTTOM = GROUND_Y + 45; // shared ground line for pot/pan/toaster/etc.

function toasterFrameIndex(o: Obstacle, t: number): number {
  const tLocal = t - (o.spawnT ?? 0);
  if (tLocal < 0) return 0;
  return Math.floor(tLocal / (1000 / TOASTER_SHEET.fps)) % TOASTER_SHEET.frames;
}

function toasterPopProgress(frameIdx: number): number {
  if (frameIdx <= 0) return 0;
  return Math.min(1, frameIdx / (TOASTER_SHEET.frames - 1));
}

function toasterSpriteRect(o: Obstacle) {
  const drawW = o.w * 1.15;
  const drawH = drawW * (TOASTER_SHEET.frameH / TOASTER_SHEET.frameW);
  const drawX = o.x + o.w / 2 - drawW / 2;
  const drawY = OBSTACLE_BOTTOM - drawH;
  return { drawW, drawH, drawX, drawY };
}

function obstacleHitboxes(o: Obstacle, t: number, cfg: DifficultyCfg): { x: number; y: number; w: number; h: number }[] {
  const oy = o.flying ? (GROUND_Y - FLYING_WHISK_BOTTOM_OFFSET - o.h) : (OBSTACLE_BOTTOM - o.h);
  const padX = o.w * (0.22 + cfg.hitboxObs * 0.4);
  const padTop = o.kind === "pot" ? o.h * 0.35 : o.kind === "whisk" ? o.h * 0.1 : o.h * 0.18;
  const padBot = o.h * 0.1;
  const body = { x: o.x + padX, y: oy + padTop, w: o.w - padX * 2, h: o.h - padTop - padBot };

  if (o.kind !== "toaster" || o.flying) return [body];

  const pop = toasterPopProgress(toasterFrameIndex(o, t));
  const { drawH } = toasterSpriteRect(o);
  const toastRise = (drawH - o.h) * pop;
  if (toastRise < 12) return [body];

  const toastW = o.w * 0.5;
  const inset = toastW * 0.1;
  return [
    body,
    {
      x: o.x + (o.w - toastW) / 2 + inset,
      y: oy - toastRise + inset,
      w: toastW - inset * 2,
      h: toastRise - inset * 2,
    },
  ];
}

const DIFFICULTY_CFG: Record<Difficulty, DifficultyCfg> = {
  easy:   { baseSpeed: 2.8, topSpeed: 5.5, ramp: 0.020, warmup: 15, victory: 30, gapMul: 1.25, sizeMul: 0.08, sizeStart: 30, hitboxEgg: 0.55, hitboxObs: 0.22, freeHit: true,  gapBufferMul: 1.0,  earlyGapBonus: 1.0,  earlyGapUntil: 0,  comboFromScore: 20, flyingWhiskUnlock: 10 },
  normal: { baseSpeed: 4.5, topSpeed: 9.0, ramp: 0.055, warmup: 20, victory: 50, gapMul: 0.88, sizeMul: 0.20, sizeStart: 15, hitboxEgg: 0.55, hitboxObs: 0.22, freeHit: false, gapBufferMul: 1.12, earlyGapBonus: 1.18, earlyGapUntil: 22, comboFromScore: 28, flyingWhiskUnlock: 12 },
};

// Power-up cadence in obstacles-per-pickup. Centralized so every powerup
// (rainbow / star / shield) inherits the same rules automatically.
const POWERUP_INTERVAL: Record<Difficulty, [number, number]> = {
  easy: [5, 8],
  normal: [10, 15],
};
function pickPowerupInterval(d: Difficulty): number {
  const [lo, hi] = POWERUP_INTERVAL[d];
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// Hand-grab sheet (1536x1024): 8 frames in top row + carton in bottom
const HAND_SHEET = { w: 1536, h: 1024, frameW: 192, frameH: 320, topY: 90, cartonX: 280, cartonY: 470, cartonW: 940, cartonH: 510 };
// Gameover sheet (1254x1254): 2x2 grid, ~627 per cell


function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameOverKind, setGameOverKind] = useState<ObstacleKind>("pan");
  const [muted, setMuted] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [activeBuff, setActiveBuff] = useState<{ label: string; until: number; total: number } | null>(null);
  const [shieldReady, setShieldReady] = useState(false);
  const [milestone, setMilestone] = useState<string | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const mutedRef = useRef(false);
  const holdingRef = useRef(false);
  const difficultyRef = useRef<Difficulty>("easy");
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);

  const stateRef = useRef({
    eggY: GROUND_Y, vy: 0, onGround: true,
    jumpHoldFrames: 0, coyote: 0, buffer: 0,
    antiFrames: 0, landSquash: 0,
    speed: 2.8,
    obstacles: [] as Obstacle[],
    powerups: [] as Powerup[],
    particles: [] as Particle[],
    spawnTimer: 120,
    obstaclesSinceLastPowerup: 0,
    nextPowerupIn: 6,
    score: 0,
    rainbowUntil: 0, doubleUntil: 0,
    rotation: 0, runFrame: 0, shake: 0, flash: 0, flashColor: "255,255,255",
    bgX: 0, fgX: 0,
    t: 0,
    cracked: false,           // first hit consumed (kid mode)
    shieldReady: false,       // shell shield pickup armed
    shieldBreakT: -9999,      // s.t timestamp of shield break (for shatter anim)
    invulnUntil: 0,           // brief i-frames after free hit
    everJumped: false,        // hide ghost-arc hint after first jump
    cartonX: 80,              // on-canvas carton position (scrolls off after launch)
    nestStartT: 0,            // ms timestamp (s.t) when "nesting" outro began
    nestFlags: { land: false, crack: false, hatch: false },
    heavyIntroShown: false,   // the one scheduled pot/toaster has appeared
    earlyHeavyKind: "pot" as ObstacleKind,
    earlyHeavyDueMs: 9000,
    introSpawnIndex: 0,
    lastSpawnKind: null as ObstacleKind | null,
  });

  const imagesRef = useRef<{
    egg?: HTMLImageElement; pan?: HTMLImageElement; pot?: HTMLImageElement;
    whisk?: HTMLImageElement; spatula?: HTMLImageElement; toaster?: HTMLImageElement;
    toasterSheet?: HTMLImageElement;
    hand?: HTMLImageElement; carton?: HTMLImageElement; kitchenBg?: HTMLImageElement;
    nestLand?: HTMLImageElement; nestCrack?: HTMLImageElement; nestHatch?: HTMLImageElement;
    rainbow?: HTMLImageElement; star?: HTMLImageElement; shield?: HTMLImageElement;
  }>({});
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem("eggscape:hi");
      if (v) setHighScore(parseInt(v, 10) || 0);
      const d = localStorage.getItem("eggscape:diff");
      if (d === "normal" || d === "easy") setDifficulty(d);
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    Promise.all([
      loadImage(eggAsset.url),
      loadImage(panAsset.url),
      loadImage(potAsset.url),
      loadImage(whiskAsset.url),
      loadImage(spatulaAsset.url),
      loadImage(handGrabAsset.url),
      loadImage(cartonAsset.url),
      loadImage(kitchenBgAsset.url),
      loadImage(nestLandAsset.url),
      loadImage(nestCrackAsset.url),
      loadImage(nestHatchAsset.url),
      loadImage(rainbowAsset.url),
      loadImage(starAsset.url),
      loadImage(shieldAsset.url),
      loadImage(toasterAsset.url),
      loadImage(toasterSheetAsset.url),
    ]).then(([egg, pan, pot, whisk, spatula, hand, carton, kitchenBg, nestLand, nestCrack, nestHatch, rainbow, star, shield, toaster, toasterSheet]) => {
      if (cancelled) return;
      imagesRef.current = { egg, pan, pot, whisk, spatula, hand, carton, kitchenBg, nestLand, nestCrack, nestHatch, rainbow, star, shield, toaster, toasterSheet };
      setReady(true);
    }).catch((err) => {
      console.error("Failed to load game assets", err);
      if (!cancelled) setLoadError(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Legacy `beep()` is retained as a thin dispatcher onto the centralised
  // AudioManager. New code should call `audio.*` directly.
  const beep = useCallback((..._args: unknown[]) => { /* deprecated: use audio.* */ }, []);
  useEffect(() => { audio.setMuted(muted); }, [muted]);

  const spawnParticles = (x: number, y: number, count: number, opts: { color: string; spread?: number; speed?: number; up?: boolean }) => {
    const s = stateRef.current;
    const spread = opts.spread ?? Math.PI * 2;
    const speed = opts.speed ?? 3;
    for (let i = 0; i < count; i++) {
      const a = opts.up ? -Math.PI / 2 + (Math.random() - 0.5) * spread : Math.random() * spread;
      const v = speed * (0.5 + Math.random());
      s.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (opts.up ? 1 : 0),
        life: 30 + Math.random() * 20, maxLife: 50,
        size: 3 + Math.random() * 4, color: opts.color,
      });
    }
  };

  const resetGame = useCallback(() => {
    const s = stateRef.current;
    const cfg = DIFFICULTY_CFG[difficultyRef.current];
    s.eggY = GROUND_Y; s.vy = 0; s.onGround = true;
    s.jumpHoldFrames = 0; s.coyote = 0; s.buffer = 0;
    s.antiFrames = 0; s.landSquash = 0;
    s.speed = cfg.baseSpeed * TRAVEL_SPEED_MUL;
    s.obstacles = []; s.powerups = []; s.particles = [];
    s.spawnTimer = Math.round(150 * GAP_BASE_MUL * cfg.gapMul);
    s.obstaclesSinceLastPowerup = 0;
    s.nextPowerupIn = pickPowerupInterval(difficultyRef.current);
    s.score = 0;
    s.rainbowUntil = 0; s.doubleUntil = 0;
    s.rotation = 0; s.runFrame = 0; s.shake = 0; s.flash = 0;
    s.t = 0;
    s.cracked = false; s.invulnUntil = 0;
    s.shieldReady = false;
    s.shieldBreakT = -9999;
    s.everJumped = false;
    s.cartonX = 80;
    s.nestStartT = 0;
    s.nestFlags = { land: false, crack: false, hatch: false };
    s.heavyIntroShown = false;
    const spawnCfg = SPAWN_CFG[difficultyRef.current];
    s.earlyHeavyKind = Math.random() < 0.5 ? "pot" : "toaster";
    s.earlyHeavyDueMs = spawnCfg.earlyHeavyEarliestMs
      + Math.random() * (spawnCfg.earlyHeavyLatestMs - spawnCfg.earlyHeavyEarliestMs);
    s.introSpawnIndex = 0;
    s.lastSpawnKind = null;
    (s as any).flyingWhiskShown = false;
    audio.stopRolling();
    setScore(0); setActiveBuff(null); setShieldReady(false); setMilestone(null);
  }, []);

  const startRun = useCallback(() => {
    resetGame();
    const s = stateRef.current;
    const cfg = DIFFICULTY_CFG[difficultyRef.current];
    // Launch Shelldon out of the carton immediately
    s.vy = JUMP_V;
    s.onGround = false;
    s.jumpHoldFrames = JUMP_HOLD_MAX;
    s.everJumped = true;
    // Give the player time to land before the first obstacle
    s.spawnTimer = Math.round(180 * GAP_BASE_MUL * cfg.gapMul);
    spawnParticles(145, GROUND_Y + 5, 14, { color: "215,170,110", spread: Math.PI * 0.8, speed: 3.5, up: true });
    setPhase("running");
    audio.init();
    audio.startRolling();
    audio.playLaunch();
  }, [resetGame, beep]);

  const tryJump = useCallback(() => {
    // Prime the AudioContext on the very first user gesture.
    audio.init();
    // Ensure keyboard-focused UI buttons (Try Again, difficulty pills, mute)
    // don't intercept the next Space/Enter as a native button activation.
    if (typeof document !== "undefined") {
      const el = document.activeElement as HTMLElement | null;
      if (el && el.tagName === "BUTTON") el.blur();
    }
    const s = stateRef.current;
    const phase = phaseRef.current;
    if (phase === "idle") {
      startRun();
      return;
    }
    if (phase === "gameover" || phase === "victory") {
      resetGame();
      setPhase("idle");
      return;
    }
    if (phase !== "running") return;
    s.buffer = BUFFER_FRAMES;
  }, [startRun, resetGame]);


  useEffect(() => {
    const activeInputs = new Set<string>();
    const updateHolding = () => { holdingRef.current = activeInputs.size > 0; };

    const isInteractive = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && !!el.closest && !!el.closest('button,a,input,select,textarea,[role="button"]');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "Enter") {
        e.preventDefault();
        if (!e.repeat) {
          activeInputs.add("key:" + e.code);
          updateHolding();
          tryJump();
        }
      } else if (e.key === "m" || e.key === "M") {
        setMuted((m) => !m);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "Enter") {
        activeInputs.delete("key:" + e.code);
        updateHolding();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (isInteractive(e.target)) return;
      const container = containerRef.current;
      if (!container || !container.contains(e.target as Node)) return;
      e.preventDefault();
      activeInputs.add("ptr:" + e.pointerId);
      updateHolding();
      tryJump();
    };
    const onPointerUp = (e: PointerEvent) => {
      activeInputs.delete("ptr:" + e.pointerId);
      updateHolding();
    };
    const onBlur = () => { activeInputs.clear(); updateHolding(); };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", onBlur);

    // Dev-only inspection hook for automated tests.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as unknown as { __eggscape?: unknown }).__eggscape = {
        getPhase: () => phaseRef.current,
        getState: () => stateRef.current,
        jump: () => tryJump(),
      };
    }
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true } as EventListenerOptions);
      window.removeEventListener("keyup", onKeyUp, { capture: true } as EventListenerOptions);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [tryJump]);



  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(33, now - last);
      last = now;
      update(dt);
      render(ctx);
      raf = requestAnimationFrame(step);
    };

    const failIntroToFried = () => {
      const s = stateRef.current;
      setGameOverKind("pan");
      setPhase("gameover");
      s.shake = 0; s.flash = 0;
      audio.stopRolling();
      audio.playFried();
      try {
        const hi = Math.max(highScore, s.score);
        localStorage.setItem("eggscape:hi", String(hi));
        setHighScore(hi);
      } catch {}
    };

    const update = (dt: number) => {
      const s = stateRef.current;
      const cfg = DIFFICULTY_CFG[difficultyRef.current];
      s.t += dt;

      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 0.003);

      for (const p of s.particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life -= 1; }
      s.particles = s.particles.filter((p) => p.life > 0);

      if (phaseRef.current === "idle") {
        s.eggY = GROUND_Y + Math.sin(s.t * 0.004) * 3;
        return;
      }

      // (intro phase removed — start runs directly)

      if (phaseRef.current === "gameover" || phaseRef.current === "victory") return;

      if (phaseRef.current === "nesting") {
        // Gameplay frozen. Drift the background gently and tick down the outro timer.
        s.bgX += 36 * (dt / 1000); // ~36 px/sec gentle drift, dt-based

        if (s.cartonX > -400) s.cartonX -= 1.2;
        const elapsed = s.t - s.nestStartT;

        const nestCx = W * 0.62;
        const nestTopY = GROUND_Y + 18 - 200; // approx top-of-nest cup area
        const nestCupY = GROUND_Y - 40;

        // Land: egg thuds into the nest
        if (!s.nestFlags.land && elapsed >= NEST_FLY_MS) {
          s.nestFlags.land = true;
          s.shake = Math.max(s.shake, 7);
          // dust puff outward along the nest rim
          spawnParticles(nestCx, nestCupY, 18, { color: "210,180,130", spread: Math.PI, speed: 3 });
          spawnParticles(nestCx, nestCupY, 10, { color: "245,230,200", spread: Math.PI, speed: 2 });
          audio.playLand();
        }
        // Crack: shell shards fly
        if (!s.nestFlags.crack && elapsed >= NEST_FLY_MS + NEST_LAND_MS) {
          s.nestFlags.crack = true;
          s.shake = Math.max(s.shake, 5);
          spawnParticles(nestCx, nestTopY + 80, 16, { color: "255,250,235", spread: Math.PI * 2, speed: 4 });
          spawnParticles(nestCx, nestTopY + 80, 8, { color: "250,210,150", spread: Math.PI * 2, speed: 3 });
          audio.playCrack();
        }
        // Hatch: sparkle burst + bigger shake
        if (!s.nestFlags.hatch && elapsed >= NEST_FLY_MS + NEST_LAND_MS + NEST_CRACK_MS) {
          s.nestFlags.hatch = true;
          s.shake = Math.max(s.shake, 11);
          s.flash = 0.5; s.flashColor = "255,240,180";
          spawnParticles(nestCx, nestTopY + 60, 36, { color: "255,230,120", spread: Math.PI * 2, speed: 5, up: true });
          spawnParticles(nestCx, nestTopY + 60, 18, { color: "255,180,220", spread: Math.PI * 2, speed: 4, up: true });
          spawnParticles(nestCx, nestTopY + 60, 12, { color: "180,230,255", spread: Math.PI * 2, speed: 3, up: true });
          audio.playHatch();
        }

        // tick particles during outro
        for (const p of s.particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life -= 1; }
        s.particles = s.particles.filter((p) => p.life > 0);
        if (s.shake > 0) s.shake *= 0.9;
        if (s.flash > 0) s.flash *= 0.92;

        if (elapsed >= NEST_TOTAL_MS) {
          setPhase("victory");
        }
        return;
      }

      const rainbow = s.t < s.rainbowUntil;
      const dbl = s.t < s.doubleUntil;
      const invuln = s.t < s.invulnUntil;

      // Endless speed curve: rises quickly early, tapers, asymptotes to topSpeed.
      const sAfterWarm = Math.max(0, s.score - cfg.warmup);
      const approach = 1 - Math.exp(-cfg.ramp * sAfterWarm);
      const effBase = cfg.baseSpeed * TRAVEL_SPEED_MUL;
      const effTop = cfg.topSpeed * TRAVEL_SPEED_MUL;
      s.speed = effBase + (effTop - effBase) * approach;

      // Background scrolls at the same horizontal rate as gameplay (px/sec, dt-based).
      // s.speed is calibrated as px/frame at 60fps, so multiply by 60 to get px/sec.
      s.bgX += s.speed * 60 * (dt / 1000);

      s.fgX = (s.fgX - s.speed) % 120;
      if (s.cartonX > -260) s.cartonX -= s.speed;

      // Feed rolling loop with current game state.
      audio.setSpeed(s.speed);
      audio.setAirborne(!s.onGround);

      if (s.onGround) s.coyote = COYOTE_FRAMES; else s.coyote = Math.max(0, s.coyote - 1);
      s.buffer = Math.max(0, s.buffer - 1);

      // Begin anticipation (coil) when jump input + ground contact line up.
      if (s.buffer > 0 && s.coyote > 0 && s.antiFrames === 0 && s.onGround) {
        s.antiFrames = JUMP_ANTICIPATION_FRAMES;
        s.buffer = 0;
      }

      if (s.antiFrames > 0) {
        // Hold position on the ground while coiling, then launch.
        s.antiFrames -= 1;
        s.vy = 0;
        s.eggY = GROUND_Y;
        if (s.antiFrames === 0) {
          s.vy = JUMP_V;
          s.onGround = false; s.coyote = 0;
          s.jumpHoldFrames = JUMP_HOLD_MAX;
          s.everJumped = true;
          audio.playJump();
          spawnParticles(145, GROUND_Y + 5, 8, { color: "215,170,110", spread: Math.PI * 0.6, speed: 2.5 });
        }
      } else {
        // Variable jump height: held → keep boosting, released early → cut short.
        if (holdingRef.current && s.jumpHoldFrames > 0 && s.vy < 0) {
          s.vy += JUMP_HOLD_BOOST;
          s.jumpHoldFrames -= 1;
        } else {
          s.jumpHoldFrames = 0;
        }
        if (!holdingRef.current && !s.onGround && s.vy < JUMP_CUT_VY) {
          s.vy = JUMP_CUT_VY;
        }

        // Hang time: gravity is softened around the apex for a "floaty" peak.
        const gravMul = Math.abs(s.vy) < HANG_VY_THRESHOLD ? HANG_GRAVITY_MUL : 1;
        s.vy += GRAVITY * gravMul;
        s.eggY += s.vy;
        if (s.eggY >= GROUND_Y) {
          if (!s.onGround) {
            audio.playLand(); // soft landing thump
            spawnParticles(145, GROUND_Y + 5, 10, { color: "215,170,110", spread: Math.PI * 0.8, speed: 3 });
            s.landSquash = LANDING_SQUASH_FRAMES;
            if (s.shake < LANDING_SHAKE_INTENSITY) s.shake = LANDING_SHAKE_INTENSITY;
          }
          s.eggY = GROUND_Y; s.vy = 0; s.onGround = true;
        }
      }
      if (s.landSquash > 0) s.landSquash -= 1;

      s.runFrame += dt * 0.012;
      // Continuous clockwise roll tied to travel speed (grounded and airborne).
      s.rotation += s.speed * ROLL_ANGULAR_BASE * dt;

      // Spawn obstacles
      s.spawnTimer -= 1;
      if (s.spawnTimer <= 0) {
        const score = s.score;
        const runMs = s.t;
        const spawnCfg = SPAWN_CFG[difficultyRef.current];

        const picked = pickObstacleKind(
          spawnCfg,
          score,
          runMs,
          s.introSpawnIndex,
          s.heavyIntroShown,
          s.earlyHeavyKind,
          s.earlyHeavyDueMs,
          s.lastSpawnKind,
        );
        s.introSpawnIndex = picked.introSpawnIndex;
        s.heavyIntroShown = picked.heavyIntroShown;
        const kind = picked.kind;
        s.lastSpawnKind = kind;

        const tier = spawnCfg.weightTiers.find((t) => score < t.upTo) || spawnCfg.weightTiers[spawnCfg.weightTiers.length - 1];

        const sizeMul = 1 + Math.min(cfg.sizeMul, Math.max(0, s.score - cfg.sizeStart) * 0.003);
        const base = OBSTACLE_BASE[kind];
        const maybeFlying = (k: ObstacleKind) => {
          if (k !== "whisk") return false;
          if (score < cfg.flyingWhiskUnlock) return false;
          const t = Math.min(1, (score - cfg.flyingWhiskUnlock) / FLYING_WHISK_RAMP_SCORE);
          const chance = FLYING_WHISK_CHANCE_LO + (FLYING_WHISK_CHANCE_HI - FLYING_WHISK_CHANCE_LO) * t;
          return Math.random() < chance;
        };
        const isFlying = maybeFlying(kind);
        s.obstacles.push({
          kind, x: W + 40,
          w: base.w * sizeMul, h: base.h * sizeMul,
          scored: false, flying: isFlying,
          spawnT: kind === "toaster" ? s.t + Math.random() * 1500 : undefined,
        });



        // Jump reach derived from physics (roomy estimate)
        const jumpReach = Math.max(180, s.speed * 50);

        // Combo: after a heavy obstacle, sometimes follow up with a light one
        let comboAdded = 0;
        const comboEligible = score >= cfg.comboFromScore && HEAVY_KINDS.includes(kind);
        if (comboEligible) {
          const chance = COMBO_BASE_CHANCE + (COMBO_MAX_CHANCE - COMBO_BASE_CHANCE) * Math.min(1, (score - cfg.comboFromScore) / 30);
          if (Math.random() < chance) {
            const lightEligible = LIGHT_KINDS.filter((k) => score >= spawnCfg.unlockScore[k]);
            const lightKind = pickWeighted(tier.w, lightEligible.length ? lightEligible : ["spatula"]);
            const lb = OBSTACLE_BASE[lightKind];
            const comboGapPx = jumpReach * 0.55 * gapScaleFor(cfg, score);
            // Never make the follow-up a flying whisk — combos require a jump.
            s.obstacles.push({
              kind: lightKind, x: W + 40 + comboGapPx,
              w: lb.w * sizeMul, h: lb.h * sizeMul,
              scored: false, flying: false,
            });
            comboAdded = comboGapPx;
          }
        }

        // Randomized gap with speed buffer + tier tightening
        const speedT = Math.max(0, Math.min(1, (s.speed - effBase) / Math.max(0.001, effTop - effBase)));
        const minGapSec = GAP_MIN_SEC_LO + (GAP_MIN_SEC_HI - GAP_MIN_SEC_LO) * speedT;
        const maxGapSec = GAP_MAX_SEC_LO + (GAP_MAX_SEC_HI - GAP_MAX_SEC_LO) * speedT;
        const gapSec = minGapSec + Math.random() * (maxGapSec - minGapSec);
        const bufferPx = s.speed * SPEED_BUFFER_FACTOR * cfg.gapBufferMul;
        const reachableFloor = jumpReach + bufferPx;
        const gapPx = (Math.max(gapSec * s.speed * 60, reachableFloor) + comboAdded) * gapScaleFor(cfg, score);
        s.spawnTimer = gapPx / s.speed;

        // Centralized power-up scheduler: tied to obstacle count, placed in the
        // safe window BETWEEN the just-spawned obstacle and the next one so it
        // never overlaps a hazard. Also blocks stacking multiple powerups.
        s.obstaclesSinceLastPowerup += 1;
        if (
          s.obstaclesSinceLastPowerup >= s.nextPowerupIn &&
          s.powerups.length === 0
        ) {
          const roll = Math.random();
          const kind: Powerup["kind"] =
            roll < 0.34 ? "nest" : roll < 0.67 ? "rainbow" : "double";
          // Place at mid-gap after the current obstacle, clear of both neighbors.
          const puX = (W + 40) + gapPx * 0.5;
          s.powerups.push({
            kind, x: puX,
            y: GROUND_Y - 75 - Math.random() * 25,
            taken: false,
          });
          s.obstaclesSinceLastPowerup = 0;
          s.nextPowerupIn = pickPowerupInterval(difficultyRef.current);
        }
      }


      for (const o of s.obstacles) o.x -= s.speed;
      for (const p of s.powerups) p.x -= s.speed;

      const eggCx = 145, eggCy = s.eggY - 28;
      const eggHW = 45 * cfg.hitboxEgg, eggHH = 50 * cfg.hitboxEgg;
      const eggBox = { x: eggCx - eggHW, y: eggCy - eggHH, w: eggHW * 2, h: eggHH * 2 };

      for (const o of s.obstacles) {
        for (const oBox of obstacleHitboxes(o, s.t, cfg)) {
          if (
            !rainbow && !invuln &&
            eggBox.x < oBox.x + oBox.w &&
            eggBox.x + eggBox.w > oBox.x &&
            eggBox.y < oBox.y + oBox.h &&
            eggBox.y + eggBox.h > oBox.y
          ) {
            if (s.shieldReady) {
              // Shell shield absorbs the hit — obstacle is destroyed, no damage.
              s.shieldReady = false;
              setShieldReady(false);
              s.shieldBreakT = s.t;
              s.invulnUntil = s.t + 400;
              // Remove obstacle instantly.
              o.x = -9999;
              audio.playShieldBlock();
              spawnParticles(eggCx, eggCy, 24, { color: "180,220,255", spread: Math.PI * 2, speed: 5, up: false });
              spawnParticles(eggCx, eggCy, 10, { color: "255,240,180", spread: Math.PI * 2, speed: 3, up: false });
              setMilestone("🛡 Shield absorbed the hit!");
              setTimeout(() => setMilestone(null), 1200);
            } else if (cfg.freeHit && !s.cracked) {
              // First hit: crack shell, bounce, brief invuln
              s.cracked = true;
              s.invulnUntil = s.t + 1400;
              s.vy = -10;
              s.onGround = false;
              s.shake = 12; s.flash = 0.6; s.flashColor = "255,200,80";
              audio.playCrack();
              spawnParticles(eggCx, eggCy, 18, { color: "255,240,180", spread: Math.PI * 2, speed: 4, up: true });
              setMilestone("Cracked! One more hit and you're toast 🥚");
              setTimeout(() => setMilestone(null), 1400);
            } else {
              setGameOverKind(o.kind);
              setPhase("gameover");
              s.shake = 0; s.flash = 0;
              audio.stopRolling();
              audio.playGameOver(o.kind);
              try {
                const hi = Math.max(highScore, s.score);
                localStorage.setItem("eggscape:hi", String(hi));
                setHighScore(hi);
              } catch {}
              return;
            }
            break;
          }
        }
        if (!o.scored && o.x + o.w < 100) {
          o.scored = true;
          const gain = dbl ? 2 : 1;
          s.score += gain;
          setScore(s.score);
          audio.playObstaclePass();
          if (s.score === 10 || s.score === 25 || s.score === 50 || (s.score > 50 && s.score % 50 === 0)) {
            const msg = s.score === 10 ? "Nice! 10 down 🥚" : s.score === 25 ? "25! Keep rolling 🪺" : `${s.score}! 🔥`;
            setMilestone(msg);
            setTimeout(() => setMilestone(null), 1500);
          }
          try {
            const hi = Math.max(highScore, s.score);
            if (hi > highScore) {
              localStorage.setItem("eggscape:hi", String(hi));
              setHighScore(hi);
            }
          } catch {}
        }
      }

      for (const p of s.powerups) {
        if (p.taken) continue;
        const pBox = { x: p.x, y: p.y, w: 44, h: 44 };
        if (
          eggBox.x < pBox.x + pBox.w &&
          eggBox.x + eggBox.w > pBox.x &&
          eggBox.y < pBox.y + pBox.h &&
          eggBox.y + eggBox.h > pBox.y
        ) {
          p.taken = true;
          audio.playPowerup();
          s.flash = 0.5; s.flashColor = "255,255,255";
          spawnParticles(p.x + 22, p.y + 22, 16, { color: "255,240,150", spread: Math.PI * 2, speed: 4 });
          const DUR = 5000;
          const now = s.t;
          if (p.kind === "rainbow") { s.rainbowUntil = now + DUR; setActiveBuff({ label: "🌈 Invincible", until: now + DUR, total: DUR }); }
          
          else if (p.kind === "double") { s.doubleUntil = now + DUR; setActiveBuff({ label: "⭐ 2× score", until: now + DUR, total: DUR }); }
          else if (p.kind === "nest") {
            if (!s.shieldReady) {
              s.shieldReady = true;
              setShieldReady(true);
              setMilestone("🛡 Shell shield ready!");
            } else {
              // Already armed — small score bonus so the pickup isn't wasted
              s.score += 3; setScore(s.score);
              setMilestone("🛡 +3 (shield already up)");
            }
            setTimeout(() => setMilestone(null), 1200);
          }
        }
      }

      if (rainbow && Math.random() < 0.6) {
        spawnParticles(eggCx + (Math.random() - 0.5) * 30, eggCy + (Math.random() - 0.5) * 30, 1, {
          color: `${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)},${Math.floor(Math.random() * 255)}`,
          spread: Math.PI * 2, speed: 1.5,
        });
      }

      s.obstacles = s.obstacles.filter((o) => o.x + o.w > -50);
      s.powerups = s.powerups.filter((p) => p.x > -60 && !p.taken);
      if (s.shake > 0) s.shake *= 0.9;
    };

    const drawEgg = (ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, rainbow: boolean) => {
      const img = imagesRef.current.egg;
      if (!img) return;
      const s = stateRef.current;
      const invuln = s.t < s.invulnUntil;

      // Shield aura — green electric crackle with gold outer glow, matches shield icon.
      const SHIELD_GREEN = "245,197,24";        // gold #F5C518
      const SHIELD_GREEN_BRIGHT = "255,225,120"; // bright gold
      const SHIELD_GOLD = "255,180,40";          // warm amber outer glow
      if (s.shieldReady && phaseRef.current === "running") {
        const pulse = 1.0 + 0.06 * Math.sin(s.t / 180);
        ctx.save();
        ctx.translate(x, y - 5);
        ctx.scale(pulse, pulse);

        // Gold outer glow (behind everything)
        const goldGlow = ctx.createRadialGradient(0, 0, 22, 0, 0, 48);
        goldGlow.addColorStop(0, `rgba(${SHIELD_GOLD},0)`);
        goldGlow.addColorStop(0.5, `rgba(${SHIELD_GOLD},0.28)`);
        goldGlow.addColorStop(1, `rgba(${SHIELD_GOLD},0)`);
        ctx.fillStyle = goldGlow;
        ctx.beginPath();
        ctx.arc(0, 0, 48, 0, Math.PI * 2);
        ctx.fill();

        // Green crackle: jagged lines around the egg, reshuffled every ~120ms.
        const bucket = Math.floor(s.t / 120);
        // Simple deterministic pseudo-random from bucket + index.
        const rand = (i: number) => {
          const v = Math.sin(bucket * 91.13 + i * 37.7) * 43758.5453;
          return v - Math.floor(v);
        };
        const baseR = 34;
        const bolts = 9;
        ctx.lineCap = "round";
        for (let b = 0; b < bolts; b++) {
          const a0 = (b / bolts) * Math.PI * 2 + rand(b) * 0.4;
          const segs = 5;
          ctx.beginPath();
          for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const a = a0 + t * (Math.PI * 2 / bolts) * 1.1;
            const jitter = (rand(b * 10 + i) - 0.5) * 10;
            const r = baseR + jitter;
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r * 1.05;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          // Bright green core
          ctx.strokeStyle = `rgba(${SHIELD_GREEN_BRIGHT},0.95)`;
          ctx.lineWidth = 1.6;
          ctx.shadowColor = `rgba(${SHIELD_GREEN},1)`;
          ctx.shadowBlur = 8;
          ctx.stroke();
        }
        ctx.shadowBlur = 0;

        // Four white sparkles at cardinal-ish positions, fading in/out.
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          const sparkPhase = (s.t / 300) + i * 0.7;
          const sparkA = Math.max(0, Math.sin(sparkPhase));
          const sr = 42;
          const sxp = Math.cos(a) * sr;
          const syp = Math.sin(a) * sr;
          const size = 2 + sparkA * 2.5;
          ctx.fillStyle = `rgba(255,255,255,${sparkA})`;
          ctx.beginPath();
          ctx.arc(sxp, syp, size, 0, Math.PI * 2);
          ctx.fill();
          // Cross shimmer
          ctx.strokeStyle = `rgba(255,255,255,${sparkA * 0.9})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sxp - size * 2, syp); ctx.lineTo(sxp + size * 2, syp);
          ctx.moveTo(sxp, syp - size * 2); ctx.lineTo(sxp, syp + size * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Shield break shatter (~300ms) — green sparks with gold trails.
      const breakElapsed = s.t - s.shieldBreakT;
      if (breakElapsed >= 0 && breakElapsed < 300 && phaseRef.current === "running") {
        const k = breakElapsed / 300;
        const r = 30 + k * 55;
        ctx.save();
        ctx.translate(x, y - 5);
        // Gold trailing ring (behind)
        ctx.strokeStyle = `rgba(${SHIELD_GOLD},${(1 - k) * 0.7})`;
        ctx.lineWidth = 5 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        // Green expanding ring (front)
        ctx.strokeStyle = `rgba(${SHIELD_GREEN_BRIGHT},${1 - k})`;
        ctx.lineWidth = 2.5 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        // Radial spark shards
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 + k * 0.6;
          const r1 = r - 8, r2 = r + 14;
          ctx.strokeStyle = i % 2 === 0
            ? `rgba(${SHIELD_GREEN_BRIGHT},${1 - k})`
            : `rgba(${SHIELD_GOLD},${(1 - k) * 0.9})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      let sx = 1, sy = 1;
      if (s.landSquash > 0 && phaseRef.current === "running") {
        // Brief, subtle landing squash only.
        const t = s.landSquash / LANDING_SQUASH_FRAMES;
        const amt = LANDING_SQUASH_AMOUNT * 0.5 * t;
        sx = 1 + amt; sy = 1 - amt;
      }
      ctx.scale(sx, sy);
      if (rainbow) {
        const hue = (s.t * 0.5) % 360;
        ctx.filter = `hue-rotate(${hue}deg) saturate(1.6)`;
      }
      if (invuln && Math.floor(s.t / 80) % 2 === 0) ctx.globalAlpha = 0.5;
      ctx.drawImage(img, -45, -55, 90, 100);
      // Crack overlay
      if (s.cracked) {
        ctx.strokeStyle = "rgba(80,40,20,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-18, -30);
        ctx.lineTo(-8, -18); ctx.lineTo(-14, -8); ctx.lineTo(-2, 2); ctx.lineTo(-10, 14);
        ctx.stroke();
      }
      ctx.restore();
    };

    // Draw the carton illustration anchored on the ground, centered at canvas x.
    // Shelldon's sprite is drawn separately on top so he can visibly launch out on Space.
    const drawCarton = (ctx: CanvasRenderingContext2D, cx: number) => {
      const img = imagesRef.current.carton;
      if (!img) return;
      const dw = 320;
      const dh = dw * (img.height / img.width);
      ctx.drawImage(img, cx - dw / 2, GROUND_Y + 105 - dh, dw, dh);
    };

    const drawHandFrame = (ctx: CanvasRenderingContext2D, frameIdx: number, x: number, y: number, scale: number) => {
      const img = imagesRef.current.hand;
      if (!img) return;
      const idx = Math.max(0, Math.min(7, frameIdx));
      const sx = idx * HAND_SHEET.frameW;
      const sy = HAND_SHEET.topY;
      const dw = HAND_SHEET.frameW * scale;
      const dh = HAND_SHEET.frameH * scale;
      ctx.drawImage(img, sx, sy, HAND_SHEET.frameW, HAND_SHEET.frameH, x, y, dw, dh);
    };

    const render = (ctx: CanvasRenderingContext2D) => {
      const s = stateRef.current;
      ctx.save();
      const sx = (Math.random() - 0.5) * s.shake;
      const sy = (Math.random() - 0.5) * s.shake;
      ctx.translate(sx, sy);

      // ===== KITCHEN BACKGROUND =====
      // 2-3 identical segments laid edge-to-edge, scrolled together. When the
      // leftmost segment exits the screen, it gets re-anchored relative to the
      // last segment (segment.x = prev.x + tileW), never reset to a hardcoded 0.
      // All math uses the same scaled rendered width (tileW) so there is no
      // drift between assumed and actual image width.
      const bg = imagesRef.current.kitchenBg;
      if (bg) {
        // Artwork is 1920x618 with the front table top at ~y=425.
        const TABLE_LINE_IMG = 425;
        const IMG_W = 1920, IMG_H = 618;
        const scale = GROUND_Y / TABLE_LINE_IMG;
        const tileW = Math.round(IMG_W * scale);
        const dh = Math.round(IMG_H * scale);
        // Wrap the accumulated scroll into [0, tileW) using tileW (not canvas W).
        const wrapped = ((s.bgX % tileW) + tileW) % tileW;
        let segX = Math.round(-wrapped);
        // Draw segments left-to-right; each next segment positioned relative
        // to the previous one. +1px overlap absorbs subpixel rounding seams.
        while (segX < W) {
          ctx.drawImage(bg, segX, 0, tileW + 1, dh);
          segX = segX + tileW;
        }
      } else {
        ctx.fillStyle = "#ffe2ec";
        ctx.fillRect(0, 0, W, H);
      }


      // Fill any area below the artwork with the table tone so the floor is solid.
      ctx.fillStyle = "#e8c79a";
      ctx.fillRect(0, GROUND_Y + 200, W, H - (GROUND_Y + 200));





      for (const p of s.particles) {
        const a = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = `rgba(${p.color},${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2); ctx.fill();
      }

      // Carton on the ground — visible during idle (Shelldon is sitting in it)
      // and stays drawn as it scrolls off-screen at the start of a run.
      const showCartonIdle = phaseRef.current === "idle";
      const showCartonRunning = phaseRef.current === "running" && s.cartonX > -200;
      if (showCartonIdle || showCartonRunning) {
        const cx = showCartonIdle ? 145 : s.cartonX;
        drawCarton(ctx, cx);
      }

      // Ghost-arc jump hint (shown only after the run starts, until first jump)
      if (phaseRef.current === "running" && !s.everJumped && s.onGround) {
        const eggX = 145;
        const eggTopY = s.eggY - 50;
        const startX = eggX, startY = eggTopY;
        const vy0 = JUMP_V, gAcc = GRAVITY;
        const speed = s.speed || DIFFICULTY_CFG[difficultyRef.current].baseSpeed * TRAVEL_SPEED_MUL;
        const pulse = 0.5 + 0.5 * Math.sin(s.t * 0.006);
        ctx.save();
        ctx.strokeStyle = `rgba(184, 52, 26, ${0.4 + pulse * 0.4})`;
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        for (let i = 0; i <= 30; i++) {
          const t = i * 2;
          const x = startX + speed * t;
          const y = startY + vy0 * t + 0.5 * gAcc * t * t;
          if (y > GROUND_Y - 28) break;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Nesting outro: Sheldon arcs into the nest, then the hatch sequence plays.
      if (phaseRef.current === "nesting") {
        const elapsed = s.t - s.nestStartT;
        const nestCx = W * 0.62;
        const nestBaseY = GROUND_Y + 18; // baseline of nest sits on the table
        const NEST_W = 220;
        const NEST_H = 240;
        const rainbow = s.t < s.rainbowUntil;

        if (elapsed < NEST_FLY_MS) {
          // Egg arcs from current position into the nest cup with a natural ease-out.
          const k = elapsed / NEST_FLY_MS;
          const easeOut = 1 - Math.pow(1 - k, 2.2);          // decelerate toward the nest
          const startX = 145;
          const targetX = nestCx;
          const ex = startX + (targetX - startX) * easeOut;
          // Slightly skewed arc so apex hits ~45% of the flight (more lifelike than pure sine).
          const arcK = Math.sin(Math.pow(k, 0.85) * Math.PI);
          const arc = arcK * 200;
          const ey = GROUND_Y - arc;
          // Rotation eases in then settles; tilt forward toward landing.
          const rot = (1 - Math.pow(1 - k, 3)) * 0.7;
          // Subtle stretch on the way up, squash near landing.
          const vyApprox = Math.cos(Math.pow(k, 0.85) * Math.PI); // +up, -down
          const stretchY = 1 + vyApprox * 0.08;
          const stretchX = 1 - vyApprox * 0.05;
          ctx.save();
          ctx.translate(ex, ey);
          ctx.scale(stretchX, stretchY);
          ctx.translate(-ex, -ey);
          drawEgg(ctx, ex, ey, rot, rainbow);
          ctx.restore();
          // Faint motion trail
          if (k > 0.05 && Math.random() < 0.5) {
            spawnParticles(ex, ey + 8, 1, { color: "255,245,210", spread: 0.4, speed: 0.6 });
          }
        } else {
          const tAfterFly = elapsed - NEST_FLY_MS;
          let frame: HTMLImageElement | undefined;
          if (tAfterFly < NEST_LAND_MS) frame = imagesRef.current.nestLand;
          else if (tAfterFly < NEST_LAND_MS + NEST_CRACK_MS) frame = imagesRef.current.nestCrack;
          else frame = imagesRef.current.nestHatch;
          if (frame) {
            // Landing squash → settle, plus a tiny hatch pop.
            let sx = 1, sy = 1;
            if (tAfterFly < 180) {
              const q = tAfterFly / 180;
              sx = 1 + (1 - q) * 0.18;
              sy = 1 - (1 - q) * 0.14;
            }
            const hatchT = tAfterFly - (NEST_LAND_MS + NEST_CRACK_MS);
            if (hatchT >= 0 && hatchT < 240) {
              const q = hatchT / 240;
              const pop = Math.sin(q * Math.PI) * 0.12;
              sx += pop; sy += pop;
            }
            const dw = NEST_W * sx;
            const dh = NEST_H * sy;
            ctx.drawImage(frame, nestCx - dw / 2, nestBaseY - dh, dw, dh);
          }
        }
      } else if (phaseRef.current !== "gameover" && phaseRef.current !== "victory") {
        for (const o of s.obstacles) {
          const img = imagesRef.current[o.kind];
          if (!img) continue;
          const oy = o.flying ? (GROUND_Y - FLYING_WHISK_BOTTOM_OFFSET - o.h) : (OBSTACLE_BOTTOM - o.h);
          if (o.flying) {
            // Faint string from ceiling so the player reads it as hanging.
            ctx.save();
            ctx.strokeStyle = "rgba(60,40,30,0.35)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(o.x + o.w / 2, 0);
            ctx.lineTo(o.x + o.w / 2, oy + 6);
            ctx.stroke();
            ctx.restore();
            // Gentle sway as it dangles.
            const sway = Math.sin((s.t + o.x) * 0.008) * 0.08;
            ctx.save();
            ctx.translate(o.x + o.w / 2, oy);
            ctx.rotate(sway);
            ctx.drawImage(img, -o.w / 2, 0, o.w, o.h);
            ctx.restore();
          } else if (o.kind === "toaster") {
            const sheet = imagesRef.current.toasterSheet;
            const { drawW, drawH, drawX, drawY } = toasterSpriteRect(o);
            if (sheet) {
              const frameIdx = toasterFrameIndex(o, s.t);
              const col = frameIdx % TOASTER_SHEET.cols;
              const row = Math.floor(frameIdx / TOASTER_SHEET.cols);
              ctx.drawImage(
                sheet,
                col * TOASTER_SHEET.frameW, row * TOASTER_SHEET.frameH,
                TOASTER_SHEET.frameW, TOASTER_SHEET.frameH,
                drawX, drawY, drawW, drawH,
              );
            } else {
              ctx.drawImage(img, o.x, oy, o.w, o.h);
            }
          } else {
            ctx.drawImage(img, o.x, oy, o.w, o.h);
          }
        }

        for (const p of s.powerups) {
          if (p.taken) continue;
          const imgs = imagesRef.current;
          const icon = p.kind === "rainbow" ? imgs.rainbow : p.kind === "double" ? imgs.star : imgs.shield;
          const size = 52;
          const cx = p.x + 22;
          const cy = p.y + 22;
          if (icon) {
            ctx.drawImage(icon, cx - size / 2, cy - size / 2, size, size);
          }
        }


        const rainbow = s.t < s.rainbowUntil;
        if (phaseRef.current === "idle") {
          // Shelldon sits in the empty cup of the carton illustration and wiggles in place.
          const tt = s.t;
          const cycle = (tt % 3200) / 3200;
          const excitement = Math.pow(Math.sin(cycle * Math.PI), 2);
          const slowSway = Math.sin(tt * 0.0022);
          const fastSway = Math.sin(tt * 0.0085);
          // Tight horizontal sway so he stays inside his cup.
          let dx = slowSway * 1.2 + fastSway * 0.8 * excitement;
          dx = Math.max(-2, Math.min(2, dx));
          // Small, contained hops.
          const hop = Math.max(0, Math.sin(tt * (0.006 + excitement * 0.006)));
          let dy = -hop * (1 + excitement * 1.5);
          const bounceBeat = (tt % 4500) / 4500;
          if (bounceBeat > 0.92) {
            const k = (bounceBeat - 0.92) / 0.08;
            dy -= Math.sin(k * Math.PI) * 2.5;
          }
          const rot = slowSway * 0.03 + fastSway * 0.02 * excitement;
          const breath = 1 + Math.sin(tt * 0.004) * 0.025;
          // Empty-cup center in the carton illustration, mapped to canvas space.
          const cupX = 144 + dx;
          const cupY = 389 + dy;
          ctx.save();
          ctx.translate(cupX, cupY);
          ctx.scale(breath, 2 - breath);
          drawEgg(ctx, 0, 0, rot, rainbow);
          ctx.restore();
        } else {
          drawEgg(ctx, 145, s.eggY, s.rotation, rainbow);
        }
      }

      if (s.flash > 0) {
        ctx.fillStyle = `rgba(${s.flashColor},${s.flash * 0.5})`;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ready, beep, highScore]);

  // Buff bar shrink ticker
  const [, force] = useState(0);
  useEffect(() => {
    if (!activeBuff) return;
    const id = setInterval(() => force((n) => n + 1), 100);
    const end = setTimeout(() => setActiveBuff(null), Math.max(0, activeBuff.until - stateRef.current.t));
    return () => { clearInterval(id); clearTimeout(end); };
  }, [activeBuff]);
  const buffRemaining = activeBuff ? Math.max(0, activeBuff.until - stateRef.current.t) : 0;
  const buffPct = activeBuff ? (buffRemaining / activeBuff.total) * 100 : 0;

  const cfg = DIFFICULTY_CFG[difficulty];
  const goInfo = GAME_OVER_COPY[gameOverKind];

  const goImg = GAME_OVER_IMG[gameOverKind];

  return (
    <div className="relative w-full max-w-[1280px] mx-auto">
      <div ref={containerRef} data-phase={phase} className="relative rounded-3xl shadow-2xl border-4 border-amber-900/30 bg-amber-50">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="block w-full h-auto cursor-pointer select-none touch-none rounded-3xl"
          style={{ aspectRatio: `${W} / ${H}` }}
        />


        {!ready && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-amber-50/90 pointer-events-none">
            <p className="text-amber-900 font-bold text-lg animate-pulse">Loading game assets…</p>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center rounded-3xl bg-amber-50 px-6 text-center pointer-events-none">
            <p className="text-amber-900 font-bold text-sm max-w-md">
              Could not load game images. Stop the dev server, run <code className="font-mono text-xs bg-white px-1 rounded">bun run dev</code> again from the project folder, then refresh.
            </p>
          </div>
        )}

        <div className="absolute top-3 right-4 flex flex-col items-center gap-1 pointer-events-none">
          <div className="px-4 py-1 rounded-full bg-amber-900/80 text-amber-50 font-bold text-xl tabular-nums shadow-lg">
            {String(score).padStart(4, "0")}
          </div>
          <div className="text-xs text-amber-900/80 font-semibold">HI {String(highScore).padStart(4, "0")}</div>
          {activeBuff && (
            <div className="mt-1 px-3 py-1 rounded-full bg-white/90 text-amber-900 text-sm font-bold shadow flex flex-col items-stretch min-w-[140px]">
              <span className="text-center">{activeBuff.label}</span>
              <div className="h-1 bg-amber-200 rounded-full mt-1 overflow-hidden">
                <div className="h-full bg-amber-600 transition-all" style={{ width: `${buffPct}%` }} />
              </div>
            </div>
          )}
          {shieldReady && (
            <div className="mt-1 px-3 py-1 rounded-full bg-white/90 text-sky-900 text-sm font-bold shadow flex items-center justify-center min-w-[140px] ring-2 ring-sky-300 animate-pulse">
              <span className="text-center">🛡 Shell shield</span>
            </div>
          )}
        </div>

        {milestone && (
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full bg-amber-500 text-white font-black text-2xl shadow-2xl animate-bounce pointer-events-none">
            {milestone}
          </div>
        )}

        <div className="absolute top-3 left-4 flex gap-2 items-center">
          <button
            onClick={() => setMuted((m) => !m)}
            className="w-9 h-9 rounded-full bg-amber-900/70 hover:bg-amber-900 text-white text-lg flex items-center justify-center shadow-lg"
            aria-label="Toggle sound"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          {phase === "idle" && (
            <div className="flex bg-white/90 rounded-full shadow-lg overflow-hidden text-sm font-bold border-2 border-amber-900/20">
              <button
                onClick={() => { setDifficulty("easy"); try { localStorage.setItem("eggscape:diff", "easy"); } catch {} }}
                className={`px-3 py-1 ${difficulty === "easy" ? "bg-amber-500 text-white" : "text-amber-900"}`}
              >
                Easy 🐣
              </button>
              <button
                onClick={() => { setDifficulty("normal"); try { localStorage.setItem("eggscape:diff", "normal"); } catch {} }}
                className={`px-3 py-1 ${difficulty === "normal" ? "bg-amber-500 text-white" : "text-amber-900"}`}
              >
                Hard 🔥
              </button>
            </div>
          )}
        </div>

        {phase === "idle" && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-5 py-2 rounded-full bg-amber-900/80 text-amber-50 text-sm font-bold shadow-lg pointer-events-none">
            Press <kbd className="px-2 py-0.5 mx-1 rounded bg-white text-amber-900 text-xs font-black">SPACE</kbd> to jump out of the carton
          </div>
        )}

        {phase === "gameover" && (
          <div className="absolute left-0 right-0 top-0 min-h-full flex items-center justify-center bg-black/40 backdrop-blur-sm p-2 sm:p-3 rounded-3xl">
            <div className="text-center bg-white rounded-2xl sm:rounded-3xl shadow-2xl border-4 border-red-400 w-[min(440px,94%)] flex flex-col items-center px-3 py-3 sm:px-6 sm:py-5 gap-2 sm:gap-3 my-2">

              <div className="shrink-0 w-full flex items-center justify-center">
                <img
                  src={goImg}
                  alt={goInfo.title}
                  className="block w-auto max-w-[70%] object-contain h-24 sm:h-32 md:h-40 lg:h-44"
                />
              </div>

              <div className="shrink-0 flex flex-col items-center gap-0.5">
                <h2 className="text-lg sm:text-2xl md:text-3xl font-black text-red-500 tracking-tight leading-none">
                  {goInfo.title}
                </h2>
                <p className="text-amber-800 text-xs sm:text-sm leading-tight">{goInfo.sub}</p>
              </div>
              <div className="shrink-0 grid grid-cols-2 gap-6 text-amber-900 w-full max-w-[260px]">
                <div>
                  <div className="text-[9px] sm:text-[10px] uppercase tracking-wider opacity-70">Score</div>
                  <div className="text-base sm:text-2xl font-black tabular-nums leading-none">{score}</div>
                </div>
                <div>
                  <div className="text-[9px] sm:text-[10px] uppercase tracking-wider opacity-70">Best</div>
                  <div className="text-base sm:text-2xl font-black tabular-nums leading-none">{highScore}</div>
                </div>
              </div>
              <button
                onClick={() => { resetGame(); setPhase("idle"); }}
                className="shrink-0 px-5 sm:px-7 py-1.5 sm:py-2 rounded-full bg-amber-500 hover:bg-amber-400 text-white font-black text-sm sm:text-base shadow-lg transition-transform hover:scale-105"
              >
                Try again
              </button>
            </div>
          </div>
        )}




        {phase === "victory" && (
          <div className="absolute left-0 right-0 top-0 min-h-full flex items-center justify-center bg-gradient-to-br from-amber-200/90 to-orange-300/90 backdrop-blur-sm p-2 sm:p-3 rounded-3xl">
            <div className="text-center bg-white rounded-2xl sm:rounded-3xl shadow-2xl border-4 border-amber-400 w-[min(440px,94%)] flex flex-col px-4 py-3 sm:px-6 sm:py-5 my-2">

              <div className="flex-1 min-h-0 flex items-center justify-center mb-2 text-7xl sm:text-8xl animate-bounce leading-none">
                🐣
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-amber-700 tracking-tight leading-tight mb-1">
                You Escaped Breakfast!
              </h2>
              <p className="text-amber-800 text-sm mb-3">
                Shelldon found the nest. A new chick is born — free at last.
              </p>
              <div className="mb-3 text-amber-900">
                <div className="text-[10px] uppercase tracking-wider opacity-70">Final score</div>
                <div className="text-2xl sm:text-3xl font-black tabular-nums">{score}</div>
              </div>
              <button
                onClick={() => { resetGame(); setPhase("idle"); }}
                className="self-center px-7 py-2 rounded-full bg-amber-500 hover:bg-amber-400 text-white font-black text-base shadow-lg transition-transform hover:scale-105"
              >
                Run again
              </button>
            </div>
          </div>
        )}

      </div>

      <div className="mt-4 text-center text-amber-900/70 text-sm">
        <span className="font-bold">Controls:</span> SPACE / ↑ / tap to jump (hold for higher) · M to mute
      </div>

    </div>
  );
}
