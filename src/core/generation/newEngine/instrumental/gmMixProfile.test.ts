import { describe, it, expect } from 'vitest';
import {
  pickSpaceProfile,
  songSpaceProfile,
  mixForProgram,
  enforceRelationalMix,
  type RoleMix,
  type SpaceProfile,
} from '../knowledge/gmMixProfile';
import type { InstrumentRoleName } from '../band/BandSpec';
import type { TimbreWorld } from '../knowledge/instruments';

// 各风格【代表性】角色 → 生效 program(暖路线池内,与 instruments.ts 一致)。
const PALETTE: Record<string, Partial<Record<InstrumentRoleName, number[]>>> = {
  pop:  { bass: [32, 38], comp: [0, 5, 24, 25], lead: [0, 5, 25, 11, 108], pad: [89], drum: [0] },
  lofi: { bass: [32, 38], comp: [5, 24, 25, 0], lead: [5, 0, 11, 108, 25], pad: [89], drum: [0] },
  rnb:  { bass: [32, 38], comp: [5, 25, 0, 24], lead: [5, 0, 25, 11], pad: [89], drum: [0] },
  jazz: { bass: [32], comp: [0, 5, 25], lead: [0, 11, 67], pad: [89], drum: [0] },
};

const isInt = (v: number) => Number.isInteger(v);
const inRange = (v: number) => v >= 0 && v <= 127;

function eachRoleProgram(fn: (style: string, role: InstrumentRoleName, program: number) => void): void {
  for (const [style, roles] of Object.entries(PALETTE)) {
    for (const [role, programs] of Object.entries(roles)) {
      for (const p of programs!) fn(style, role as InstrumentRoleName, p);
    }
  }
}

describe('knowledge/gmMixProfile — pickSpaceProfile', () => {
  it('风格 / timbreWorld / 有无 pad → 空间', () => {
    expect(pickSpaceProfile('jazz', undefined, true)).toBe('jazzClub');
    expect(pickSpaceProfile('blues', undefined, true)).toBe('jazzClub');
    expect(pickSpaceProfile('lofi', undefined, true)).toBe('lofiTapeRoom');
    expect(pickSpaceProfile('rnb', undefined, true)).toBe('rnbPlateRoom');
    expect(pickSpaceProfile('pop', 'syntheticSoft' as TimbreWorld, true)).toBe('syntheticSoftRoom');
    expect(pickSpaceProfile('pop', undefined, false)).toBe('dryFront');
    expect(pickSpaceProfile('pop', undefined, true)).toBe('popWarmRoom');
  });
});

describe('knowledge/gmMixProfile — mixForProgram CC 合法性', () => {
  it('每个 style×role×program 都拿到 RoleMix(4 个 CC 全整数 0..127)', () => {
    eachRoleProgram((style, role, program) => {
      const space = pickSpaceProfile(style, undefined, role !== 'drum');
      const m = mixForProgram({ style, timbreWorld: undefined, role, program, hasPad: true, space });
      for (const v of [m.volume, m.pan, m.reverb, m.chorus]) {
        expect(isInt(v), `${style}/${role}/${program} CC 非整数: ${v}`).toBe(true);
        expect(inRange(v), `${style}/${role}/${program} CC 越界: ${v}`).toBe(true);
      }
    });
  });
});

