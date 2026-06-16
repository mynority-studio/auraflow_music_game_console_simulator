// ============================================================
// motifSandbox · model · Melodic Slot Planner(directive roadmap_slot_fusion §7)
// ------------------------------------------------------------
// buildMelodicSlotPlanFromRoadMap:RoadmapBrickSlot[] → MelodicSlotPlan(纯函数,确定性)。
//   ① brick type → 旋律 requiredFunction。
//   ② userBrick 功能 → 偏好的 slot 功能 → 选【最佳功能匹配 slot】落 motif(mustQuote)。
//   ③ 结构性复现:与最佳 slot 同 recurrenceKey 的 slot 也 mustQuote(motif 在等价 brick 再现)。
//   ④ 用户决策:无复现(through-composed)→ 回退【句头】排比(保记忆点)。
//   ⑤ 其余 slot:同类型→mustDevelop / 答句区→mayReference / 抵触功能→generatedOnly,带 lineage。
//   不假设固定 bar 0/16/32/48 —— quote 落点来自 RoadMap slot。Phase 5 weaver 据此填充。
// ============================================================

import type { MotifSandboxFormContext } from './types';
import type {
  RoadmapBrickSlot, RoadmapBrickType, UserMelodicBrick, UserMelodicBrickFunction,
  MelodicSlot, MelodicSlotPlan, MelodicSlotFunction, MelodicSlotTransform,
} from './melodicBrickTypes';

const PHRASE_BEATS = 16; // 句头排比回退用(4 小节)

/** brick type → 该区域要求的旋律功能。 */
const TYPE_FUNCTION: Record<RoadmapBrickType, MelodicSlotFunction> = {
  Launcher: 'opening', Tonic: 'opening', Approach: 'approach',
  Cadence: 'cadence', Turnaround: 'answer', Cycle: 'continuation', Other: 'fill',
};

/** userBrick 功能 → 偏好的 slot 功能(优先序;空 = ambiguous,落第一个结构强 slot)。 */
const USER_PREF: Record<UserMelodicBrickFunction, MelodicSlotFunction[]> = {
  opening: ['opening'], launcher: ['opening'], approach: ['approach'],
  cadence: ['cadence', 'resolution'], resolution: ['cadence', 'resolution'],
  answer: ['answer', 'continuation'],
  passing: ['continuation', 'fill'], neighbor: ['continuation', 'fill'],
  arpeggio: ['opening', 'continuation'], sequence: ['continuation', 'answer'],
  ambiguous: [],
};

/** 同类型发展槽用的变形手法。 */
function devTransform(fn: MelodicSlotFunction): MelodicSlotTransform {
  return fn === 'approach' ? 'transpose' : fn === 'cadence' || fn === 'resolution' ? 'cadenceTail' : 'sequence';
}

interface Pair { brick: RoadmapBrickSlot; slot: MelodicSlot; }

/** 找句头(0/16/32…)覆盖的 slot —— RoadMap 无复现时的排比回退。 */
function phraseHeadBrickIds(pairs: readonly Pair[], totalBeats: number): Set<string> {
  const ids = new Set<string>();
  for (let h = 0; h < totalBeats - 1e-6; h += PHRASE_BEATS) {
    // 句头落在哪个 brick 跨度内(否则取起点最接近的)
    let pick = pairs.find((p) => h >= p.brick.startBeat - 1e-6 && h < p.brick.startBeat + p.brick.durationBeats - 1e-6);
    if (!pick) pick = [...pairs].sort((a, b) => Math.abs(a.brick.startBeat - h) - Math.abs(b.brick.startBeat - h))[0];
    if (pick) ids.add(pick.brick.id);
  }
  return ids;
}

