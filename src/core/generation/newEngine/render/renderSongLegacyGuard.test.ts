// ============================================================
// ★ P2(musicgenerative_remaining_strict_migration_gaps):renderSong() = LEGACY 占位(lead 恒空)。
//   守护:产品/UI 生成路径【永不】调用它(产品 lead 必走 renderSongFull 的 MG 链)。防未来审计混淆。
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderSong } from './renderCoordinator';
import { generateSong } from '../generation/GenerationController';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { createTimebase, createRandomContext } from '../foundation';

describe('render/renderSong — legacy 占位守护', () => {
  it('renderSong() 是 legacy 占位:lead 轨恒空(产品 lead 不从这里来)', () => {
    const band = buildBandSpec({ seed: 3, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const arrangement = buildArrangementPlan(band, { rng: createRandomContext(3) });
    const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(3));
    const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
    const { ir } = renderSong(plan, timebase);
    const lead = ir.tracks.find((t) => t.role === 'lead');
    expect(lead?.notes.length ?? 0).toBe(0); // 占位:lead 恒空
  });

  it('★ 产品路径 generateSong 产【非空 lead】→ 证明走 renderSongFull/MG 链,不用 renderSong 占位', () => {
    for (const style of ['pop', 'lofi', 'rnb', 'jazz']) {
      const res = generateSong({ seed: 3, styleHint: style, mood: 'build', targetDuration: 120 });
      const lead = res.ir!.tracks.find((t) => t.role === 'lead')!;
      expect(lead.notes.length, `${style} lead`).toBeGreaterThan(0);
    }
  });

  it('★ GenerationController(产品入口)源码不调用裸 renderSong( —— 只能用 renderSongFull(', () => {
    const src = readFileSync('src/core/generation/newEngine/generation/GenerationController.ts', 'utf8');
    // renderSongFull( 不匹配 /renderSong\(/(其后是 "Full",非 "(")
    expect(src.match(/renderSong\(/g)).toBeNull();
  });
});