describe('knowledge/gmMixProfile — 单角色护栏', () => {
  const space: SpaceProfile = 'popWarmRoom';
  const mk = (role: InstrumentRoleName, program: number, hasPad = true) =>
    mixForProgram({ style: 'pop', timbreWorld: undefined, role, program, hasPad, space });

  it('bass.reverb ≤ 12 且有小 room send:低频靠后一点但不糊', () => {
    for (const p of [32, 33, 34, 35, 36, 37, 38, 39]) expect(mk('bass', p).reverb).toBeLessThanOrEqual(12);
    expect(mk('bass', 32).reverb).toBe(10);
    expect(mk('bass', 38).reverb).toBe(8);
    expect(mk('bass', 32).volume).toBe(74);
    expect(mk('bass', 38).volume).toBe(72);
    expect(mk('bass', 38).chorus).toBeLessThanOrEqual(3);
  });

  it('drum.chorus == 0', () => {
    expect(mk('drum', 0).chorus).toBe(0);
  });

  it('drum 进受控 room:靠后一点但仍不超过小喇叭瞬态上限', () => {
    const drum = mk('drum', 0);
    expect(drum.volume).toBe(86);
    expect(drum.reverb).toBe(14);
    expect(drum.chorus).toBe(0);
  });

  it('Room 鼓组对齐试听 room send:保留 kick 空间,但不影响 808/Brush', () => {
    expect(mk('drum', 8)).toMatchObject({ volume: 86, reverb: 30, chorus: 0 });
    expect(mk('drum', 25)).toMatchObject({ volume: 86, reverb: 14, chorus: 0 });
    expect(mk('drum', 40)).toMatchObject({ volume: 86, reverb: 14, chorus: 0 });
  });

  it('FX pad 98/99/100/102:volume ≤ 60 且 reverb 保留空气层但不再淹没总线', () => {
    for (const sp of ['popWarmRoom', 'lofiTapeRoom', 'rnbPlateRoom', 'jazzClub', 'dryFront', 'syntheticSoftRoom'] as SpaceProfile[]) {
      for (const p of [98, 99, 100, 102]) {
        const m = mixForProgram({ style: 'pop', timbreWorld: undefined, role: 'pad', program: p, hasPad: true, space: sp });
        expect(m.volume, `FX pad ${p}@${sp} vol`).toBeLessThanOrEqual(60);
        expect(m.reverb, `FX pad ${p}@${sp} rev`).toBeGreaterThanOrEqual(72);
        expect(m.chorus, `FX pad ${p}@${sp} chorus`).toBeLessThanOrEqual(56);
      }
    }
  });

  it('电钢 4/5 都收干:不靠大 chorus/reverb 压住大钢琴', () => {
    expect(mk('comp', 4)).toMatchObject({ volume: 72, reverb: 18, chorus: 12 });
    expect(mk('lead', 4)).toMatchObject({ volume: 80, reverb: 22, chorus: 14 });
    expect(mk('comp', 5)).toMatchObject({ volume: 70, reverb: 12, chorus: 6 });
    expect(mk('lead', 5)).toMatchObject({ volume: 76, reverb: 16, chorus: 8 });
  });

  it('GU Electric Grand 槽位 5 比 Rhodes 4 更少空间,避免电钢尾巴堆叠', () => {
    expect(mk('comp', 5).chorus).toBeLessThan(mk('comp', 4).chorus);
    expect(mk('lead', 5).chorus).toBeLessThan(mk('lead', 4).chorus);
    expect(mk('comp', 5).reverb).toBeLessThan(mk('comp', 4).reverb);
    expect(mk('lead', 5).reverb).toBeLessThan(mk('lead', 4).reverb);
  });

  it('GU Electric Grand 槽位 5 只有少量空气:release 之外不再给大 reverb/chorus/delay', () => {
    const comp = mk('comp', 5);
    const lead = mk('lead', 5);
    expect(comp.volume).toBeLessThanOrEqual(70);
    expect(lead.volume).toBeLessThanOrEqual(76);
    expect(comp.reverb).toBeLessThanOrEqual(12);
    expect(lead.reverb).toBeLessThanOrEqual(16);
    expect(comp.chorus).toBeLessThanOrEqual(6);
    expect(lead.chorus).toBeLessThanOrEqual(8);
    expect(comp.delay).toBeUndefined();
    expect(lead.delay).toBeUndefined();
  });

  it('Jazz/ACG 的 FM EP 不进共享 delay,避免和 club/cinematic 空间叠糊', () => {
    for (const style of ['jazz', 'acg']) {
      const space = pickSpaceProfile(style, undefined, true);
      expect(mixForProgram({ style, timbreWorld: undefined, role: 'lead', program: 5, hasPad: true, space }).delay).toBeUndefined();
      expect(mixForProgram({ style, timbreWorld: undefined, role: 'comp', program: 5, hasPad: true, space }).delay).toBeUndefined();
    }
  });

  it('吉他 comp 保持干短:低 reverb/chorus,且不进 delay', () => {
    for (const p of [24, 25]) {
      const m = mk('comp', p);
      expect(m.volume, `GM${p} comp volume`).toBeLessThanOrEqual(78);
      expect(m.reverb, `GM${p} comp reverb`).toBeLessThanOrEqual(20);
      expect(m.chorus, `GM${p} comp chorus`).toBeLessThanOrEqual(2);
      expect(m.delay, `GM${p} comp delay`).toBeUndefined();
    }
  });

  it('民谣木吉他 25 不走 clean-electric delay,bass/drum/pad 不进 delay', () => {
    expect(mk('lead', 25).delay).toBeUndefined();
    expect(mk('comp', 25).delay).toBeUndefined();
    expect(mk('bass', 32).delay).toBeUndefined();
    expect(mk('drum', 0).delay).toBeUndefined();
    expect(mk('pad', 89).delay).toBeUndefined();
  });

  it('POP 无 pad 的 dryFront 也打开 eighth delay bus,供 EP/lofi delay 使用', () => {
    const warm = songSpaceProfile('pop', undefined, true);
    const dry = songSpaceProfile('pop', undefined, false);
    expect(warm.delayMode).toBe('eighth');
    expect(warm.delayFeedback).toBeGreaterThan(0);
    expect(dry.delayMode).toBe('eighth');
    expect(dry.delayFeedback).toBeGreaterThan(0);
  });

  it('Clav 7:reverb ≤ 30(各空间)', () => {
    for (const sp of ['popWarmRoom', 'rnbPlateRoom', 'syntheticSoftRoom'] as SpaceProfile[]) {
      const m = mixForProgram({ style: 'rnb', timbreWorld: undefined, role: 'comp', program: 7, hasPad: true, space: sp });
      expect(m.reverb).toBeLessThanOrEqual(30);
    }
  });

  it('颤音琴/马林巴/卡林巴 mallet 音准优先:chorus == 0', () => {
    for (const p of [11, 12, 107, 108]) expect(mk('lead', p).chorus).toBe(0);
  });

  it('颤音琴高区防刺耳:lead 不大湿、不高音量', () => {
    const m = mk('lead', 11);
    expect(m.volume).toBeLessThanOrEqual(88);
    expect(m.reverb).toBeLessThanOrEqual(40);
    expect(m.delay ?? 0).toBe(0);
  });

  it('lead pan 居中 58..70(各 program)', () => {
    for (const p of [0, 4, 11, 12, 67, 75]) {
      const m = mk('lead', p);
      expect(m.pan).toBeGreaterThanOrEqual(58);
      expect(m.pan).toBeLessThanOrEqual(70);
    }
  });

  it('bass/drum 居中 pan=64', () => {
    expect(mk('bass', 33).pan).toBe(64);
    expect(mk('drum', 0).pan).toBe(64);
  });

  // ★ melody-forward(2026-06-23,用户:走 A 整编旋律声音小):lead CC7 抬高 → 旋律明显坐在 comp 之上。
  it('★ lead.volume > comp.volume(同 program,旋律在 comp 之上)且 ≥ 92', () => {
    for (const p of [0, 12, 6, 67]) { // jazz/暖路线代表 lead program;GM4/5 电钢有防糊专属规则;GM11 有高区防刺耳专属规则
      const lead = mk('lead', p).volume;
      const comp = mk('comp', p).volume;
      expect(lead, `gm${p} lead 比 comp 响`).toBeGreaterThan(comp);
      expect(lead, `gm${p} lead CC7 ≥ 92`).toBeGreaterThanOrEqual(92);
    }
  });
});

