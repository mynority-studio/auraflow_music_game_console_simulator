import { describe, it, expect } from 'vitest';
import { buildPitchSets } from './mgPitchClassSets';
import { chooseNote } from './mgNoteChooser';
import { resolveDegree, CHORD_TYPES, MELODY_RANGE } from '../knowledge/mgMusicTheoryTables';
import type { ChordBlock } from './mgChordPart';
import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';

// ============================================================
// MG strict 移植 Loop 4 — PitchClassSets / NoteChooser / resolveDegree 单元锁
// ============================================================

const mkBlock = (rootPc: number, type: string, index = 0): ChordBlock => ({
  index, root: 'C', rootPc, bassPc: rootPc, type,
  durationBeats: 4, startBeat: index * 4, endBeat: index * 4 + 4,
});

describe('knowledge/mgMusicTheoryTables · resolveDegree(family-aware)', () => {
  it('major 家族:3=4 半音、7=11', () => {
    expect(resolveDegree('3', 'maj7')).toBe(4);
    expect(resolveDegree('7', 'maj7')).toBe(11);
  });
  it('minor7 家族:7=b7=10(jazz 约定 "Dm7 的 7 是 C")', () => {
    expect(resolveDegree('7', 'm7')).toBe(10);
  });
  it('dominant 家族:7=b7=10、#11=6', () => {
    expect(resolveDegree('7', '7')).toBe(10);
    expect(resolveDegree('#11', '7')).toBe(6);
  });
  it('literal fallback:b9=1', () => {
    expect(resolveDegree('b9', 'maj7')).toBe(1);
  });
  it('CHORD_TYPES 关键间隔', () => {
    expect(CHORD_TYPES['maj7']).toEqual([0, 4, 7, 11]);
    expect(CHORD_TYPES['m7']).toEqual([0, 3, 7, 10]);
    expect(CHORD_TYPES['7']).toEqual([0, 4, 7, 10]);
    expect(MELODY_RANGE).toEqual({ LOW: 60, HIGH: 86 });
  });
});

describe('render/mgPitchClassSets · buildPitchSets', () => {
  it('Cmaj7:chordTones ⊇ {0,4,7,11};pc 集合不互相重叠', () => {
    const sets = buildPitchSets({ chord: mkBlock(0, 'maj7'), nextChord: null });
    expect(sets.rootPc).toBe(0);
    for (const pc of [0, 4, 7, 11]) expect(sets.chordTones).toContain(pc);
    // 非重叠:chord/color/scale/approach/outside 两两不交
    const groups = [sets.chordTones, sets.colorTones, sets.scaleTones, sets.outsideTones];
    const seen = new Set<number>();
    for (const g of groups) for (const pc of g) {
      expect(seen.has(pc)).toBe(false);
      seen.add(pc);
    }
  });

  it('Dm7:根 2,chordTones ⊇ {2,5,9,0}(D F A C)', () => {
    const sets = buildPitchSets({ chord: mkBlock(2, 'm7'), nextChord: null });
    for (const pc of [2, 5, 9, 0]) expect(sets.chordTones).toContain(pc);
  });
});

describe('render/mgNoteChooser · chooseNote', () => {
  const sets = buildPitchSets({ chord: mkBlock(0, 'maj7'), nextChord: null });

  it('R token → 休止(midi null)', () => {
    const r = chooseNote({ kind: 'R', duration: 0.5 } as AbstractMelodyToken, { sets, prevMidi: 67 });
    expect(r.midi).toBeNull();
  });

  it('C token(argmax,无 rng)→ 落和弦音、在音域内', () => {
    const c = chooseNote({ kind: 'C', duration: 0.5 } as AbstractMelodyToken, { sets, prevMidi: 67 });
    expect(c.midi).not.toBeNull();
    const pc = ((c.midi! % 12) + 12) % 12;
    expect(sets.chordTones).toContain(pc);
    expect(c.midi!).toBeGreaterThanOrEqual(MELODY_RANGE.LOW - 6);
    expect(c.midi!).toBeLessThanOrEqual(MELODY_RANGE.HIGH);
  });

  it('G token(GOAL)→ 偏向 3rd/7th(高权重);确定性', () => {
    const g1 = chooseNote({ kind: 'G', duration: 1 } as AbstractMelodyToken, { sets, prevMidi: 67 });
    const g2 = chooseNote({ kind: 'G', duration: 1 } as AbstractMelodyToken, { sets, prevMidi: 67 });
    expect(g1.midi).toBe(g2.midi); // argmax 确定
    const pc = ((g1.midi! % 12) + 12) % 12;
    expect([4, 11]).toContain(pc); // Cmaj7 的 3rd(E=4)或 7th(B=11)权重最高
  });

  it('确定性:同输入同 rng 序列结果一致', () => {
    const mk = () => { let s = 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
    const a = chooseNote({ kind: 'S', duration: 0.5 } as AbstractMelodyToken, { sets, prevMidi: 67, rng: mk() });
    const b = chooseNote({ kind: 'S', duration: 0.5 } as AbstractMelodyToken, { sets, prevMidi: 67, rng: mk() });
    expect(a.midi).toBe(b.midi);
  });
});
