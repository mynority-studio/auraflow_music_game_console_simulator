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
  pop:  { bass: [32, 38], comp: [0, 5, 24, 25], lead: [0, 5, 25, 108], pad: [89], drum: [0] },
  lofi: { bass: [32, 38], comp: [5, 24, 25, 0], lead: [5, 0, 108, 25], pad: [89], drum: [0] },
  rnb:  { bass: [32, 38], comp: [5, 25, 0, 24], lead: [5, 0, 25], pad: [89], drum: [0] },
  jazz: { bass: [32], comp: [0, 5, 25], lead: [0, 67], pad: [89], drum: [0] },
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
  it('POP/LOFI/JAZZ/RNB 共用无风格染色空间；ACG/BLUES 保留独立合同', () => {
    expect(pickSpaceProfile('jazz', undefined, true)).toBe('dryFront');
    expect(pickSpaceProfile('blues', undefined, true)).toBe('jazzClub');
    expect(pickSpaceProfile('lofi', undefined, true)).toBe('dryFront');
    expect(pickSpaceProfile('rnb', undefined, true)).toBe('dryFront');
    expect(pickSpaceProfile('pop', 'syntheticSoft' as TimbreWorld, true)).toBe('dryFront');
    expect(pickSpaceProfile('pop', undefined, false)).toBe('dryFront');
    expect(pickSpaceProfile('pop', undefined, true)).toBe('dryFront');
  });
});

