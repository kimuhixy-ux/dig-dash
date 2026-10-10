// 効果音はすべてその場で合成する。音声ファイルを持たないのでオフラインでも軽い。

let ctx = null;
let muted = false;

// iPhoneのSafariは、タップなどの操作の中でしか音を鳴らし始められないため、最初のタップで呼ぶ。
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
}

function tone(freq, dur, opts = {}) {
  const { type = 'square', vol = 0.06, when = 0, slide = null } = opts;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, vol = 0.08, when = 0) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buf;
  gain.gain.value = vol;
  src.connect(gain).connect(ctx.destination);
  src.start(ctx.currentTime + when);
}

const SOUNDS = {
  gold: () => [988, 1319, 1760].forEach((f, i) => tone(f, 0.08, { when: i * 0.05 })),
  dig: () => { noise(0.12, 0.07); tone(160, 0.12, { type: 'triangle', slide: 70, vol: 0.08 }); },
  trap: () => tone(330, 0.15, { type: 'triangle', slide: 160, vol: 0.08 }),
  kill: () => { noise(0.25, 0.1); tone(200, 0.3, { type: 'sawtooth', slide: 50, vol: 0.05 }); },
  death: () => tone(660, 0.8, { type: 'sawtooth', slide: 60, vol: 0.07 }),
  reveal: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.14, { when: i * 0.07, type: 'triangle', vol: 0.08 })),
  clear: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.18, { when: i * 0.11, vol: 0.06 })),
  respawn: () => tone(1200, 0.2, { type: 'sine', slide: 300, vol: 0.04 }),
  rewind: () => tone(300, 0.08, { type: 'sine', slide: 600, vol: 0.03 }),
  tap: () => tone(700, 0.04, { type: 'sine', vol: 0.04 })
};

export function playSound(name) {
  if (muted || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
  SOUNDS[name]();
}
