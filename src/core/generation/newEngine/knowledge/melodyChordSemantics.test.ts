import { describe, it, expect } from 'vitest';
import { evaluateNoteInChordContext, getMelodyChordSemantics } from './melodyChordSemantics';

// C 大调,各音用 pc(C=0…)
const ev = (notePc: number, chordType: string, chordRootPc: number, func: 'T' | 'S' | 'D', extra: Record<string, unknown> = {}) =>
  evaluateNoteInChordContext({ notePc, chordType, chordRootPc, effectiveFunc: func, keyRootPc: 0, globalMode: 'major', ...extra });

describe('knowledge · evaluateNoteInChordContext 统一评判器 (KB 移植 §6)', () => {
  it('和弦音 C on Cmaj7@T → consonant · 在 literal 契约 · urgency 0', () => {
    const r = ev(0, 'maj7', 0, 'T');
    expect(r.consonance).toBe('consonant');
    expect(r.isInChordContract).toBe(true);
    expect(r.urgency).toBe(0);
  });

  it('4 度 F on Cmaj7@T → avoid(M7T 倾向)· urgency 高', () => {
    const r = ev(5, 'maj7', 0, 'T');
    expect(r.consonance).toBe('avoid');
    expect(r.urgency).toBeGreaterThanOrEqual(0.9);
  });

  it('★ 导音 B on G7@D(C 调)→ Layer B 升级为 tension,解决目标含 C(0)', () => {
    // Layer A 7D[4]=CT 0.0;Layer B B=调内 7 音 leading kkTension 0.842 → 升 tension
    const r = ev(11, '7', 7, 'D');
    expect(r.consonance).toBe('tension');
    expect(r.resolutionTargets).toContain(0); // 解决到 C
  });

  it('9 音 D on Cmaj7 → 在可接受色彩扩展(isInChordExtension)', () => {
    const r = ev(2, 'maj7', 0, 'T');
    expect(r.isInChordExtension).toBe(true);  // 9 ∈ maj 可用色彩
    expect(r.isInChordContract).toBe(false);  // 非 literal
  });

  it('下一和弦锚点:D 是 G(下一和弦)的 5 音 → isInNextChordAnchor', () => {
    const r = ev(2, 'maj7', 0, 'T', { nextChordType: '7', nextChordRootPc: 7 }); // 下一和弦 G7,5 音=D(2)
    expect(r.isInNextChordAnchor).toBe(true);
  });

  it('modal:tonalCharacter=modal 时 urgency 减半(张力可挂)', () => {
    const tonal = ev(5, 'maj7', 0, 'T');
    const modal = ev(5, 'maj7', 0, 'T', { tonalCharacter: 'modal' });
    expect(modal.urgency).toBeLessThan(tonal.urgency);
    expect(modal.urgency).toBeCloseTo(tonal.urgency * 0.5, 5);
  });

  it('getMelodyChordSemantics:scenario 解析 + 无 improvisor(vocabFamily 恒 null)', () => {
    const s = getMelodyChordSemantics('maj7', 'T');
    expect(s.scenario).toBe('M7T');
    expect(s.base).toBe('maj');
    expect(s.isMajFamily).toBe(true);
    expect(s.vocabFamily).toBeNull();
    expect(getMelodyChordSemantics('m7', 'S').scenario).toBe('m7S'); // ii Dorian
  });
});
