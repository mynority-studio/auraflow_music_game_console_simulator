import { describe, it, expect } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { buildTextureSchedule } from './textureSchedule';
import { createTimebase, createRandomContext, beats } from '../foundation';
import type { MusicalIR } from '../ir/MusicalIR';

// ============================================================
// texture-switch 音乐性修复 · 第一期(docs/texture_switch_musicality_directive.md)
//   非 LOFI 织体切换决策上移到器配层(段级下发)→ render 不再逐 span 随机切。
//   验收:段内织体一致、硬切骤降到结构点、repeatGroup 一致、同曲 ≤2、无突发大洞;LOFI 回退老路。
// ============================================================

function pieces(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const instrumentation = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
  const timebase = createTimebase({ meter: { numerator: arrangement.meter.numerator, denominator: arrangement.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arrangement.tempoBpm }] });
  const activeSectionIds = new Set<string>();
  for (const [sid, tex] of Object.entries(instrumentation.textureBySection)) if (instrumentation.textureYieldPolicy[tex] === 'active') activeSectionIds.add(sid);
  const sectionRoleById = Object.fromEntries(arrangement.sections.map((s) => [s.id, s.role]));
  const sched = buildTextureSchedule({ plan, style: band.style, sectionRoleById, activeSectionIds, textureRng: createRandomContext(seed).substream('compTexture'), richTextureBySection: instrumentation.richTextureBySection });
  return { band, arrangement, instrumentation, plan, timebase, activeSectionIds, sched };
}

function maxCompGap(ir: MusicalIR, ppq: number): number {
  const comp = ir.tracks.find((t) => t.role === 'comp');
  if (!comp || comp.notes.length === 0) return 0;
  const ev = comp.notes.map((n) => [(n.startTick as number) / ppq, ((n.startTick as number) + (n.durationTicks as number)) / ppq]).sort((a, b) => a[0] - b[0]);
  let maxGap = 0, cursor = 0;
  for (const [s, e] of ev) { if (s - cursor > maxGap) maxGap = s - cursor; cursor = Math.max(cursor, e); }
  return maxGap;
}

describe('texture-switch 修复 · 第一期(非 LOFI 段级下发)', () => {
  it('★ 633823/POP:段内织体一致(无逐 span 乱切)+ 硬切骤降到结构点', () => {
    const { plan, sched } = pieces(633823, 'pop');
    // 段内一致:每段的所有 active span 共享同一 textureCase
    const bySec: Record<string, Set<string>> = {};
    for (const c of plan.chordTimeline) { const tc = sched[c.id]; if (tc) (bySec[c.sectionId] ??= new Set()).add(tc); }
    for (const set of Object.values(bySec)) expect(set.size).toBe(1); // 段内单一织体
    // 硬切次数 = 相邻 span 织体变化(排除空)→ 应 ≤ 段落数(旧值 41)
    const seq = plan.chordTimeline.map((c) => sched[c.id] ?? '');
    let switches = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] && seq[i - 1] && seq[i] !== seq[i - 1]) switches++;
    expect(switches).toBeLessThanOrEqual(plan.chordTimeline.length / 8 + 1); // 远小于 41(每段 ~8 span)
  });

  it('★ 633823/POP:comp 不再出现 >2 拍突发空洞(旧 3.75 拍)', () => {
    const { ir } = generateSong({ seed: 633823, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const { timebase } = pieces(633823, 'pop');
    expect(maxCompGap(ir, timebase.ppq)).toBeLessThan(2.0); // 旧 3.75;残留为织体自身一致节奏,非突发洞
  });

  it('★ 器配层 richTextureBySection:同 role 一致(verse↔verse 同)+ 同曲 ≤2 + chorus≠verse', () => {
    const { arrangement, instrumentation } = pieces(633823, 'pop');
    const rich = instrumentation.richTextureBySection;
    const byRole: Record<string, Set<string>> = {};
    for (const s of arrangement.sections) { const tc = rich[s.id]; if (tc) (byRole[s.role] ??= new Set()).add(tc); }
    // 同 role 段(verse1/verse2、chorus1/chorus2)复用同一 texture
    for (const set of Object.values(byRole)) expect(set.size).toBe(1);
    // 同曲核心织体 ≤ 2
    expect(new Set(Object.values(rich)).size).toBeLessThanOrEqual(2);
    // chorus 与 verse 不同(段落对比)
    if (byRole.verse && byRole.chorus) expect([...byRole.verse][0]).not.toBe([...byRole.chorus][0]);
  });

  it('LOFI 第一期不下发(richTextureBySection 空)→ 逐 span 回退仍工作', () => {
    const { instrumentation, sched } = pieces(633823, 'lofi');
    expect(Object.keys(instrumentation.richTextureBySection).length).toBe(0);
    expect(Object.keys(sched).length).toBeGreaterThan(0); // 回退路径仍出 schedule
  });

  it('确定性:同 seed 两次 richTextureBySection + schedule 一致', () => {
    const a = pieces(633823, 'pop');
    const b = pieces(633823, 'pop');
    expect(a.instrumentation.richTextureBySection).toEqual(b.instrumentation.richTextureBySection);
    expect(a.sched).toEqual(b.sched);
  });
});
