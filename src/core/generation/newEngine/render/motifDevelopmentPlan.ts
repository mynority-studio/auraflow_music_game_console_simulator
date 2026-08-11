// ============================================================
// newEngine · render · motifDevelopmentPlan(redesign 二期)
// ------------------------------------------------------------
// 把"一次 owned span"扩成发展弧线:陈述(quote)→ 再现/片段化(develop)→ 回归(return)。
// 硬不变量(docs/motif-development-redesign-task.md §1):用户音高与先后顺序永不改;
// 变奏只允许 删音(片段化/省中段)/ 改时值(延尾/持音)/ 整体平移;
// 经过音插入的音高严格限制在相邻锚点音高闭区间内 → 构造上保序保轮廓。
// 全部纯函数、确定性(打分排序选址,无 RNG)。
// ============================================================

import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { NoteIR } from '../ir/MusicalIR';
import type { Timebase } from '../foundation';
import type { RoadMap } from './mgRoadMapParser';
import {
  admittedPcsAtBeat,
  capUnsupportedLongExposure,
  materializeAuthoredUserMotifBrick,
  motifHarmonicSupportRatio,
  motifLongExposureSupported,
  motifStructuralNotesSupported,
  USER_MOTIF_RELAXED_DEVIATION_RATIO,
  type AuthoredMotifDevelopmentOccurrence,
  type AuthoredMotifSectionInfo,
  type AuthoredUserMotifBrickPlan,
  type MotifRecognizabilityAudit,
  type UserMotifBrickNote,
} from './userMotifBrick';
import { buildMelodyRhythmShapeProfile, melodyRhythmShapeSimilarity } from './mgRhythmShapeMatcher';
import { motifStyleIntegration } from './motifStyleIntegration';
import {
  applyLineageOp,
  formalFunctionForPosition,
  lineageOpFor,
  lineageSimilarityToRoot,
  pitchPolicyForOp,
  similarityBandVerdict,
  type MotifFormalFunction,
} from './motifLineage';

export type MotifConfidenceTier = 'fidelity' | 'refine' | 'heal';
export type MotifDevelopmentTransform =
  | 'exact-recap' | 'fragment-head' | 'fragment-tail'
  | 'delay-tail' | 'terminal-hold' | 'omit-middle';

/** occurrence 必须达到的和声支持度(低于此宁可不出现,不硬凹)。 */
export const MOTIF_OCCURRENCE_MIN_SUPPORT = 0.6;
const MIN_GAP_BEATS = 4;
const MIN_DUR = 0.25;

const TRANSFORM_LABEL: Record<MotifDevelopmentTransform, string> = {
  'exact-recap': '完整再现', 'fragment-head': '头部片段', 'fragment-tail': '尾部片段',
  'delay-tail': '延尾', 'terminal-hold': '持音收', 'omit-middle': '省中段',
};

/** 档位允许的变奏词汇:保真档只做最保守的再现/头部片段。 */
const TIER_TRANSFORMS: Record<MotifConfidenceTier, readonly MotifDevelopmentTransform[]> = {
  fidelity: ['exact-recap', 'fragment-head', 'terminal-hold'],
  refine: ['exact-recap', 'fragment-head', 'fragment-tail', 'delay-tail', 'terminal-hold', 'omit-middle'],
  heal: ['exact-recap', 'fragment-head', 'fragment-tail', 'delay-tail', 'terminal-hold', 'omit-middle'],
};

const mod12 = (v: number): number => ((v % 12) + 12) % 12;
const clone = (notes: readonly UserMotifBrickNote[]): UserMotifBrickNote[] => notes.map((n) => ({ ...n }));
const spanOf = (notes: readonly UserMotifBrickNote[]): number =>
  Math.max(MIN_DUR, ...notes.map((n) => n.onsetBeat + n.durationBeat));

/** 对 0 起点的相对音符序列施加变奏。返回 null = 该变奏对此素材不适用。
 *  不变量:输出音高序列 = 输入音高序列的连续子序列或全序列(保音高保序);onset 单调。 */
