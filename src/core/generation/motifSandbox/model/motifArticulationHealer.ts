// ============================================================
// motifSandbox · model · 新手 motif 连音/断奏治愈(beginner healing directive Phase 1)
// ------------------------------------------------------------
// 新手常因手指技术弹出【非有意的极短断点】→ 把这种短空拍温和补成连贯时值;但【同音重复断奏】
//   (C C / C C C)是真演奏手势,必须保留间隔、不延长。纯函数 / 确定性 / 不动 onset/pitch/数量。
// 用户拍板:① motif-local 温和补,不做 bar-end aggressive fill(那是 Q+N leadGapFill 的职责)
//   ② 同音连续≥2 = 有意断奏 → 锁(healer 不延、render legato 不连)③ 时值留 1/16 网格,不造浮点尾巴
//   ④ 不同音可直接延到 next onset 形成贴连;safety gap 交 render/sanitizer tick 层。
// ============================================================

import type { MotifNote, HealingMode } from './types';

const GRID = 0.25; // 1/16 拍
const REST_GAP = 0.75;        // gap≥此 → 有意休止,保留
const CLIPPED_DUR = 0.25;     // ★ 只补【被夹短的音】(≤16 分):长音(eighth+)后的小空拍=有意呼吸,不补(under-repair)
const snapGrid = (b: number): number => Math.round(b / GRID) * GRID;

export interface ArticulationHealResult {
  notes: MotifNote[];
  gapsHealed: number;          // 不同音高短空拍补连的音数
  staccatoNotes: number;       // 锁为有意同音断奏的音数
}

/** 治愈 motif 连音/断奏。mode='off' 或 <2 音 → 原样返回。不动 onset/pitch/数量,只改 durationBeat + 标签。 */
export function healMotifArticulation(notes: readonly MotifNote[], opts: { mode?: HealingMode } = {}): ArticulationHealResult {
  const mode = opts.mode ?? 'beginner';
  const out = notes.map((n) => ({ ...n }));
  if (mode === 'off' || out.length < 2) return { notes: out, gapsHealed: 0, staccatoNotes: 0 };
  // 注:进来时已按 onset 升序(分析链保证);为稳妥按 onset 复核排序。
  out.sort((a, b) => a.onsetBeat - b.onsetBeat);

  // 1) 标记【同音重复断奏 run】(连续≥2 个同 midi、不同 onset)。
  let staccatoNotes = 0;
  for (let i = 0; i < out.length; ) {
    let j = i;
    while (j + 1 < out.length && out[j + 1].midi === out[i].midi) j++;
    if (j > i) { // run 长度 ≥2
      for (let k = i; k <= j; k++) {
        out[k].articulationLock = 'staccato-repeat';
        out[k].healingTags = [...(out[k].healingTags ?? []), 'intentional-repeat-staccato'];
        staccatoNotes++;
      }
    }
    i = j + 1;
  }

  // 2) 补【不同音高】短空拍 → 延到 next onset(贴连;1/16 网格)。同音高(下一个同 pitch)绝不延(护断奏)。
  let gapsHealed = 0;
  for (let i = 0; i < out.length - 1; i++) {
    const cur = out[i], next = out[i + 1];
    if (next.midi === cur.midi) continue;                       // 同音 → 不延(断奏意图)
    if (cur.durationBeat > CLIPPED_DUR + 1e-6) continue;        // ★ 长音后的小空拍=有意呼吸,不补(只补被夹短的音)
    const gap = next.onsetBeat - (cur.onsetBeat + cur.durationBeat);
    if (gap <= 1e-6 || gap >= REST_GAP - 1e-6) continue;        // 重叠交 sanitizer;≥0.75 当有意休止
    const newDur = snapGrid(next.onsetBeat - cur.onsetBeat);     // 延到 next onset(两 onset 皆在网格 → 1/16 倍数)
    if (newDur > cur.durationBeat + 1e-6) {
      cur.originalDurationBeat = cur.durationBeat;
      cur.durationBeat = newDur;
      cur.healingTags = [...(cur.healingTags ?? []), 'gap-healed-legato'];
      gapsHealed++;
    }
  }
  return { notes: out, gapsHealed, staccatoNotes };
}

/** 相邻同音高 run(≥2)的【起始索引集】—— render 层在 tag 丢失(过桥)时重新推断断奏锁用。 */
export function deriveSamePitchStaccatoRuns(midisOrNotes: readonly { midi: number; onsetBeat: number }[]): Set<number> {
  const locked = new Set<number>();
  const s = [...midisOrNotes].map((n, i) => ({ ...n, i })).sort((a, b) => a.onsetBeat - b.onsetBeat);
  for (let a = 0; a < s.length; ) {
    let b = a;
    while (b + 1 < s.length && s[b + 1].midi === s[a].midi) b++;
    if (b > a) for (let k = a; k <= b; k++) locked.add(s[k].i);
    a = b + 1;
  }
  return locked;
}
