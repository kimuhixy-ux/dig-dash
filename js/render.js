// 描画だけを担当する。ゲーム状態は読むだけで書き換えない。
import { tileAt, isHole, entityPos, REFILL_TICKS, DIG_TICKS } from './game.js';

const PALETTES = {
  dark: {
    bg: '#0d1020', brick: '#b8562e', brickHi: '#d9744a', mortar: '#5a2412',
    steel: '#5d6b82', steelHi: '#8a99b3', steelLo: '#363f50', ladder: '#e8c872',
    bar: '#cfd6e6', gold: '#ffcf33', goldHi: '#fff4b8', goldLo: '#b8860b',
    hole: '#05060c', player: '#7df9ff', enemy: '#ff4f7b', enemyEye: '#fff36b',
    exit: '#7dff9a', trapMark: 'rgba(255,255,255,0.55)'
  },
  light: {
    bg: '#eef1f8', brick: '#c0643a', brickHi: '#dd8458', mortar: '#7a3317',
    steel: '#7c879b', steelHi: '#a9b4c8', steelLo: '#4c5566', ladder: '#9a6a12',
    bar: '#4a5468', gold: '#e8a800', goldHi: '#fff1a8', goldLo: '#9a6a00',
    hole: '#1b1d29', player: '#0077cc', enemy: '#d81b4a', enemyEye: '#ffe14d',
    exit: '#159a3c', trapMark: 'rgba(0,0,0,0.5)'
  }
};

export function currentPalette() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? PALETTES.dark : PALETTES.light;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const state = { ts: 16, particles: [], shake: 0 };

  function fit(cols, rows, maxW, maxH) {
    const ts = Math.max(8, Math.floor(Math.min(maxW / cols, maxH / rows)));
    const dpr = window.devicePixelRatio || 1;
    state.ts = ts;
    canvas.style.width = `${cols * ts}px`;
    canvas.style.height = `${rows * ts}px`;
    canvas.width = Math.round(cols * ts * dpr);
    canvas.height = Math.round(rows * ts * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ts;
  }

  function draw(g, opts = {}) {
    const pal = currentPalette();
    const ts = state.ts;
    ctx.save();
    applyShake(ctx, state);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(-ts, -ts, (g.w + 2) * ts, (g.h + 2) * ts);
    drawTiles(ctx, g, ts, pal, opts);
    drawGold(ctx, g, ts, pal, opts.time || 0);
    if (opts.ghost) drawGhost(ctx, opts.ghost, ts, pal);
    drawEntities(ctx, g, ts, pal, opts);
    drawParticles(ctx, state, ts);
    if (opts.editMode && g.w > 1) drawGrid(ctx, g, ts);
    ctx.restore();
  }

  function burst(kind, c, r) {
    const pal = currentPalette();
    const colors = { gold: pal.gold, dig: pal.brickHi, kill: pal.enemy, death: pal.player, reveal: pal.exit };
    const n = kind === 'death' ? 40 : kind === 'kill' ? 24 : 14;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.03 + Math.random() * 0.09;
      state.particles.push({
        x: c + 0.5, y: r + 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.04,
        life: 30 + Math.random() * 25, color: colors[kind] || pal.gold
      });
    }
    if (kind === 'death') state.shake = 14;
  }

  return { fit, draw, burst, get tileSize() { return state.ts; } };
}

function drawGrid(ctx, g, ts) {
  ctx.strokeStyle = 'rgba(128,128,160,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < g.w; c++) { ctx.moveTo(c * ts + 0.5, 0); ctx.lineTo(c * ts + 0.5, g.h * ts); }
  for (let r = 1; r < g.h; r++) { ctx.moveTo(0, r * ts + 0.5); ctx.lineTo(g.w * ts, r * ts + 0.5); }
  ctx.stroke();
}

function applyShake(ctx, state) {
  if (state.shake <= 0) return;
  const s = state.shake * 0.4;
  ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  state.shake--;
}

