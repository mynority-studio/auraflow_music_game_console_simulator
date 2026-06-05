import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from './harmonyEngine';
import { generateSong } from '../generation/GenerationController';
import { realChordScale } from '../knowledge/chordScales';
import { chordTones } from '../knowledge/chords';
import { createRandomContext, mod12, pc } from '../foundation';

describe('harmony · 小调打磨 V7-i (4.2)', () => {
  const KEY = 0; // C minor
  const mkMinor = (seed = 4) => {
    const seedRng = createRandomContext(seed);
    const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(KEY), mode: 'minor' });
    const arrangement = buildArrangementPlan(band, { rng: seedRng });
    return buildHarmonicPlanFromArrangement(band, arrangement, seedRng);
  };

  it('realChordScale:小调主属 V7 → Phrygian dominant(含升导音 + 调内 b6/b3)', () => {
    // C minor V7 = G7,根=7。预期 = C 和声小调 pc 集 {0,2,3,5,7,8,11}
    const scale = realChordScale(pc(7), pc(KEY), 'minor', { isDominant: true });
    expect(scale).toEqual([0, 2, 3, 5, 7, 8, 11]);
    expect(scale).toContain(11); // B♮ 升导音
    expect(scale).toContain(8);  // Ab 调内 b6(Mixolydian 会错成 A♮)
    // 大调 V7 仍 Mixolydian(对照)
    const maj = realChordScale(pc(7), pc(KEY), 'major', { isDominant: true });
    expect(maj).toEqual([0, 2, 4, 5, 7, 9, 11]); // G Mixolydian = C 大调
  });

  it('★ 小调出 V7:含升导音(大三),且 chord-tones ⊆ chord-scale(不变量)', () => {
    const plan = mkMinor();
    const v7s = plan.chordTimeline.filter((c) => c.quality === '7');
    expect(v7s.length).toBeGreaterThan(0);
    const leadingTone = mod12(KEY + 11); // C minor 升导音 B♮
    // ★ Loop 2:prototype 可含副属(V/V 等)→ 不是所有 '7' 都是 home V。仅 home V(root=G)查升导音。
    const homeV = v7s.filter((c) => c.rootPc === mod12(KEY + 7));
    expect(homeV.length).toBeGreaterThan(0);
    for (const c of homeV) {
      expect(chordTones(c.rootPc, '7')).toContain(leadingTone); // home V7 含升导音
      expect(new Set<number>(plan.chordScaleMap[c.id]).has(leadingTone)).toBe(true); // 升导音进音阶
    }
    // 不变量:所有 7 和弦(含副属)chord-tones ⊆ chord-scale
    for (const c of v7s) {
      const scale = new Set<number>(plan.chordScaleMap[c.id]);
      for (const t of chordTones(c.rootPc, c.quality)) expect(scale.has(t)).toBe(true);
    }
  });

  it('★ 出现 V7→i 解决(属七后接小调主和弦)', () => {
    const plan = mkMinor();
    const tl = plan.chordTimeline;
    const domRoot = mod12(KEY + 7);
    let found = false;
    for (let i = 0; i < tl.length - 1; i++) {
      if (tl[i].quality === '7' && tl[i].rootPc === domRoot && tl[i + 1].rootPc === KEY) {
        expect(['m7', 'min']).toContain(tl[i + 1].quality); // 解决到小调主(小品质)
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('端到端:小调多 seed generateSong 收敛(非 failed)', () => {
    for (let seed = 0; seed < 6; seed++) {
      const r = generateSong({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(KEY), mode: 'minor' });
      expect(r.status).not.toBe('failed');
    }
  });
});
