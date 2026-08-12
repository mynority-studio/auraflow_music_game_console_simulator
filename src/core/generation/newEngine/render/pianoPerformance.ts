// ============================================================
// newEngine · render · 钢琴柱式和弦人性化(表情三件套 A)
// ------------------------------------------------------------
// 用户诊断:柱式和弦所有声部同 tick 同力度 = "MIDI 味"最大来源。
// 本 pass 在 capOnsetGroups / snapCompLaidback / groove pocket 全部完成之后
// 运行(晚期,NoteIR 层),避免 per-voice 偏移被密度预算按 tick 分桶误砍:
//   1) 声部差异力度:顶音 +7(旋律面)、内声部 -8(收敛)、底音持平;
//   2) 自下而上微 roll:每声部 2-3 tick(≈3ms/声部,总展开 ≤12 tick),
//      确定性 per-chord;上声部时值同步缩短 → release 对齐不糊;
//   3) 门控:仅 comp + GM 原声钢琴音色;ACG 豁免(score 自带演奏);
//      LOFI 不 roll(dusty chop 的机器紧致是风格特征,仅做力度差异);
//      短促击点(<0.4 拍)不 roll。纯确定性。
// ============================================================

import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { midi, ticks } from '../foundation';

const clampVel = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

export function isGmAcousticPianoProgram(program: number | undefined, bank?: number): boolean {
  return program !== undefined && program >= 0 && program <= 7 && (bank ?? 0) === 0;
}

/** 柱式和弦人性化(见文件头)。tracks 原样透传非目标轨。 */
export function humanizePianoBlockChords(
  tracks: TrackIR[],
  args: {
    compProgram?: number;
    compBank?: number;
    style: string;
    ppq: number;
  },
): TrackIR[] {
  const styleKey = args.style.toLowerCase();
  if (styleKey === 'acg') return tracks;
  if (!isGmAcousticPianoProgram(args.compProgram, args.compBank)) return tracks;
  const allowRoll = styleKey !== 'lofi';
  const minRollDurTicks = Math.round(args.ppq * 0.4);

  return tracks.map((t) => {
    if (t.role !== 'comp' || t.notes.length === 0) return t;
    const byTick = new Map<number, NoteIR[]>();
    for (const n of t.notes) {
      const st = n.startTick as number;
      byTick.set(st, [...(byTick.get(st) ?? []), n]);
    }
    const out: NoteIR[] = [];
    for (const [st, group] of byTick) {
      if (group.length < 3) { out.push(...group); continue; }
      const sorted = [...group].sort((a, b) => (a.pitch as number) - (b.pitch as number));
      const top = sorted.length - 1;
      const maxDur = Math.max(...sorted.map((n) => n.durationTicks as number));
      // 常量步长(不用绝对 tick 哈希):repeatGroup 重复段(verse1≡verse2)的 comp 必须逐字一致
      const rollStep = allowRoll && maxDur >= minRollDurTicks ? 2 : 0;
      sorted.forEach((n, index) => {
        const vel = clampVel((n.velocity as number)
          + (index === top ? 7 : index === 0 ? 0 : -8));
        const offset = Math.min(rollStep * index, 12);
        out.push({
          ...n,
          pitch: midi(n.pitch as number),
          startTick: ticks(st + offset),
          durationTicks: ticks(Math.max(1, (n.durationTicks as number) - offset)), // release 对齐
          velocity: vel,
        });
      });
    }
    out.sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));
    return { ...t, notes: out };
  });
}