describe('knowledge/gmMixProfile — Dream 风格硬件混音合同', () => {
  it('POP/JAZZ/RNB 保持默认通道；LOFI 使用独立硬件宏', () => {
    const dryStyles = ['pop', 'jazz', 'rnb'] as const;
    for (const role of ['lead', 'comp', 'bass', 'pad', 'drum'] as const) {
      for (const program of PALETTE.pop[role] ?? [0]) {
        const mixes = dryStyles.map((style) => mixForProgram({
          style,
          timbreWorld: undefined,
          role,
          program,
          hasPad: true,
          space: pickSpaceProfile(style, undefined, true),
        }));
        for (const [index, mix] of mixes.entries()) {
          expect(mix.volume, `${dryStyles[index]}/${role}/GM${program}`).toBe(100);
          expect(mix.reverb, `${dryStyles[index]}/${role}/GM${program}`).toBe(0);
          expect(mix.chorus, `${dryStyles[index]}/${role}/GM${program}`).toBe(0);
        }
        expect(mixes[1], `${role}/GM${program}/jazz`).toEqual(mixes[0]);
        expect(mixes[2], `${role}/GM${program}/rnb`).toEqual(mixes[0]);
      }
    }
    expect(mixForProgram({ style: 'lofi', timbreWorld: undefined, role: 'drum', program: 0, hasPad: true, space: 'dryFront' }))
      .toEqual({ volume: 97, pan: 64, reverb: 16, chorus: 0 });
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

  it('Dream 干声基线：bass 不进共享 FX', () => {
    for (const p of [32, 33, 34, 35, 36, 37, 38, 39]) {
      expect(mk('bass', p).reverb).toBe(0);
      expect(mk('bass', p).chorus).toBe(0);
    }
    expect(mk('bass', 32).volume).toBe(100);
    expect(mk('bass', 38).volume).toBe(100);
    expect(mk('bass', 38).chorus).toBeLessThanOrEqual(1);
  });

  it('drum.chorus == 0', () => {
    expect(mk('drum', 0).chorus).toBe(0);
  });

  it('Dream 干声基线：drum 不进共享 FX', () => {
    const drum = mk('drum', 0);
    expect(drum.volume).toBe(100);
    expect(drum.reverb).toBe(0);
    expect(drum.chorus).toBe(0);
  });

  it('Room 鼓组也服从干声基线', () => {
    expect(mk('drum', 8)).toMatchObject({ volume: 100, reverb: 0, chorus: 0 });
    expect(mk('drum', 25)).toMatchObject({ volume: 100, reverb: 0, chorus: 0 });
    expect(mk('drum', 40)).toMatchObject({ volume: 100, reverb: 0, chorus: 0 });
  });

  it('FX pad 98/99/100/102 暂不进入共享 Reverb/Chorus', () => {
    for (const sp of ['popWarmRoom', 'lofiTapeRoom', 'rnbPlateRoom', 'jazzClub', 'dryFront', 'syntheticSoftRoom'] as SpaceProfile[]) {
      for (const p of [98, 99, 100, 102]) {
        const m = mixForProgram({ style: 'pop', timbreWorld: undefined, role: 'pad', program: p, hasPad: true, space: sp });
        expect(m.volume, `FX pad ${p}@${sp} vol`).toBe(100);
        expect(m.reverb, `FX pad ${p}@${sp} rev`).toBe(0);
        expect(m.chorus, `FX pad ${p}@${sp} chorus`).toBe(0);
      }
    }
  });

  it('电钢 4/5 使用音符 gate，不靠共享 Reverb/Chorus 制造尾音', () => {
    expect(mk('comp', 4)).toMatchObject({ volume: 100, reverb: 0, chorus: 0 });
    expect(mk('lead', 4)).toMatchObject({ volume: 100, reverb: 0, chorus: 0 });
    expect(mk('comp', 5)).toMatchObject({ volume: 100, reverb: 0, chorus: 0 });
    expect(mk('lead', 5)).toMatchObject({ volume: 100, reverb: 0, chorus: 0 });
    expect(mixForProgram({ style: 'lofi', timbreWorld: undefined, role: 'lead', program: 5, hasPad: true, space: 'dryFront' }))
      .toMatchObject({ volume: 96, reverb: 28, chorus: 7 });
  });

  it('Rhodes 与 Electric Grand 的共享空间均归零', () => {
    for (const role of ['comp', 'lead'] as const) {
      expect(mk(role, 4)).toMatchObject({ reverb: 0, chorus: 0 });
      expect(mk(role, 5)).toMatchObject({ reverb: 0, chorus: 0 });
    }
  });

  it('GU Electric Grand 槽位 5 只有少量空气:release 之外不再给大 reverb/chorus/delay', () => {
    const comp = mk('comp', 5);
    const lead = mk('lead', 5);
    expect(comp.volume).toBe(100);
    expect(lead.volume).toBe(100);
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
      expect(m.volume, `GM${p} comp volume`).toBe(100);
      expect(m.reverb, `GM${p} comp reverb`).toBeLessThanOrEqual(14);
      expect(m.chorus, `GM${p} comp chorus`).toBe(0);
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

  it('四风格统一关闭未确认的 song delay bus', () => {
    const warm = songSpaceProfile('pop', undefined, true);
    const dry = songSpaceProfile('pop', undefined, false);
    expect(warm.delayMode).toBe('off');
    expect(warm.delayFeedback).toBe(0);
    expect(dry.delayMode).toBe('off');
    expect(dry.delayFeedback).toBe(0);
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
    expect(m.volume).toBe(100);
    expect(m.reverb).toBeLessThanOrEqual(40);
    expect(m.delay ?? 0).toBe(0);
  });

  it('卡林巴是轻拨弦热源:lead 不吃大音量/大空间', () => {
    const m = mk('lead', 108);
    expect(m.volume).toBe(100);
    expect(m.reverb).toBeLessThanOrEqual(18);
    expect(m.chorus).toBe(0);
    expect(m.delay).toBeUndefined();
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

  it('四风格不再用 CC7 制造 lead/comp 前后关系', () => {
    for (const p of [0, 12, 6]) { // jazz/暖路线代表 lead program;GM67 sax 是设备热源,有专属校平规则
      const lead = mk('lead', p).volume;
      const comp = mk('comp', p).volume;
      expect(lead, `gm${p} lead default`).toBe(100);
      expect(comp, `gm${p} comp default`).toBe(100);
    }
  });

  it('GM67 sax 是设备热源:保持前景但不走键盘类 CC92+ 规则', () => {
    const sax = mk('lead', 67);
    expect(sax.volume).toBe(100);
    expect(sax.reverb).toBeLessThanOrEqual(52);
    expect(sax.chorus).toBe(0);
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

  it('★ LOFI bass 使用独立硬件宏并保持低频空间集中', () => {
    expect(mLofi('bass', 32)).toMatchObject({ volume: 92, pan: 64, reverb: 4, chorus: 0 });
  });

  it('★ 非 ACG 不受影响(POP lead 仍走 melody-forward,≥ 92)', () => {
    expect(mPop('lead', 0).volume).toBeGreaterThanOrEqual(92);
  });
});
