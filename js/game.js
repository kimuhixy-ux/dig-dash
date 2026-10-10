// ゲームのルールだけを扱う。DOMに触れない純粋なデータ操作にしておくと、
// 巻き戻し用のスナップショット(状態のコピー)やNodeでの自動テストがそのまま使える。

export const TICK_RATE = 60;
export const HOLE_TICKS = 330;
export const REFILL_TICKS = 45;
export const DIG_TICKS = 14;

const PLAYER_STEP = 8;
const ENEMY_STEP = 14;
const FALL_STEP = 5;
const ENEMY_FALL_STEP = 7;
const TRAP_TICKS = 150;
const RESPAWN_TICKS = 90;

export function createGame(level, seed = 12345) {
  const h = level.map.length;
  const w = level.map[0].length;
  const g = {
    w, h, tiles: [], gold: [], holes: new Array(w * h).fill(0),
    digging: null, player: null, enemies: [], goldLeft: 0,
    revealed: false, tick: 0, seed, status: 'play', events: []
  };
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      placeCell(g, level.map[r][c], c, r);
    }
  }
  if (!g.player) g.player = makeEntity(0, 0);
  if (g.goldLeft === 0) g.revealed = true;
  return g;
}

function placeCell(g, ch, c, r) {
  g.gold.push(ch === '$' ? 1 : 0);
  g.tiles.push('#=H-XS'.includes(ch) ? ch : ' ');
  if (ch === '$') g.goldLeft++;
  if (ch === 'P') g.player = makeEntity(c, r);
  if (ch === 'E') {
    const e = makeEntity(c, r);
    Object.assign(e, { carry: 0, dropIn: 0, wait: 30, mode: 'wait', escaping: false, sc: c, sr: r });
    g.enemies.push(e);
  }
}

function makeEntity(c, r) {
  return { c, r, fc: c, fr: r, t: 1, dur: 1, mode: 'idle', facing: 1, anim: 0 };
}

