import { describe, it, expect } from 'vitest';
import { buildMelodicSlotPlanFromRoadMap } from './melodicSlotPlanner';
import { defaultSandboxForm } from './types';
import type { RoadmapBrickSlot, RoadmapBrickType, UserMelodicBrick, UserMelodicBrickFunction } from './melodicBrickTypes';

// planner 只读 userBrick.primaryFunction + sourceMotifId → 用最小 fake brick 聚焦 planner 逻辑。
const userBrickAs = (fn: UserMelodicBrickFunction): UserMelodicBrick => ({ primaryFunction: fn, sourceMotifId: 'motif-x' } as UserMelodicBrick);
const rb = (id: string, type: RoadmapBrickType, startBeat: number, recurrenceKey: string, durationBeats = 4): RoadmapBrickSlot => ({
  id, name: id, type, startBeat, durationBeats, chordIds: [`ch@${startBeat}`], recurrenceKey,
});
const slotById = (plan: ReturnType<typeof buildMelodicSlotPlanFromRoadMap>, id: string) => plan.slots.find((s) => s.id === id)!;
const quoteFns = (plan: ReturnType<typeof buildMelodicSlotPlanFromRoadMap>) => plan.userQuoteSlotIds.map((id) => slotById(plan, id).requiredFunction);
const quoteStartsOf = (plan: ReturnType<typeof buildMelodicSlotPlanFromRoadMap>) => plan.userQuoteSlotIds.map((id) => slotById(plan, id).startBeat).sort((a, b) => a - b);

