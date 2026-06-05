// ============================================================
// newEngine · knowledge · MelodyLofiGrammarTags(MG strict 移植:slope 语料)
// Provenance: ../melodygenerative/src/lib/improvisor/LofiGrammarTags.ts 忠实港(cp + 改 import)。
// slope rule 的 LOFI 特征提取 + 权重乘子。KB 合规:纯函数。
// ============================================================

// LofiGrammarTags.ts — style-law labels for imported Impro-Visor slopes.
//
// The imported slope corpus stays immutable. This module overlays LOFI
// preferences: sparse space, small crawls, color holds, soft cadences,
// and restrained chromatic neighbors.

import type { FlatToken, ImprovisorSlopeRule, SlopeNote, SlopeNoteType } from './melodySlopeCorpus';

export type LofiGrammarTag =
  | 'lofi_star_crawl'
  | 'lofi_crawl_hold'
  | 'lofi_hold_answer'
  | 'lofi_color_suspension'
  | 'lofi_rest_space'
  | 'lofi_short_crawl'
  | 'lofi_color_hold'
  | 'lofi_soft_cadence'
  | 'lofi_parallel_answer'
  | 'lofi_chromatic_neighbor'
  | 'lofi_vamp_friendly'
  | 'lofi_avoid_busy'
  | 'lofi_avoid_large_leap';

export interface LofiSlopeFeatures {
  totalDuration: number;
  audibleDuration: number;
  tokenCount: number;
  audibleTokenCount: number;
  restDuration: number;
  restRatio: number;
  shortestDuration: number;
  shortAudibleTokenCount: number;
  maxConsecutiveShortAudibleCount: number;
  longToneCount: number;
  colorTokenCount: number;
  approachTokenCount: number;
  chromaticTokenCount: number;
  maxAbsSlope: number;
  smallCrawlGroupCount: number;
  repeatedShapeCount: number;
}

interface FlatNoteView {
  type: SlopeNoteType;
  d: number;
  degree?: string;
}

const COLOR_DEGREES = new Set(['2', '9', '#9', '4', '11', '#11', '6', '13', '7', 'b7']);