describe('knowledge/gmMixProfile — enforceRelationalMix(comp↔pad)', () => {
  const space: SpaceProfile = 'popWarmRoom';
  const buildSet = (compProg: number, padProg: number): Partial<Record<InstrumentRoleName, RoleMix>> => ({
    comp: mixForProgram({ style: 'pop', timbreWorld: undefined, role: 'comp', program: compProg, hasPad: true, space }),
    pad: mixForProgram({ style: 'pop', timbreWorld: undefined, role: 'pad', program: padProg, hasPad: true, space }),
  });

  it('pad.reverb ≥ comp.reverb + 20(两者在场)', () => {
    const fixed = enforceRelationalMix(buildSet(0, 89));
    expect(fixed.pad!.reverb).toBeGreaterThanOrEqual(fixed.comp!.reverb + 20);
  });

  it('pad.volume ≤ comp.volume - 10(非唯一和声,背景让位)', () => {
    const fixed = enforceRelationalMix(buildSet(4, 89), { padIsOnlyHarmony: false });
    expect(fixed.pad!.volume).toBeLessThanOrEqual(fixed.comp!.volume - 10);
  });

  it('pad 唯一和声 → 不被压响度', () => {
    const set = buildSet(4, 90);
    // 人为把 pad 抬到比 comp 响,验证 padIsOnlyHarmony 时不压
    set.pad = { ...set.pad!, volume: set.comp!.volume + 10 };
    const fixed = enforceRelationalMix(set, { padIsOnlyHarmony: true });
    expect(fixed.pad!.volume).toBe(set.comp!.volume + 10);
  });

  it('|comp.pan − pad.pan| ≥ 22(两者在场)', () => {
    const fixed = enforceRelationalMix(buildSet(0, 89));
    expect(Math.abs(fixed.comp!.pan - fixed.pad!.pan)).toBeGreaterThanOrEqual(22);
  });

  it('缺 comp 或 pad → 原样返回', () => {
    const only = { comp: mixForProgram({ style: 'pop', timbreWorld: undefined, role: 'comp', program: 0, hasPad: false, space }) };
    expect(enforceRelationalMix(only)).toBe(only);
  });
});

