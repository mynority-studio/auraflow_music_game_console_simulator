import { describe, it, expect } from 'vitest';
import { repairRepeatedMelodicFriction } from './motifFrictionRepair';
import { buildPitchContractContext } from './pitchContract';
import { makeChord } from './chords';
import type { MotifNote } from './types';

const m12 = (n: number) => ((n % 12) + 12) % 12;
const CMAJ = [0, 2, 4, 5, 7, 9, 11];
const ctx = () => buildPitchContractContext({ progression: [makeChord(1, 0, 'major', 0, 8)], keyPc: 0, mode: 'major' }); // C 全程
const note = (midi: number, onsetBeat: number, kind: MotifNote['occurrenceKind'] = 'develop'): MotifNote =>
  ({ midi, onsetBeat, durationBeat: 1, velocity: 0.9, scaleDegree: 1, octave: 4, accent: 0.7, structuralToneScore: 0.7, occurrenceKind: kind });

// C→Db→G:Db 是强调 m2(离调)+ 跳走到 G【不解决】→ 真摩擦;每相重复一遍(Db 在 idx 1/4/7)
const dbIdx = [1, 4, 7];
const repeated = (kinds: MotifNote['occurrenceKind'][]) => [
  note(60, 0, kinds[0]), note(61, 1, kinds[0]), note(67, 2, kinds[0]),
  note(60, 3, kinds[1]), note(61, 4, kinds[1]), note(67, 5, kinds[1]),
  note(60, 6, kinds[2]), note(61, 7, kinds[2]), note(67, 8, kinds[2]),
];

describe('motifSandbox/motifFrictionRepair(Phase 2)', () => {
  it('★ 前两次留、第三次起修第二音(≤3 半音,修后非 Db)', () => {
    const r = repairRepeatedMelodicFriction(repeated(['develop', 'develop', 'develop']), { pitchCtx: ctx(), style: 'pop', tonality: 'major', keyPc: 0, scalePcs: CMAJ });
    const s = r.notes;
    expect(m12(s[1].midi)).toBe(1); // 第 1 次 Db 留
    expect(m12(s[4].midi)).toBe(1); // 第 2 次 Db 留
    expect(m12(s[7].midi)).not.toBe(1); // 第 3 次 Db 被修
    expect(Math.abs(s[7].midi - 61)).toBeLessThanOrEqual(3); // ≤3 半音
    expect(s[7].healingTags).toContain('friction-repaired');
    expect(s[7].originalMidi).toBe(61);
    expect(r.audit.frictionPairsRepaired).toBe(1);
  });

  it('★ exact quote 永不修(计 protectedQuoteFrictionCount,Db 不变)', () => {
    const r = repairRepeatedMelodicFriction(repeated(['quote', 'quote', 'quote']), { pitchCtx: ctx(), style: 'pop', tonality: 'major', keyPc: 0, scalePcs: CMAJ });
    expect(dbIdx.every((i) => m12(r.notes[i].midi) === 1)).toBe(true); // 所有 Db 原样
    expect(r.audit.frictionPairsRepaired).toBe(0);
    expect(r.audit.protectedQuoteFrictionCount).toBeGreaterThan(0);
  });

  it('★ 第一次是 quote(计数+保护),develop 第三次出现才修', () => {
    const r = repairRepeatedMelodicFriction(repeated(['quote', 'develop', 'develop']), { pitchCtx: ctx(), style: 'pop', tonality: 'major', keyPc: 0, scalePcs: CMAJ });
    expect(m12(r.notes[1].midi)).toBe(1);    // quote Db 不动
    expect(m12(r.notes[7].midi)).not.toBe(1); // cell 第 3 次(develop)→ 修
    expect(r.audit.protectedQuoteFrictionCount).toBeGreaterThan(0);
  });

  it('★ off 模式不修', () => {
    const r = repairRepeatedMelodicFriction(repeated(['develop', 'develop', 'develop']), { pitchCtx: ctx(), style: 'pop', tonality: 'major', keyPc: 0, scalePcs: CMAJ, mode: 'off' });
    expect(r.audit.frictionPairsRepaired).toBe(0);
    expect(dbIdx.every((i) => m12(r.notes[i].midi) === 1)).toBe(true);
  });

  it('★ 同音重复(staccato lock)跳过摩擦修复', () => {
    const run = [note(60, 0), note(60, 1), note(60, 2)].map((n) => ({ ...n, articulationLock: 'staccato-repeat' as const }));
    const r = repairRepeatedMelodicFriction(run, { pitchCtx: ctx(), style: 'pop', tonality: 'major', keyPc: 0, scalePcs: CMAJ });
    expect(r.audit.frictionPairsScanned).toBe(0); // 同音 semis=0 → 不扫
    expect(r.audit.frictionPairsRepaired).toBe(0);
  });

  it('★ 弱/经过的离调音不修(只 emphasized 高风险才计)', () => {
    // Db 作弱短经过(structuralToneScore 低 + 级进解决)→ 不 emphasized → 不 flag
    const weak = [
      { ...note(60, 0), durationBeat: 0.5, structuralToneScore: 0.2 },
      { ...note(61, 0.75), durationBeat: 0.25, structuralToneScore: 0.2 },
      { ...note(62, 1), durationBeat: 0.5, structuralToneScore: 0.2 },
    ];
    const r = repairRepeatedMelodicFriction(weak, { pitchCtx: ctx(), style: 'pop', tonality: 'major', keyPc: 0, scalePcs: CMAJ });
    expect(r.audit.frictionPairsRepaired).toBe(0);
  });
});
