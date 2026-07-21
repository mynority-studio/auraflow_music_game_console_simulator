import { describe, it, expect } from 'vitest';
import { realChordScale } from './chordScales';
import { pc } from '../foundation';

describe('knowledge · 真 chord-scale (3.6)', () => {
  const C = pc(0);

  it('调内大调和弦 → 完整母调音阶(7 音,含 avoid 4 度 F=5)', () => {
    // C 大调,任一调内根音 → C 大调音阶 {0,2,4,5,7,9,11}
    const cmaj = realChordScale(pc(0), C, 'major'); // I
    expect(cmaj).toEqual([0, 2, 4, 5, 7, 9, 11]);
    // ii(Dm7,根=2)在同调内 → pc 集合恒等于母调(调式只是起点不同)
    const dm = realChordScale(pc(2), C, 'major');
    expect(dm).toEqual([0, 2, 4, 5, 7, 9, 11]);
    // 含旧占位 stable∪acceptable 漏掉的 F(4 度 avoid 仍属音阶)
    expect(cmaj).toContain(5);
  });

  it('调内小调 → 自然小调音阶', () => {
    const cm = realChordScale(pc(0), C, 'minor'); // i
    expect(cm).toEqual([0, 2, 3, 5, 7, 8, 10]); // C 自然小调
  });

  it('副属 D7(V7/V)→ 根音 Mixolydian,含离调 F#(=6)', () => {
    const d7 = realChordScale(pc(2), C, 'major', { isSecondaryDominant: true });
    expect(d7).toEqual([0, 2, 4, 6, 7, 9, 11]); // D E F# G A B C
    expect(d7).toContain(6); // F# 离调(母调无)
  });

  it('7b13 → Mixolydian b6，完整包含属七和弦的 b13', () => {
    // A7b13 = A C# E G F; A Mixolydian b6 = A B C# D E F G.
    const a7b13 = realChordScale(pc(9), C, 'major', { isSecondaryDominant: true, dominantType: '7b13' });
    expect(a7b13).toEqual([1, 2, 4, 5, 7, 9, 11]);
    expect(a7b13).toContain(5); // F = b13
  });

  it('7b9 → Phrygian dominant，完整包含 b9、3、5、b7', () => {
    const a7b9 = realChordScale(pc(9), C, 'major', { isSecondaryDominant: true, dominantType: '7b9' });
    expect(a7b9).toEqual([1, 2, 4, 5, 7, 9, 10]);
  });

  it('7#9 / 7#9#11 → Composite Blues，同时保留大三度与 altered tensions', () => {
    const c7Sharp9 = realChordScale(pc(0), C, 'major', { isDominant: true, dominantType: '7#9' });
    expect(c7Sharp9).toEqual([0, 3, 4, 5, 6, 7, 10]);
    expect(c7Sharp9).toEqual(expect.arrayContaining([0, 3, 4, 7, 10]));

    const c7Sharp9Sharp11 = realChordScale(pc(0), C, 'major', { isDominant: true, dominantType: '7#9#11' });
    expect(c7Sharp9Sharp11).toEqual(expect.arrayContaining([0, 3, 4, 6, 7, 10]));
  });

  it('借和弦 iv Fm7 → 根音 Dorian,含离调 Ab(=8)/Eb(=3)', () => {
    const fm = realChordScale(pc(5), C, 'major', { isBorrowed: true });
    expect(fm).toEqual([0, 2, 3, 5, 7, 8, 10]); // F G Ab Bb C D Eb 的 pc 集
    expect(fm).toContain(8); // Ab 离调
    expect(fm).toContain(3); // Eb 离调
  });
});
