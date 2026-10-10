// ステージエディタ。マップは文字列の配列で持ち、ゲーム本体と同じ形式なのでそのままテストプレイできる。
import { createRenderer } from './render.js';
import { createGame } from './game.js';

const W = 20;
const H = 14;
const CODES = ' #=H-XS$PE';
const MAX_ENEMIES = 8;
const TOOLS = [
  [' ', '消す'], ['#', 'レンガ'], ['=', '鉄'], ['H', 'はしご'], ['-', 'ロープ'],
  ['X', 'にせ床'], ['S', '隠しはしご'], ['$', '金塊'], ['P', '自分'], ['E', '敵']
];

const $ = (id) => document.getElementById(id);

// URLに載せるための圧縮。タイル10種を a〜j の1文字にし、同じ文字の連続は後ろに個数を付ける。
export function encodeMap(map) {
  const s = map.join('');
  let out = '';
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += String.fromCharCode(97 + CODES.indexOf(s[i])) + (j - i > 1 ? String(j - i) : '');
    i = j;
  }
  return out;
}

export function decodeMap(code) {
  let s = '';
  for (const m of code.matchAll(/([a-j])(\d*)/g)) {
    s += CODES[m[1].charCodeAt(0) - 97].repeat(m[2] ? Number(m[2]) : 1);
    if (s.length > W * H) return null;
  }
  if (s.length !== W * H) return null;
  const rows = [];
  for (let r = 0; r < H; r++) rows.push(s.slice(r * W, (r + 1) * W));
  return rows;
}

function blankMap() {
  const rows = [];
  for (let r = 0; r < H - 1; r++) rows.push(' '.repeat(W));
  rows.push('='.repeat(W));
  rows[H - 2] = ' P' + ' '.repeat(W - 2);
  return rows.map((row) => row.split(''));
}

export function createEditor({ onTest, onSave }) {
  const renderer = createRenderer($('ed-canvas'));
  let grid = blankMap();
  let tool = '#';
  let current = newRecord();

  buildPalette();
  bindCanvas();
  $('ed-test').addEventListener('click', test);
  $('ed-save').addEventListener('click', save);
  $('ed-share').addEventListener('click', share);
  $('ed-new').addEventListener('click', () => { grid = blankMap(); current = newRecord(); syncName(); draw(); msg('新しいステージ'); });
  $('ed-clear').addEventListener('click', () => { grid = blankMap(); touched(); draw(); msg('全消去しました'); });
  $('ed-name').addEventListener('input', () => { current.name = $('ed-name').value; });

  function newRecord() {
    return { id: Date.now(), name: '', cleared: false };
  }

  function buildPalette() {
    const box = $('palette');
    for (const [ch, label] of TOOLS) {
      const btn = document.createElement('button');
      btn.className = `pal-btn${ch === tool ? ' on' : ''}`;
      btn.dataset.ch = ch;
      btn.append(previewCanvas(ch));
      const span = document.createElement('span');
      span.textContent = label;
      btn.append(span);
      btn.addEventListener('click', () => selectTool(ch));
      box.append(btn);
    }
  }

  function selectTool(ch) {
    tool = ch;
    for (const b of document.querySelectorAll('.pal-btn')) b.classList.toggle('on', b.dataset.ch === ch);
  }

  function bindCanvas() {
    const cv = $('ed-canvas');
    const paintAt = (ev) => {
      const rect = cv.getBoundingClientRect();
      const c = Math.floor(((ev.clientX - rect.left) / rect.width) * W);
      const r = Math.floor(((ev.clientY - rect.top) / rect.height) * H);
      if (c >= 0 && c < W && r >= 0 && r < H) paint(c, r);
    };
    cv.addEventListener('pointerdown', (ev) => { ev.preventDefault(); cv.setPointerCapture(ev.pointerId); paintAt(ev); });
    cv.addEventListener('pointermove', (ev) => { if (cv.hasPointerCapture(ev.pointerId)) paintAt(ev); });
  }

  function paint(c, r) {
    if (grid[r][c] === tool) return;
    if (tool === 'P') replaceAll('P', ' ');
    if (tool === 'E' && countOf('E') >= MAX_ENEMIES) {
      msg(`敵は${MAX_ENEMIES}体までです`);
      return;
    }
    grid[r][c] = tool;
    touched();
    draw();
  }

  // 1マスでも変えたら「クリア確認済み」を取り消す。変更後の面が解ける保証はないため。
  function touched() {
    current.cleared = false;
  }

  function replaceAll(from, to) {
    for (const row of grid) for (let c = 0; c < W; c++) if (row[c] === from) row[c] = to;
  }

  function countOf(ch) {
    return grid.reduce((n, row) => n + row.filter((x) => x === ch).length, 0);
  }

  function mapRows() {
    return grid.map((row) => row.join(''));
  }

  function draw() {
    const g = createGame({ map: mapRows() });
    for (const e of g.enemies) e.wait = 0;
    renderer.draw(g, { editMode: true, time: 0 });
  }

  function check() {
    if (countOf('P') !== 1) return '「自分」を1つ置いてください';
    if (countOf('$') === 0) return '金塊を1つ以上置いてください';
    return '';
  }

  function test() {
    const err = check();
    if (err) { msg(err); return; }
    onTest({ name: current.name || '無題', par: 999, map: mapRows() });
  }

  function save() {
    current.name = $('ed-name').value.trim();
    onSave({ ...current, map: mapRows() });
    msg('マイステージに保存しました');
  }

  async function share() {
    if (!current.cleared) { msg('テストプレイでクリアすると共有できます'); return; }
    const params = new URLSearchParams({ s: encodeMap(mapRows()), n: current.name || '無題' });
    const url = `${location.origin}${location.pathname}#${params}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Dig Dash', text: current.name || 'ステージ', url });
      else { await navigator.clipboard.writeText(url); msg('リンクをコピーしました'); }
    } catch {
      msg('共有を中止しました');
    }
  }

  function syncName() {
    $('ed-name').value = current.name || '';
  }

  function msg(text) {
    $('ed-msg').textContent = text;
  }

  function fit() {
    const maxH = Math.max(160, window.innerHeight - 330);
    renderer.fit(W, H, window.innerWidth - 16, maxH);
    draw();
  }

  window.addEventListener('resize', () => { if (!$('screen-editor').hidden) fit(); });

  return {
    show() { syncName(); fit(); },
    load(cs) { grid = cs.map.map((row) => row.split('')); current = { id: cs.id, name: cs.name, cleared: Boolean(cs.cleared) }; syncName(); msg(''); fit(); },
    markCleared() {
      current.cleared = true;
      msg('クリア確認OK！「共有」でリンクを送れます（保存も忘れずに）');
    }
  };
}

function previewCanvas(ch) {
  const cv = document.createElement('canvas');
  if (ch === ' ') return cv;
  const r = createRenderer(cv);
  r.fit(1, 1, 22, 22);
  const g = createGame({ map: [ch] });
  for (const e of g.enemies) e.wait = 0;
  r.draw(g, { editMode: true });
  return cv;
}
