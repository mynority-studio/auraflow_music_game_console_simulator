import { describe, expect, it } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import type { InstrumentRoleName } from '../band/BandSpec';
import { createRandomContext } from '../foundation';
import { buildArrangementPlan } from './arranger';
import type { OpeningTextureEntry, Section } from './ArrangementPlan';
import { planOpeningGesture } from './openingGesturePlanner';

const roleSet = (...roles: InstrumentRoleName[]) => new Set<InstrumentRoleName>(roles);

const plan = (seed: number, style: string, roles?: InstrumentRoleName[]) =>
  buildArrangementPlan(
    buildBandSpec({
      seed,
      styleHint: style,
      mood: 'build',
      targetDuration: 96,
      bandConstraint: roles ? { allowedRoles: roleSet(...roles), requiredRoles: roleSet(...roles) } : undefined,
    }),
    { rng: createRandomContext(seed) },
  );

const TEXTURE_SUPPORT: Record<OpeningTextureEntry, readonly InstrumentRoleName[]> = {
  none: [],
  pianoRiff: ['comp', 'lead'],
  rhodesDust: ['comp', 'pad'],
  padSwell: ['pad', 'comp'],
  stringOstinato: ['pad', 'comp'],
  synthPulse: ['comp', 'pad', 'lead'],
  guitarMute: ['comp'],
  bellMotif: ['lead', 'comp'],
  vinylNoise: ['comp', 'pad', 'drum'],
};

describe('arranger/openingGesturePlanner', () => {
  it('下发全曲开头入场计划,锚定首段', () => {
    const p = plan(7, 'pop');
    expect(p.openingGesture.sectionId).toBe(p.sections[0].id);
    expect(p.openingGesture.roleDelayBars).toBeTruthy();
    expect(['soft', 'medium', 'bold']).toContain(p.openingGesture.intensity);
  });

  it('确定性:同 seed/style/lineup → 同 openingGesture', () => {
    expect(plan(12, 'rnb').openingGesture).toEqual(plan(12, 'rnb').openingGesture);
    expect(plan(12, 'acg').openingGesture).toEqual(plan(12, 'acg').openingGesture);
  });

  it('非 Jazz macro 跨 seed 仍产生开头差异,但不靠巨权重压死', () => {
    for (const style of ['pop', 'rnb', 'lofi', 'acg']) {
      const signatures = new Set<string>();
      for (let seed = 0; seed < 32; seed++) {
        const g = plan(seed, style).openingGesture;
        signatures.add(`${g.mode}|${g.drumEntry}|${g.textureEntry}|${g.intensity}`);
      }
      expect(signatures.size, style).toBeGreaterThanOrEqual(3);
    }
  });

  it('尊重 band selection:没鼓手就不下发鼓开头,没选的 role 不出现在 delay 表', () => {
    const p = plan(7, 'pop', ['comp', 'bass']);
    expect(p.openingGesture.drumEntry).toBe('none');
    expect(Object.keys(p.openingGesture.roleDelayBars).sort()).toEqual(['bass', 'comp']);
  });

  it('textureEntry 只选择当前 lineup 可以承载的织体,不偷偷要求不存在的乐手', () => {
    for (const style of ['pop', 'rnb', 'lofi', 'jazz', 'acg']) {
      for (let seed = 0; seed < 24; seed++) {
        const p = plan(seed, style, ['bass', 'drum']);
        const texture = p.openingGesture.textureEntry;
        const active = new Set(p.openingGesture.roleDelayBars ? Object.keys(p.openingGesture.roleDelayBars) as InstrumentRoleName[] : []);
        const supported = texture === 'none' || TEXTURE_SUPPORT[texture].some((role) => active.has(role));
        expect(supported, `${style}/${seed}/${texture}/${[...active].join(',')}`).toBe(true);
      }
    }
  });

  it('无 intro 的 repeat core 不承载整段 opening texture，角色延迟只保留首小节分层', () => {
    const b = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const core: Section = {
      id: 'verse1',
      role: 'verse',
      harmonyRole: 'loop',
      functionTag: 'story',
      bars: 4,
      repeatGroup: 'verse-loop',
      hookPolicy: 'light',
    };
    const intro: Section = {
      ...core,
      id: 'intro',
      role: 'intro',
      harmonyRole: 'intro',
      functionTag: 'setup',
      repeatGroup: undefined,
    };

    // 无 rng 固定取 POP 第一候选：dedicated intro 的 lead 原计划在第 3 小节才进。
    const dedicated = planOpeningGesture([intro], b);
    const noIntro = planOpeningGesture([core], b);

    expect(dedicated.textureEntry).toBe('pianoRiff');
    expect(dedicated.roleDelayBars.lead).toBe(3);
    expect(noIntro.textureEntry).toBe('none');
    expect(noIntro.drumEntry).toBe(dedicated.drumEntry);
    expect(noIntro.mode).toBe(dedicated.mode);
    expect(noIntro.roleDelayBars.comp).toBe(0);
    expect(noIntro.roleDelayBars.lead).toBe(1);
    expect(Object.values(noIntro.roleDelayBars).every((bars) => Number.isInteger(bars) && bars <= 1)).toBe(true);
  });
});
