import { describe, it, expect } from 'vitest';
import { buildPitchSets } from './mgPitchClassSets';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import { resolveLocalScale, melodyContractPcsForStyle, type LocalScaleContext } from '../knowledge/mgLocalScaleResolver';

// ============================================================
// MG full-parity G3 — orthogonal pitch sets 不变量(directive §10 #1)
// 结构音 = written chord contract ∩ resolved local scale(交集空 → 回退 contract)。
// ============================================================

const cd = (root: string, rootMidi: number, type: string, roman: string): MgChordDef =>
  ({ root, rootMidi, type, bassMidi: rootMidi, duration: 4, roman } as MgChordDef);
// JAZZ ii-V-I:Dm7 / G7 / Cmaj7
const CHORDS = [cd('D', 50, 'm7', 'ii'), cd('G', 55, '7', 'V'), cd('C', 48, 'maj7', 'I')];
const blocks = buildChordPart(CHORDS).blocks;
const ctx: LocalScaleContext = { style: 'JAZZ', key: 'C', mode: 'major' } as LocalScaleContext;

const chordLikeOf = (b: typeof blocks[number]) =>
  ({ rootMidi: b.rootPc, type: b.type, roman: b.roman ?? '', effectiveFunc: b.functionHint, localTonalCenterPc: b.localKeyPc, forcedScale: b.forcedScale, borrowedFrom: b.borrowedFrom, borrowedSource: b.borrowedSource } as never);

describe('render/mgOrthogonalPitchSets(MG full-parity G3)', () => {
  it('★ 结构音 = contract ∩ local scale(交集空→contract);均 ⊆ contract', () => {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const sets = buildPitchSets({ chord: b, nextChord: blocks[i + 1] ?? null, localScaleContext: ctx });
      const contract = melodyContractPcsForStyle(ctx.style, chordLikeOf(b), b.rootPc);
      const scale = resolveLocalScale(ctx, chordLikeOf(b)).pcs;
      const intersection = [...contract].filter((pc) => scale.has(pc));
      const expectedStructural = (intersection.length > 0 ? intersection : [...contract]).sort((a, c) => a - c);
      expect(sets.chordTones, `${b.root}${b.type} 结构音=intersection?contract`).toEqual(expectedStructural);
      for (const pc of sets.chordTones) expect([...contract], `${b.root}${b.type} 结构音⊆contract`).toContain(pc);
    }
  });

  it('★ colorTones ⊆ chordTones 且都是 declared color(非 basic 0/3/4/5/7/10/11)', () => {
    for (const b of blocks) {
      const sets = buildPitchSets({ chord: b, nextChord: null, localScaleContext: ctx });
      for (const pc of sets.colorTones) {
        expect(sets.chordTones).toContain(pc);
        const interval = ((pc - b.rootPc) % 12 + 12) % 12;
        expect([0, 3, 4, 5, 7, 10, 11]).not.toContain(interval);
      }
    }
  });

  it('★ scaleTones ⊆ local scale 且不与结构音重叠;集合都是合法 pc', () => {
    for (const b of blocks) {
      const sets = buildPitchSets({ chord: b, nextChord: null, localScaleContext: ctx });
      const scale = resolveLocalScale(ctx, chordLikeOf(b)).pcs;
      for (const pc of sets.scaleTones) { expect(scale.has(pc)).toBe(true); expect(sets.chordTones).not.toContain(pc); }
      for (const set of [sets.chordTones, sets.colorTones, sets.scaleTones, sets.approachTargets, sets.outsideTones]) {
        for (const pc of set) { expect(pc).toBeGreaterThanOrEqual(0); expect(pc).toBeLessThan(12); }
      }
    }
  });

  it('★ orthogonal(有 ctx)≠ vocab(无 ctx):JAZZ 属和弦走真 chord-scale', () => {
    const g7 = blocks[1];
    const ortho = buildPitchSets({ chord: g7, nextChord: blocks[2], localScaleContext: ctx });
    const vocab = buildPitchSets({ chord: g7, nextChord: blocks[2] });
    expect(JSON.stringify(ortho)).not.toBe(JSON.stringify(vocab));
  });

  it('★ priorityPcs 含全部结构音(reorder 不丢音)+ 确定性', () => {
    const sets = buildPitchSets({ chord: blocks[0], nextChord: blocks[1], localScaleContext: ctx });
    expect([...sets.priorityPcs].sort((a, b) => a - b)).toEqual([...sets.chordTones].sort((a, b) => a - b));
    const again = buildPitchSets({ chord: blocks[0], nextChord: blocks[1], localScaleContext: ctx });
    expect(JSON.stringify(sets)).toBe(JSON.stringify(again));
  });
});
