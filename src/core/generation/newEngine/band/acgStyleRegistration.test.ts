import { describe, it, expect } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec } from './bandEngine';
import { toHarmonyStyle } from '../harmony/progressionSelector';
import { PROGRESSION_POOL } from '../knowledge/progressions';
import { pc } from '../foundation';

// ============================================================
// MG 升级 Phase 2a — ACG 风格注册端到端验收(久石让/坂本电影钢琴,钢琴主导多轨)
// ============================================================

describe('band/acgStyleRegistration(MG 升级 Phase 2a)', () => {
  it('★ acg → HarmonyStyle ACG;PROGRESSION_POOL 有 7 条 ACG 进行', () => {
    expect(toHarmonyStyle('acg')).toBe('ACG');
    const acgProtos = PROGRESSION_POOL.filter((p) => p.style === 'ACG');
    expect(acgProtos.length).toBe(7);
    expect(acgProtos.some((p) => p.mode === 'Minor')).toBe(true);  // minor circle
    expect(acgProtos.every((p) => p.slots.length > 0)).toBe(true);
  });

  it('★ ACG 端到端生成:多 seed 不失败、IR 非空、音符合法', () => {
    for (const seed of [3, 7, 42, 128]) {
      const r = generateSong({ seed, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
      expect(r.status, `seed ${seed}`).not.toBe('failed');
      expect(r.ir, `seed ${seed} ir`).toBeTruthy();
      const notes = r.ir!.tracks.flatMap((t) => t.notes);
      expect(notes.length, `seed ${seed} notes`).toBeGreaterThan(0);
      for (const n of notes) expect(n.pitch).toBeGreaterThanOrEqual(0);
    }
  });

  it('★ 钢琴主导多轨:lead/comp = 钢琴族(GM 0-5),bass 原声(32/43),lead+comp+bass 常驻', () => {
    const r = generateSong({ seed: 7, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
    const byRole = (role: string) => r.ir!.tracks.find((t) => t.role === role);
    const lead = byRole('lead'), comp = byRole('comp'), bass = byRole('bass');
    expect(lead, 'lead 常驻').toBeTruthy();
    expect(comp, 'comp 常驻').toBeTruthy();
    expect(bass, 'bass 常驻').toBeTruthy();
    expect(lead!.program, 'lead 钢琴族').toBeLessThanOrEqual(5);   // 大钢琴(0)/电钢(4)
    expect(comp!.program, 'comp 钢琴族').toBeLessThanOrEqual(5);
    expect([32, 43], 'bass 原声/低音提琴').toContain(bass!.program);
  });

  it('★ ACG 确定性:同 seed 同 style 两次产物字节一致', () => {
    const gen = () => generateSong({ seed: 11, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' })
      .ir!.tracks.map((t) => `${t.role}:${t.program}:` + t.notes.map((n) => `${n.pitch}@${n.startTick}`).join(',')).join('|');
    expect(gen()).toBe(gen());
  });
});