describe('motifSandbox/melodicSlotPlanner(RoadMap → 旋律 slot 计划,Phase 4)', () => {
  it('★ 每 slot 有 roadmapBrickId;至少一个 mustQuote', () => {
    const bricks = [rb('a', 'Tonic', 0, 'Tonic|I'), rb('b', 'Approach', 4, 'Approach|ii-V'), rb('c', 'Cadence', 8, 'Cadence|V-I')];
    const plan = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('opening'), seed: 7 });
    expect(plan.slots.every((s) => s.roadmapBrickId)).toBe(true);
    expect(plan.userQuoteSlotIds.length).toBeGreaterThanOrEqual(1);
  });

  it('★ cadence motif 不强制曲首复述,落到最早 Cadence brick', () => {
    const bricks = [rb('a', 'Tonic', 0, 'Tonic|I'), rb('b', 'Cadence', 4, 'Cadence|V-I'), rb('c', 'Approach', 8, 'Approach|ii-V'), rb('d', 'Cadence', 12, 'Cadence|V-I')];
    const plan = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('cadence'), seed: 5 });
    expect(quoteStartsOf(plan)).toEqual([4, 12]);
    expect(slotById(plan, plan.slots[0].id).userMotifPolicy).not.toBe('mustQuote');
  });

  it('★ directive#4:approach motif → quote 落在 Approach slot', () => {
    const bricks = [rb('a', 'Tonic', 0, 'Tonic|I'), rb('b', 'Approach', 4, 'Approach|ii-V'), rb('c', 'Cadence', 8, 'Cadence|V-I'), rb('d', 'Approach', 12, 'Approach|ii-V')];
    const plan = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('approach'), seed: 3 });
    expect(quoteFns(plan)).toContain('approach'); // motif 落在 Approach slot(among quotes)
    expect(quoteStartsOf(plan)).toEqual([4, 12]);
  });

  it('★ directive#5:cadence motif → quote 落在 Cadence/resolution slot', () => {
    const bricks = [rb('a', 'Tonic', 0, 'Tonic|I'), rb('b', 'Cadence', 4, 'Cadence|V-I'), rb('c', 'Approach', 8, 'Approach|ii-V'), rb('d', 'Cadence', 12, 'Cadence|V-I')];
    const plan = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('cadence'), seed: 5 });
    expect(quoteFns(plan).some((f) => f === 'cadence' || f === 'resolution')).toBe(true);
    expect(quoteStartsOf(plan)).toEqual([4, 12]);
  });

  it('★ 结构性复现:同 recurrenceKey 的 brick 都 mustQuote(motif 在等价 brick 再现)', () => {
    const bricks = [rb('a', 'Tonic', 0, 'Tonic|I'), rb('b', 'Approach', 6, 'Approach|ii-V'), rb('c', 'Approach', 18, 'Approach|ii-V')];
    const plan = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(24), roadmapBricks: bricks, userBrick: userBrickAs('approach'), seed: 1 });
    const qs = quoteStartsOf(plan);
    expect(qs).toContain(6); expect(qs).toContain(18);  // 结构性复现落 RoadMap brick(6/18),非固定锚
    expect(qs).not.toContain(0);
    expect(plan.warnings.some((w) => w.includes('结构再现点') || w.includes('段落开头'))).toBe(false); // 走结构性复现,非回退
  });

  it('★ 无复现 → 只落最早功能匹配 brick(warning 标记,不强制曲首)', () => {
    // 全唯一 recurrenceKey → 无结构复现
    const bricks = [rb('a', 'Tonic', 0, 'Tonic|I'), rb('b', 'Approach', 4, 'Approach|ii-V'), rb('c', 'Cadence', 8, 'Cadence|IV-V'), rb('d', 'Turnaround', 12, 'Turnaround|vi-IV')];
    const plan = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('approach'), seed: 2 });
    expect(plan.warnings.some((w) => w.includes('最早功能匹配') && w.includes('不强制曲首'))).toBe(true);
    expect(plan.userQuoteSlotIds.length).toBe(1);
    // 最佳匹配(Approach@4)一定在 quote 集合里
    expect(plan.userQuoteSlotIds.map((id) => slotById(plan, id).startBeat)).toEqual([4]);
  });

  it('★ 非 quote slot:同类型→mustDevelop / 答句区→mayReference / 抵触→generatedOnly,带 lineage', () => {
    const bricks = [rb('a', 'Approach', 0, 'Approach|ii-V'), rb('b', 'Approach', 8, 'Approach|ii-V'), rb('c', 'Cycle', 4, 'Cycle|vi'), rb('d', 'Cadence', 12, 'Cadence|V-I')];
    const plan = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('approach'), seed: 4 });
    const cycle = plan.slots.find((s) => s.requiredFunction === 'continuation')!;
    expect(cycle.userMotifPolicy).toBe('mayReference');           // Cycle = 答句/延续区
    expect(cycle.lineage.sourceMotifId).toBe('motif-x');
    const cadence = plan.slots.find((s) => s.requiredFunction === 'cadence')!;
    expect(cadence.userMotifPolicy).toBe('generatedOnly');         // 与 approach motif 抵触
    for (const s of plan.slots) expect(s.reason).toBeTruthy();
  });

  it('★ Phase6 校验:连续铺满的 plan 无结构 warning;有 quote', () => {
    // 4 brick × 16 拍 = 64 拍,连续铺满 16 bar(模拟真实 brick tiling)
    const bricks = [rb('a', 'Tonic', 0, 'Tonic|I', 16), rb('b', 'Approach', 16, 'Approach|ii-V', 16), rb('c', 'Tonic', 32, 'Tonic|I', 16), rb('d', 'Cadence', 48, 'Cadence|V-I', 16)];
    const plan = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('opening'), seed: 6 });
    expect(plan.warnings.filter((w) => w.includes('空洞') || w.includes('重叠') || w.includes('未铺满') || w.includes('beat0'))).toEqual([]);
    expect(plan.userQuoteSlotIds.length).toBeGreaterThanOrEqual(1);
  });

  it('★ Phase6 校验:覆盖空洞被报告', () => {
    const bricks = [rb('a', 'Tonic', 0, 'Tonic|I', 4), rb('b', 'Cadence', 12, 'Cadence|V-I', 4)]; // 4-12 空洞
    const plan = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('opening'), seed: 1 });
    expect(plan.warnings.some((w) => w.includes('空洞'))).toBe(true);
  });

  it('确定性:同输入 → 同 plan', () => {
    const bricks = [rb('a', 'Tonic', 0, 'Tonic|I'), rb('b', 'Approach', 4, 'Approach|ii-V'), rb('c', 'Approach', 12, 'Approach|ii-V')];
    const a = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('approach'), seed: 9 });
    const b = buildMelodicSlotPlanFromRoadMap({ form: defaultSandboxForm(16), roadmapBricks: bricks, userBrick: userBrickAs('approach'), seed: 9 });
    expect(a.userQuoteSlotIds).toEqual(b.userQuoteSlotIds);
    expect(a.slots.map((s) => s.userMotifPolicy)).toEqual(b.slots.map((s) => s.userMotifPolicy));
  });
});
