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

  it('选 键盘手+贝斯手+鼓手 → allowed=lead/comp/bass/drum;required=comp/bass/drum;家族(键盘/贝斯,鼓不限)', () => {
    const c = deriveLineupConstraint(sel(
      { role: 'keyboardist', state: 'selected' },
      { role: 'bassist', state: 'selected' },
      { role: 'drummer', state: 'selected' },
    ))!;
    expect([...c.allowedRoles!].sort()).toEqual(['bass', 'comp', 'drum', 'lead']); // keyboardist 不含 pad
    // ★ requiredRoles:每个 selected 乐手必须出现(键盘手→comp,贝斯手→bass,鼓手→drum)
    expect([...c.requiredRoles!].sort()).toEqual(['bass', 'comp', 'drum']);
    expect(c.familyByRole!.lead).toEqual(['keyboard']);
    expect(c.familyByRole!.comp).toEqual(['keyboard']);
    expect(c.familyByRole!.bass).toEqual(['bass']);
    expect(c.familyByRole!.drum).toBeUndefined(); // 鼓不做家族过滤
    expect(c.familyByRole!.pad).toBeUndefined();   // keyboardist 不承担 pad
  });

  it('仅选 键盘手 → 白名单 lead/comp;required=comp(钢琴必出声)', () => {
    const c = deriveLineupConstraint(sel({ role: 'keyboardist', state: 'selected' }))!;
    expect([...c.allowedRoles!].sort()).toEqual(['comp', 'lead']);
    expect([...c.requiredRoles!]).toEqual(['comp']);
  });

  it('★ 仅选 鼓手 → allowed/required 都只 drum(旋律 role 由 bandEngine 自动补)', () => {
    const c = deriveLineupConstraint(sel({ role: 'drummer', state: 'selected' }))!;
    expect([...c.allowedRoles!]).toEqual(['drum']);
    expect([...c.requiredRoles!]).toEqual(['drum']);
  });

  it('★ 合成/氛围乐手 → pad(required),家族 pad', () => {
    const c = deriveLineupConstraint(sel({ role: 'synthPlayer', state: 'selected' }))!;
    expect([...c.allowedRoles!]).toEqual(['pad']);
    expect([...c.requiredRoles!]).toEqual(['pad']);
    expect(c.familyByRole!.pad).toEqual(['pad']);
  });

  it('仅禁用 鼓手(其余 auto)→ 默认乐队减 drum,不限家族,无 required', () => {
    const c = deriveLineupConstraint(sel({ role: 'drummer', state: 'disabled' }))!;
    expect(c.allowedRoles!.has('drum')).toBe(false);
    expect(c.allowedRoles!.has('lead')).toBe(true);
    expect(c.allowedRoles!.has('bass')).toBe(true);
    expect(c.familyByRole).toBeUndefined();
    expect(c.requiredRoles).toBeUndefined();
  });

  it('主奏乐手不限家族:选 leadPlayer → lead 允许+required 且无家族限制', () => {
    const c = deriveLineupConstraint(sel({ role: 'leadPlayer', state: 'selected' }))!;
    expect([...c.allowedRoles!]).toEqual(['lead']);
    expect([...c.requiredRoles!]).toEqual(['lead']);
    expect(c.familyByRole).toBeUndefined(); // lead 不限家族
  });

  it('无家族乐手覆盖 → 开放该 role 全家族:键盘手+主奏 → lead 家族清空+各分到 comp/lead', () => {
    const c = deriveLineupConstraint(sel(
      { role: 'keyboardist', state: 'selected' },
      { role: 'leadPlayer', state: 'selected' },
    ))!;
    expect(c.familyByRole?.lead).toBeUndefined(); // 主奏覆盖 lead → 不限家族
    expect(c.familyByRole!.comp).toEqual(['keyboard']);
    // 贪心去重:键盘手→comp,主奏→lead
    expect([...c.requiredRoles!].sort()).toEqual(['comp', 'lead']);
  });

  it('选择胜过排除:键盘手 selected + 主奏 disabled → lead(键盘也覆盖)不被减掉', () => {
    const c = deriveLineupConstraint(sel(
      { role: 'keyboardist', state: 'selected' }, // lead/comp
      { role: 'leadPlayer', state: 'disabled' },  // 也覆盖 lead
    ))!;
    expect([...c.allowedRoles!].sort()).toEqual(['comp', 'lead']);
  });
});

describe('musicGeneration/participantConstraint · participantForRole', () => {
  it('无选择 → 默认 role→participant 映射', () => {
    expect(participantForRole('bass')).toBe('bassist');
    expect(participantForRole('drum')).toBe('drummer');
    expect(participantForRole('lead')).toBe('leadPlayer');
    expect(participantForRole('pad')).toBe('synthPlayer');
  });
  it('selected 乐手优先承担其 role', () => {
    const ps = sel({ role: 'keyboardist', state: 'selected' });
    expect(participantForRole('lead', ps)).toBe('keyboardist'); // 键盘手 selected → 承担 lead
  });
});