// 乱数を状態の中に持たせる。巻き戻すと乱数も戻るので、同じ操作なら同じ展開になる。
function rand(g) {
  g.seed = (g.seed + 0x6D2B79F5) | 0;
  let t = g.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const inBounds = (g, c, r) => c >= 0 && c < g.w && r >= 0 && r < g.h;
const idx = (g, c, r) => r * g.w + c;

export function tileAt(g, c, r) {
  if (!inBounds(g, c, r)) return '=';
  const t = g.tiles[idx(g, c, r)];
  if (t === 'S') return g.revealed ? 'H' : ' ';
  return t;
}

export function isHole(g, c, r) {
  return inBounds(g, c, r) && g.holes[idx(g, c, r)] > 0;
}

function canEnter(g, c, r) {
  const t = tileAt(g, c, r);
  if (t === '=') return false;
  return t !== '#' || isHole(g, c, r);
}

// 経路計画では穴を「まだレンガがある」とみなす。だから敵は穴の上を平気で歩き、落ちる。
function canEnterPlan(g, c, r) {
  const t = tileAt(g, c, r);
  return t !== '=' && t !== '#';
}

export function enemyAt(g, c, r, except) {
  return g.enemies.find((e) => e !== except && e.mode !== 'dead' && e.c === c && e.r === r);
}

function standsOn(g, c, r, self, planning) {
  if (r >= g.h - 1) return true;
  const here = tileAt(g, c, r);
  if (here === 'H' || here === '-') return true;
  const below = tileAt(g, c, r + 1);
  if (below === '=' || below === 'H') return true;
  if (below === '#') return planning || !isHole(g, c, r + 1);
  if (planning) return false;
  const e = enemyAt(g, c, r + 1, self);
  return Boolean(e && e.mode !== 'fall');
}

function startMove(ent, c, r, dur, mode) {
  if (c !== ent.c) ent.facing = c > ent.c ? 1 : -1;
  ent.fc = ent.c;
  ent.fr = ent.r;
  ent.c = c;
  ent.r = r;
  ent.t = 0;
  ent.dur = dur;
  ent.mode = mode;
}

export function entityPos(ent) {
  const k = ent.dur > 0 ? Math.min(1, ent.t / ent.dur) : 1;
  return { x: ent.fc + (ent.c - ent.fc) * k, y: ent.fr + (ent.r - ent.fr) * k };
}

export function step(g, input) {
  if (g.status !== 'play') return;
  g.tick++;
  updateHoles(g);
  updatePlayer(g, input);
  for (const e of g.enemies) updateEnemy(g, e);
  checkCollision(g);
}

function updateHoles(g) {
  for (let i = 0; i < g.holes.length; i++) {
    if (g.holes[i] <= 0) continue;
    g.holes[i]--;
    if (g.holes[i] > 0) continue;
    const c = i % g.w;
    const r = Math.floor(i / g.w);
    const p = g.player;
    if (p.c === c && p.r === r) killPlayer(g);
    for (const e of g.enemies) {
      if (e.mode !== 'dead' && e.c === c && e.r === r) killEnemy(g, e);
    }
  }
}

// ---- プレイヤー ----

function updatePlayer(g, input) {
  const p = g.player;
  if (p.mode === 'dead') return;
  p.anim++;
  if (p.mode === 'move' || p.mode === 'fall') {
    p.t++;
    if (p.t < p.dur) return;
    arrivePlayer(g, p);
    if (g.status !== 'play') return;
  }
  if (p.mode === 'dig') {
    p.t++;
    if (!updateDig(g, p)) return;
  }
  decidePlayer(g, p, input);
}

function arrivePlayer(g, p) {
  p.mode = 'idle';
  p.fc = p.c;
  p.fr = p.r;
  const i = idx(g, p.c, p.r);
  if (g.gold[i]) {
    g.gold[i] = 0;
    g.goldLeft--;
    g.events.push({ type: 'gold', c: p.c, r: p.r });
    if (g.goldLeft === 0) {
      g.revealed = true;
      g.events.push({ type: 'reveal' });
    }
  }
  if (g.goldLeft === 0 && p.r === 0) {
    g.status = 'clear';
    g.events.push({ type: 'clear' });
  }
}

// 掘っている最中に敵が穴の真上へ来たら中断する(元作品と同じく、敵の足元は掘れない)。
function updateDig(g, p) {
  const d = g.digging;
  if (!d) {
    p.mode = 'idle';
    return true;
  }
  if (enemyAt(g, d.c, d.r - 1)) {
    g.digging = null;
    p.mode = 'idle';
    return true;
  }
  d.t++;
  if (p.t < p.dur) return false;
  g.holes[idx(g, d.c, d.r)] = HOLE_TICKS;
  g.digging = null;
  p.mode = 'idle';
  return true;
}

function decidePlayer(g, p, input) {
  if (!standsOn(g, p.c, p.r, p, false)) {
    startMove(p, p.c, p.r + 1, FALL_STEP, 'fall');
    return;
  }
  // 掘るボタンは押した瞬間を予約として保持し、動ける状態になった最初の判定で必ず消費する。
  // 失敗しても残すと、ずっと後で勝手に掘ってしまうため。
  const dig = input.dig;
  input.dig = 0;
  if (dig && tryDig(g, p, dig)) return;
  const dir = input.dir;
  if (dir === 'left' || dir === 'right') {
    const dc = dir === 'left' ? -1 : 1;
    p.facing = dc;
    if (canEnter(g, p.c + dc, p.r)) startMove(p, p.c + dc, p.r, PLAYER_STEP, 'move');
  } else if (dir === 'up') {
    if (tileAt(g, p.c, p.r) === 'H' && canEnter(g, p.c, p.r - 1)) {
      startMove(p, p.c, p.r - 1, PLAYER_STEP, 'move');
    }
  } else if (dir === 'down') {
    movePlayerDown(g, p);
  }
}

function movePlayerDown(g, p) {
  if (!canEnter(g, p.c, p.r + 1)) return;
  const here = tileAt(g, p.c, p.r);
  const below = tileAt(g, p.c, p.r + 1);
  if (here === 'H' || below === 'H') {
    startMove(p, p.c, p.r + 1, PLAYER_STEP, 'move');
  } else if (here === '-') {
    startMove(p, p.c, p.r + 1, FALL_STEP, 'fall');
  }
}

function tryDig(g, p, dc) {
  const c = p.c + dc;
  const r = p.r + 1;
  p.facing = dc;
  if (tileAt(g, c, r) !== '#' || isHole(g, c, r)) return false;
  const above = tileAt(g, c, p.r);
  const aboveOpen = above === ' ' || (above === '#' && isHole(g, c, p.r));
  if (!aboveOpen || g.gold[idx(g, c, p.r)]) return false;
  if (enemyAt(g, c, p.r)) return false;
  p.mode = 'dig';
  p.t = 0;
  p.dur = DIG_TICKS;
  g.digging = { c, r, t: 0 };
  g.events.push({ type: 'dig', c, r });
  return true;
}

function killPlayer(g) {
  if (g.player.mode === 'dead') return;
  g.player.mode = 'dead';
  g.status = 'dead';
  g.events.push({ type: 'death', c: g.player.c, r: g.player.r });
}

function checkCollision(g) {
  const p = g.player;
  if (p.mode === 'dead') return;
  const pp = entityPos(p);
  for (const e of g.enemies) {
    if (e.mode === 'dead') continue;
    const ep = entityPos(e);
    if (Math.abs(ep.x - pp.x) < 0.6 && Math.abs(ep.y - pp.y) < 0.6) {
      killPlayer(g);
      return;
    }
  }
}

// ---- 敵 ----

function updateEnemy(g, e) {
  e.anim++;
  if (e.mode === 'dead') {
    if (--e.wait <= 0) respawnEnemy(g, e);
    return;
  }
  if (e.mode === 'trapped') {
    if (--e.wait <= 0) climbOut(g, e);
    return;
  }
  if (e.mode === 'wait') {
    if (--e.wait > 0) return;
    e.mode = 'idle';
  }
  if (e.mode === 'move' || e.mode === 'fall') {
    e.t++;
    if (e.t < e.dur) return;
    arriveEnemy(g, e);
    if (e.mode !== 'idle') return;
  }
  decideEnemy(g, e);
}

function arriveEnemy(g, e) {
  e.mode = 'idle';
  e.fc = e.c;
  e.fr = e.r;
  if (isHole(g, e.c, e.r) && !e.escaping) {
    e.mode = 'trapped';
    e.wait = TRAP_TICKS;
    g.events.push({ type: 'trap', c: e.c, r: e.r });
    dropGoldAbove(g, e);
    return;
  }
  handleEnemyGold(g, e);
}

function handleEnemyGold(g, e) {
  const i = idx(g, e.c, e.r);
  if (!e.carry && g.gold[i] && rand(g) < 0.6) {
    g.gold[i] = 0;
    e.carry = 1;
    e.dropIn = 6 + Math.floor(rand(g) * 20);
    return;
  }
  if (!e.carry) return;
  e.dropIn--;
  if (e.dropIn > 0 || g.gold[i] || tileAt(g, e.c, e.r) !== ' ') return;
  if (!standsOn(g, e.c, e.r, e, false)) return;
  g.gold[i] = 1;
  e.carry = 0;
}

// 穴に落ちた敵は持っている金塊を穴の上に置く。元作品の「穴で金を吐き出させる」駆け引きを残すため。
function dropGoldAbove(g, e) {
  if (!e.carry) return;
  const r = e.r - 1;
  if (r < 0 || tileAt(g, e.c, r) !== ' ' || g.gold[idx(g, e.c, r)]) return;
  g.gold[idx(g, e.c, r)] = 1;
  e.carry = 0;
}

function climbOut(g, e) {
  const r = e.r - 1;
  if (r < 0 || !canEnter(g, e.c, r) || enemyAt(g, e.c, r, e)) {
    e.wait = 20;
    return;
  }
  e.escaping = true;
  startMove(e, e.c, r, Math.round(ENEMY_STEP * 1.5), 'move');
}

function killEnemy(g, e) {
  e.mode = 'dead';
  e.wait = RESPAWN_TICKS;
  e.escaping = false;
  g.events.push({ type: 'kill', c: e.c, r: e.r });
}

// 復活は最上段のランダムな空き列から。元作品と同じく「どこから降ってくるか分からない」緊張感を残す。
function respawnEnemy(g, e) {
  const cols = [];
  for (let c = 0; c < g.w; c++) {
    if (tileAt(g, c, 0) === ' ' && !enemyAt(g, c, 0) && Math.abs(c - g.player.c) > 3) cols.push(c);
  }
  const c = cols.length ? cols[Math.floor(rand(g) * cols.length)] : e.sc;
  const r = cols.length ? 0 : e.sr;
  Object.assign(e, { c, r, fc: c, fr: r, t: 1, dur: 1, mode: 'wait', wait: 40 });
  g.events.push({ type: 'respawn', c, r });
}

function decideEnemy(g, e) {
  if (!e.escaping && !standsOn(g, e.c, e.r, e, false)) {
    if (!enemyAt(g, e.c, e.r + 1, e)) startMove(e, e.c, e.r + 1, ENEMY_FALL_STEP, 'fall');
    return;
  }
  const next = e.escaping ? escapeStep(g, e) : chaseStep(g, e);
  e.escaping = false;
  if (!next || enemyAt(g, next.c, next.r, e)) {
    e.mode = 'wait';
    e.wait = 6 + Math.floor(rand(g) * 10);
    return;
  }
  startMove(e, next.c, next.r, ENEMY_STEP, 'move');
}

function escapeStep(g, e) {
  const pref = g.player.c >= e.c ? [1, -1] : [-1, 1];
  for (const dc of pref) {
    if (canEnter(g, e.c + dc, e.r) && !enemyAt(g, e.c + dc, e.r, e)) return { c: e.c + dc, r: e.r };
  }
  return null;
}

function planNeighbors(g, c, r) {
  if (!standsOn(g, c, r, null, true)) {
    return canEnterPlan(g, c, r + 1) ? [[c, r + 1]] : [];
  }
  const out = [];
  const here = tileAt(g, c, r);
  if (here === 'H' && canEnterPlan(g, c, r - 1)) out.push([c, r - 1]);
  for (const dc of [-1, 1]) {
    if (canEnterPlan(g, c + dc, r)) out.push([c + dc, r]);
  }
  const ladderDown = here === 'H' || here === '-' || tileAt(g, c, r + 1) === 'H';
  if (ladderDown && canEnterPlan(g, c, r + 1)) out.push([c, r + 1]);
  return out;
}

// 幅優先探索(近い順に全マスを調べる方法)でプレイヤーへの最短経路の1歩目を選ぶ。
// 届かないときは、高さを優先して最も近づけるマスを目指す。
function chaseStep(g, e) {
  const target = idx(g, g.player.c, g.player.r);
  const start = idx(g, e.c, e.r);
  const prev = new Map([[start, -1]]);
  const queue = [start];
  let best = start;
  let bestScore = scoreFor(g, start);
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === target) { best = cur; break; }
    const s = scoreFor(g, cur);
    if (s < bestScore) { best = cur; bestScore = s; }
    for (const [nc, nr] of planNeighbors(g, cur % g.w, Math.floor(cur / g.w))) {
      const ni = idx(g, nc, nr);
      if (prev.has(ni)) continue;
      prev.set(ni, cur);
      queue.push(ni);
    }
  }
  return firstStep(g, prev, start, best);
}

function scoreFor(g, i) {
  const c = i % g.w;
  const r = Math.floor(i / g.w);
  return Math.abs(r - g.player.r) * 3 + Math.abs(c - g.player.c);
}

function firstStep(g, prev, start, goal) {
  if (goal === start) return null;
  let cur = goal;
  while (prev.get(cur) !== start) cur = prev.get(cur);
  return { c: cur % g.w, r: Math.floor(cur / g.w) };
}
