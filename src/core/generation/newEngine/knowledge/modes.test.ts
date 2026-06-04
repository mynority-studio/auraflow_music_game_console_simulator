import { describe, it, expect } from 'vitest';
import { modalScale, modalVamp, nearestInScale } from './modes';
import { pc } from '../foundation';

describe('knowledge · 教会调式 + vamp (4.1)', () => {
  it('modalScale:D Dorian = D E F G A B C(scale-step 序)', () => {
    expect(modalScale(pc(2), 'dorian')).toEqual([2, 4, 5, 7, 9, 11, 0]);
  });

  it('modalVamp:Dorian = [i m7, IV maj];Mixolydian = [I 7, bVII maj]', () => {
    const dor = modalVamp(pc(2), 'dorian'); // D
    expect(dor[0]).toMatchObject({ rootPc: 2, quality: 'm7', label: 'i' });
    expect(dor[1]).toMatchObject({ rootPc: 7, quality: 'maj', label: 'IV' }); // G
    const mix = modalVamp(pc(7), 'mixolydian'); // G
    expect(mix[0]).toMatchObject({ rootPc: 7, quality: '7', label: 'i' });
    expect(mix[1]).toMatchObject({ rootPc: 5, quality: 'maj', label: 'bVII' }); // F
  });

  it('nearestInScale:scale 内原样;scale 外就近收入', () => {
    const cDorian = modalScale(pc(0), 'dorian'); // C D Eb F G A Bb = 0 2 3 5 7 9 10
    expect(nearestInScale(pc(3), cDorian)).toBe(3); // Eb 在内
    expect(nearestInScale(pc(4), cDorian)).toBe(3); // E(4)→ 就近 Eb(3)
    expect(nearestInScale(pc(1), cDorian)).toBe(0); // Db(1)→ C(0) 或 D(2),取最近 C
  });
});
