// ============================================================
// newEngine · render · HarmonicContract 测试
// ------------------------------------------------------------
// 锁用户规则:合同=stable∪color · 合同内放行 · 合同外仅 经过/邻音/弱拍级进 ·
// 级进/不和谐用真实 midi 距离(pc 距1 的 M7 跳进 ≠ 级进)。
// ============================================================

import { describe, expect, it } from 'vitest';
import { chordContractPcs, admitNoteByContract, voicingAllInContract } from './harmonicContract';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';

// C 大调和弦合同:stable C/E/G(0,4,7)+ color 9th D / 13th A(2,9)
const CONTRACT = new Set([0, 2, 4, 7, 9]);

describe('chordContractPcs = stable ∪ color', () => {
  it('合并 stable 与 color 去重', () => {
    const plan = { stableToneMap: { c0: [0, 4, 7] }, colorToneMap: { c0: [2, 9, 4] } } as unknown as HarmonicPlan;
    expect([...chordContractPcs(plan, 'c0')].sort((a, b) => a - b)).toEqual([0, 2, 4, 7, 9]);
  });
});

describe('admitNoteByContract', () => {
  it('合同内 → 放行(in-contract);色彩音 9th 也在合同', () => {
    expect(admitNoteByContract({ noteMidi: 62, contract: CONTRACT, isWeakBeat: false }).reason).toBe('in-contract'); // D=9th
    expect(admitNoteByContract({ noteMidi: 60, contract: CONTRACT, isWeakBeat: false }).admit).toBe(true); // C
  });

  it('合同外 + 强拍 + 无前后 → rejected', () => {
    expect(admitNoteByContract({ noteMidi: 61, contract: CONTRACT, isWeakBeat: false }).admit).toBe(false); // Db
  });

  it('经过音:两侧合同音、级进穿过 → passing', () => {
    // C(60) - Db(61) - D(62):两侧 C/D 在合同,半音穿过
    expect(admitNoteByContract({ noteMidi: 61, contract: CONTRACT, isWeakBeat: false, prevMidi: 60, nextMidi: 62 }).reason).toBe('passing');
  });

  it('邻音:两侧同一合同音、级进折回 → neighbor', () => {
    // C(60) - Db(61) - C(60)
    expect(admitNoteByContract({ noteMidi: 61, contract: CONTRACT, isWeakBeat: false, prevMidi: 60, nextMidi: 60 }).reason).toBe('neighbor');
  });

  it('弱拍 + 级进接入 → weak-beat-step', () => {
    expect(admitNoteByContract({ noteMidi: 61, contract: CONTRACT, isWeakBeat: true, prevMidi: 60 }).reason).toBe('weak-beat-step');
  });

  it('★ pc 距1 但 midi 是 M7 跳进(11 半音)≠ 级进 → rejected', () => {
    // Db(61) 前是 D(50);pc 距 |1-2|=1 看似级进,真实 |61-50|=11 = 大七跳进 → 不放行
    expect(admitNoteByContract({ noteMidi: 61, contract: CONTRACT, isWeakBeat: true, prevMidi: 50 }).admit).toBe(false);
  });

  it('tritone 跳进到非合同音 → rejected', () => {
    // F#(66) 弱拍,前是 C(60),|6| 三全音 ≠ 级进
    expect(admitNoteByContract({ noteMidi: 66, contract: CONTRACT, isWeakBeat: true, prevMidi: 60 }).admit).toBe(false);
  });
});

describe('voicingAllInContract', () => {
  it('全和弦音 → true;含非合同音 → false', () => {
    expect(voicingAllInContract([60, 64, 67], CONTRACT)).toBe(true);   // C E G
    expect(voicingAllInContract([60, 64, 67, 62], CONTRACT)).toBe(true); // + D(9th 在合同)
    expect(voicingAllInContract([60, 61], CONTRACT)).toBe(false);       // Db 不在合同
  });
});
