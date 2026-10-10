// 画面の切り替えと、各部品(プレイ・エディタ・保存)のつなぎ役。
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createPlay } from './play.js';
import { createEditor, decodeMap } from './editor.js';
import { createGame } from './game.js';
import { createTutorial } from './tutorial.js';
import { loadData, saveData, loadGhost, saveGhost } from './storage.js';
import { unlockAudio, setMuted, playSound } from './audio.js';

const $ = (id) => document.getElementById(id);
const data = loadData();
const input = createInput();
const gameRenderer = createRenderer($('game-canvas'));
let levels = [];
let session = null;
let editor = null;

async function boot() {
  setMuted(data.muted);
  updateSoundLabel();
  try {
    const res = await fetch('data/levels.json');
    levels = await res.json();
  } catch {
    levels = [];
  }
  bindUi();
  editor = createEditor({ onTest: startTest, onSave: saveCustom, getCustom: () => data.custom });
  drawTitle();
  if (!openSharedFromHash()) show('title');
  registerSw();
}

function show(name) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== `screen-${name}`;
  if (name === 'select') buildSelect();
  if (name === 'editor') editor.show();
  if (name !== 'game' && session) endSession();
}

function bindUi() {
  document.body.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });
  for (const btn of document.querySelectorAll('[data-go]')) {
    btn.addEventListener('click', () => { playSound('tap'); show(btn.dataset.go); });
  }
  $('btn-howto').addEventListener('click', showHowto);
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-pause').addEventListener('click', pause);
  $('btn-retry').addEventListener('click', () => restart());
  $('tut-skip').addEventListener('click', skipTutorial);
  $('opt-ghost').addEventListener('change', (ev) => { data.showGhost = ev.target.checked; saveData(data); });
  input.bindPad($('pad'));
  input.bindDig($('btn-dig-l'), -1);
  input.bindDig($('btn-dig-r'), 1);
  input.bindRewind($('btn-rewind'));
  input.onKey('p', pause);
  input.onKey('Escape', pause);
  window.addEventListener('resize', () => { if (session) fitGame(session.level); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && session) pause(); });
}

function toggleSound() {
  data.muted = !data.muted;
  setMuted(data.muted);
  saveData(data);
  updateSoundLabel();
}

function updateSoundLabel() {
  $('btn-sound').textContent = data.muted ? '音: OFF' : '音: ON';
}

// ---- ステージ選択 ----

function buildSelect() {
  const grid = $('stage-grid');
  grid.replaceChildren();
  let total = 0;
  levels.forEach((lv, i) => {
    const prog = data.progress[`b${i}`];
    total += prog ? prog.stars : 0;
    const unlocked = i === 0 || Boolean(data.progress[`b${i - 1}`]);
    grid.append(stageButton(lv, i, prog, unlocked));
  });
  $('star-total').textContent = `★ ${total} / ${levels.length * 3}`;
  $('opt-ghost').checked = data.showGhost;
  buildCustomList();
}

function stageButton(lv, i, prog, unlocked) {
  const btn = el('button', 'stage-btn');
  btn.disabled = !unlocked;
  btn.append(el('span', 'num', String(i + 1)), el('span', 'nm', unlocked ? lv.name : '???'));
  const stars = prog ? prog.stars : 0;
  btn.append(el('span', 'stars', '★'.repeat(stars) + '☆'.repeat(3 - stars)));
  if (prog) btn.append(el('span', 'best', `${prog.best.toFixed(1)}秒`));
  // 1面はチュートリアルを一度終えるまで、説明つきで始める。
  const tutorial = i === 0 && !data.tutorialDone;
  btn.addEventListener('click', () => startLevel(lv, { id: `b${i}`, index: i, tutorial }));
  return btn;
}

function buildCustomList() {
  const list = $('custom-list');
  list.replaceChildren();
  $('custom-empty').hidden = data.custom.length > 0;
  data.custom.forEach((cs, i) => {
    const li = el('li');
    li.append(el('span', 'cname', cs.name || '無題'));
    if (cs.cleared) li.append(el('span', 'ok', 'クリア確認済'));
    li.append(smallBtn('遊ぶ', () => startLevel(toLevel(cs), { id: `c${cs.id}` })));
    li.append(smallBtn('編集', () => { show('editor'); editor.load(cs); }));
    li.append(deleteBtn(i));
    list.append(li);
  });
}

