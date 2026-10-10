// 1ステージ分のプレイを管理する。固定間隔の更新ループ、巻き戻し、ゴーストの記録と再生を受け持つ。
import { createGame, step, entityPos, TICK_RATE } from './game.js';
import { poseOf } from './render.js';
import { playSound } from './audio.js';

const SNAP_EVERY = 4;
const SNAP_LIMIT = 150;
const GHOST_EVERY = 2;
const POSES = ['stand', 'run', 'climb', 'hang', 'fall', 'dig', 'trapped'];

export function createPlay({ level, renderer, input, ghostFrames, onEnd, onHud, tutor }) {
  let g = createGame(level, 1000 + level.map.join('').length);
  const snaps = [];
  const record = [];
  let rewinds = 0;
  let rewindFrames = 0;
  let revealTick = -1;
  let running = true;
  let paused = false;
  let acc = 0;
  let last = performance.now();
  let raf = 0;

  function frame(now) {
    if (!running) return;
    acc += Math.min(100, now - last);
    last = now;
    const dt = 1000 / TICK_RATE;
    if (input.state.rewind && !paused && g.status !== 'clear') {
      acc = 0;
      doRewind();
    } else {
      rewindFrames = 0;
      while (acc >= dt) {
        acc -= dt;
        if (!paused) tick();
      }
    }
    draw();
    raf = requestAnimationFrame(frame);
  }

  function tick() {
    if (g.status !== 'play') return;
    if (g.tick % SNAP_EVERY === 0) pushSnap();
    if (g.tick % GHOST_EVERY === 0) recordGhost();
    g.enemyHold = tutor ? tutor.update(g) : false;
    step(g, input.state);
    handleEvents();
    onHud(hudInfo());
    if (g.status !== 'play') finish();
  }

  function pushSnap() {
    const events = g.events;
    g.events = [];
    snaps.push(structuredClone(g));
    g.events = events;
    if (snaps.length > SNAP_LIMIT) snaps.shift();
  }

  function recordGhost() {
    const p = g.player;
    const pos = entityPos(p);
    record[g.tick / GHOST_EVERY] = [
      Math.round(pos.x * 20), Math.round(pos.y * 20), POSES.indexOf(poseOf(g, p)), p.facing
    ];
  }

  // 巻き戻しは押している間2倍速で過去へ戻る。死んだ直後でも押せばやり直せる。
  function doRewind() {
    rewindFrames++;
    if (rewindFrames % 2 !== 1 || snaps.length === 0) return;
    if (rewindFrames === 1) rewinds++;
    g = snaps.pop();
    record.length = Math.floor(g.tick / GHOST_EVERY);
    playSound('rewind');
    onHud(hudInfo());
    if (rewindFrames === 1) onEnd({ type: 'resume' });
  }

  function handleEvents() {
    for (const ev of g.events) {
      if (ev.type === 'reveal') revealTick = g.tick;
      if (ev.c !== undefined && ev.type !== 'respawn') renderer.burst(ev.type, ev.c, ev.r);
      playSound(ev.type);
    }
    g.events = [];
  }

  function finish() {
    const seconds = g.tick / TICK_RATE;
    if (g.status === 'clear') {
      const stars = 1 + (seconds <= level.par ? 1 : 0) + (seconds <= level.par && rewinds === 0 ? 1 : 0);
      onEnd({ type: 'clear', seconds, stars, rewinds, ghost: record.slice() });
    } else {
      onEnd({ type: 'dead', canRewind: snaps.length > 0 });
    }
  }

  function draw() {
    renderer.draw(g, {
      time: performance.now() / 16.7,
      revealAge: revealTick >= 0 ? g.tick - revealTick : 0,
      ghost: ghostAt(ghostFrames, g.tick),
      showDead: true,
      hint: tutor ? tutor.hint(g) : null
    });
    if (g.revealed && revealTick < 0) revealTick = g.tick;
  }

  function hudInfo() {
    return { gold: g.goldLeft, seconds: g.tick / TICK_RATE, rewinds, status: g.status };
  }

  raf = requestAnimationFrame(frame);
  onHud(hudInfo());

  return {
    stop() { running = false; cancelAnimationFrame(raf); },
    setPaused(v) { paused = v; last = performance.now(); acc = 0; },
    get status() { return g.status; }
  };
}

function ghostAt(frames, tick) {
  if (!frames || !frames.length) return null;
  const f = frames[Math.min(frames.length - 1, Math.floor(tick / GHOST_EVERY))];
  if (!f) return null;
  return { x: f[0] / 20, y: f[1] / 20, pose: POSES[f[2]] || 'run', d: f[3], f: tick };
}
