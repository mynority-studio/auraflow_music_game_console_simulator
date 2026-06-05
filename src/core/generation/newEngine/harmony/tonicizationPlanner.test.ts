// ============================================================
// newEngine · harmony · tonicizationPlanner 单测(placement 结构)
// ------------------------------------------------------------
// 锁:light(POP)1:1 替成 V/X;iiv_split(JAZZ)插 ii/X+V/X;maxFires=0 不动;确定性。
// ============================================================

import { describe, expect, it } from 'vitest';
import { planTonicization } from './tonicizationPlanner';
import { beats, mod12 } from '../foundation';
import type { ResolvedChord } from './harmonyEngine';

// C 大调 diatonic 序列:I-IV-V-vi-ii-V-I-I(有 V/vi/ii 可离调目标)
const DEG_ROOT: Record<number, number> = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
const DEG_Q: Record<number, string> = { 1: 'maj7', 2: 'm7', 4: 'maj7', 5: '7', 6: 'm7' };
const mk = (degree: number): ResolvedChord => ({
  roman: { degree: degree as 1, accidental: 'natural', quality: DEG_Q[degree] as never },
  rootPc: mod12(DEG_ROOT[degree]) as never,
  quality: DEG_Q[degree] as never,
  durationBeats: beats(4),
  sectionId: 'v',
  func: 'T',
});
const SEQ = [1, 4, 5, 6, 2, 5, 1, 1].map(mk);

describe('tonicizationPlanner placement', () => {
  it('light(POP):1:1 替成 V/X(degree5,secondaryTarget,root=临时主上方五度)', () => {
    const { chords, fires } = planTonicization({ chords: SEQ, style: 'POP', borrowSource: 'Mixolydian', maxFires: 1 });
    expect(fires).toBe(1);
    expect(chords).toHaveLength(SEQ.length); // light 不增删
    const vx = chords.find((c) => c.tonicizationPlacement === 'light')!;
    expect(vx).toBeDefined();
    expect(vx.roman.degree).toBe(5);
    expect(vx.borrowedSource).toBe('secondary_dominant');
    expect(vx.roman.secondaryTarget).toBeDefined();
    expect(vx.rootPc).toBe(mod12((vx.localTonalCenterPc as number) + 7));
  });

  it('iiv_split(JAZZ):插入 ii/X+V/X(长度增 + 同临时主)', () => {
    const { chords, fires } = planTonicization({ chords: SEQ, style: 'JAZZ', borrowSource: 'Aeolian', maxFires: 1 });
    expect(fires).toBe(1);
    expect(chords.length).toBe(SEQ.length + 1); // 1 个 sac → ii+V 两格
    const iix = chords.find((c) => c.borrowedSource === 'secondary_ii_v')!;
    const vx = chords.find((c) => c.tonicizationPlacement === 'iiv_split' && c.roman.degree === 5)!;
    expect(iix).toBeDefined();
    expect(vx).toBeDefined();
    expect(iix.localTonalCenterPc).toBe(vx.localTonalCenterPc); // 同临时主音
    expect(iix.rootPc).toBe(mod12((iix.localTonalCenterPc as number) + 2)); // ii = 上方大二度
    expect(iix.func).toBe('S');
    expect(vx.func).toBe('D');
  });

  it('maxFires=0(LOFI/BLUES)→ 原样不动', () => {
    expect(planTonicization({ chords: SEQ, style: 'LOFI', borrowSource: 'Aeolian', maxFires: 0 }).chords).toBe(SEQ);
    expect(planTonicization({ chords: SEQ, style: 'BLUES', borrowSource: 'Aeolian', maxFires: 2 }).fires).toBe(0);
  });

  it('已着色和弦不再离调(borrowedSource/secondaryTarget 跳过)', () => {
    const colored = SEQ.map((c, i) => (i === 1 ? { ...c, borrowedSource: 'modal_interchange' as const } : c));
    const { chords } = planTonicization({ chords: colored, style: 'POP', borrowSource: 'Mixolydian', maxFires: 4 });
    // 借和弦那格仍是 modal_interchange(没被替成 V/X)
    expect(chords.find((c) => c.borrowedSource === 'modal_interchange')).toBeDefined();
  });

  it('确定性:同输入两次完全一致', () => {
    const a = JSON.stringify(planTonicization({ chords: SEQ, style: 'JAZZ', borrowSource: 'Aeolian', maxFires: 2 }).chords);
    const b = JSON.stringify(planTonicization({ chords: SEQ, style: 'JAZZ', borrowSource: 'Aeolian', maxFires: 2 }).chords);
    expect(a).toBe(b);
  });
});