export function buildMelodicSlotPlanFromRoadMap(args: {
  form: MotifSandboxFormContext;
  roadmapBricks: readonly RoadmapBrickSlot[];
  userBrick: UserMelodicBrick;
  seed: number;
}): MelodicSlotPlan {
  const { form, roadmapBricks, userBrick } = args;
  const beatsPerBar = form.beatsPerBar;
  const totalBeats = form.totalBars * beatsPerBar;
  const warnings: string[] = [];

  if (roadmapBricks.length === 0) {
    return { totalBars: form.totalBars, beatsPerBar, slots: [], userQuoteSlotIds: [], userDevelopSlotIds: [], warnings: ['RoadMap 无 brick → 空 slot plan'] };
  }

  // ① 每个 brick → MelodicSlot 骨架(requiredFunction 由 type 决定);按 startBeat 排序。
  const ordered = [...roadmapBricks].sort((a, b) => a.startBeat - b.startBeat);
  const pairs: Pair[] = ordered.map((b, i) => ({
    brick: b,
    slot: {
      id: `ms-${i}-${b.startBeat}`, roadmapBrickId: b.id,
      startBeat: b.startBeat, durationBeats: b.durationBeats, sectionId: b.sectionId,
      requiredFunction: TYPE_FUNCTION[b.type],
      userMotifPolicy: 'generatedOnly', lineage: { transform: 'none' }, reason: '',
    },
  }));

  // ② 最佳功能匹配 slot:userBrick 功能偏好命中 → 最早那个;否则第一个结构强 slot(opening/cadence)→ 兜底首槽。
  const pref = USER_PREF[userBrick.primaryFunction] ?? [];
  let best = pairs.find((p) => pref.includes(p.slot.requiredFunction));
  if (!best) best = pairs.find((p) => p.slot.requiredFunction === 'opening' || p.slot.requiredFunction === 'cadence') ?? pairs[0];

  // ③/④ quote 集合:结构性复现(同 recurrenceKey)优先;无复现 → 回退句头(用户决策,保排比)。
  const bestKey = best.brick.recurrenceKey;
  const recurringIds = new Set(pairs.filter((p) => p.brick.recurrenceKey === bestKey).map((p) => p.brick.id));
  let quoteIds: Set<string>;
  if (recurringIds.size >= 2) {
    quoteIds = recurringIds; // motif 落在所有结构等价 brick(结构性复现)
  } else {
    quoteIds = phraseHeadBrickIds(pairs, totalBeats); // 回退:句头排比
    quoteIds.add(best.brick.id);                      // 至少含最佳匹配
    warnings.push('RoadMap 无复现 brick → motif 回退句头排比(保记忆点)');
  }

  // ⑤ 逐 slot 定策略 + lineage + reason。
  for (const p of pairs) {
    const isQuote = quoteIds.has(p.brick.id);
    if (isQuote) {
      p.slot.userMotifPolicy = 'mustQuote';
      p.slot.lineage = { sourceMotifId: userBrick.sourceMotifId, transform: 'quote' };
      p.slot.reason = `quote@${p.brick.type}${recurringIds.size >= 2 ? '(recur)' : '(phraseHead)'}`;
    } else if (p.brick.type === best.brick.type) {
      p.slot.userMotifPolicy = 'mustDevelop';
      p.slot.lineage = { sourceMotifId: userBrick.sourceMotifId, parentSlotId: best.slot.id, transform: devTransform(p.slot.requiredFunction) };
      p.slot.reason = `develop@${p.brick.type}`;
    } else if (p.slot.requiredFunction === 'answer' || p.slot.requiredFunction === 'continuation') {
      p.slot.userMotifPolicy = 'mayReference';
      p.slot.lineage = { sourceMotifId: userBrick.sourceMotifId, parentSlotId: best.slot.id, transform: 'answer' };
      p.slot.reason = `reference@${p.brick.type}`;
    } else {
      p.slot.userMotifPolicy = 'generatedOnly';
      p.slot.lineage = { transform: 'none' };
      p.slot.reason = `generated@${p.brick.type}`;
    }
  }

  const slots = pairs.map((p) => p.slot);
  const userQuoteSlotIds = slots.filter((s) => s.userMotifPolicy === 'mustQuote').map((s) => s.id);
  const userDevelopSlotIds = slots.filter((s) => s.userMotifPolicy === 'mustDevelop' || s.userMotifPolicy === 'mayReference').map((s) => s.id);
  return { totalBars: form.totalBars, beatsPerBar, slots, userQuoteSlotIds, userDevelopSlotIds, warnings };
}
