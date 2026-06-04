import { describe, it, expect } from 'vitest';
import { resolveChordScenario, getMelodyTendency, tendencyTargetPcs } from './tendencyTable';
import { kkTension, intervalAesthetic, expectedResolutionPcs, KK_TENSION_MAJOR } from './keyProfiles';
import { pc } from '../foundation';

describe('knowledge · TendencyTable (P1-2 KB port)', () => {
  it('scenario 解析:maj7@T→M7T / maj7@S→M7S / m7@S→m7S / 7@D→7D / m7b5→null', () => {
    expect(resolveChordScenario('maj7', 'T')).toBe('M7T');
    expect(resolveChordScenario('maj7', 'S')).toBe('M7S');
    expect(resolveChordScenario('m7', 'S')).toBe('m7S');
    expect(resolveChordScenario('m7', 'T')).toBe('m7T');
    expect(resolveChordScenario('7', 'D')).toBe('7D');
    expect(resolveChordScenario('m7b5', 'D')).toBeNull(); // 退回基础判据
  });

  it('★ Cmaj7@T(M7T):根=CT / 4 度(F)=avoid / 9(D)=tension / 7 音(B)=CT', () => {
    const root = pc(0);
    expect(getMelodyTendency(pc(0), root, 'M7T').state).toBe('CT'); // C
    expect(getMelodyTendency(pc(5), root, 'M7T').state).toBe('A');  // F=4度 avoid
    expect(getMelodyTendency(pc(2), root, 'M7T').state).toBe('T');  // D=9 tension
    expect(getMelodyTendency(pc(11), root, 'M7T').state).toBe('CT');// B=maj7 CT
  });

  it('G7@D(7D):11 音(C)=avoid / maj7(F#=#11)=tension / b7(F)=CT;b9/#9 是 T 非 A', () => {
    const root = pc(7); // G
    expect(getMelodyTendency(pc(0), root, '7D').state).toBe('A');  // C=11 avoid
    expect(getMelodyTendency(pc(5), root, '7D').state).toBe('CT'); // F=b7 CT
    expect(getMelodyTendency(pc(8), root, '7D').state).toBe('T');  // Ab=b9 tension(非 avoid)
  });

  it('解决目标绝对 pc:Cmaj7 上 F(avoid)→ 解决到 E(4)', () => {
    const entry = getMelodyTendency(pc(5), pc(0), 'M7T'); // F on Cmaj7
    expect(tendencyTargetPcs(entry, pc(0))).toContain(4); // → E
  });
});

describe('knowledge · KeyProfiles K-K (P1-2 KB port)', () => {
  it('KK 张力:主音(0)最稳=0 / b2(1)最不稳=1 / 大三(4)≈0.478', () => {
    expect(kkTension(0, 'major')).toBe(0);
    expect(kkTension(1, 'major')).toBe(1);
    expect(KK_TENSION_MAJOR[4]).toBeCloseTo(0.478, 2);
  });

  it('调内美学:7 音=Leading(解决到主音)/ 主音=Home(无解决)', () => {
    expect(intervalAesthetic(11, 'major').function).toBe('Leading');
    expect(intervalAesthetic(0, 'major').function).toBe('Home');
    expect(expectedResolutionPcs(pc(11), pc(0), 'major')).toEqual([0]); // B→C
  });

  it('小调 K-K 与大调不同(b3 在小调更稳)', () => {
    expect(kkTension(3, 'minor')).toBeLessThan(kkTension(3, 'major')); // 小调 b3 稳
  });
});
