import { describe, it, expect } from 'vitest';
import { harmonicPlanToMgChordDefs, chordSpanToMgChordDef } from './mgChordDefAdapter';
import { buildChordPart } from './mgChordPart';
import { parseRoadMap } from './mgRoadMapParser';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createRandomContext, pc } from '../foundation';

// ============================================================
// MG strict 移植 Loop 2 — HarmonicPlan → MgChordDef adapter
// ------------------------------------------------------------
// 验证我们的 HarmonicPlan 经 adapter 能产出良构 MgChordDef[],并被忠实港的
// buildChordPart + parseRoadMap 端到端消费(不 crash、覆盖完整、确定性)。
// 注:此处不验证 brick 与 MG 一致(Option B:我们和弦 ≠ MG 和弦);RoadMap parity 见 *.parity.test。
// ============================================================

const mkPlan = (style: string, seed: number) => {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120, key: pc(0), mode: 'major' });
  const arrangement = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  return plan;
};

describe('render/mgChordDefAdapter · HarmonicPlan → MgChordDef (Loop 2)', () => {
  it('chordSpanToMgChordDef:rootMidi%12 = rootPc;type 宽优先;duration 直传', () => {
    const span = {
      id: 'x', roman: 'I', rootPc: pc(5), quality: 'min', startBeat: 0, durationBeats: 4, sectionId: 's',
      chordType: 'm9', forcedScale: 'Dorian', localTonalCenterPc: pc(2),
    } as never;
    const def = chordSpanToMgChordDef(span);
    expect(((def.rootMidi % 12) + 12) % 12).toBe(5);
    expect(def.type).toBe('m9');          // 宽 chordType 优先
    expect(def.duration).toBe(4);
    expect(def.forcedScale).toBe('Dorian');
    expect(def.localTonalCenterPc).toBe(2);
  });

  it('type 回退窄 quality(无 chordType 时)', () => {
    const span = { id: 'x', roman: 'V', rootPc: pc(7), quality: '7', startBeat: 0, durationBeats: 2, sectionId: 's' } as never;
    expect(chordSpanToMgChordDef(span).type).toBe('7');
  });

  it('bass:pedal / 转位 3rd·5th·7th 取真实和弦音(slash bass);否则根位', () => {
    const bpc = (s: object) => ((chordSpanToMgChordDef(s as never).bassMidi % 12) + 12) % 12;
    const base = { id: 'x', roman: { degree: 1, accidental: 'natural', quality: 'maj' }, rootPc: pc(7), quality: 'maj', startBeat: 0, durationBeats: 4, sectionId: 's' };
    expect(bpc({ ...base, bassRole: 'pedal', bassPedalPc: pc(0) })).toBe(0); // C pedal under G
    expect(bpc({ ...base, bassRole: '3rd' })).toBe(11);                       // G maj 3rd = B(转位真实 bass)
    expect(bpc({ ...base, bassRole: '5th' })).toBe(2);                        // G maj 5th = D
    expect(bpc({ ...base })).toBe(7);                                         // 无 bassRole → 根位 G
  });

  it('★ Loop 2 全字段:effectiveFunc(度数 TSD)/ 真实 notesMidi / borrowedFrom / chordSymbol', () => {
    const I = chordSpanToMgChordDef({ id: 'a', roman: { degree: 1, accidental: 'natural', quality: 'maj7' }, rootPc: pc(0), quality: 'maj7', chordType: 'maj7', startBeat: 0, durationBeats: 4, sectionId: 's' } as never);
    expect(I.effectiveFunc).toBe('T');
    expect(I.notesMidi!.map((m) => m % 12)).toEqual([0, 4, 7, 11]); // Cmaj7 真实和弦音(非 stableTones 凑数)
    expect(I.notes).toEqual(['C', 'E', 'G', 'B']);
    expect(I.chordSymbol).toBe('Cmaj7');
    expect(I.borrowedFrom).toBe(null);
    // V7(mustResolve)→ D
    const V = chordSpanToMgChordDef({ id: 'b', roman: { degree: 5, accidental: 'natural', quality: '7' }, rootPc: pc(7), quality: '7', chordType: '7', startBeat: 0, durationBeats: 4, sectionId: 's', mustResolve: true } as never);
    expect(V.effectiveFunc).toBe('D');
    // ★ Gap A:borrowedFrom 现为 harmony 层透传(span.borrowedFrom);render 不推导 →
    //   span 带 borrowedFrom 即原样输出,不带则 null(下面测 passthrough)。
    const iv = chordSpanToMgChordDef({ id: 'c', roman: { degree: 4, accidental: 'natural', quality: 'm7' }, rootPc: pc(5), quality: 'm7', chordType: 'm7', startBeat: 0, durationBeats: 4, sectionId: 's', borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor iv' } as never);
    expect(iv.effectiveFunc).toBe('S');
    expect(iv.borrowedFrom).toBe('parallel minor iv'); // 作者标签精确 passthrough
  });

  it('★ 真 HarmonicPlan 端到端:adapter → buildChordPart → parseRoadMap 不 crash、覆盖完整', () => {
    for (const style of ['pop', 'lofi', 'rnb', 'jazz']) {
      const plan = mkPlan(style, 7);
      const defs = harmonicPlanToMgChordDefs(plan);
      expect(defs.length).toBe(plan.chordTimeline.length);
      const part = buildChordPart(defs);
      const road = parseRoadMap({ part, songKeyPc: 0 });
      // 全和弦被连续覆盖
      const covered = road.bricks.flatMap((b) => b.chordIndices);
      expect(covered).toEqual(defs.map((_, i) => i));
      // rootPc 保真
      defs.forEach((d, i) => {
        expect(((d.rootMidi % 12) + 12) % 12).toBe(((plan.chordTimeline[i].rootPc % 12) + 12) % 12);
      });
    }
  });

  it('确定性:同 seed 两次 adapter+parse 结果一致', () => {
    const a = parseRoadMap({ part: buildChordPart(harmonicPlanToMgChordDefs(mkPlan('pop', 11))), songKeyPc: 0 });
    const b = parseRoadMap({ part: buildChordPart(harmonicPlanToMgChordDefs(mkPlan('pop', 11))), songKeyPc: 0 });
    expect(a).toEqual(b);
  });
});