// 削除は誤タップを防ぐため2回押しにする。ブラウザの確認ダイアログは操作を止めてしまうので使わない。
function deleteBtn(i) {
  const btn = smallBtn('削除', () => {
    if (btn.dataset.armed) {
      data.custom.splice(i, 1);
      saveData(data);
      buildCustomList();
      return;
    }
    btn.dataset.armed = '1';
    btn.textContent = 'もう一度';
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = '削除'; }, 2500);
  });
  return btn;
}

function toLevel(cs) {
  return { name: cs.name || '無題', par: 999, map: cs.map };
}

function saveCustom(cs) {
  const i = data.custom.findIndex((c) => c.id === cs.id);
  if (i >= 0) data.custom[i] = cs; else data.custom.unshift(cs);
  saveData(data);
}

// ---- プレイ ----

function startLevel(level, meta) {
  if (session) endSession();
  show('game');
  input.clear();
  $('hud-name').textContent = meta.index !== undefined ? `${meta.index + 1}. ${level.name}` : level.name;
  $('death-banner').hidden = true;
  fitGame(level);
  const ghost = meta.id && data.showGhost ? loadGhost(meta.id) : null;
  const tutor = meta.tutorial ? createTutorial({
    box: $('tut'), textEl: $('tut-text'),
    controls: { pad: [$('pad')], dig: [$('btn-dig-l'), $('btn-dig-r')], rewind: [$('btn-rewind')] }
  }) : null;
  const play = createPlay({
    level, renderer: gameRenderer, input, ghostFrames: ghost,
    onEnd: (res) => onPlayEnd(res), onHud: updateHud, tutor
  });
  session = { level, meta, play, tutor };
}

// 画面を表示した直後でも clientWidth を読めばレイアウトが確定するので、待たずにその場で合わせる。
function fitGame(level) {
  const st = $('stage');
  gameRenderer.fit(level.map[0].length, level.map.length, st.clientWidth - 8, st.clientHeight - 8);
}

function endSession() {
  if (session.tutor) session.tutor.stop();
  session.play.stop();
  session = null;
  closeModal();
}

function restart() {
  if (!session) return;
  const { level, meta } = session;
  if (session.tutor) session.tutor.stop();
  session.play.stop();
  session = null;
  closeModal();
  startLevel(level, meta);
}

function updateHud(h) {
  $('hud-gold').textContent = String(h.gold);
  $('hud-time').textContent = h.seconds.toFixed(1);
}

function onPlayEnd(res) {
  if (res.type === 'resume') $('death-banner').hidden = true;
  if (res.type === 'dead') $('death-banner').hidden = false;
  if (res.type === 'clear') setTimeout(() => onClear(res), 700);
}

function onClear(res) {
  if (!session) return;
  const { meta } = session;
  let newBest = false;
  if (meta.id) {
    const prev = data.progress[meta.id];
    newBest = !prev || res.seconds < prev.best;
    data.progress[meta.id] = {
      stars: Math.max(prev ? prev.stars : 0, res.stars),
      best: Math.min(prev ? prev.best : Infinity, res.seconds)
    };
    if (newBest) saveGhost(meta.id, res.ghost);
    saveData(data);
  }
  if (meta.test) editor.markCleared();
  if (meta.tutorial) finishTutorial();
  showClearModal(res, newBest, meta);
}

function showClearModal(res, newBest, meta) {
  const body = el('div');
  const stars = el('div', 'big-stars');
  for (let i = 0; i < 3; i++) stars.append(el('span', i < res.stars ? '' : 'off', '★'));
  body.append(stars);
  body.append(resultLine('タイム', `${res.seconds.toFixed(1)}秒${newBest ? '（自己ベスト！）' : ''}`));
  if (session.level.par < 999) body.append(resultLine('目標', `${session.level.par}秒以内・巻き戻しなし`));
  body.append(resultLine('巻き戻し', `${res.rewinds}回`));
  openModal('ステージクリア！', body, clearButtons(meta));
}

