// 描画だけを担当する。ゲーム状態は読むだけで書き換えない。
import { tileAt, isHole, entityPos, REFILL_TICKS, DIG_TICKS } from './game.js';

const PALETTES = {
  dark: {
    bg: '#0d1020', brick: '#b8562e', brickHi: '#d9744a', mortar: '#5a2412',
    steel: '#5d6b82', steelHi: '#8a99b3', steelLo: '#363f50', ladder: '#e8c872',
    bar: '#cfd6e6', gold: '#ffcf33', goldHi: '#fff4b8', goldLo: '#b8860b',
    hole: '#05060c', player: '#7df9ff', enemy: '#ff4f7b', enemyEye: '#fff36b',
    exit: '#7dff9a', trapMark: 'rgba(255,255,255,0.55)',
    hat: '#ffb02e', glove: '#ffffff', shoe: '#a0612e', eyeWhite: '#ffffff', pupil: '#14161f',
    cheek: 'rgba(255,110,150,0.7)', mouth: '#2a0f18'
  },
  light: {
    bg: '#eef1f8', brick: '#c0643a', brickHi: '#dd8458', mortar: '#7a3317',
    steel: '#7c879b', steelHi: '#a9b4c8', steelLo: '#4c5566', ladder: '#9a6a12',
    bar: '#4a5468', gold: '#e8a800', goldHi: '#fff1a8', goldLo: '#9a6a00',
    hole: '#1b1d29', player: '#0077cc', enemy: '#d81b4a', enemyEye: '#ffe14d',
    exit: '#159a3c', trapMark: 'rgba(0,0,0,0.5)',
    hat: '#f29d00', glove: '#ffffff', shoe: '#7a4520', eyeWhite: '#ffffff', pupil: '#14161f',
    cheek: 'rgba(255,90,130,0.6)', mouth: '#2a0f18'
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

// 丸い体に短い手足のひょうきんな2頭身キャラ。画像素材を使わず図形だけで描くので、著作権の心配がない。
function drawRunner(ctx, x, y, ts, color, pose, ent, isEnemy) {
  const s = ts;
  const swing = Math.sin((ent.anim || 0) / 5);
  const f = ent.facing || 1;
  const pal = currentPalette();
  const limbs = limbsFor(pose, swing, f);
  const bob = pose === 'run' ? Math.abs(swing) * s * 0.04 : 0;
  const P = (px, py) => [x + px * s, y + py * s - bob];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.09);
  // 脚は体の後ろ、腕は体の前に描くと、付け根を隠しつつ手の動きがよく見える。
  limbs.legs.forEach(([lx, ly], i) => {
    const foot = [x + lx * s, y + (ly - 0.04) * s];
    line(ctx, P(i ? 0.6 : 0.4, 0.68), foot);
    dot(ctx, foot, s * 0.075, pal.shoe);
  });
  dot(ctx, P(0.5, 0.5), s * 0.27, color);
  const face = { cx: x + s * 0.5, cy: y + s * 0.5 - bob, s, f, pose, pal };
  // 顔の描画で線の色や太さを変えるので、腕を描く前に元へ戻す。
  ctx.save();
  if (isEnemy) drawEnemyFace(ctx, face, swing, color); else drawPlayerFace(ctx, face);
  ctx.restore();
  for (const [ax, ay] of limbs.arms) {
    line(ctx, P(ax < 0.5 ? 0.27 : 0.73, 0.6), P(ax, ay));
    dot(ctx, P(ax, ay), s * 0.07, pal.glove);
  }
  ctx.restore();
}

function drawPlayerFace(ctx, { cx, cy, s, f, pose, pal }) {
  ctx.fillStyle = pal.hat;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.1, s * 0.25, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - s * 0.27 + s * 0.06 * f, cy - s * 0.12, s * 0.54, s * 0.06);
  dot(ctx, [cx + s * 0.1 * f, cy - s * 0.27], s * 0.05, pal.goldHi);
  drawEyes(ctx, cx + s * 0.05 * f, cy + s * 0.02, s, f, pose, pal.eyeWhite, pal);
  dot(ctx, [cx + s * 0.19 * f, cy + s * 0.12], s * 0.045, pal.cheek);
  ctx.fillStyle = pal.mouth;
  ctx.beginPath();
  if (pose === 'fall' || pose === 'trapped') ctx.arc(cx + s * 0.06 * f, cy + s * 0.15, s * 0.045, 0, Math.PI * 2);
  else ctx.arc(cx + s * 0.06 * f, cy + s * 0.08, s * 0.085, 0, Math.PI);
  ctx.fill();
}

