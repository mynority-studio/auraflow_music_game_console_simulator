// ============================================================
// newEngine · knowledge · MelodyChordSemantics(统一旋律-和弦语义查询,B-port)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/musicTheory.ts
//   (evaluateNoteInChordContext / getMelodyChordSemantics / NoteHarmonicAssessment)。
//   ★ 已移除对 improvisorVocab 的 lazy require(plan §6):vocabFamily 保留为 optional,恒 null。
// 这是"这个音在这个和弦上行不行"的【统一入口】,给 melody/audit/resolver 共用:
//   Layer A 和弦框架(TendencyTable,scenario)+ Layer B 调性框架(K-K/IntervalAesthetics)
//   max-merge 取更狠的张力判,叠 avoid 物理法则 + scale 感知。
// 纯函数。返回 consonance(consonant/colortone/tension/avoid)+ urgency + 解决目标 + 契约布尔。
// ============================================================

import { mod12 } from '../foundation';
import { chordTypeIntervals } from './chords';
import { getChordVoicingAesthetics, isAvoidNote, computeGlobalContract, isDomFamilyChord } from './chordIntervalRoles';
import { resolveChordScenario, getMelodyTendency, detectChordBaseQuality, type ChordScenario } from './tendencyTable';
import { intervalAesthetic, kkTension, type KeyMode } from './keyProfiles';

export interface NoteHarmonicAssessment {
  consonance: 'consonant' | 'colortone' | 'tension' | 'avoid'; // 权威判读
  urgency: number;                 // [0,1] 解决急迫度(TSD 加权)
  resolutionTargets: number[];     // 绝对 pc:想去哪(本音已剔除)
  isInChordContract: boolean;      // pc ∈ 和弦 literal
  isInChordExtension: boolean;     // pc ∈ 可接受色彩扩展(非 literal)
  isInNextChordAnchor: boolean;    // pc ∈ 下一和弦 1/3/5
}

export interface MelodyChordSemantics {
  type: string;
  base: 'maj' | 'min' | 'dom' | 'sus' | null;
  scenario: ChordScenario | null;
  vocabFamily: string | null; // 恒 null(已去 improvisor 依赖)
  intervals: readonly number[];
  isSus: boolean;
  isMinorS: boolean;
  isMinorT: boolean;
  isMajFamily: boolean;
  isDomFamily: boolean;
}

/** 把和弦解析成语义:base 品质 + scenario(TendencyTable 键)+ literal intervals。无 improvisor。 */
export function getMelodyChordSemantics(chordType: string, effectiveFunc?: 'T' | 'S' | 'D'): MelodyChordSemantics {
  const base = detectChordBaseQuality(chordType);
  const scenario = effectiveFunc !== undefined ? resolveChordScenario(chordType, effectiveFunc) : null;
  const intervals = chordTypeIntervals(chordType);
  const isMinor = base === 'min';
  return {
    type: chordType, base, scenario, vocabFamily: null, intervals,
    isSus: base === 'sus',
    isMinorS: isMinor && effectiveFunc === 'S',
    isMinorT: isMinor && effectiveFunc === 'T',
    isMajFamily: base === 'maj',
    isDomFamily: base === 'dom',
  };
}

/**
 * 单音在和弦上下文中的和声评估(统一入口)。逐步忠实 port:
 *   Layer A 和弦框架 → Layer B 调性框架 max-merge → avoid 物理覆写 → scale 感知 → urgency + 目标。
 */
