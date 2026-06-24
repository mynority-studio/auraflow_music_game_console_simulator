import { describe, it, expect } from 'vitest';
import {
  buildPitchContractContext, contractAtBeat, classifyMelodyNoteAgainstContract,
  nearestContractTone, isStructuralMelodyNote, isBlueColorPc, keyBlueNotePc,
} from './pitchContract';
import { makeChord, type SandboxChord } from './chords';
import type { MotifNote } from './types';

const m12 = (n: number) => ((n % 12) + 12) % 12;
const note = (midi: number, onsetBeat: number, durationBeat: number, over: Partial<MotifNote> = {}): MotifNote =>
  ({ midi, onsetBeat, durationBeat, velocity: 0.8, scaleDegree: 1, octave: 4, accent: 0.5, ...over });

// C 大调 I(C E G),seasoned 成 C7(加 Bb)的版本手工构造
const cMajTonic = (): SandboxChord => makeChord(1, 0, 'major', 0, 4);
const cDom7 = (): SandboxChord => ({ ...makeChord(1, 0, 'major', 0, 4), realRoman: 'I7', realType: '7', realRootPc: 0, realTonePcs: [0, 4, 7, 10], effectiveFunc: 'D' });

describe('motifSandbox/pitchContract', () => {
  it('基本合同:C 大调 I 三和弦 stable=C/E/G,11(F)入 avoid', () => {
    const ctx = buildPitchContractContext({ progression: [cMajTonic()], keyPc: 0, mode: 'major' });
    const c = ctx.contracts[0];
    expect(c.stablePcs).toEqual([0, 4, 7]); // C E G
    expect(c.avoidPcs).toContain(5);        // F = 大三上的纯四度
    expect(ctx.isBluesInput).toBe(false);
  });

  it('majorBlues:dom7 化的 I 把 b3(Eb)admit 成 color(I7#9 蓝调感)', () => {
    const ctx = buildPitchContractContext({ progression: [cDom7()], keyPc: 0, mode: 'major', inputTonality: 'majorBlues' });
    const c = ctx.contracts[0];
    expect(ctx.isBluesInput).toBe(true);
    expect(keyBlueNotePc(0, 'majorBlues')).toBe(3); // Eb
    expect(c.colorPcs).toContain(3); // b3 作色彩(因 chord 是 dom7/D 功能,容纳蓝调音)
  });

  it('majorBlues:纯大三和弦(非 dom7/非 D 功能)不把 b3 当 color → 只能弱经过', () => {
    const tonic = { ...cMajTonic(), effectiveFunc: 'T' as const };
    const ctx = buildPitchContractContext({ progression: [tonic], keyPc: 0, mode: 'major', inputTonality: 'majorBlues' });
    const c = ctx.contracts[0];
    expect(c.colorPcs).not.toContain(3); // 纯 T 大三:b3 不作 color
    expect(c.scalePcs).toContain(3);      // 但布鲁斯音阶里 → 弱经过可用
  });

  it('结构音分类:强拍 b3 在不容纳的和弦上 = unsupported-structural;弱经过 b3 = scale-passing', () => {
    const tonic = { ...cMajTonic(), effectiveFunc: 'T' as const };
    const ctx = buildPitchContractContext({ progression: [tonic], keyPc: 0, mode: 'major', inputTonality: 'majorBlues' });
    const c = ctx.contracts[0];
    const strongBlue = note(63, 0, 1.5, { structuralToneScore: 0.7 }); // Eb 强长
    expect(classifyMelodyNoteAgainstContract({ note: strongBlue, contract: c, isBlue: true })).toBe('unsupported-structural');
    const weakBlue = note(63, 0.75, 0.25, { structuralToneScore: 0.2 }); // Eb 短弱
    expect(classifyMelodyNoteAgainstContract({ note: weakBlue, contract: c, isBlue: true })).toBe('scale-passing');
  });

  it('quote 蓝调音:occurrenceKind=quote 的不支持蓝音 → quote-blue(保留,不算 unsupported)', () => {
    const tonic = { ...cMajTonic(), effectiveFunc: 'T' as const };
    const ctx = buildPitchContractContext({ progression: [tonic], keyPc: 0, mode: 'major', inputTonality: 'majorBlues' });
    const c = ctx.contracts[0];
    const q = note(63, 0, 1.5, { structuralToneScore: 0.7, occurrenceKind: 'quote' });
    expect(classifyMelodyNoteAgainstContract({ note: q, contract: c, isBlue: true })).toBe('quote-blue');
  });

  it('nearestContractTone:结构音吸到 stable∪color 最近;非结构吸到含 scale', () => {
    const ctx = buildPitchContractContext({ progression: [cMajTonic()], keyPc: 0, mode: 'major' });
    const c = ctx.contracts[0];
    // C 大三和弦上:stable=C/E/G,color=9/13/maj7(D/A/B,Cmaj13 全协和),只有 F(11)是 scale-only
    expect(c.scalePcs).toEqual([5]); // 仅 F
    // F(65)结构 → 吸到最近 stable/color(E64 或 G67),不能停 F(11 冲突)
    expect([64, 67]).toContain(nearestContractTone(65, c, { structural: true }));
    // F 作弱经过 → 允许停 F(scale 音)
    expect(nearestContractTone(65, c, { structural: false })).toBe(65);
  });

  it('isStructuralMelodyNote:按落点重判(显式低分=弱经过即使强拍;否则下拍/长音=结构)', () => {
    expect(isStructuralMelodyNote(note(60, 0, 0.5, { structuralToneScore: 0.7 }))).toBe(true);   // 下拍 → 结构
    expect(isStructuralMelodyNote(note(60, 0, 0.25, { structuralToneScore: 0.2 }))).toBe(false); // 显式低分(生成器标注弱经过)→ 非结构
    expect(isStructuralMelodyNote(note(60, 0.75, 0.75, { structuralToneScore: 0.86 }))).toBe(false); // ★ transform 后 stale 高分不信 → 弱拍短音=弱
    expect(isStructuralMelodyNote(note(60, 0, 0.25))).toBe(true);  // 下拍(无分)
    expect(isStructuralMelodyNote(note(60, 0.75, 0.25))).toBe(false); // 弱拍短音(无分)
  });

  it('isBlueColorPc + contractAtBeat', () => {
    expect(isBlueColorPc(3, 0, 'majorBlues')).toBe(true);  // Eb
    expect(isBlueColorPc(6, 0, 'minorBlues')).toBe(true);  // Gb
    expect(isBlueColorPc(4, 0, 'majorBlues')).toBe(false); // E
    const ctx = buildPitchContractContext({ progression: [makeChord(1, 0, 'major', 0, 4), makeChord(4, 0, 'major', 4, 4)], keyPc: 0, mode: 'major' });
    expect(contractAtBeat(ctx, 5).chordIndex).toBe(1);
  });

  it('minorBlues:m7b5/dim 容纳 b5(Gb)作 color', () => {
    const m7b5: SandboxChord = { ...makeChord(2, 0, 'minor', 0, 4), realType: 'm7b5', realRootPc: m12(0 + 2), realTonePcs: [2, 5, 8, 0], effectiveFunc: 'S' };
    const ctx = buildPitchContractContext({ progression: [m7b5], keyPc: 0, mode: 'minor', inputTonality: 'minorBlues' });
    const c = ctx.contracts[0];
    expect(c.colorPcs).toContain(6); // Gb = key b5,m7b5/S 功能容纳
  });
});
