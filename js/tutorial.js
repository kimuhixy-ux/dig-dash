// 1面用のチュートリアル。ゲームの状態を毎回見て、できたら次の説明へ自動で進む。
// 「次へ」ボタンを押させないのは、実際に手を動かして覚えてもらうため。
import { entityPos } from './game.js';

const STEPS = [
  {
    text: '左下の丸いパッドに指を置いて、右へずらすと歩けます。',
    focus: 'pad', hold: true,
    done: (g) => g.player.c >= 3
  },
  {
    text: 'はしご（矢印）まで歩いたら、パッドを上に倒して登ろう。',
    hint: () => ({ x: 12, y: 11 }), hold: true,
    done: (g) => g.player.r <= 10
  },
  {
    text: '左のレンガの上にある金塊を取ろう。重なるだけで拾えます。',
    hint: () => ({ x: 3, y: 10 }), hold: true,
    done: (g, s) => g.goldLeft < s.startGold
  },
  {
    text: 'レンガの上で ◣掘 を押すと左ななめ下、◢掘 で右ななめ下に穴があきます。灰色の鉄は掘れません。1回掘ってみよう。',
    // 下の鉄の床（掘れない）に降りてしまったら、掘れる場所を指して戻ってもらう。
    hint: (g) => (g.player.r === 10 ? null : { x: 6, y: 10 }),
    focus: 'dig', hold: true,
    done: (g) => Boolean(g.digging) || g.holes.some((v) => v > 0)
  },
  {
    text: '⏪ を長押しすると時間が戻ります。やられても、これでやり直せます。',
    focus: 'rewind', hold: true,
    done: (g, s) => s.ticks > 300
  },
  {
    text: '敵が動き出します！近づいてきたら、通り道に穴を掘って落とそう。落ちた敵の頭の上は歩けます。',
    hint: (g) => (g.enemies[0] ? entityPos(g.enemies[0]) : null),
    done: (g, s) => s.ticks > 480 || g.enemies.some((e) => e.mode === 'trapped')
  },
  {
    text: '残りの金塊を全部集めよう。右上の数字が残りの数です。',
    done: (g) => g.revealed
  },
  {
    text: '右上に新しいはしごが出ました！いちばん上まで登ればクリア！',
    hint: () => ({ x: 18, y: 1 })
  }
];

export function createTutorial({ box, textEl, controls }) {
  let index = -1;
  let active = true;
  const st = { ticks: 0, startGold: 0 };

  function show(i, g) {
    index = i;
    st.ticks = 0;
    st.startGold = g.goldLeft;
    const step = STEPS[i];
    textEl.textContent = step.text;
    for (const [key, els] of Object.entries(controls)) {
      for (const el of els) el.classList.toggle('tut-focus', key === step.focus);
    }
  }

  return {
    // 毎ティック呼ぶ。戻り値は「敵を止めておくか」。
    update(g) {
      if (!active) return false;
      if (index < 0) { box.hidden = false; show(0, g); }
      st.ticks++;
      const step = STEPS[index];
      if (step.done && step.done(g, st)) show(index + 1, g);
      const hold = Boolean(STEPS[index].hold);
      // 待機中の敵は点滅して見えなくなるので、止めている間は点滅しない値にそろえる。
      if (hold) for (const e of g.enemies) if (e.wait > 25) e.wait = 25;
      return hold;
    },
    hint(g) {
      const step = active ? STEPS[index] : null;
      return step && step.hint ? step.hint(g) : null;
    },
    stop() {
      active = false;
      box.hidden = true;
      for (const els of Object.values(controls)) for (const el of els) el.classList.remove('tut-focus');
    }
  };
}