function clearButtons(meta) {
  if (meta.test) return [{ label: 'エディタに戻る', primary: true, action: () => show('editor') }];
  const buttons = [];
  const next = meta.index !== undefined ? levels[meta.index + 1] : null;
  if (next) buttons.push({ label: '次のステージへ', primary: true, action: () => startLevel(next, { id: `b${meta.index + 1}`, index: meta.index + 1 }) });
  if (meta.shared) buttons.push({ label: 'マイステージに保存', action: () => saveShared(meta) });
  buttons.push({ label: 'もう一度', action: restart });
  buttons.push({ label: 'ステージ選択へ', action: () => show('select') });
  return buttons;
}

function pause() {
  if (!session || $('screen-game').hidden || !$('modal').hidden) return;
  session.play.setPaused(true);
  const resume = () => { closeModal(); session.play.setPaused(false); };
  const back = session.meta.test ? 'editor' : 'select';
  openModal('一時停止', el('p', 'result-line', session.level.name), [
    { label: '再開', primary: true, action: resume },
    { label: '最初から', action: restart },
    { label: session.meta.test ? 'エディタに戻る' : 'ステージ選択へ', action: () => show(back) }
  ]);
}

// とじる・クリアのどちらでも「済み」にして、次から1面は説明なしで始める。
function finishTutorial() {
  if (session && session.tutor) session.tutor.stop();
  if (session) session.meta.tutorial = false;
  data.tutorialDone = true;
  saveData(data);
}

function skipTutorial() {
  playSound('tap');
  finishTutorial();
}

function startTest(level) {
  startLevel(level, { test: true });
}

// ---- 共有URL ----

function openSharedFromHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get('s');
  if (!code) return false;
  const map = decodeMap(code);
  if (!map) return false;
  const name = params.get('n') || '共有ステージ';
  history.replaceState(null, '', location.pathname);
  startLevel({ name, par: 999, map }, { shared: true, code });
  return true;
}

function saveShared(meta) {
  const map = decodeMap(meta.code);
  saveCustom({ id: Date.now(), name: session.level.name, map, cleared: true });
  show('select');
}

// ---- タイトル ----

function drawTitle() {
  if (!levels.length) return;
  const r = createRenderer($('title-canvas'));
  const g = createGame(levels[0]);
  // 開始直後の敵は復活待ちの点滅で消えて見えるので、止まった絵ではその待ちをなくす。
  for (const e of g.enemies) e.wait = 0;
  r.fit(20, 14, Math.min(388, window.innerWidth - 32), 200);
  const loop = () => {
    if (!$('screen-title').hidden) r.draw(g, { time: performance.now() / 16.7 });
    requestAnimationFrame(loop);
  };
  loop();
}

function showHowto() {
  const body = $('tpl-howto').content.cloneNode(true);
  body.querySelector('#btn-tutorial').addEventListener('click', () => {
    closeModal();
    startLevel(levels[0], { id: 'b0', index: 0, tutorial: true });
  });
  openModal('あそびかた', body, [{ label: 'とじる', primary: true, action: closeModal }]);
}

// ---- 小さな部品 ----

function openModal(title, body, buttons) {
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(body);
  const box = $('modal-buttons');
  box.replaceChildren();
  for (const b of buttons) {
    const btn = el('button', `btn${b.primary ? ' primary' : ''}`, b.label);
    btn.addEventListener('click', () => { playSound('tap'); b.action(); });
    box.append(btn);
  }
  $('modal').hidden = false;
}

function closeModal() {
  $('modal').hidden = true;
}

function resultLine(label, value) {
  const p = el('p', 'result-line', `${label}：`);
  p.append(el('b', '', value));
  return p;
}

function smallBtn(label, fn) {
  const b = el('button', 'btn small', label);
  b.addEventListener('click', fn);
  return b;
}

function el(tag, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function registerSw() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
