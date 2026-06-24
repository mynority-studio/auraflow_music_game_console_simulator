import { describe, it, expect } from 'vitest';
import { buildAccompaniment } from './accompaniment';
import { makeChord, type SandboxChord } from './chords';

const m12 = (n: number) => ((n % 12) + 12) % 12;

// seasoned C7#9(tonic):C E G Bb Eb,bluesSeasoned
const c7sharp9: SandboxChord = { ...makeChord(1, 0, 'major', 0, 4), realRoman: 'I7', realType: '7', realRootPc: 0, realTonePcs: [0, 4, 7, 10, 3], bluesSeasoned: true, effectiveFunc: 'T' };
const plainC: SandboxChord = makeChord(1, 0, 'major', 0, 4); // 普通 C 三和弦

describe('motifSandbox/blues comp voicing(Phase 7)', () => {
  it('★ seasoned blue3 和弦:comp 走 no-3 shell(不含硬大三 E,让 lead 主蓝音)', () => {
    const acc = buildAccompaniment([c7sharp9], 'pop', 7);
    const compPcs = new Set(acc.comp.map((n) => m12(n.midi)));
    expect(compPcs.has(4), 'comp 不含自然大三 E').toBe(false); // pc4 = E
    expect(compPcs.has(0) || compPcs.has(7) || compPcs.has(10), 'comp 含 root/5/b7 shell').toBe(true);
  });

  it('★ 普通(未 seasoned)和弦:comp 正常含三度(不误伤非布鲁斯)', () => {
    const acc = buildAccompaniment([plainC], 'pop', 7);
    const compPcs = new Set(acc.comp.map((n) => m12(n.midi)));
    expect(compPcs.has(4)).toBe(true); // 普通 C 三和弦 comp 含 E
  });

  it('★ 伴奏消费 realTonePcs + comp/bass 非空(§11.5)', () => {
    const acc = buildAccompaniment([c7sharp9], 'pop', 7);
    expect(acc.comp.length).toBeGreaterThan(0);
    expect(acc.bass.length).toBeGreaterThan(0);
    const compPcs = new Set(acc.comp.map((n) => m12(n.midi)));
    expect(compPcs.has(10), 'comp 含 seasoned b7(Bb,来自 realTonePcs)').toBe(true); // pc10 = Bb
  });
});
