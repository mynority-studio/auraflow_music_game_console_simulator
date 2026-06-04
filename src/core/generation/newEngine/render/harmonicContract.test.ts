// ============================================================
// newEngine · render · HarmonicContract 测试(三档:和弦合同 / 音阶 / 半音)
// ------------------------------------------------------------
// 和弦 ⊥ 音阶两轴。合同=stable∪color(强拍自由);音阶内非和弦音=自然经过(弱拍/经过/邻音);
// 半音(非音阶)=最严(仅两侧和弦音的真半音经过/邻音)。级进用真实 midi 距离。
// ============================================================

import { describe, expect, it } from 'vitest';
import { chordContractPcs, chordScalePcs, admitNoteByContract, voicingAllInContract } from './harmonicContract';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';

// Cmaj9 合同:stable C/E/G/B(0,4,7,11)+ color 9th D / 13th A(2,9)
const CONTRACT = new Set([0, 2, 4, 7, 9, 11]);
// C 大调 chord-scale:C D E F G A B —— 比合同多了 F(4 度,非和弦/avoid 但在音阶)
const SCALE = new Set([0, 2, 4, 5, 7, 9, 11]);

describe('chordContractPcs / chordScalePcs', () => {
  it('合同 = stable∪color;音阶 = chordScaleMap', () => {
    const plan = {
      stableToneMap: { c0: [0, 4, 7] }, colorToneMap: { c0: [2, 9] },
      chordScaleMap: { c0: [0, 2, 4, 5, 7, 9, 11] },
    } as unknown as HarmonicPlan;
    expect([...chordContractPcs(plan, 'c0')].sort((a, b) => a - b)).toEqual([0, 2, 4, 7, 9]);
    expect([...chordScalePcs(plan, 'c0')].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });
});

const admit = (noteMidi: number, over: Partial<Parameters<typeof admitNoteByContract>[0]> = {}) =>
  admitNoteByContract({ noteMidi, chordContract: CONTRACT, scale: SCALE, isWeakBeat: false, ...over });

describe('① 和弦合同内 → 强拍自由', () => {
  it('色彩 9th(D) / maj7(B) 都自由', () => {
    expect(admit(62).reason).toBe('in-contract'); // D=9th
    expect(admit(71).reason).toBe('in-contract'); // B=maj7
  });
});

describe('② 音阶内非和弦音(F=4度)→ 弱拍/经过/邻音', () => {
  it('强拍无前后 → rejected', () => {
    expect(admit(65).admit).toBe(false); // F 强拍裸放
  });
  it('经过 E-F-G → scale-passing', () => {
    expect(admit(65, { prevMidi: 64, nextMidi: 67 }).reason).toBe('scale-passing');
  });
  it('邻音 G-F-G → scale-neighbor', () => {
    expect(admit(65, { prevMidi: 67, nextMidi: 67 }).reason).toBe('scale-neighbor');
  });
  it('弱拍级进接入 → scale-weak', () => {
    expect(admit(65, { isWeakBeat: true, prevMidi: 64 }).reason).toBe('scale-weak');
  });
});

describe('③ 半音(非音阶,如 Db)→ 最严', () => {
  it('弱拍单侧级进 → rejected(半音不能弱拍单放)', () => {
    expect(admit(61, { isWeakBeat: true, prevMidi: 60 }).admit).toBe(false); // Db
  });
  it('两侧和弦音的半音经过 C-Db-D → chromatic-passing', () => {
    expect(admit(61, { prevMidi: 60, nextMidi: 62 }).reason).toBe('chromatic-passing');
  });
  it('两侧同和弦音的半音邻音 C-Db-C → chromatic-neighbor', () => {
    expect(admit(61, { prevMidi: 60, nextMidi: 60 }).reason).toBe('chromatic-neighbor');
  });
  it('强拍裸放 → rejected', () => {
    expect(admit(66).admit).toBe(false); // F#
  });
});

describe('级进用真实 midi 距离(pc 距1 的 M7 跳进 ≠ 级进)', () => {
  it('Db 前是 D(midi 50,M7 跳进)→ rejected', () => {
    expect(admit(61, { prevMidi: 50, nextMidi: 62 }).admit).toBe(false);
  });
});

describe('voicingAllInContract', () => {
  it('全和弦音 → true;含非合同音 → false', () => {
    expect(voicingAllInContract([60, 64, 67, 62], CONTRACT)).toBe(true); // C E G D(9th)
    expect(voicingAllInContract([60, 65], CONTRACT)).toBe(false);        // F 不在合同
  });
});
