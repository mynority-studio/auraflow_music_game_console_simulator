import { describe, it, expect } from 'vitest';
import { assessFriction, intervalClassOf, spanKindOf } from './scaleStyleIntervalTolerance';
import { TONALITY_INTERVALS, type SandboxTonality } from './sandboxScales';

const scale = (t: SandboxTonality) => TONALITY_INTERVALS[t];
const A = (over: Partial<Parameters<typeof assessFriction>[0]> = {}) => assessFriction({
  semitones: 2, pcA: 0, pcB: 2, style: 'pop', tonality: 'major', scalePcs: scale('major'),
  emphasized: false, resolved: false, chordSupported: false, ...over,
});

describe('motifSandbox/scaleStyleIntervalTolerance(Phase 2)', () => {
  it('intervalClass / spanKind:M2 与 m7 同 class 不同 span;m2 与 M7 同 class 不同 span', () => {
    expect(intervalClassOf(2)).toBe(2); expect(intervalClassOf(10)).toBe(2); // M2/m7 同 class
    expect(spanKindOf(2)).toBe('step'); expect(spanKindOf(10)).toBe('seventh');
    expect(intervalClassOf(1)).toBe(1); expect(intervalClassOf(11)).toBe(1); // m2/M7 同 class
    expect(spanKindOf(1)).toBe('step'); expect(spanKindOf(11)).toBe('seventh');
  });

  it('★ M2 ≠ m7 安全:M2 低风险,m7 跳高风险(同 class)', () => {
    const m2step = A({ semitones: 2, pcA: 0, pcB: 2, emphasized: true });
    const m7leap = A({ semitones: 10, pcA: 0, pcB: 10, emphasized: true }); // C→Bb 大跳
    expect(m2step.risk).toBeLessThan(0.3);
    expect(m7leap.risk).toBeGreaterThan(m2step.risk + 0.3);
  });

  it('★ m2 ≠ M7 安全:m2 step 风险 < M7 跳', () => {
    const m2 = A({ semitones: 1, pcA: 4, pcB: 5, emphasized: true }); // E→F
    const M7 = A({ semitones: 11, pcA: 0, pcB: 11, emphasized: true }); // C→B 大跳
    expect(M7.risk).toBeGreaterThan(m2.risk);
  });

  it('★ major+pop:M2 允许;m2 仅作经过;三全音强调高风险', () => {
    expect(A({ semitones: 2, emphasized: true }).risk).toBeLessThan(0.3);           // M2 允许
    const m2passing = A({ semitones: 1, pcA: 4, pcB: 5, resolved: true });          // m2 经过
    const m2struct = A({ semitones: 1, pcA: 4, pcB: 5, emphasized: true });         // m2 强结构
    expect(m2passing.risk).toBeLessThan(m2struct.risk);                             // 经过 < 结构
    const tritone = A({ semitones: 6, pcA: 5, pcB: 11, emphasized: true });         // F→B 强调
    expect(tritone.risk).toBeGreaterThan(0.65);                                     // 高风险
  });

  it('★ majorPent+pop:m2/三全音离调 → 高风险', () => {
    const m2 = A({ semitones: 1, pcA: 0, pcB: 1, tonality: 'majorPent', scalePcs: scale('majorPent'), emphasized: true }); // C→Db,Db 离调
    expect(m2.producedByScalePcs).toBe(false);
    expect(m2.risk).toBeGreaterThan(0.65);
  });

  it('★ minorPent+pop:m3/P4/P5 正常(低);引入的 m2 高风险', () => {
    for (const semi of [3, 5, 7]) expect(A({ semitones: semi, pcA: 0, pcB: semi, tonality: 'minorPent', scalePcs: scale('minorPent'), emphasized: true }).risk).toBeLessThan(0.3);
    expect(A({ semitones: 1, pcA: 0, pcB: 1, tonality: 'minorPent', scalePcs: scale('minorPent'), emphasized: true }).risk).toBeGreaterThan(0.6);
  });

  it('★ majorBlues+pop:蓝调音(b3)三全音作经过 → 豁免/低风险', () => {
    // Eb(3,蓝调音)→ A(9):6 半音三全音,Eb 是 majorBlues 蓝调音
    const a = assessFriction({ semitones: 6, pcA: 3, pcB: 9, style: 'pop', tonality: 'majorBlues', scalePcs: scale('majorBlues'), emphasized: false, resolved: true, chordSupported: false });
    expect(a.styleScaleExempt).toBe(true);
    expect(a.risk).toBeLessThan(0.3);
  });

  it('★ minorBlues+jazz:m2 + b5 蓝调音,解决时广泛允许', () => {
    // F(5)→Gb(6):m2,Gb 是 minorBlues 蓝调音(b5)
    const a = assessFriction({ semitones: 1, pcA: 5, pcB: 6, style: 'jazz', tonality: 'minorBlues', scalePcs: scale('minorBlues'), emphasized: true, resolved: true, chordSupported: false });
    expect(a.styleScaleExempt).toBe(true);
    expect(a.risk).toBeLessThan(0.3);
  });

  it('★ major+jazz:半音 approach 级进解决 → 允许', () => {
    const a = assessFriction({ semitones: 1, pcA: 1, pcB: 2, style: 'jazz', tonality: 'major', scalePcs: scale('major'), emphasized: false, resolved: true, chordSupported: false });
    expect(a.risk).toBeLessThan(0.3); // jazz chromatic approach resolved
  });
});
