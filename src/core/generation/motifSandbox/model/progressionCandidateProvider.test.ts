import { describe, it, expect } from 'vitest';
import { getProgressionCandidatesForMotif } from './progressionCandidateProvider';
import { listProgressionPrototypes } from '../../newEngine/knowledge/progressions';
import type { SandboxStyle } from './types';

const poolIds = (style: SandboxStyle, mode: 'major' | 'minor' = 'major'): string[] =>
  getProgressionCandidatesForMotif({ style, mode }).candidates.map((c) => c.prototype.id);
const styleIds = (s: 'POP' | 'LOFI' | 'RNB' | 'JAZZ'): string[] => listProgressionPrototypes({ style: s }).map((p) => p.id);

describe('motifSandbox/progressionCandidateProvider(全风格候选池,directive Phase 2)', () => {
  it('★ 每风格全部模板可达(去掉 verse 硬过滤;chorus/bridge/intro/ending 不再被挡)', () => {
    for (const [style, S] of [['pop', 'POP'], ['lofi', 'LOFI'], ['rnb', 'RNB'], ['jazz', 'JAZZ']] as const) {
      const ids = new Set(poolIds(style));
      for (const id of styleIds(S)) expect(ids.has(id), `${style} 应可达 ${id}`).toBe(true);
    }
  });

  it('★ 非 verse 角色的模板也进池(证明 verse 硬过滤已移除)', () => {
    const pool = getProgressionCandidatesForMotif({ style: 'pop', mode: 'major' }).candidates;
    const nonVerse = pool.filter((c) => !c.prototype.sectionRoles.includes('verse'));
    // POP 模板里存在非 verse 角色(chorus/bridge/…)→ 现在也在候选池里(旧逻辑会被踢掉)
    if (listProgressionPrototypes({ style: 'POP' }).some((p) => !p.sectionRoles.includes('verse'))) {
      expect(nonVerse.length).toBeGreaterThan(0);
    }
  });

  it('★ BLUES 永不进 Q+R 池;非 jazz 不退化到 JAZZ', () => {
    for (const style of ['pop', 'lofi', 'rnb', 'jazz'] as const) {
      const pool = getProgressionCandidatesForMotif({ style, mode: 'major' }).candidates;
      expect(pool.every((c) => c.prototype.style !== 'BLUES'), `${style} 无 BLUES`).toBe(true);
      if (style !== 'jazz') expect(pool.every((c) => c.prototype.style !== 'JAZZ'), `${style} 不退 JAZZ`).toBe(true);
    }
    expect(poolIds('pop')).not.toContain('blues_12bar_dom');
  });

  it('★ opposite-mode 模板进池但被标记 modeMatch=false(tracked,scorer 降权,非无声惊喜)', () => {
    // major 目标 → minor 同风格模板应在池里、且 modeMatch=false;major 模板 modeMatch=true
    const pool = getProgressionCandidatesForMotif({ style: 'pop', mode: 'major' }).candidates;
    expect(pool.some((c) => c.modeMatch === true), 'major 模板存在').toBe(true);
    expect(pool.some((c) => c.modeMatch === false), 'minor 模板进池但标记 false').toBe(true);
    for (const c of pool) expect(c.modeMatch).toBe(c.prototype.mode === 'Major');
  });
});
