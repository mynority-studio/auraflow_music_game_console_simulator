import { describe, it, expect } from 'vitest';
import { deriveLineupConstraint, participantForRole } from './participantConstraint';
import type { BandParticipantSelection } from './types';

const sel = (...ps: BandParticipantSelection[]) => ps;

describe('musicGeneration/participantConstraint · deriveLineupConstraint', () => {
  it('空 / 全 auto → undefined(Q+N 默认完整乐队,无约束)', () => {
    expect(deriveLineupConstraint(undefined)).toBeUndefined();
    expect(deriveLineupConstraint([])).toBeUndefined();
    expect(deriveLineupConstraint(sel({ role: 'keyboardist', state: 'auto' }))).toBeUndefined();
  });

  it('选 键盘手+贝斯手+鼓手 → allowedRoles 覆盖全部职责;家族限定(键盘=keyboard,贝斯=bass,鼓不限)', () => {
    const c = deriveLineupConstraint(sel(
      { role: 'keyboardist', state: 'selected' },
      { role: 'bassist', state: 'selected' },
      { role: 'drummer', state: 'selected' },
    ))!;
    expect([...c.allowedRoles!].sort()).toEqual(['bass', 'comp', 'drum', 'lead', 'pad']);
    expect(c.familyByRole!.lead).toEqual(['keyboard']);
    expect(c.familyByRole!.comp).toEqual(['keyboard']);
    expect(c.familyByRole!.pad).toEqual(['keyboard']);
    expect(c.familyByRole!.bass).toEqual(['bass']);
    expect(c.familyByRole!.drum).toBeUndefined(); // 鼓不做家族过滤
  });

  it('仅选 键盘手 → 白名单只含键盘可承担的 lead/comp/pad(无 bass/drum)', () => {
    const c = deriveLineupConstraint(sel({ role: 'keyboardist', state: 'selected' }))!;
    expect([...c.allowedRoles!].sort()).toEqual(['comp', 'lead', 'pad']);
  });

  it('仅禁用 鼓手(其余 auto)→ 默认乐队减 drum,不限家族', () => {
    const c = deriveLineupConstraint(sel({ role: 'drummer', state: 'disabled' }))!;
    expect(c.allowedRoles!.has('drum')).toBe(false);
    expect(c.allowedRoles!.has('lead')).toBe(true);
    expect(c.allowedRoles!.has('bass')).toBe(true);
    expect(c.familyByRole).toBeUndefined();
  });

  it('主奏乐手不限家族:选 leadPlayer → lead 允许且无家族限制', () => {
    const c = deriveLineupConstraint(sel({ role: 'leadPlayer', state: 'selected' }))!;
    expect([...c.allowedRoles!]).toEqual(['lead']);
    expect(c.familyByRole).toBeUndefined(); // lead 不限家族
  });

  it('无家族乐手覆盖 → 开放该 role 全家族:键盘手+主奏 → lead 家族被清空(comp/pad 仍 keyboard)', () => {
    const c = deriveLineupConstraint(sel(
      { role: 'keyboardist', state: 'selected' },
      { role: 'leadPlayer', state: 'selected' },
    ))!;
    expect(c.familyByRole?.lead).toBeUndefined(); // 主奏覆盖 lead → 不限家族
    expect(c.familyByRole!.comp).toEqual(['keyboard']);
    expect(c.familyByRole!.pad).toEqual(['keyboard']);
  });

  it('选择胜过排除:键盘手 selected + 合成 disabled → lead/comp/pad 不被合成的 disable 减掉', () => {
    const c = deriveLineupConstraint(sel(
      { role: 'keyboardist', state: 'selected' }, // lead/comp/pad
      { role: 'synthPlayer', state: 'disabled' }, // 也覆盖 pad/lead/comp
    ))!;
    expect([...c.allowedRoles!].sort()).toEqual(['comp', 'lead', 'pad']);
  });
});

describe('musicGeneration/participantConstraint · participantForRole', () => {
  it('无选择 → 默认 role→participant 映射', () => {
    expect(participantForRole('bass')).toBe('bassist');
    expect(participantForRole('drum')).toBe('drummer');
    expect(participantForRole('lead')).toBe('leadPlayer');
  });
  it('selected 乐手优先承担其 role', () => {
    const ps = sel({ role: 'guitarist', state: 'selected' });
    expect(participantForRole('lead', ps)).toBe('guitarist'); // 吉他手 selected → 承担 lead
  });
});
