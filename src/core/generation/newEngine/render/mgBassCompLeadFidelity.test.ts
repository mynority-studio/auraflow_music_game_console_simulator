import { describe, it, expect } from 'vitest';
import { generateMusicSync } from '../../musicGeneration/MusicGenerationService';
import { instrumentInfo } from '../knowledge/instruments';

// ============================================================
// MG bass/comp/lead fidelity(directive §10.2)—— SIM 侧不变量(不依赖 live ../melodygenerative,任意 CI 可跑)。
// 跨引擎【密度/织体 vs MG】的实测对比在 scripts/audit-mg-bass-comp-lead-fidelity.ts(§5)。
// 本测锁:§4 ACG 逐-bar 织体多样性不塌回段级 + lead 近单音 + comp 密度不失控 + 家族合法。
// ============================================================

const acg = (seed: number) => generateMusicSync({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90, key: 'C' });
const trk = (r: ReturnType<typeof acg>, role: string) => r.ir!.tracks.find((t) => t.role === role);
const bars = (r: ReturnType<typeof acg>) => r.uiSnapshot.sections.reduce((a, s) => a + s.bars, 0) || 1;
const texCases = (r: ReturnType<typeof acg>) => ((r.report as { textureCases?: string[] } | undefined)?.textureCases ?? []);
const maxStackAt = (notes: readonly { startTick: number }[]) => {
  const by = new Map<number, number>();
  for (const n of notes) by.set(n.startTick, (by.get(n.startTick) ?? 0) + 1);
  return Math.max(0, ...by.values());
};

const SEEDS = [0, 7, 42, 99, 12345];

describe('render/mgBassCompLeadFidelity · §4 ACG 逐-bar 织体多样性', () => {
  it('ACG textureSchedule 不塌成段级(≥5 种,不再是 2)', () => {
    for (const seed of SEEDS) {
      const cases = texCases(acg(seed));
      expect(cases.length, `seed ${seed} ACG 织体多样性 [${cases.join(',')}]`).toBeGreaterThanOrEqual(5);
    }
  });

  it('ACG 织体全部是 ACG 具名手势(comp 消费 MG 织体池)', () => {
    for (const seed of SEEDS) {
      for (const tc of texCases(acg(seed))) {
        expect(tc.startsWith('ACG_') || tc.startsWith('Piano_'), `seed ${seed} 非 ACG 织体 ${tc}`).toBe(true);
      }
    }
  });
});

describe('render/mgBassCompLeadFidelity · lead/comp/bass 结构', () => {
  it('ACG 恒 lead+comp+bass;comp 有音符(硬合同)', () => {
    for (const seed of SEEDS) {
      const r = acg(seed);
      const roles = new Set(r.ir!.tracks.map((t) => t.role));
      expect(roles.has('lead') && roles.has('comp') && roles.has('bass'), `seed ${seed}`).toBe(true);
      expect(trk(r, 'comp')!.notes.length, `seed ${seed} comp notes`).toBeGreaterThan(0);
    }
  });

  it('ACG lead 近单音(任一 onset 同时 ≤2),不塞 comp 织体进 lead', () => {
    for (const seed of SEEDS) {
      const lead = trk(acg(seed), 'lead')!;
      expect(maxStackAt(lead.notes as unknown as { startTick: number }[]), `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it('★ P2 ACG comp 密度 MG-aligned(carve 让路后不过密;MG≈3.8-6.2/bar)', () => {
    for (const seed of SEEDS) {
      const r = acg(seed);
      const compPerBar = trk(r, 'comp')!.notes.length / bars(r);
      expect(compPerBar, `seed ${seed} comp/bar=${compPerBar.toFixed(1)}`).toBeLessThanOrEqual(8);
    }
  });

  it('★ P2 ACG comp 有低位 cantabile 托底(inner voice/floor 在旋律下方)', () => {
    for (const seed of SEEDS) {
      const comp = trk(acg(seed), 'comp')!;
      expect(comp.notes.some((n) => (n.pitch as number) < 64), `seed ${seed} comp 低位支撑`).toBe(true);
    }
  });

  it('★ P0-1:ACG comp 有 CC64 踏板(延音/尾音/融合感,忠实 MG 每和弦踩)', () => {
    for (const seed of SEEDS) {
      const comp = trk(acg(seed), 'comp');
      const ped = comp?.pedalEvents ?? [];
      expect(ped.length, `seed ${seed} ACG comp 踏板`).toBeGreaterThan(0);
      expect(ped.some((p) => p.down), `seed ${seed} 有踩下`).toBe(true);
      expect(ped.some((p) => !p.down), `seed ${seed} 有抬起`).toBe(true);
    }
  });

  it('★ P1a 响度秩序(melody-first):lead avg 显著 > comp;comp≈29-32(pp);bass≈37', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    for (const seed of SEEDS) {
      const r = acg(seed);
      const leadV = mean(trk(r, 'lead')!.notes.map((n) => n.velocity as number));
      const compV = mean(trk(r, 'comp')!.notes.map((n) => n.velocity as number));
      const bassV = mean(trk(r, 'bass')!.notes.map((n) => n.velocity as number));
      expect(leadV - compV, `seed ${seed} lead(${leadV.toFixed(0)})>>comp(${compV.toFixed(0)})`).toBeGreaterThan(30);
      expect(compV, `seed ${seed} comp pp`).toBeGreaterThanOrEqual(25);
      expect(compV, `seed ${seed} comp pp`).toBeLessThanOrEqual(36);
      expect(bassV, `seed ${seed} bass`).toBeGreaterThanOrEqual(30);
      expect(bassV, `seed ${seed} bass`).toBeLessThanOrEqual(44);
    }
  });

  it('★ P1b lead 音域上浮到 MG soprano(均值≥72,几乎无 <69)', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    for (const seed of SEEDS) {
      const ps = trk(acg(seed), 'lead')!.notes.map((n) => n.pitch as number);
      expect(mean(ps), `seed ${seed} lead mean`).toBeGreaterThanOrEqual(72);
      expect(ps.filter((p) => p < 69).length / ps.length, `seed ${seed} <69 占比`).toBeLessThan(0.05);
    }
  });

  it('家族合法:ACG lead/comp=keyboard,bass=bass', () => {
    for (const seed of SEEDS) {
      const r = acg(seed);
      for (const role of ['lead', 'comp'] as const) {
        const t = trk(r, role); if (t) expect(instrumentInfo(t.program).family, `seed ${seed} ${role}`).toBe('keyboard');
      }
      const b = trk(r, 'bass'); if (b) expect(instrumentInfo(b.program).family, `seed ${seed} bass`).toBe('bass');
    }
  });
});