export function extractLofiSlopeFeatures(rule: ImprovisorSlopeRule): LofiSlopeFeatures {
  const notes = flattenNotes(rule);
  let totalDuration = 0;
  let restDuration = 0;
  let longToneCount = 0;
  let colorTokenCount = 0;
  let approachTokenCount = 0;
  let chromaticTokenCount = 0;
  let audibleTokenCount = 0;
  let shortAudibleTokenCount = 0;
  let consecutiveShortAudibleCount = 0;
  let maxConsecutiveShortAudibleCount = 0;
  let shortestDuration = Number.POSITIVE_INFINITY;

  for (const note of notes) {
    totalDuration += note.d;
    shortestDuration = Math.min(shortestDuration, note.d);
    const audible = note.type !== 'R' && note.type !== 'N';
    if (!audible) {
      restDuration += note.d;
      consecutiveShortAudibleCount = 0;
    } else {
      audibleTokenCount++;
      if (note.d <= 0.25) {
        shortAudibleTokenCount++;
        consecutiveShortAudibleCount++;
        maxConsecutiveShortAudibleCount = Math.max(maxConsecutiveShortAudibleCount, consecutiveShortAudibleCount);
      } else {
        consecutiveShortAudibleCount = 0;
      }
    }
    if (note.d >= 1.0 && audible) longToneCount++;
    if (note.type === 'L' || note.type === 'H' || (note.type === 'X' && note.degree && COLOR_DEGREES.has(note.degree))) {
      colorTokenCount++;
    }
    if (note.type === 'A') approachTokenCount++;
    if (note.type === 'X' || (note.degree && /[#b]/.test(note.degree))) chromaticTokenCount++;
  }

  const slopeShapes = rule.bodyKind === 'slope'
    ? rule.slopes.map(group => `${group.dirMin}:${group.dirMax}:${group.notes.map(n => n.type).join('')}`)
    : [];
  const repeatedShapeCount = slopeShapes.length - new Set(slopeShapes).size;
  const maxAbsSlope = rule.bodyKind === 'slope'
    ? Math.max(0, ...rule.slopes.map(group => Math.max(Math.abs(group.dirMin), Math.abs(group.dirMax))))
    : 0;
  const smallCrawlGroupCount = rule.bodyKind === 'slope'
    ? rule.slopes.filter(group => {
        const range = Math.max(Math.abs(group.dirMin), Math.abs(group.dirMax));
        const audible = group.notes.filter(note => note.type !== 'R' && note.type !== 'N');
        return range <= 3 && audible.length >= 2 && audible.length <= 5;
      }).length
    : 0;

  return {
    totalDuration,
    audibleDuration: totalDuration - restDuration,
    tokenCount: notes.length,
    audibleTokenCount,
    restDuration,
    restRatio: totalDuration > 0 ? restDuration / totalDuration : 0,
    shortestDuration: Number.isFinite(shortestDuration) ? shortestDuration : 0,
    shortAudibleTokenCount,
    maxConsecutiveShortAudibleCount,
    longToneCount,
    colorTokenCount,
    approachTokenCount,
    chromaticTokenCount,
    maxAbsSlope,
    smallCrawlGroupCount,
    repeatedShapeCount,
  };
}

export function tagImprovisorSlopeRule(rule: ImprovisorSlopeRule): LofiGrammarTag[] {
  const f = extractLofiSlopeFeatures(rule);
  const tags = new Set<LofiGrammarTag>();

  if (isLofiStarCrawlRule(rule)) tags.add('lofi_star_crawl');
  if (hasCrawlHoldShape(rule)) tags.add('lofi_crawl_hold');
  if (hasHoldAnswerShape(rule)) tags.add('lofi_hold_answer');
  if (hasColorSuspensionShape(rule)) tags.add('lofi_color_suspension');
  if (f.restRatio >= 0.16 || f.restDuration >= 2) tags.add('lofi_rest_space');
  if (f.smallCrawlGroupCount >= 2) tags.add('lofi_short_crawl');
  if (f.colorTokenCount >= 2 && f.longToneCount >= 1) tags.add('lofi_color_hold');
  if (/Cadence/i.test(rule.brickType) && (f.longToneCount >= 1 || f.restRatio >= 0.12)) tags.add('lofi_soft_cadence');
  if (f.repeatedShapeCount >= 1 || hasSoftParallelShape(rule)) tags.add('lofi_parallel_answer');
  if (f.chromaticTokenCount >= 1 && f.chromaticTokenCount <= Math.max(2, Math.ceil(f.tokenCount * 0.25))) {
    tags.add('lofi_chromatic_neighbor');
  }
  if (isVampFriendlyBrick(rule.brickType) && f.totalDuration <= 16 && f.audibleDuration >= 2) {
    tags.add('lofi_vamp_friendly');
  }
  if (isTooBusyForLofi(f)) tags.add('lofi_avoid_busy');
  if (f.maxAbsSlope >= 10 && f.restRatio < 0.2) tags.add('lofi_avoid_large_leap');

  return [...tags];
}

export function lofiSlopeWeightMultiplier(rule: ImprovisorSlopeRule): number {
  const tags = tagImprovisorSlopeRule(rule);
  let multiplier = 1;
  for (const tag of tags) {
    switch (tag) {
      case 'lofi_star_crawl': multiplier *= 1.18; break;
      case 'lofi_crawl_hold': multiplier *= 1.22; break;
      case 'lofi_hold_answer': multiplier *= 1.18; break;
      case 'lofi_color_suspension': multiplier *= 1.16; break;
      case 'lofi_rest_space': multiplier *= 1.16; break;
      case 'lofi_short_crawl': multiplier *= 1.18; break;
      case 'lofi_color_hold': multiplier *= 1.20; break;
      case 'lofi_soft_cadence': multiplier *= 1.12; break;
      case 'lofi_parallel_answer': multiplier *= 1.14; break;
      case 'lofi_chromatic_neighbor': multiplier *= 1.04; break;
      case 'lofi_vamp_friendly': multiplier *= 1.10; break;
      case 'lofi_avoid_busy': multiplier *= 0.28; break;
      case 'lofi_avoid_large_leap': multiplier *= 0.35; break;
    }
  }
  return Math.max(0.08, Math.min(1.75, multiplier));
}

export function summarizeLofiSlopeTags(rules: ImprovisorSlopeRule[]): {
  total: number;
  perTag: Record<LofiGrammarTag, number>;
  topRules: Array<{ id: string; source: string; brickType: string; multiplier: number; tags: LofiGrammarTag[]; rawLine: string }>;
} {
  const perTag = emptyTagCounts();
  const topRules = rules.map(rule => {
    const tags = tagImprovisorSlopeRule(rule);
    for (const tag of tags) perTag[tag]++;
    return {
      id: rule.id,
      source: rule.source,
      brickType: rule.brickType,
      multiplier: lofiSlopeWeightMultiplier(rule),
      tags,
      rawLine: rule.rawLine,
    };
  }).sort((a, b) => b.multiplier - a.multiplier || b.tags.length - a.tags.length).slice(0, 16);
  return { total: rules.length, perTag, topRules };
}

function flattenNotes(rule: ImprovisorSlopeRule): FlatNoteView[] {
  if (rule.bodyKind === 'slope') {
    return rule.slopes.flatMap(group => group.notes.map(slopeNoteToView));
  }
  return rule.flatTokens.map(flatTokenToView);
}

function slopeNoteToView(note: SlopeNote): FlatNoteView {
  return { type: note.type, d: note.d };
}

function flatTokenToView(token: FlatToken): FlatNoteView {
  if (token.kind === 'abstract') {
    return { type: token.type, d: token.d };
  }
  return { type: 'X', d: token.d, degree: token.degree };
}

function isLofiStarCrawlRule(rule: ImprovisorSlopeRule): boolean {
  return rule.brickType === 'Surprise-Major-Cadence'
    && rule.bodyKind === 'slope'
    && rule.rawLine.includes('(slope 1 3 C8 L8 C8 L2)')
    && rule.rawLine.includes('(slope -9 -1 C4+8 C8 C8 C8)');
}

function hasSoftParallelShape(rule: ImprovisorSlopeRule): boolean {
  if (rule.bodyKind !== 'slope') return false;
  let similarPairs = 0;
  for (let i = 1; i < rule.slopes.length; i++) {
    const prev = rule.slopes[i - 1];
    const curr = rule.slopes[i];
    const prevWidth = prev.dirMax - prev.dirMin;
    const currWidth = curr.dirMax - curr.dirMin;
    const prevAudible = prev.notes.filter(n => n.type !== 'R' && n.type !== 'N').length;
    const currAudible = curr.notes.filter(n => n.type !== 'R' && n.type !== 'N').length;
    if (Math.abs(prevWidth - currWidth) <= 1 && Math.abs(prevAudible - currAudible) <= 1 && currAudible >= 2) {
      similarPairs++;
    }
  }
  return similarPairs >= 2;
}

function hasCrawlHoldShape(rule: ImprovisorSlopeRule): boolean {
  if (rule.bodyKind !== 'slope') return false;
  for (const group of rule.slopes) {
    const audible = group.notes.filter(n => n.type !== 'R' && n.type !== 'N');
    if (audible.length < 2 || audible.length > 6) continue;
    const range = Math.max(Math.abs(group.dirMin), Math.abs(group.dirMax));
    const hasContract = audible.some(n => n.type === 'C' || n.type === 'G');
    const hasColor = audible.some(n => n.type === 'L' || n.type === 'H');
    const hasLongLanding = audible.some(n => n.d >= 1.0);
    const hasEighthCrawl = audible.filter(n => n.d <= 0.5).length >= 2;
    if (group.dirMin >= 1 && group.dirMax <= 5 && range <= 5 && hasContract && hasColor && hasEighthCrawl && hasLongLanding) {
      return true;
    }
  }

  for (let i = 0; i < rule.slopes.length - 1; i++) {
    const crawl = rule.slopes[i];
    const hold = rule.slopes[i + 1];
    const crawlAudible = crawl.notes.filter(n => n.type !== 'R' && n.type !== 'N');
    const holdAudible = hold.notes.filter(n => n.type !== 'R' && n.type !== 'N');
    const crawlHasColor = crawlAudible.some(n => n.type === 'L' || n.type === 'H');
    const crawlHasContract = crawlAudible.some(n => n.type === 'C' || n.type === 'G');
    const nextHasLongTone = holdAudible.some(n => n.d >= 1.0 && (n.type === 'C' || n.type === 'L' || n.type === 'H' || n.type === 'G'));
    if (crawl.dirMin >= 1 && crawl.dirMax <= 5 && crawlAudible.length >= 2 && crawlAudible.length <= 5 && crawlHasColor && crawlHasContract && nextHasLongTone) {
      return true;
    }
  }

  return false;
}

function hasHoldAnswerShape(rule: ImprovisorSlopeRule): boolean {
  if (rule.bodyKind !== 'slope') return false;
  for (let i = 0; i < rule.slopes.length - 1; i++) {
    const hold = rule.slopes[i];
    const answer = rule.slopes[i + 1];
    const holdHasLongTone = hold.notes.some(n => n.d >= 1.0 && n.type !== 'R' && n.type !== 'N');
    if (!holdHasLongTone) continue;
    const answerAudible = answer.notes.filter(n => n.type !== 'R' && n.type !== 'N');
    const answerRange = Math.max(Math.abs(answer.dirMin), Math.abs(answer.dirMax));
    const answerHasContractOrColor = answerAudible.some(n => n.type === 'C' || n.type === 'G' || n.type === 'L' || n.type === 'H');
    if (answerAudible.length >= 1 && answerAudible.length <= 5 && answerRange <= 5 && answerHasContractOrColor) {
      return true;
    }
  }
  return false;
}

function hasColorSuspensionShape(rule: ImprovisorSlopeRule): boolean {
  const notes = flattenNotes(rule);
  const longColors = notes.filter(n => n.d >= 1.0 && (n.type === 'L' || n.type === 'H')).length;
  if (longColors >= 1) return true;
  return notes.some(n => n.d >= 1.5 && n.type !== 'R' && n.type !== 'N');
}

function isVampFriendlyBrick(brickType: string): boolean {
  return /Cadence|Turnaround|Launcher|Dropback|Q-fragment|POT/i.test(brickType);
}

function isTooBusyForLofi(features: LofiSlopeFeatures): boolean {
  const density = features.totalDuration > 0 ? features.tokenCount / features.totalDuration : 0;
  const manyShortNotes = features.shortestDuration > 0 && features.shortestDuration < 0.25;
  return features.restRatio < 0.08
    && features.longToneCount === 0
    && (density > 2.6 || manyShortNotes || features.tokenCount >= 28);
}

function emptyTagCounts(): Record<LofiGrammarTag, number> {
  return {
    lofi_star_crawl: 0,
    lofi_crawl_hold: 0,
    lofi_hold_answer: 0,
    lofi_color_suspension: 0,
    lofi_rest_space: 0,
    lofi_short_crawl: 0,
    lofi_color_hold: 0,
    lofi_soft_cadence: 0,
    lofi_parallel_answer: 0,
    lofi_chromatic_neighbor: 0,
    lofi_vamp_friendly: 0,
    lofi_avoid_busy: 0,
    lofi_avoid_large_leap: 0,
  };
}