describe('knowledge/gmMixProfile — ACG solo-piano 平衡(2026-06-28 用户:lead 碾全队/一轨很小声)', () => {
  const space: SpaceProfile = 'dryFront';
  const mAcg = (role: InstrumentRoleName, program: number) => mixForProgram({ style: 'acg', timbreWorld: undefined, role, program, hasPad: true, space });
  const mLofi = (role: InstrumentRoleName, program: number) => mixForProgram({ style: 'lofi', timbreWorld: undefined, role, program, hasPad: true, space });
  const mPop = (role: InstrumentRoleName, program: number) => mixForProgram({ style: 'pop', timbreWorld: undefined, role, program, hasPad: true, space });

  it('★ ACG lead 减压(< 非 ACG lead;solo piano 的 RH 不碾 LH)', () => {
    expect(mAcg('lead', 0).volume, 'ACG lead < POP lead').toBeLessThan(mPop('lead', 0).volume);
  });

  it('★ ACG comp 抬高(> 非 ACG comp;高空气 comp 可听)', () => {
    expect(mAcg('comp', 0).volume, 'ACG comp > POP comp').toBeGreaterThan(mPop('comp', 0).volume);
  });

  it('★ ACG comp CC7 > lead CC7(有效响度模型:comp velocity 低 → CC7 补偿;lead velocity 高 → CC7 拉低)', () => {
    expect(mAcg('comp', 0).volume).toBeGreaterThan(mAcg('lead', 0).volume);
  });

  it('★ ACG bass 不再用 CC7 硬抬(当前 SF2 低频样本已足)', () => {
    expect(mAcg('bass', 32).volume, 'ACG bass <= POP bass').toBeLessThanOrEqual(mPop('bass', 32).volume);
    expect(mAcg('bass', 32).volume, 'ACG bass 仍保托底').toBeGreaterThanOrEqual(60);
  });

  it('★ LOFI bass 单独前移,避免 EP/质感层把低频主体盖住', () => {
    expect(mLofi('bass', 32).volume).toBeGreaterThan(mPop('bass', 32).volume);
    expect(mLofi('bass', 32).volume).toBeLessThanOrEqual(82);
  });

  it('★ 非 ACG 不受影响(POP lead 仍走 melody-forward,≥ 92)', () => {
    expect(mPop('lead', 0).volume).toBeGreaterThanOrEqual(92);
  });
});