function drawEnemyFace(ctx, { cx, cy, s, f, pose, pal }, swing, color) {
  const tip = [cx + s * 0.06 * swing, cy - s * 0.42];
  line(ctx, [cx, cy - s * 0.25], tip);
  dot(ctx, tip, s * 0.06, color);
  const sad = pose === 'trapped';
  drawEyes(ctx, cx + s * 0.04 * f, cy - s * 0.04, s, f, pose, pal.enemyEye, pal);
  ctx.strokeStyle = pal.mouth;
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  for (const side of [-1, 1]) {
    const ex = cx + s * 0.04 * f + side * s * 0.1;
    const inner = sad ? -0.17 : -0.12;
    line(ctx, [ex - side * s * 0.02, cy + s * inner], [ex + side * s * 0.09, cy + s * (sad ? -0.12 : -0.19)]);
  }
  ctx.beginPath();
  if (sad) {
    for (let i = 0; i <= 6; i++) ctx.lineTo(cx - s * 0.12 + i * s * 0.04, cy + s * (0.13 + ((i % 2) ? -0.025 : 0.025)));
    ctx.stroke();
    return;
  }
  // 大口に出っ歯1本。怖さより間の抜けた感じを出すため。
  ctx.fillStyle = pal.mouth;
  ctx.ellipse(cx + s * 0.04 * f, cy + s * 0.08, s * 0.12, s * 0.09, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = pal.eyeWhite;
  ctx.fillRect(cx + s * 0.04 * f - s * 0.035, cy + s * 0.08, s * 0.07, s * 0.05);
}

// 目は大きな白目と、進む向きに寄せた黒目。はしごでは上を見て、どこへ行くかが一目で分かる。
function drawEyes(ctx, cx, cy, s, f, pose, white, pal) {
  const look = pose === 'climb' || pose === 'hang' ? [0, -0.03] : pose === 'fall' ? [0, 0.03] : [0.03 * f, 0];
  for (const side of [-1, 1]) {
    const ex = cx + side * s * 0.09;
    dot(ctx, [ex, cy], s * 0.075, white);
    dot(ctx, [ex + look[0] * s, cy + look[1] * s], s * 0.038, pal.pupil);
  }
}

function limbsFor(pose, sw, f) {
  switch (pose) {
    case 'run':
      return { arms: [[0.86, 0.56 + 0.12 * sw], [0.14, 0.56 - 0.12 * sw]],
        legs: [[0.5 - 0.2 * sw, 0.98], [0.5 + 0.2 * sw, 0.98]] };
    case 'climb':
      return { arms: [[0.18, 0.2 + 0.1 * sw], [0.82, 0.2 - 0.1 * sw]],
        legs: [[0.34, 0.94 - 0.06 * sw], [0.66, 0.94 + 0.06 * sw]] };
    case 'hang':
      return { arms: [[0.36 + 0.04 * sw, 0.08], [0.64 + 0.04 * sw, 0.08]],
        legs: [[0.42, 0.98], [0.58 + 0.05 * sw, 0.96]] };
    case 'fall':
      return { arms: [[0.08, 0.16 + 0.06 * sw], [0.92, 0.16 - 0.06 * sw]], legs: [[0.28, 0.96], [0.72, 0.92]] };
    case 'trapped':
      return { arms: [[0.14, 0.12 + 0.06 * sw], [0.86, 0.12 - 0.06 * sw]], legs: [[0.4, 0.98], [0.6, 0.98]] };
    case 'dig':
      return { arms: [[0.5 + 0.42 * f, 0.86], [0.5 + 0.34 * f, 0.78]], legs: [[0.38, 0.98], [0.62, 0.98]] };
    default:
      return { arms: [[0.12, 0.68], [0.88, 0.68]], legs: [[0.4, 0.98], [0.6, 0.98]] };
  }
}

function dot(ctx, [px, py], radius, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fill();
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
