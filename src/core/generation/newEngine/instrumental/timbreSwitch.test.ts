// ============================================================
// newEngine · instrumental · 器配音色切换(同乐手换声音,2026-06-05)
// ------------------------------------------------------------
// 锁:comp/lead 偶尔 chorus 换【同族】备选音色;repeatGroup 一致;确定性;无 rng=不切。
//   IR 落 programChanges(同 channel 中途换 program)。
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from './instrumentalPlanner';
import { instrumentInfo, isKeyboardFamily, sameFamilyAlternates } from '../knowledge/instruments';
import { generateSong } from '../generation/GenerationController';
import { createRandomContext, pc } from '../foundation';

const setup = (seed: number, style = 'pop') => {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'x', targetDuration: 150, key: pc(0) });
  const arr = buildArrangementPlan(band);
  return { band, arr };
};
const planWith = (seed: number, style = 'pop') => {
  const { band, arr } = setup(seed, style);
  return { band, arr, plan: buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre')) };
};

// 找一个会切音色的 seed
function firstSwitching(style = 'pop') {
  for (let seed = 0; seed < 40; seed++) {
    const { band, arr, plan } = planWith(seed, style);
    for (const role of band.instrumentPool) {
      const progs = new Set(arr.sections.map((s) => plan.programByRoleSection[role][s.id]));
      if (progs.size > 1) return { seed, band, arr, plan, role };
    }
  }
  return null;
}

describe('器配音色切换', () => {
  it('存在会切音色的歌(comp/lead)', () => {
    expect(firstSwitching('pop')).not.toBeNull();
  });

  it('切换 = 同族 + 落在 chorus(verse 保持 primary)', () => {
    const f = firstSwitching('pop')!;
    const bySec = f.plan.programByRoleSection[f.role];
    const chorusProg = bySec[f.arr.sections.find((s) => s.role === 'chorus')!.id];
    const verseProg = bySec[f.arr.sections.find((s) => s.role === 'verse')!.id];
    // ★ primary = 非切段(verse)实际用的基底 —— 器配层 coherentLeadComp 后的 program(可能≠band.roleProgram)。
    const primary = verseProg;
    expect(chorusProg).not.toBe(primary);                        // chorus 换了
    expect(instrumentInfo(chorusProg).family).toBe(instrumentInfo(primary).family); // 同族
    expect(sameFamilyAlternates('pop', f.role, primary)).toContain(chorusProg);
  });

  it('★ 只有键盘族切(颤音琴/马林巴等 mallet 不切)+ 每首最多一个乐手切', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { band, arr, plan } = planWith(seed, 'jazz'); // jazz lead 池含颤音琴/马林巴
      let switchingRoles = 0;
      for (const role of band.instrumentPool) {
        const progs = new Set(arr.sections.map((s) => plan.programByRoleSection[role][s.id]));
        if (progs.size > 1) {
          switchingRoles++;
          expect(isKeyboardFamily(band.roleProgram[role]), `${role} 切了但非键盘族`).toBe(true);
        }
      }
      expect(switchingRoles).toBeLessThanOrEqual(1); // 每首最多一个
    }
  });

  it('repeatGroup 一致:所有 chorus 同音色、所有 verse 同音色', () => {
    const f = firstSwitching('pop')!;
    const bySec = f.plan.programByRoleSection[f.role];
    const choruses = f.arr.sections.filter((s) => s.role === 'chorus').map((s) => bySec[s.id]);
    const verses = f.arr.sections.filter((s) => s.role === 'verse').map((s) => bySec[s.id]);
    expect(new Set(choruses).size).toBe(1);
    expect(new Set(verses).size).toBe(1);
  });

  it('无 rng → 不切(全曲 primary,向后兼容)', () => {
    const { band, arr } = setup(3);
    const plan = buildInstrumentationPlan(band, arr); // 无 rng
    for (const role of band.instrumentPool) {
      const progs = new Set(arr.sections.map((s) => plan.programByRoleSection[role][s.id]));
      expect(progs.size).toBe(1);
    }
  });

  it('确定性:同 seed 两次一致', () => {
    const a = JSON.stringify(planWith(3).plan.programByRoleSection);
    const b = JSON.stringify(planWith(3).plan.programByRoleSection);
    expect(a).toBe(b);
  });

  it('端到端:切音色的歌 IR 带 programChanges(同 channel 中途换),且收敛', () => {
    const f = firstSwitching('pop')!;
    const r = generateSong({ seed: f.seed, styleHint: 'pop', mood: 'x', targetDuration: 150, key: pc(0) });
    expect(r.status).not.toBe('failed');
    const tracks = r.ir!.tracks.filter((t) => t.programChanges && t.programChanges.length);
    expect(tracks.length).toBeGreaterThan(0);
    const init = tracks[0].program!;
    const changed = tracks[0].programChanges![0].program;
    expect(instrumentInfo(init).family).toBe(instrumentInfo(changed).family);
  });
});
