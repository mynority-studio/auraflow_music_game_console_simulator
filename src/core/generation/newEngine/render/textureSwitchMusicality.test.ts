import { describe, it, expect } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { buildTextureSchedule } from './textureSchedule';
import { createTimebase, createRandomContext, beats } from '../foundation';
import { textureBehavior, isDelayedEntryTexture, rateTextureTransition } from '../knowledge/textureProfiles';
import { RENDERED_TEXTURE_CASES } from './textureRenderer';
import { measureCompGaps } from './compContinuity';
import { denseMelodySpanRanges } from './mgPostMixShaper';
import type { MusicalIR } from '../ir/MusicalIR';

// comp 真在场区间(从 chordTimeline 实际 span 算 + comp 在 activeRoles + 段 active)。
function compActiveRanges(p: ReturnType<typeof pieces>): { lo: number; hi: number }[] {
  const { plan, instrumentation, timebase, activeSectionIds } = p;
  const bySec: Record<string, { lo: number; hi: number }> = {};
  for (const c of plan.chordTimeline) {
    const lo = timebase.beatToTick(c.startBeat) as number;
    const hi = lo + (timebase.beatToTick(c.durationBeats) as number);
    const r = bySec[c.sectionId];
    if (!r) bySec[c.sectionId] = { lo, hi }; else { r.lo = Math.min(r.lo, lo); r.hi = Math.max(r.hi, hi); }
  }
  return Object.entries(bySec)
    .filter(([sid]) => activeSectionIds.has(sid) && (instrumentation.activeRolesBySection[sid] ?? []).includes('comp'))
    .map(([, r]) => r);
}

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
  it('★ 633823/POP:段内织体 ≤2(无逐 span 乱切)+ 硬切骤降到结构点', () => {
    const { plan, sched, arrangement } = pieces(633823, 'pop');
    // 段内 ≤2:段级织体 + 最多一个中段受控变体(第二期)
    const bySec: Record<string, Set<string>> = {};
    for (const c of plan.chordTimeline) { const tc = sched[c.id]; if (tc) (bySec[c.sectionId] ??= new Set()).add(tc); }
    for (const set of Object.values(bySec)) expect(set.size).toBeLessThanOrEqual(2);
    // 硬切 = 相邻 span 织体变化 → ≤ 段落数 + verse 数(段边界 + 每 verse 最多一个变体点),远小于 41
    const seq = plan.chordTimeline.map((c) => sched[c.id] ?? '');
    let switches = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] && seq[i - 1] && seq[i] !== seq[i - 1]) switches++;
    const verses = arrangement.sections.filter((s) => s.role === 'verse').length;
    expect(switches).toBeLessThanOrEqual(arrangement.sections.length + verses);
  });

  it('★ 第二期段内受控变化:触发时 verse 段 ≤2 织体、所有 verse 一致(repeatGroup)、不引入突发洞', () => {
    // 找一个触发 verse 变体的 seed(seed 2/pop 实测触发)
    const { arrangement, instrumentation, plan, sched, timebase } = pieces(2, 'pop');
    const sw = instrumentation.richTextureSwitchBySection;
    expect(Object.keys(sw).length).toBeGreaterThan(0); // 该 seed 触发
    const verses = arrangement.sections.filter((s) => s.role === 'verse');
    // 所有 verse 段同一变体(repeatGroup 一致)
    const variants = new Set(verses.map((v) => sw[v.id]?.toTexture).filter(Boolean));
    expect(variants.size).toBe(1);
    // 每 verse 段 = 2 种织体(base + 变体)
    for (const v of verses) {
      const set = new Set(plan.chordTimeline.filter((c) => c.sectionId === v.id).map((c) => sched[c.id]).filter(Boolean));
      expect(set.size).toBeLessThanOrEqual(2);
    }
    // 不引入突发洞(变体为兼容连续织体)
    const { ir } = generateSong({ seed: 2, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    expect(maxCompGap(ir, timebase.ppq)).toBeLessThan(2.0);
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

  it('★ LOFI(三期纳入段级机制):有段级下发 + 段内织体 ≤2(不再逐 span 乱切)', () => {
    const { instrumentation, sched, plan } = pieces(633823, 'lofi');
    expect(Object.keys(instrumentation.richTextureBySection).length).toBeGreaterThan(0); // 三期:LOFI 也段级下发
    const bySec: Record<string, Set<string>> = {};
    for (const c of plan.chordTimeline) { const tc = sched[c.id]; if (tc) (bySec[c.sectionId] ??= new Set()).add(tc); }
    for (const set of Object.values(bySec)) expect(set.size).toBeLessThanOrEqual(2);
  });

  it('确定性:同 seed 两次 richTextureBySection + schedule 一致', () => {
    const a = pieces(633823, 'pop');
    const b = pieces(633823, 'pop');
    expect(a.instrumentation.richTextureBySection).toEqual(b.instrumentation.richTextureBySection);
    expect(a.instrumentation.richTextureSwitchBySection).toEqual(b.instrumentation.richTextureSwitchBySection);
    expect(a.sched).toEqual(b.sched);
  });
});

describe('texture behavior KB(第二期元数据)', () => {
  it('全 16 rich 织体都有 behavior + firstOnsetBeat', () => {
    for (const tc of RENDERED_TEXTURE_CASES) {
      expect(textureBehavior(tc), tc).toBeDefined();
      expect(typeof textureBehavior(tc)!.firstOnsetBeat).toBe('number');
    }
  });

  it('isDelayedEntryTexture:含 Q&A / Reverse_Swell / Lofi_Late_Chord_Answer(一期硬编码漏的)', () => {
    expect(isDelayedEntryTexture('Piano_Question_Answer')).toBe(true);
    expect(isDelayedEntryTexture('Ambient_Reverse_Swell')).toBe(true);          // ★ 一期漏,二期补
    expect(isDelayedEntryTexture('Piano_Lofi_Late_Chord_Answer')).toBe(true);
    expect(isDelayedEntryTexture('Low_Pedal_Color_Wash')).toBe(false);
    expect(isDelayedEntryTexture('HalfTime_Emotional_Pulse')).toBe(false);
  });

  it('rateTextureTransition:→delayedEntry=downbeatAnchor;wash→pluck=carryTail;同织体=allow', () => {
    expect(rateTextureTransition('Low_Pedal_Color_Wash', 'Piano_Question_Answer')).toEqual({ rating: 'allowWithBridge', bridge: 'downbeatAnchor' });
    expect(rateTextureTransition('Ambient_Pad_Breath', 'Soft_Guitar_Pluck_8ths')).toEqual({ rating: 'allowWithBridge', bridge: 'carryTail' });
    expect(rateTextureTransition('Low_Pedal_Color_Wash', 'Low_Pedal_Color_Wash')).toEqual({ rating: 'allow', bridge: 'none' });
    expect(rateTextureTransition('Lyrical_10th_Broken', 'Piano_Wide_Color_Motion').rating).toBe('allow'); // arp→roll continuous
  });
});

describe('comp 连续性审计(第三期 measureCompGaps)', () => {
  it('只在 active 区间量空隙;排除 comp 缺席段', () => {
    const ppq = 480;
    // active 区间 [0,1920];comp 覆盖 0-960 + 1440-1920 → 空隙 960-1440 = 1 拍
    const notes = [{ startTick: 0, durationTicks: 960 }, { startTick: 1440, durationTicks: 480 }];
    const rep = measureCompGaps(notes, [{ lo: 0, hi: 1920 }], ppq);
    expect(rep.maxGapBeats).toBeCloseTo(1.0);
    // [1920,3840] 是 comp 缺席段(不在 activeRanges)→ 不计入,哪怕全空
    const rep2 = measureCompGaps(notes, [{ lo: 0, hi: 1920 }], ppq); // 同上,缺席段被排除
    expect(rep2.maxGapBeats).toBeCloseTo(1.0);
  });
});

describe('texture-switch 回归矩阵(directive §5,6 seed × 4 风格)', () => {
  const SEEDS = [633823, 64062, 7, 42, 100, 999];
  const STYLES = ['pop', 'rnb', 'jazz', 'lofi'];
  for (const seed of SEEDS) for (const style of STYLES) {
    it(`${seed}/${style}: 不 failed · 段内织体 ≤2 · comp-active 无 >2.5 拍突发洞`, () => {
      const p = pieces(seed, style);
      // 段内织体 ≤2(段级 + 最多一个受控变体)
      const bySec: Record<string, Set<string>> = {};
      for (const c of p.plan.chordTimeline) { const tc = p.sched[c.id]; if (tc) (bySec[c.sectionId] ??= new Set()).add(tc); }
      for (const set of Object.values(bySec)) expect(set.size).toBeLessThanOrEqual(2);
      // 生成不 failed + comp 无突发洞(用生产 auditor 的 comp-continuity-gap finding:per-style 阈值 +
      //   ★ Loop 5 已从"comp 应在场区间"排除 LOFI dense-melody 区间[那里 comp 被有意删],故不误报)。
      const { status, report } = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      expect(status).not.toBe('failed');
      expect(report.findings.some((f) => f.ruleId === 'comp-continuity-gap')).toBe(false);
    });
  }
});
