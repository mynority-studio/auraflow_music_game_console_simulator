import { describe, it, expect } from 'vitest';
import { timbreSource, classifyTimbreWorld, worldMismatches, repairWorldMismatches, sameInstrumentPairs } from './instruments';
import type { InstrumentRoleName } from '../band/BandSpec';

const rp = (o: Partial<Record<InstrumentRoleName, number>>) => o as Record<InstrumentRoleName, number>;

describe('knowledge/instruments · 音色世界统一性', () => {
  it('timbreSource:钢琴/弦乐/立式=acoustic · Rhodes/指弹=electric · 合成贝斯/pad=synth', () => {
    expect(timbreSource(0)).toBe('acoustic');
    expect(timbreSource(32)).toBe('acoustic');
    expect(timbreSource(4)).toBe('electric');
    expect(timbreSource(33)).toBe('electric');
    expect(timbreSource(38)).toBe('synth');
    expect(timbreSource(89)).toBe('synth');
  });

  it('★ classifyTimbreWorld:jazz→jazzCombo · lofi→lofiTapeKeys · pop 全 acoustic→acousticPianoBand · pop 合成→syntheticSoft', () => {
    expect(classifyTimbreWorld(rp({ comp: 0, bass: 32 }), 'jazz')).toBe('jazzCombo');
    expect(classifyTimbreWorld(rp({ comp: 4, bass: 33 }), 'lofi')).toBe('lofiTapeKeys');
    expect(classifyTimbreWorld(rp({ comp: 0, bass: 32 }), 'pop')).toBe('acousticPianoBand');
    expect(classifyTimbreWorld(rp({ comp: 1, bass: 33 }), 'pop')).toBe('brightPopHybrid'); // acoustic comp + electric bass
    expect(classifyTimbreWorld(rp({ comp: 4, bass: 38 }), 'pop')).toBe('syntheticSoft');   // electric comp + synth bass
    expect(classifyTimbreWorld(rp({ comp: 4, bass: 33 }), 'rnb')).toBe('electricKeys');
  });

  it('★ worldMismatches(不风格错配 guard):jazz+合成贝斯 / lofi+亮钢琴 comp / jazz+合唱 pad → flagged;干净→空', () => {
    expect(worldMismatches(rp({ comp: 0, bass: 38, pad: 49 }), 'jazz')).toContain('jazz≠synth-bass');
    expect(worldMismatches(rp({ comp: 1, bass: 33 }), 'lofi')).toContain('lofi≠bright-piano-comp');
    expect(worldMismatches(rp({ comp: 0, bass: 32, pad: 89 }), 'jazz')).toContain('jazz≠choir/warm-pad');
    expect(worldMismatches(rp({ comp: 0, bass: 32, pad: 49 }), 'jazz')).toEqual([]); // 标准 jazz combo 无错配
  });

  it('★ repairWorldMismatches:错配 → 从同 style 池换不错配候选;无错配 → 原对象(identity)', () => {
    const bad = rp({ lead: 11, comp: 0, bass: 38, pad: 49, drum: 0 }); // jazz 误用合成贝斯
    const fixed = repairWorldMismatches(bad, 'jazz');
    expect(fixed.bass).toBe(32);                       // 换立式(jazz 池 [32])
    expect(worldMismatches(fixed, 'jazz')).toEqual([]); // 修复后无错配
    const clean = rp({ lead: 11, comp: 0, bass: 32, pad: 49, drum: 0 });
    expect(repairWorldMismatches(clean, 'jazz')).toBe(clean); // 无错配 = 原对象返回(确定性/零改动)
  });

  it('★ sameInstrumentPairs:lead==comp 记录不拒绝;不同→空', () => {
    expect(sameInstrumentPairs(rp({ lead: 4, comp: 4 }))).toEqual([{ a: 'lead', b: 'comp', program: 4 }]);
    expect(sameInstrumentPairs(rp({ lead: 11, comp: 4 }))).toEqual([]);
  });
});
