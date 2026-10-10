// localStorage(端末内の保存領域)への読み書き。プライベートブラウズでは失敗することがあるので、
// すべて try/catch で包み、保存できなくてもゲームは遊べるようにする。

const KEY = 'dig-dash-v1';
const GHOST_PREFIX = 'dig-dash-ghost-';

const DEFAULTS = { progress: {}, muted: false, custom: [], showGhost: true };

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : structuredClone(DEFAULTS);
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 容量超過などで保存できなくても、遊ぶこと自体は続けられる
  }
}

export function loadGhost(levelId) {
  try {
    const raw = localStorage.getItem(GHOST_PREFIX + levelId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGhost(levelId, frames) {
  try {
    localStorage.setItem(GHOST_PREFIX + levelId, JSON.stringify(frames));
  } catch {
    // ゴーストはおまけなので、保存に失敗しても黙って諦める
  }
}