export function evaluateNoteInChordContext(args: {
  notePc: number;
  chordType: string;
  chordRootPc: number;
  effectiveFunc: 'T' | 'S' | 'D';
  nextChordType?: string | null;
  nextChordRootPc?: number | null;
  keyRootPc: number;
  scaleNameForBar?: string;
  isModalContext?: boolean;
  localScalePcs?: ReadonlySet<number>;
  tonalCharacter?: 'tonal' | 'modal';
  localTonalCenterPc?: number;
  globalMode?: KeyMode;
}): NoteHarmonicAssessment {
  const {
    notePc, chordType, chordRootPc, effectiveFunc,
    nextChordType = null, nextChordRootPc = null, keyRootPc,
    scaleNameForBar, isModalContext, localScalePcs,
    tonalCharacter = 'tonal', localTonalCenterPc, globalMode = 'major',
  } = args;

  const npc = mod12(notePc);
  const rpc = mod12(chordRootPc);
  const kpc = mod12(keyRootPc);
  const pcFromChord = mod12(npc - rpc);

  const literalIntervals = chordTypeIntervals(chordType);
  const isDom = isDomFamilyChord(chordType, literalIntervals);
  const localKeyRootPc = localTonalCenterPc !== undefined ? mod12(localTonalCenterPc) : kpc;
  const pcFromLocalKey = mod12(npc - localKeyRootPc);

  // 和弦相对角色 / tensionLevel
  const chordEntry = getChordVoicingAesthetics(chordType)[pcFromChord];
  const role = chordEntry?.role ?? 'AVOID_NOTE';
  const chordTensionLevel = chordEntry?.tensionLevel ?? 1.0;

  // chord literal & extension 契约
  const isInChordContract = literalIntervals.some((iv) => mod12(rpc + iv) === npc);
  const globalContract = computeGlobalContract(chordType, rpc);
  const isInChordExtension = globalContract.pcs.has(npc) && !isInChordContract;

  // 下一和弦 1/3/5 锚点
  let isInNextChordAnchor = false;
  const nextAnchorPcs: number[] = [];
  if (nextChordType !== null && nextChordRootPc !== null) {
    const nrpc = mod12(nextChordRootPc);
    const nextIvs = chordTypeIntervals(nextChordType);
    nextAnchorPcs.push(nrpc);
    if (nextIvs.includes(3)) nextAnchorPcs.push(mod12(nrpc + 3));
    if (nextIvs.includes(4)) nextAnchorPcs.push(mod12(nrpc + 4));
    if (nextIvs.includes(7)) nextAnchorPcs.push(mod12(nrpc + 7));
    isInNextChordAnchor = nextAnchorPcs.includes(npc);
  }

  // —— Layer A:和弦框架 consonance ——
  let consonance: NoteHarmonicAssessment['consonance'];
  let tendencyGravity: number | null = null;
  let tendencyTargets: readonly number[] | null = null;
  const scenario = resolveChordScenario(chordType, effectiveFunc);
  if (scenario !== null) {
    const tendency = getMelodyTendency(npc, rpc, scenario);
    tendencyGravity = tendency.gravity;
    tendencyTargets = tendency.targets;
    if (tendency.state === 'CT') consonance = 'consonant';
    else if (tendency.state === 'T') consonance = tendency.gravity >= 0.5 ? 'tension' : 'colortone';
    else consonance = 'avoid';
  } else {
    if (role === 'AVOID_NOTE') consonance = 'avoid';
    else if (role === 'CHORD_TONE') {
      if (isDom && pcFromChord === 10) consonance = 'tension';
      else if (chordType.startsWith('maj') && pcFromChord === 11) consonance = 'tension';
      else consonance = 'consonant';
    } else if (role === 'AVAILABLE_TENSION') consonance = 'colortone';
    else consonance = 'tension'; // ALTERED_TENSION
  }

  // —— Layer B:调性框架 max-merge(取更狠的张力判,单向升级)——
  const layerBRule = intervalAesthetic(pcFromLocalKey, globalMode);
  const layerBGravity = kkTension(pcFromLocalKey, globalMode);
  const layerBTargetsAbs = layerBRule.expectedResolutions.map((t) => mod12(localKeyRootPc + t));
  const layerAGravity = tendencyGravity ?? chordTensionLevel * 0.5;
  if (layerBGravity > layerAGravity) {
    tendencyGravity = layerBGravity;
    const rank = { consonant: 0, colortone: 1, tension: 2, avoid: 3 } as const;
    if (layerBGravity >= 0.85) {
      const verdict: NoteHarmonicAssessment['consonance'] = layerBRule.function === 'Tension' ? 'avoid' : 'tension';
      if (rank[verdict] > rank[consonance]) consonance = verdict;
    } else if (layerBGravity >= 0.5) {
      if (consonance === 'consonant' || consonance === 'colortone') consonance = 'tension';
    }
  }
  const mergedLayerTargets: number[] = [];
  if (tendencyTargets !== null) for (const off of tendencyTargets) mergedLayerTargets.push(mod12(rpc + off));
  for (const pc of layerBTargetsAbs) mergedLayerTargets.push(pc);

  // avoid 物理法则覆写(仅升级到 avoid,modal 特征音内嵌豁免)
  if (consonance !== 'avoid' && isAvoidNote(pcFromChord, chordType, scaleNameForBar, isModalContext ?? false, effectiveFunc)) {
    consonance = 'avoid';
  }

  // scale 感知(给定 runScale 时)。局部音阶只能提供横向语境，不能把纵向 chord avoid
  // 升格成可停留的 color tone；弱拍短经过是否可用由带节奏/邻接信息的调用层决定。
  if (localScalePcs !== undefined && localScalePcs.size > 0) {
    if (localScalePcs.has(npc)) {
      if (tonalCharacter === 'modal' && consonance === 'tension') consonance = 'colortone';
    } else if (consonance === 'consonant' || consonance === 'colortone') {
      consonance = 'tension';
    }
  }

  // urgency
  let urgency: number;
  if (tendencyGravity !== null) urgency = tendencyGravity;
  else if (consonance === 'consonant') urgency = 0;
  else if (consonance === 'colortone') urgency = 0.15;
  else if (consonance === 'tension') urgency = Math.min(1, 0.5 + chordTensionLevel * 0.3 + (effectiveFunc === 'D' ? 0.2 : effectiveFunc === 'T' ? 0.1 : 0));
  else urgency = 1.0;
  if (tonalCharacter === 'modal' && urgency > 0) urgency = Math.min(1, urgency * 0.5);

  // 解决目标(优先级混合,去重,剔本音)
  const targets = new Set<number>();
  for (const pc of mergedLayerTargets) targets.add(pc);
  for (const iv of literalIntervals) targets.add(mod12(rpc + iv));
  for (const pc of nextAnchorPcs) targets.add(pc);
  targets.delete(npc);

  return { consonance, urgency, resolutionTargets: [...targets], isInChordContract, isInChordExtension, isInNextChordAnchor };
}