// ---- タイル ----

function drawTiles(ctx, g, ts, pal, opts) {
  for (let r = 0; r < g.h; r++) {
    for (let c = 0; c < g.w; c++) {
      const raw = g.tiles[r * g.w + c];
      const x = c * ts;
      const y = r * ts;
      if (raw === '#' || raw === 'X') drawBrickCell(ctx, g, c, r, ts, pal, raw === 'X' && opts.editMode);
      else if (raw === '=') drawSteel(ctx, x, y, ts, pal);
      else if (raw === 'H') drawLadder(ctx, x, y, ts, pal.ladder, 1);
      else if (raw === '-') drawBar(ctx, x, y, ts, pal);
      else if (raw === 'S') drawHiddenLadder(ctx, g, c, r, ts, pal, opts);
    }
  }
}

function drawBrickCell(ctx, g, c, r, ts, pal, markTrap) {
  const x = c * ts;
  const y = r * ts;
  const d = g.digging;
  if (d && d.c === c && d.r === r) {
    // 掘っている途中は上から少しずつ崩れていくように見せる
    const k = Math.min(1, d.t / DIG_TICKS);
    drawBrick(ctx, x, y + ts * k, ts, ts * (1 - k), pal);
    return;
  }
  if (isHole(g, c, r)) {
    const left = g.holes[r * g.w + c];
    ctx.fillStyle = pal.hole;
    ctx.fillRect(x, y, ts, ts);
    if (left < REFILL_TICKS) {
      const k = 1 - left / REFILL_TICKS;
      drawBrick(ctx, x, y + ts * (1 - k), ts, ts * k, pal);
    }
    return;
  }
  drawBrick(ctx, x, y, ts, ts, pal);
  if (markTrap) {
    ctx.fillStyle = pal.trapMark;
    ctx.font = `bold ${Math.floor(ts * 0.6)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + ts / 2, y + ts / 2 + 1);
  }
}

function drawBrick(ctx, x, y, w, h, pal) {
  if (h <= 0) return;
  ctx.fillStyle = pal.brick;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const top = y + h - w;
  ctx.fillStyle = pal.brickHi;
  ctx.fillRect(x, top, w, Math.max(1, w * 0.08));
  ctx.fillStyle = pal.mortar;
  const lw = Math.max(1, w * 0.07);
  ctx.fillRect(x, top + w * 0.47, w, lw);
  ctx.fillRect(x, top + w - lw, w, lw);
  ctx.fillRect(x + w * 0.5, top, lw, w * 0.47);
  ctx.fillRect(x + w * 0.2, top + w * 0.5, lw, w * 0.5);
  ctx.fillRect(x + w * 0.75, top + w * 0.5, lw, w * 0.5);
  ctx.restore();
}

function drawSteel(ctx, x, y, ts, pal) {
  const b = Math.max(1, ts * 0.12);
  ctx.fillStyle = pal.steelLo;
  ctx.fillRect(x, y, ts, ts);
  ctx.fillStyle = pal.steelHi;
  ctx.fillRect(x, y, ts - b, ts - b);
  ctx.fillStyle = pal.steel;
  ctx.fillRect(x + b, y + b, ts - b * 2, ts - b * 2);
  ctx.fillStyle = pal.steelLo;
  const rv = Math.max(1, ts * 0.1);
  ctx.fillRect(x + b * 1.5, y + b * 1.5, rv, rv);
  ctx.fillRect(x + ts - b * 1.5 - rv, y + ts - b * 1.5 - rv, rv, rv);
}

function drawLadder(ctx, x, y, ts, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const lw = Math.max(1.5, ts * 0.1);
  ctx.fillRect(x + ts * 0.18, y, lw, ts);
  ctx.fillRect(x + ts * 0.82 - lw, y, lw, ts);
  for (const k of [0.15, 0.48, 0.81]) ctx.fillRect(x + ts * 0.18, y + ts * k, ts * 0.64, lw);
  ctx.restore();
}

function drawBar(ctx, x, y, ts, pal) {
  ctx.fillStyle = pal.bar;
  ctx.fillRect(x, y + ts * 0.12, ts, Math.max(1.5, ts * 0.08));
}

function drawHiddenLadder(ctx, g, c, r, ts, pal, opts) {
  const x = c * ts;
  const y = r * ts;
  if (opts.editMode) {
    drawLadder(ctx, x, y, ts, pal.exit, 0.45);
    return;
  }
  if (!g.revealed) return;
  // 出現直後は下から順に光りながら伸びる
  const age = opts.revealAge ?? 999;
  const k = Math.max(0, Math.min(1, (age - (g.h - r) * 2) / 12));
  if (k <= 0) return;
  drawLadder(ctx, x, y, ts, pal.exit, k);
  if (r === 0) drawExitArrow(ctx, x, ts, pal, opts.time || 0);
}

function drawExitArrow(ctx, x, ts, pal, time) {
  const bob = Math.sin(time / 8) * ts * 0.12;
  ctx.fillStyle = pal.exit;
  ctx.beginPath();
  ctx.moveTo(x + ts * 0.5, bob + ts * 0.02);
  ctx.lineTo(x + ts * 0.85, bob + ts * 0.4);
  ctx.lineTo(x + ts * 0.15, bob + ts * 0.4);
  ctx.closePath();
  ctx.fill();
}

// ---- 金塊 ----

function drawGold(ctx, g, ts, pal, time) {
  for (let i = 0; i < g.gold.length; i++) {
    if (!g.gold[i]) continue;
    const c = i % g.w;
    const r = Math.floor(i / g.w);
    drawIngot(ctx, c * ts, r * ts, ts, pal, time + i * 7);
  }
}

function drawIngot(ctx, x, y, ts, pal, phase) {
  const top = y + ts * 0.55;
  const bot = y + ts * 0.92;
  ctx.fillStyle = pal.goldLo;
  ctx.beginPath();
  ctx.moveTo(x + ts * 0.1, bot);
  ctx.lineTo(x + ts * 0.9, bot);
  ctx.lineTo(x + ts * 0.75, top);
  ctx.lineTo(x + ts * 0.25, top);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pal.gold;
  ctx.fillRect(x + ts * 0.27, top + ts * 0.04, ts * 0.46, ts * 0.12);
  const glint = (phase % 90) / 90;
  if (glint < 0.25) {
    ctx.fillStyle = pal.goldHi;
    const gx = x + ts * (0.25 + glint * 2);
    ctx.fillRect(gx, top + ts * 0.03, ts * 0.08, ts * 0.3);
  }
}

// ---- キャラクター ----

function drawEntities(ctx, g, ts, pal, opts) {
  for (const e of g.enemies) {
    if (e.mode === 'dead') continue;
    if (e.mode === 'wait' && e.wait > 25 && Math.floor(e.wait / 4) % 2) continue;
    const pos = entityPos(e);
    const shake = e.mode === 'trapped' && e.wait < 40 ? Math.sin(e.wait) * ts * 0.05 : 0;
    drawRunner(ctx, pos.x * ts + shake, pos.y * ts, ts, pal.enemy, poseOf(g, e), e, true);
    if (e.carry) drawIngot(ctx, pos.x * ts + ts * 0.2, pos.y * ts - ts * 0.5, ts * 0.6, pal, 0);
  }
  const p = g.player;
  if (p.mode === 'dead' && !opts.showDead) return;
  const pos = entityPos(p);
  drawRunner(ctx, pos.x * ts, pos.y * ts, ts, pal.player, poseOf(g, p), p, false);
}

function drawGhost(ctx, ghost, ts, pal) {
  ctx.save();
  ctx.globalAlpha = 0.3;
  const fake = { anim: ghost.f, facing: ghost.d, t: 0, dur: 1 };
  drawRunner(ctx, ghost.x * ts, ghost.y * ts, ts, pal.player, ghost.pose || 'run', fake, false);
  ctx.restore();
}

export function poseOf(g, e) {
  if (e.mode === 'trapped') return 'trapped';
  if (e.mode === 'dig') return 'dig';
  if (e.mode === 'fall') return 'fall';
  const here = tileAt(g, e.c, e.r);
  if (here === '-' && e.fr === e.r) return 'hang';
  if (e.fr !== e.r || (here === 'H' && e.mode !== 'move')) return 'climb';
  if (e.mode === 'move') return 'run';
  return 'stand';
}

// 棒人間を太い線で描く。ポーズごとに手足の角度だけを変えれば済むので、画像素材が要らない。
function drawRunner(ctx, x, y, ts, color, pose, ent, isEnemy) {
  const s = ts;
  const ph = (ent.anim || 0) / 5;
  const swing = Math.sin(ph);
  const f = ent.facing || 1;
  const limbs = limbsFor(pose, swing, f);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, s * 0.13);
  const P = (px, py) => [x + px * s, y + py * s];
  line(ctx, P(0.5, 0.36), P(0.5, 0.62));
  for (const [ax, ay] of limbs.arms) line(ctx, P(0.5, 0.42), P(ax, ay));
  for (const [lx, ly] of limbs.legs) line(ctx, P(0.5, 0.62), P(lx, ly));
  ctx.beginPath();
  ctx.arc(x + s * 0.5, y + s * 0.22, s * 0.14, 0, Math.PI * 2);
  ctx.fill();
  if (isEnemy) drawVisor(ctx, x, y, s, f);
  ctx.restore();
}

function drawVisor(ctx, x, y, s, f) {
  ctx.fillStyle = currentPalette().enemyEye;
  ctx.fillRect(x + s * (f > 0 ? 0.5 : 0.36), y + s * 0.18, s * 0.14, s * 0.06);
}

function limbsFor(pose, sw, f) {
  switch (pose) {
    case 'run':
      return { arms: [[0.5 + 0.2 * sw, 0.55], [0.5 - 0.2 * sw, 0.55]],
        legs: [[0.5 + 0.22 * sw, 0.96], [0.5 - 0.22 * sw, 0.96]] };
    case 'climb':
      return { arms: [[0.3, 0.2 + 0.1 * sw], [0.7, 0.2 - 0.1 * sw]],
        legs: [[0.32, 0.9 - 0.08 * sw], [0.68, 0.9 + 0.08 * sw]] };
    case 'hang':
      return { arms: [[0.4 + 0.05 * sw, 0.12], [0.6 + 0.05 * sw, 0.12]],
        legs: [[0.45, 0.96], [0.55 + 0.05 * sw, 0.94]] };
    case 'fall':
      return { arms: [[0.18, 0.2], [0.82, 0.2]], legs: [[0.3, 0.92], [0.7, 0.92]] };
    case 'trapped':
      return { arms: [[0.25, 0.1 + 0.05 * sw], [0.75, 0.1 - 0.05 * sw]], legs: [[0.4, 0.96], [0.6, 0.96]] };
    case 'dig':
      return { arms: [[0.5 + 0.4 * f, 0.85], [0.5 + 0.3 * f, 0.75]], legs: [[0.38, 0.96], [0.62, 0.96]] };
    default:
      return { arms: [[0.32, 0.6], [0.68, 0.6]], legs: [[0.4, 0.96], [0.6, 0.96]] };
  }
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

function drawParticles(ctx, state, ts) {
  const alive = [];
  for (const p of state.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.004;
    p.life--;
    if (p.life <= 0) continue;
    ctx.globalAlpha = Math.min(1, p.life / 20);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x * ts - 2, p.y * ts - 2, Math.max(2, ts * 0.12), Math.max(2, ts * 0.12));
    alive.push(p);
  }
  ctx.globalAlpha = 1;
  state.particles = alive;
}
