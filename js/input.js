// キーボードとタッチを同じ形 { dir, dig } にまとめる。ゲーム側は入力元を気にしなくて済む。

const KEY_DIRS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down'
};
const KEY_DIGS = { z: -1, q: -1, x: 1, e: 1 };

export function createInput() {
  const state = { dir: null, dig: 0, rewind: false };
  const held = [];
  const listeners = {};

  const press = (dir) => {
    const i = held.indexOf(dir);
    if (i >= 0) held.splice(i, 1);
    held.push(dir);
    state.dir = dir;
  };
  const release = (dir) => {
    const i = held.indexOf(dir);
    if (i >= 0) held.splice(i, 1);
    state.dir = held.length ? held[held.length - 1] : null;
  };

  window.addEventListener('keydown', (ev) => onKey(ev, true));
  window.addEventListener('keyup', (ev) => onKey(ev, false));
  window.addEventListener('blur', () => clear());

  function onKey(ev, down) {
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (KEY_DIRS[k]) {
      ev.preventDefault();
      if (down) press(KEY_DIRS[k]); else release(KEY_DIRS[k]);
    } else if (KEY_DIGS[k] && down && !ev.repeat) {
      state.dig = KEY_DIGS[k];
    } else if (k === 'r') {
      state.rewind = down;
    } else if (down && !ev.repeat && listeners[k]) {
      listeners[k]();
    }
  }

  function clear() {
    held.length = 0;
    state.dir = null;
    state.dig = 0;
    state.rewind = false;
  }

  return {
    state,
    clear,
    onKey(key, fn) { listeners[key] = fn; },
    bindPad(el) { bindPad(el, press, release); },
    bindDig(el, dc) { bindHold(el, () => { state.dig = dc; }, () => {}); },
    bindRewind(el) { bindHold(el, () => { state.rewind = true; }, () => { state.rewind = false; }); }
  };
}

// 方向パッドは1つの円として扱い、指の位置の角度で4方向を決める。
// 指を離さずに滑らせるだけで方向を切り替えられるので、ボタン4つより操作が速い。
function bindPad(el, press, release) {
  let current = null;
  const knob = el.querySelector('.pad-knob');
  const update = (ev) => {
    const rect = el.getBoundingClientRect();
    const dx = ev.clientX - (rect.left + rect.width / 2);
    const dy = ev.clientY - (rect.top + rect.height / 2);
    const dead = rect.width * 0.1;
    let dir = null;
    if (Math.hypot(dx, dy) > dead) {
      dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
    }
    if (dir !== current) {
      if (current) release(current);
      if (dir) press(dir);
      current = dir;
    }
    el.dataset.dir = dir || '';
    if (knob) moveKnob(knob, dx, dy, rect.width * 0.28);
  };
  const end = () => {
    if (current) release(current);
    current = null;
    el.dataset.dir = '';
    if (knob) knob.style.transform = '';
  };
  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    update(ev);
  });
  el.addEventListener('pointermove', (ev) => { if (el.hasPointerCapture(ev.pointerId)) update(ev); });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
}

function moveKnob(knob, dx, dy, max) {
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, max / d);
  knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
}

function bindHold(el, down, up) {
  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    el.classList.add('pressed');
    down();
  });
  const end = () => {
    el.classList.remove('pressed');
    up();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