export function applyMotifTransform(
  transform: MotifDevelopmentTransform,
  relative: readonly UserMotifBrickNote[],
  sourceSpanBeats: number,
): UserMotifBrickNote[] | null {
  const n = relative.length;
  if (n < 2) return null;
  switch (transform) {
    case 'exact-recap':
      return clone(relative);
    case 'fragment-head': {
      if (n < 3) return null;
      const keep = Math.max(2, Math.ceil(n / 2));
      return clone(relative.slice(0, keep));
    }
    case 'fragment-tail': {
      if (n < 3) return null;
      const keep = Math.max(2, Math.ceil(n / 2));
      const tail = clone(relative.slice(n - keep));
      const base = tail[0].onsetBeat;
      return tail.map((x) => ({ ...x, onsetBeat: x.onsetBeat - base }));
    }
    case 'delay-tail': {
      const out = clone(relative);
      const last = out[n - 1];
      if (last.onsetBeat + 0.5 + MIN_DUR > sourceSpanBeats) return null;
      last.onsetBeat += 0.5;
      last.durationBeat = Math.max(MIN_DUR, last.durationBeat - 0.5);
      return out;
    }
    case 'terminal-hold': {
      const out = clone(relative);
      const last = out[n - 1];
      last.durationBeat = Math.max(last.durationBeat, sourceSpanBeats - last.onsetBeat);
      return out;
    }
    case 'omit-middle': {
      if (n < 4) return null;
      const interior = relative.slice(1, n - 1)
        .map((x, i) => ({ index: i + 1, score: x.structuralToneScore ?? 0.5 }))
        .sort((a, b) => a.score - b.score);
      const drop = new Set(interior.slice(0, Math.max(1, Math.floor((n - 2) / 3))).map((x) => x.index));
      return clone(relative.filter((_, i) => !drop.has(i)));
    }
    default:
      return null;
  }
}

/** 结缔组织 + 弱音降级(修饰/治愈档)。音高不变量:
 *  - 降级只缩时值/降力度,音高不动;
 *  - 插入音的音高严格落在相邻两锚点音高的【开区间】内 → 不可能破坏轮廓/顺序。 */
export function refineMotifNotes(
  source: readonly UserMotifBrickNote[],
  harmonicPlan: HarmonicPlan,
  windowEndBeat: number,
  tier: MotifConfidenceTier,
): UserMotifBrickNote[] {
  if (tier === 'fidelity' || source.length < 2) return clone(source);
  const notes = [...source].sort((a, b) => a.onsetBeat - b.onsetBeat).map((x) => ({ ...x }));
  // —— 弱音降级:内部经过重音(低结构分)且不被 chord-scale 准入 → 缩短 + 压低,当装饰听 ——
  for (let i = 1; i < notes.length - 1; i++) {
    const x = notes[i];
    if ((x.structuralToneScore ?? 0.5) >= 0.3) continue;
    if (admittedPcsAtBeat(harmonicPlan, x.onsetBeat).includes(mod12(x.pitch))) continue;
    x.durationBeat = Math.min(x.durationBeat, 1 / 3);
    x.velocity = Math.max(1, Math.round(x.velocity * 0.8));
  }
  // —— 经过音插入:【仅治愈档】(用户标准 2026-08-10:非瞎按输入尽量不加音,
  //    加多了听不出是自己的 motif;完善动机优先用外部框接/衍生材料,不动内部)——
  const inserts: UserMotifBrickNote[] = [];
  if (tier !== 'heal') return notes.sort((x, y) => x.onsetBeat - y.onsetBeat || x.pitch - y.pitch);
  const maxInserts = Math.max(1, Math.floor(notes.length / 3));
  for (let i = 0; i < notes.length - 1 && inserts.length < maxInserts; i++) {
    const a = notes[i], b = notes[i + 1];
    const ioi = b.onsetBeat - a.onsetBeat;
    const restGap = b.onsetBeat - (a.onsetBeat + a.durationBeat);
    const leap = Math.abs(b.pitch - a.pitch);
    if (!((leap > 4 && ioi >= 1.0) || restGap >= 1.0)) continue;
    const insertBeat = b.onsetBeat - 0.5;
    if (insertBeat <= a.onsetBeat + 0.1 || insertBeat >= windowEndBeat - MIN_DUR) continue;
    const lo = Math.min(a.pitch, b.pitch), hi = Math.max(a.pitch, b.pitch);
    if (hi - lo < 2) continue; // 无开区间可用
    const admitted = admittedPcsAtBeat(harmonicPlan, insertBeat);
    if (admitted.length === 0) continue;
    const mid = (lo + hi) / 2;
    let best: number | null = null;
    for (let p = lo + 1; p <= hi - 1; p++) {
      if (!admitted.includes(mod12(p))) continue;
      if (best === null || Math.abs(p - mid) < Math.abs(best - mid) - 1e-9) best = p;
    }
    if (best === null) continue;
    inserts.push({
      pitch: best,
      onsetBeat: insertBeat,
      durationBeat: MIN_DUR,
      velocity: Math.max(1, Math.round(Math.min(a.velocity, b.velocity) * 0.75)),
      accent: 0.1,
      structuralToneScore: 0.1,
    });
  }
  return [...notes, ...inserts].sort((x, y) => x.onsetBeat - y.onsetBeat || x.pitch - y.pitch);
}

function sectionHeadBonus(sections: readonly AuthoredMotifSectionInfo[] | undefined, startBeat: number): number {
  const section = sections?.find((s) => startBeat >= s.startBeat - 1e-6 && startBeat < s.endBeat - 1e-6);
  if (!section) return 0.5;
  return startBeat - section.startBeat < 4 - 1e-6 ? 1 : 0.5;
}

/** 规划陈述之外的发展 occurrence(确定性,打分排序)。找不到高支持度位置就宁缺毋滥。 */
export function planMotifDevelopment(args: {
  plan: AuthoredUserMotifBrickPlan;
  roadMap: RoadMap;
  harmonicPlan: HarmonicPlan;
  totalBeats: number;
  sections?: readonly AuthoredMotifSectionInfo[];
  confidenceTier?: MotifConfidenceTier;
  style?: string;
}): AuthoredMotifDevelopmentOccurrence[] {
  const { plan, roadMap, harmonicPlan, totalBeats, sections } = args;
  const tier = args.confidenceTier ?? 'fidelity';
  const integration = motifStyleIntegration(args.style);
  // 按风格融入合同:POP/RNB 每段落在场;LOFI/ACG/JAZZ 松散关联(占比交给衍生语法)
  const perSection = integration.perSectionPresence && (sections?.length ?? 0) > 0;
  const maxExtra = perSection
    ? sections!.length
    : Math.min(integration.maxExtra, Math.floor(totalBeats / 32)); // 每 8 bar 才配得起一次再现
  if (maxExtra <= 0 || plan.notes.length < 2) return [];
  const relative = [...plan.notes]
    .sort((a, b) => a.onsetBeat - b.onsetBeat)
    .map((x) => ({ ...x, onsetBeat: x.onsetBeat - plan.startBeat }));
  const sourceSpan = spanOf(relative);

  interface Candidate { occ: AuthoredMotifDevelopmentOccurrence; score: number }
  const candidates: Candidate[] = [];
  const starts = roadMap.bricks
    .filter((b) => b.durationBeats > 0 && b.startBeat >= plan.endBeat + MIN_GAP_BEATS - 1e-6)
    .map((b) => b.startBeat);
  for (const startBeat of [...new Set(starts)]) {
    for (const transform of TIER_TRANSFORMS[tier]) {
      const rel = applyMotifTransform(transform, relative, sourceSpan);
      if (!rel) continue;
      const span = spanOf(rel);
      const endBeat = startBeat + span;
      if (endBeat > totalBeats + 1e-6) continue;
      const placed = rel.map((x) => ({ ...x, onsetBeat: x.onsetBeat + startBeat }));
      const support = motifHarmonicSupportRatio(placed, harmonicPlan);
      if (support < MOTIF_OCCURRENCE_MIN_SUPPORT) continue;
      // 长音硬门:任何 ≥1 拍的音必须被覆盖和弦接住,否则触发 avoid-long-exposure 审计
      if (!motifLongExposureSupported(placed, harmonicPlan)) continue;
      // 结构音硬门:结构落点必须被 stable/color 接住,否则触发 structural-tone-outside-intersection
      if (!motifStructuralNotesSupported(placed, harmonicPlan)) continue;
      const late = startBeat / Math.max(1, totalBeats);
      const isRecapLike = transform === 'exact-recap' || transform === 'terminal-hold';
      // 再现类靠后(回归感),片段类居中(发展感);fragmentBias = 风格对全句引用的忌讳程度
      const positionFit = isRecapLike ? late * 10 : 10 - Math.abs(late - 0.5) * 20;
      const kind: AuthoredMotifDevelopmentOccurrence['kind'] = isRecapLike && late > 0.6 ? 'return' : 'develop';
      const score = support * 100 + sectionHeadBonus(sections, startBeat) * 12 + positionFit
        + (isRecapLike ? 0 : integration.fragmentBias);
      candidates.push({
        score,
        occ: {
          kind, transform, startBeat, endBeat,
          notes: placed,
          fidelityReferenceNotes: placed,
          harmonicSupportRatio: support,
          note: `${kind === 'return' ? '回归' : '发展'} · ${TRANSFORM_LABEL[transform]} @bar${Math.floor(startBeat / 4) + 1} · 支持 ${(support * 100).toFixed(0)}%`,
        },
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.occ.startBeat - b.occ.startBeat);

  const chosen: AuthoredMotifDevelopmentOccurrence[] = [];
  const usedTransforms = new Set<string>();
  const gap = perSection ? 2 : MIN_GAP_BEATS; // 段落在场模式下密度更高,间隔放宽到 2 拍
  const collides = (occ: AuthoredMotifDevelopmentOccurrence): boolean =>
    [{ startBeat: plan.startBeat, endBeat: plan.endBeat }, ...chosen]
      .some((s) => occ.startBeat < s.endBeat + gap - 1e-6 && occ.endBeat > s.startBeat - gap + 1e-6);

  if (perSection) {
    // 每段落取该段内最高分候选(优先未用过的手法;全用过则允许重复 —— 在场优先于多样)
    for (const section of sections!) {
      if (chosen.length >= maxExtra) break;
      if (plan.startBeat >= section.startBeat - 1e-6 && plan.startBeat < section.endBeat - 1e-6) continue; // 陈述已在场
      const inSection = candidates.filter(({ occ }) =>
        occ.startBeat >= section.startBeat - 1e-6 && occ.startBeat < section.endBeat - 1e-6 && !collides(occ));
      const pick = inSection.find(({ occ }) => !usedTransforms.has(occ.transform)) ?? inSection[0];
      if (!pick) continue; // 该段无达标位置(支持度/长音门)→ 宁缺,记录在 audit 层
      usedTransforms.add(pick.occ.transform);
      chosen.push(pick.occ);
    }
  } else {
    for (const { occ } of candidates) {
      if (chosen.length >= maxExtra) break;
      if (usedTransforms.has(occ.transform)) continue; // 手法多样,不重复同一变奏
      if (collides(occ)) continue;
      usedTransforms.add(occ.transform);
      chosen.push(occ);
    }
  }
  return chosen.sort((a, b) => a.startBeat - b.startBeat);
}

/** ≤此分视为"节奏形状已认不出",report-only 警告(阈值校准后可升硬门)。 */
export const MOTIF_RECOGNIZABILITY_WARN_SIMILARITY = 0.5;
const ORNAMENT_SCORE_MAX = 0.15; // refineMotifNotes 插入的经过音 structuralToneScore = 0.1

function anchorPitches(notes: readonly UserMotifBrickNote[]): number[] {
  return [...notes]
    .sort((a, b) => a.onsetBeat - b.onsetBeat)
    .filter((n) => (n.structuralToneScore ?? 0.5) > ORNAMENT_SCORE_MAX)
    .map((n) => n.pitch);
}

function isOrderedSubsequence(sub: readonly number[], full: readonly number[]): boolean {
  let j = 0;
  for (const x of full) if (j < sub.length && sub[j] === x) j++;
  return j === sub.length;
}

/** 辨识度审计(redesign 三期,report-only):每次再现 vs 陈述的节奏相似度 + 保序不变量校验。 */
export function auditMotifRecognizability(
  plan: AuthoredUserMotifBrickPlan,
): MotifRecognizabilityAudit {
  const statementRel = plan.notes.map((n) => ({ ...n, onsetBeat: n.onsetBeat - plan.startBeat }));
  const statementProfile = buildMelodyRhythmShapeProfile(
    statementRel, 0, Math.max(1, plan.endBeat - plan.startBeat));
  const statementAnchors = anchorPitches(plan.notes);
  const warnings: string[] = [];
  const occurrences = (plan.occurrences ?? []).map((occ) => {
    const rel = occ.notes.map((n) => ({ ...n, onsetBeat: n.onsetBeat - occ.startBeat }));
    const rhythmSimilarity = melodyRhythmShapeSimilarity(
      statementProfile,
      buildMelodyRhythmShapeProfile(rel, 0, Math.max(1, occ.endBeat - occ.startBeat)),
    );
    // contour 节点(P1 保轮廓换音高):验轮廓符号而非音高子序列(倒影按镜像验)
    const pitchOrderPreserved = occ.pitchPolicy === 'contour'
      ? (() => {
        const signs = (xs: readonly { onsetBeat: number; pitch: number }[]): number[] => {
          const s = [...xs].sort((a, b) => a.onsetBeat - b.onsetBeat);
          return s.slice(1).map((x, i) => Math.sign(x.pitch - s[i].pitch));
        };
        const rootSigns = signs(plan.notes);
        const occSigns = signs(occ.notes.filter((n) => (n.structuralToneScore ?? 0.5) > ORNAMENT_SCORE_MAX));
        const expected = occ.introducedFeatures?.includes('inverted-contour')
          ? rootSigns.map((v) => -v) : rootSigns;
        const len = Math.min(expected.length, occSigns.length);
        if (len === 0) return true;
        return occSigns.slice(0, len).filter((v, i) => v === expected[i]).length / len >= 0.6;
      })()
      : isOrderedSubsequence(anchorPitches(occ.notes), statementAnchors);
    if (rhythmSimilarity < MOTIF_RECOGNIZABILITY_WARN_SIMILARITY) {
      warnings.push(`${occ.note}:节奏形状相似度 ${rhythmSimilarity.toFixed(2)} 低于 ${MOTIF_RECOGNIZABILITY_WARN_SIMILARITY}`);
    }
    if (!pitchOrderPreserved) warnings.push(`${occ.note}:非装饰音不再是陈述音高的保序子序列(不变量疑似被破坏)`);
    return {
      kind: occ.kind,
      transform: occ.transform,
      startBeat: occ.startBeat,
      rhythmSimilarity,
      pitchOrderPreserved,
      noteCountRatio: occ.notes.length / Math.max(1, plan.notes.length),
    };
  });
  return {
    occurrenceCount: occurrences.length,
    minRhythmSimilarity: occurrences.length ? Math.min(...occurrences.map((o) => o.rhythmSimilarity)) : 1,
    allPitchOrderPreserved: occurrences.every((o) => o.pitchOrderPreserved),
    occurrences,
    warnings,
  };
}

/** P1(墨盒任务书)· 谱系发展规划器(motif_development_v2):
 *  - parent-child 链:发展节点从上一变体生长(不再每次重置 root);
 *  - 形式功能:continuation(片段/模进/位移)→ development(倒影/深模进/liquidation)→ return(root 保真 + 继承);
 *  - 双向距离带:too-close 自动加深操作,too-far 重罚。 */
function planMotifLineageDevelopment(args: {
  plan: AuthoredUserMotifBrickPlan;
  roadMap: RoadMap;
  harmonicPlan: HarmonicPlan;
  totalBeats: number;
  sections: readonly AuthoredMotifSectionInfo[];
}): AuthoredMotifDevelopmentOccurrence[] {
  const { plan, roadMap, harmonicPlan, totalBeats, sections } = args;
  if (plan.notes.length < 2) return [];
  const rootRel = [...plan.notes].sort((a, b) => a.onsetBeat - b.onsetBeat)
    .map((x) => ({ ...x, onsetBeat: x.onsetBeat - plan.startBeat }));
  const rootSpan = spanOf(rootRel);
  const brickStarts = [...new Set(roadMap.bricks
    .filter((b) => b.durationBeats > 0 && b.startBeat >= plan.endBeat + 2 - 1e-6)
    .map((b) => b.startBeat))];

  const chosen: AuthoredMotifDevelopmentOccurrence[] = [];
  let parentRel = rootRel;          // 链头 = root;此后逐节点生长
  let parentNodeId = 'root';
  const depth: Record<MotifFormalFunction, number> = { presentation: 0, continuation: 0, development: 0, return: 0 };
  const introducedPool: string[] = [];
  const overlaps = (start: number, end: number): boolean =>
    [{ startBeat: plan.startBeat, endBeat: plan.endBeat }, ...chosen]
      .some((s) => start < s.endBeat + 2 - 1e-6 && end > s.startBeat - 2 + 1e-6);

  const lastIdx = sections.length - 1;
  sections.forEach((section, idx) => {
    if (plan.startBeat >= section.startBeat - 1e-6 && plan.startBeat < section.endBeat - 1e-6) return; // 陈述已在场
    const fn = formalFunctionForPosition(section.startBeat / Math.max(1, totalBeats), idx === lastIdx);
    const isReturn = fn === 'return';
    const op = isReturn
      ? (introducedPool.includes('displacement') ? 'rhythmic-displacement' as const : 'terminal-hold' as const)
      : lineageOpFor(fn, depth[fn]);
    const material = isReturn ? rootRel : parentRel; // return = root 保真;发展节点从父代生长
    let best: { occ: AuthoredMotifDevelopmentOccurrence; score: number } | null = null;
    for (const startBeat of brickStarts) {
      if (startBeat < section.startBeat - 1e-6 || startBeat >= section.endBeat - 1e-6) continue;
      const placedParent = material.map((x) => ({ ...x, onsetBeat: x.onsetBeat + startBeat }));
      let result = applyLineageOp(op, placedParent, harmonicPlan, startBeat + spanOf(material) + 1);
      if (!result) result = { notes: placedParent.map((x) => ({ ...x })), pitchPolicy: 'exact', introduced: [] };
      let notes = capUnsupportedLongExposure(result.notes, harmonicPlan);
      const relNotes = notes.map((x) => ({ ...x, onsetBeat: x.onsetBeat - startBeat }));
      const span = spanOf(relNotes);
      const endBeat = startBeat + span;
      if (endBeat > totalBeats + 1e-6 || endBeat > section.endBeat + 4 + 1e-6) continue;
      if (overlaps(startBeat, endBeat)) continue;
      const support = motifHarmonicSupportRatio(notes, harmonicPlan);
      // 保真组松门(P2.2,治"动机只出现一次"):authored 窗口的 R1/R1b 审计已降级,
      // 结构音/长音硬门不再必要(长音由 capUnsupportedLongExposure 压帽)——
      // 只留支持度门,让原音高的片段/再现在更多段落真实落位。
      if (support < (result.pitchPolicy === 'exact' ? 0.55 : 0.45)) continue;
      let similarity = lineageSimilarityToRoot(rootRel, relNotes, rootSpan, span);
      let verdict = similarityBandVerdict(fn, similarity);
      let escalated = result;
      if (verdict === 'too-close' && !isReturn) { // 过近 → 叠一层位移加深
        const deeper = applyLineageOp('rhythmic-displacement', notes, harmonicPlan, endBeat + 1);
        if (deeper) {
          escalated = { ...result, notes: deeper.notes, introduced: [...result.introduced, ...deeper.introduced] };
          notes = capUnsupportedLongExposure(deeper.notes, harmonicPlan);
          similarity = lineageSimilarityToRoot(rootRel, notes.map((x) => ({ ...x, onsetBeat: x.onsetBeat - startBeat })), rootSpan, span);
          verdict = similarityBandVerdict(fn, similarity);
        }
      }
      const bandBonus = verdict === 'in-band' ? 15 : verdict === 'too-close' ? -10 : -25;
      const score = support * 100 + sectionHeadBonus(sections, startBeat) * 12 + bandBonus;
      const nodeId = `motif-node-${idx}`;
      const occ: AuthoredMotifDevelopmentOccurrence = {
        kind: isReturn ? 'return' : 'develop',
        transform: op,
        startBeat, endBeat,
        notes, fidelityReferenceNotes: notes,
        harmonicSupportRatio: support,
        note: `${isReturn ? '回归' : fn === 'development' ? '发展' : '延续'} · ${op} · 父=${isReturn ? 'root+' + parentNodeId : parentNodeId} · 相似 ${(similarity * 100).toFixed(0)}% @bar${Math.floor(startBeat / 4) + 1}`,
        nodeId, parentNodeId: isReturn ? `root+${parentNodeId}` : parentNodeId,
        formalFunction: fn,
        pitchPolicy: isReturn ? 'exact' : pitchPolicyForOp(op),
        introducedFeatures: escalated.introduced,
        similarityToRoot: similarity,
      };
      if (!best || score > best.score) best = { occ, score };
    }
    if (!best) return;
    chosen.push(best.occ);
    if (!isReturn) { // 链式生长:下一节点从本节点的素材出发
      parentRel = best.occ.notes.map((x) => ({ ...x, onsetBeat: x.onsetBeat - best!.occ.startBeat }));
      parentNodeId = best.occ.nodeId!;
      depth[fn]++;
      introducedPool.push(...(best.occ.introducedFeatures ?? []));
    }
  });
  return chosen.sort((a, b) => a.startBeat - b.startBeat);
}

/** 一期 plan → 二期发展 plan:陈述按档位修饰,规划 develop/return occurrence 并同样修饰。 */
export function withMotifDevelopment(
  plan: AuthoredUserMotifBrickPlan | undefined,
  args: {
    roadMap: RoadMap;
    harmonicPlan: HarmonicPlan;
    totalBeats: number;
    sections?: readonly AuthoredMotifSectionInfo[];
    confidenceTier?: MotifConfidenceTier;
    style?: string;
    /** motif_development_v2(墨盒任务书 P1):谱系+形式功能+距离带。缺省 false = 二期行为(baseline)。 */
    developmentV2?: boolean;
  },
): AuthoredUserMotifBrickPlan | undefined {
  if (!plan) return undefined;
  const tier = args.confidenceTier ?? 'fidelity';
  const useV2 = (args.developmentV2 ?? false) && (args.sections?.length ?? 0) > 0
    && motifStyleIntegration(args.style).perSectionPresence; // LOFI/ACG 等松散风格仍走各自收敛策略
  const rawOccurrences = useV2
    ? planMotifLineageDevelopment({
      plan, roadMap: args.roadMap, harmonicPlan: args.harmonicPlan,
      totalBeats: args.totalBeats, sections: args.sections!,
    })
    : planMotifDevelopment({ ...args, plan });
  const occurrences = rawOccurrences.map((occ) => {
    const refined = capUnsupportedLongExposure(
      refineMotifNotes(occ.notes, args.harmonicPlan, occ.endBeat, tier), args.harmonicPlan);
    return { ...occ, notes: refined, fidelityReferenceNotes: refined };
  });
  // 陈述:接不住的长音压到暴露线下(所有档位;音高/落拍不动)。落位打分是加权比,
  // 单颗未接住长音能混过 → 必须在此兜底,否则整曲被 avoid-long-exposure 审计打回。
  const statementBase = tier === 'fidelity'
    ? plan.notes
    : refineMotifNotes(plan.notes, args.harmonicPlan, plan.endBeat, tier);
  const statement = capUnsupportedLongExposure(statementBase, args.harmonicPlan);
  const developed = { ...plan, notes: statement, fidelityReferenceNotes: statement, occurrences };
  return { ...developed, recognizability: auditMotifRecognizability(developed) };
}

/** 陈述 + 全部 occurrence 一起物化(逐段复用一期的 groove 对齐 + 保真钳制)。 */
export function materializeAuthoredUserMotifDevelopment(
  plan: AuthoredUserMotifBrickPlan | undefined,
  timebase: Timebase,
  options: Parameters<typeof materializeAuthoredUserMotifBrick>[2] = {},
): NoteIR[] {
  if (!plan) return [];
  const statement = materializeAuthoredUserMotifBrick(plan, timebase, options);
  const extras = (plan.occurrences ?? []).flatMap((occ) =>
    materializeAuthoredUserMotifBrick({
      ...plan,
      startBeat: occ.startBeat,
      endBeat: occ.endBeat,
      notes: occ.notes,
      fidelityReferenceNotes: occ.fidelityReferenceNotes,
      timingDeviationRatioLimit: Math.max(plan.timingDeviationRatioLimit, USER_MOTIF_RELAXED_DEVIATION_RATIO),
      occurrences: undefined,
    }, timebase, options));
  return [...statement, ...extras]
    .sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));
}
