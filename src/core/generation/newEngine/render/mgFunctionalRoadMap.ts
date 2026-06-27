// ============================================================
// newEngine · render · MgFunctionalRoadMap
// ★ MG full-parity Phase B(2026-06-28):港自当前 MG FunctionalRoadMap.ts(554-brick catalog DP cover,
//   style-aware)。仅改 import 路径(catalog→melodyBrickCatalog·dict→melodyBrickDictionary·types→mgRoadMapParser)。
//   取代旧 mgRoadMapParser.parseRoadMap 成【生产真源】RoadMap。
// ============================================================
// FunctionalRoadMap.ts — production RoadMap parser backed by
// Impro-Visor's full My.dictionary catalog.
//
// This parser compiles the generated ImprovisorBrickCatalog into matchable
// brick patterns, including recursive `(brick Child Key Dur)` blocks, and
// runs a non-overlapping DP cover for functional brick selection.

import type { ChordPart, ChordBlock } from './mgChordPart';
import {
  IMPROVISOR_BRICKS,
  IMPROVISOR_BRICK_TYPES,
  type ImprovisorCatalogBlock,
  type ImprovisorCatalogBrick,
} from '../knowledge/melodyBrickCatalog';
import type { BrickFamily, BrickPattern, BrickQuality, BrickStep } from '../knowledge/melodyBrickDictionary';
import { chordTypeQuality } from '../knowledge/melodyBrickDictionary';
import type { BrickMatch, RoadMap, KeySegment } from './mgRoadMapParser';

const RAW_CHORDBLOCK_COST = 10.0;
const SONG_KEY_MATCH_BONUS = -0.2;
const UNSUPPORTED_LOCAL_CENTER_PENALTY = 0.45;
const IV_FAMILY_MATCH_COST = 0.05;
const CADENTIAL_COVERAGE_BONUS = -0.35;
const STRONG_CADENTIAL_COVERAGE_BONUS = -0.65;
const CADENTIAL_ARRIVAL_SPLIT_PENALTY = 1.15;
const MIXED_LOCAL_CENTER_SPAN_PENALTY = 4.5;
const MAX_RECURSION_DEPTH = 12;
const MAX_COMPILED_PATTERN_STEPS = 24;

const NOTE_PCS: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

interface CompileResult {
  pattern: BrickPattern;
  sourceType: string;
  sourceQualifier?: string;
}

interface CatalogCompileSummary {
  patterns: CompileResult[];
  skipped: string[];
}

interface ExpandedBrick {
  steps: BrickStep[];
  stepDurations: number[];
  arbitraryDurations: boolean;
}

interface TraceEntry {
  startIdx: number;
  pattern: BrickPattern;
  keyPc: number;
  cost: number;
}

interface RawChordFallback {
  family: BrickFamily;
  keyPc: number;
}

export interface ParseFunctionalRoadMapArgs {
  part: ChordPart;
  songKeyPc: number;
  style?: string;
}

export interface FunctionalCatalogStats {
  catalogEntries: number;
  uniqueNames: number;
  compiledPatterns: number;
  skippedPatterns: number;
}

const NAME_TO_BRICKS = groupByName(IMPROVISOR_BRICKS);
const REPRESENTATIVE_BY_NAME = buildRepresentativeMap(NAME_TO_BRICKS);
const COMPILED_CATALOG = compileCatalogPatterns();
const FUNCTIONAL_BRIDGE_PATTERNS = buildFunctionalBridgePatterns();
const FUNCTIONAL_PATTERNS = [...COMPILED_CATALOG.patterns, ...FUNCTIONAL_BRIDGE_PATTERNS];

export const IMPROVISOR_FUNCTIONAL_ROADMAP_STATS: FunctionalCatalogStats = {
  catalogEntries: IMPROVISOR_BRICKS.length,
  uniqueNames: NAME_TO_BRICKS.size,
  compiledPatterns: FUNCTIONAL_PATTERNS.length,
  skippedPatterns: COMPILED_CATALOG.skipped.length,
};

export const IMPROVISOR_FUNCTIONAL_SKIPPED_BRICKS = COMPILED_CATALOG.skipped;

export function improvisorFunctionalBrickPatterns(): readonly BrickPattern[] {
  return FUNCTIONAL_PATTERNS.map(entry => entry.pattern);
}

export function parseFunctionalRoadMap(args: ParseFunctionalRoadMapArgs): RoadMap {
  const { part, songKeyPc, style } = args;
  const blocks = part.blocks;
  const n = blocks.length;
  const allowJazzOnlyBricks = !style || style.toUpperCase() === 'JAZZ';
  if (n === 0) return { bricks: [], totalCost: 0, segments: [] };

  const dp = new Array<number>(n + 1).fill(Infinity);
  const trace: Array<TraceEntry | null> = new Array(n + 1).fill(null);
  dp[0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 0; j < i; j++) {
      const len = i - j;
      for (const entry of FUNCTIONAL_PATTERNS) {
        const pattern = entry.pattern;
        if (pattern.steps.length !== len) continue;
        for (let keyPc = 0; keyPc < 12; keyPc++) {
          const matchCost = matchPatternCost(blocks, j, pattern, keyPc);
          if (matchCost === null) continue;
          if (!contextualPatternAllowed(blocks, j, i, pattern, keyPc, songKeyPc, allowJazzOnlyBricks)) continue;
          const span = blocks.slice(j, i);
          const spanBeats = span.reduce((sum, block) => sum + block.durationBeats, 0);
          if (pattern.minTotalBeats !== undefined && spanBeats < pattern.minTotalBeats) continue;
          if (pattern.maxTotalBeats !== undefined && spanBeats > pattern.maxTotalBeats) continue;
          let cost = pattern.baseCost + matchCost;
          if (keyPc === songKeyPc) cost += SONG_KEY_MATCH_BONUS;
          if (
            keyPc !== songKeyPc
            && explicitLocalCenterPcForSpan(span, songKeyPc) === null
          ) {
            cost += UNSUPPORTED_LOCAL_CENTER_PENALTY;
          }
          if (len >= 2 && !pattern.arbitraryDurations) {
            const actual = span.map(block => block.durationBeats);
            const expected = pattern.stepDurations ?? new Array(len).fill(1);
            cost *= durationScalingMultiplier(actual, expected);
          }
          cost += localCenterContinuityPenalty(span, songKeyPc, pattern);
          cost += cadentialCoverageAdjustment(blocks, j, i, pattern, keyPc);
          if (dp[j] + cost < dp[i]) {
            dp[i] = dp[j] + cost;
            trace[i] = { startIdx: j, pattern, keyPc, cost };
          }
        }
      }
    }

    if (dp[i - 1] + RAW_CHORDBLOCK_COST < dp[i]) {
      const fallback = inferRawChordFallback(blocks, i - 1, songKeyPc);
      const rawPattern: BrickPattern = {
        name: 'Raw-ChordBlock',
        family: fallback.family,
        baseCost: RAW_CHORDBLOCK_COST,
        steps: [{ rootDegreePc: 0, qualities: ['any'] }],
      };
      dp[i] = dp[i - 1] + RAW_CHORDBLOCK_COST;
      trace[i] = {
        startIdx: i - 1,
        pattern: rawPattern,
        keyPc: fallback.keyPc,
        cost: RAW_CHORDBLOCK_COST,
      };
    }
  }

  const bricks: BrickMatch[] = [];
  let cursor = n;
  while (cursor > 0) {
    const t = trace[cursor];
    if (!t) break;
    const span = blocks.slice(t.startIdx, cursor);
    const explicitLocalCenterPc = explicitLocalCenterPcForSpan(span, songKeyPc);
    const functionalKeyPc = explicitLocalCenterPc ?? songKeyPc;
    bricks.unshift({
      name: t.pattern.name,
      family: t.pattern.family,
      startBeat: span[0].startBeat,
      durationBeats: span.reduce((sum, block) => sum + block.durationBeats, 0),
      chordIndices: span.map(block => block.index),
      keyPc: functionalKeyPc,
      cost: t.cost,
    });
    cursor = t.startIdx;
  }

  return {
    bricks,
    totalCost: dp[n] === Infinity ? RAW_CHORDBLOCK_COST * n : dp[n],
    segments: deriveKeySegments(bricks, part.totalBeats, songKeyPc),
  };
}

function compileCatalogPatterns(): CatalogCompileSummary {
  const out: CompileResult[] = [];
  const skipped: string[] = [];
  for (const brick of IMPROVISOR_BRICKS) {
    const expanded = expandCatalogBrick(brick, notePc(brick.key), []);
    if (!expanded || expanded.steps.length === 0) {
      skipped.push(`${brick.name}${brick.qualifier ?? ''}`);
      continue;
    }
    if (expanded.steps.length > MAX_COMPILED_PATTERN_STEPS) {
      skipped.push(`${brick.name}${brick.qualifier ?? ''}`);
      continue;
    }
    out.push({
      pattern: {
        name: brick.name,
        family: familyForCatalogBrick(brick),
        baseCost: normalizedCatalogCost(brick),
        steps: expanded.steps,
        stepDurations: expanded.stepDurations,
        arbitraryDurations: expanded.arbitraryDurations,
      },
      sourceType: brick.type,
      sourceQualifier: brick.qualifier,
    });
  }
  return { patterns: out, skipped };
}

function buildFunctionalBridgePatterns(): CompileResult[] {
  return [
    {
      pattern: {
        name: 'I-V-vi-IV',
        family: 'Turnaround',
        baseCost: 0.05,
        steps: [
          { rootDegreePc: 0, qualities: ['major'] },
          { rootDegreePc: 7, qualities: ['dominant', 'major', 'sus'] },
          { rootDegreePc: 9, qualities: ['minor'] },
          { rootDegreePc: 5, qualities: ['major'] },
        ],
        stepDurations: [1, 1, 1, 1],
      },
      sourceType: 'FunctionalBridge',
      sourceQualifier: 'pop-axis',
    },
    {
      pattern: {
        name: 'Pop-Canon-Loop-8',
        family: 'Turnaround',
        baseCost: 0.02,
        steps: [
          { rootDegreePc: 0, qualities: ['major'] },
          { rootDegreePc: 7, qualities: ['dominant', 'major', 'sus'] },
          { rootDegreePc: 9, qualities: ['minor'] },
          { rootDegreePc: 4, qualities: ['minor'] },
          { rootDegreePc: 5, qualities: ['major'] },
          { rootDegreePc: 0, qualities: ['major'] },
          { rootDegreePc: 5, qualities: ['major'] },
          { rootDegreePc: 7, qualities: ['dominant', 'major', 'sus'] },
        ],
        stepDurations: [1, 1, 1, 1, 1, 1, 1, 1],
      },
      sourceType: 'FunctionalBridge',
      sourceQualifier: 'pop-canon-loop',
    },
    {
      pattern: {
        name: 'Pop-Canon-Closed-8',
        family: 'Turnaround',
        baseCost: 0.02,
        steps: [
          { rootDegreePc: 0, qualities: ['major'] },
          { rootDegreePc: 7, qualities: ['dominant', 'major', 'sus'] },
          { rootDegreePc: 9, qualities: ['minor'] },
          { rootDegreePc: 4, qualities: ['minor'] },
          { rootDegreePc: 5, qualities: ['major'] },
          { rootDegreePc: 0, qualities: ['major'] },
          { rootDegreePc: 5, qualities: ['major'] },
          { rootDegreePc: 0, qualities: ['major'] },
        ],
        stepDurations: [1, 1, 1, 1, 1, 1, 1, 1],
      },
      sourceType: 'FunctionalBridge',
      sourceQualifier: 'pop-canon-closed',
    },
  ];
}

function contextualPatternAllowed(
  blocks: ChordBlock[],
  startIdx: number,
  endIdx: number,
  pattern: BrickPattern,
  keyPc: number,
  songKeyPc: number,
  allowJazzOnlyBricks: boolean,
): boolean {
  if (!allowJazzOnlyBricks && isJazzOnlyPattern(pattern)) return false;
  if (pattern.name === 'Pop-Canon-Loop-8') {
    const next = blocks[endIdx];
    return Boolean(next && next.rootPc === keyPc && ivChordTypeQuality(next.type) === 'major');
  }
  return true;
}

function isJazzOnlyPattern(pattern: BrickPattern): boolean {
  return /(Giant|Donna|Yardbird|Dominant-Cycle|Rhythm-Bridge|SPOT|Tension|Supertension|Side-Slips|Dizzy|Dogleg|Stablemates|Starlight|Bauble|Nowhere|Bird)/i
    .test(pattern.name);
}

function expandCatalogBrick(
  brick: ImprovisorCatalogBrick,
  instanceKeyPc: number,
  stack: string[],
): ExpandedBrick | null {
  const sourceKeyPc = notePc(brick.key);
  const transpose = mod12(instanceKeyPc - sourceKeyPc);
  const steps: BrickStep[] = [];
  const stepDurations: number[] = [];
  let arbitraryDurations = false;

  const sameNameDepth = stack.filter(name => name === brick.name).length;
  if (stack.length > MAX_RECURSION_DEPTH || sameNameDepth > 2) return null;
  const nextStack = [...stack, brick.name];

  for (const block of brick.blocks) {
    if (block.kind === 'chord') {
      const chord = parseCatalogChord(block.name);
      if (!chord) return null;
      steps.push({
        rootDegreePc: mod12(chord.rootPc + transpose - instanceKeyPc),
        qualities: [chord.quality],
        ...(chord.slashBassDegreePc !== undefined ? { slashBassDegreePc: chord.slashBassDegreePc } : {}),
      });
      const duration = parseDuration(block.duration);
      if (duration === null) {
        arbitraryDurations = true;
        stepDurations.push(1);
      } else {
        stepDurations.push(duration);
      }
      continue;
    }

    if (block.kind === 'brick') {
      const childKey = block.key ? notePc(block.key) : instanceKeyPc;
      const expanded = expandCatalogBrickReference(block.name, childKey, nextStack);
      if (!expanded) return null;
      steps.push(...expanded.steps.map(step => ({
        ...step,
        rootDegreePc: mod12(step.rootDegreePc + childKey - instanceKeyPc),
      })));
      const blockDuration = parseDuration(block.duration);
      const scaled = scaleChildDurations(expanded.stepDurations, blockDuration);
      stepDurations.push(...scaled.durations);
      arbitraryDurations ||= expanded.arbitraryDurations || scaled.arbitrary;
      continue;
    }

    return null;
  }

  return { steps, stepDurations, arbitraryDurations };
}

function expandCatalogBrickReference(
  name: string,
  childKeyPc: number,
  stack: string[],
): ExpandedBrick | null {
  if (!stack.includes(name)) {
    const variants = NAME_TO_BRICKS.get(name) ?? [];
    const expanded = variants
      .map(variant => expandCatalogBrick(variant, childKeyPc, stack))
      .filter((value): value is ExpandedBrick => Boolean(value));
    const merged = mergeCompatibleExpansions(expanded, pickRepresentativeBrick(name));
    if (merged) return merged;
  }

  const child = pickRepresentativeBrick(name);
  return child ? expandCatalogBrick(child, childKeyPc, stack) : null;
}

function mergeCompatibleExpansions(
  expansions: ExpandedBrick[],
  representative?: ImprovisorCatalogBrick,
): ExpandedBrick | null {
  if (expansions.length === 0) return null;
  const grouped = new Map<string, ExpandedBrick[]>();
  for (const expanded of expansions) {
    const key = expansionCompatibilityKey(expanded);
    const list = grouped.get(key) ?? [];
    list.push(expanded);
    grouped.set(key, list);
  }

  const groups = [...grouped.values()].sort((a, b) =>
    b.length - a.length
    || a[0].steps.length - b[0].steps.length
  );

  let chosen = groups[0];
  if (representative) {
    const repExpanded = expandCatalogBrick(representative, notePc(representative.key), [representative.name]);
    const repKey = repExpanded ? expansionCompatibilityKey(repExpanded) : null;
    if (repKey && grouped.has(repKey)) chosen = grouped.get(repKey)!;
  }

  const first = chosen[0];
  return {
    steps: first.steps.map((step, index) => ({
      rootDegreePc: step.rootDegreePc,
      qualities: unionQualities(chosen.flatMap(expanded => expanded.steps[index]?.qualities ?? [])),
      ...(step.slashBassDegreePc !== undefined ? { slashBassDegreePc: step.slashBassDegreePc } : {}),
    })),
    stepDurations: first.stepDurations,
    arbitraryDurations: chosen.some(expanded => expanded.arbitraryDurations),
  };
}

function expansionCompatibilityKey(expanded: ExpandedBrick): string {
  return [
    expanded.steps.map(step => step.rootDegreePc).join(','),
    expanded.steps.map(step => step.slashBassDegreePc ?? 'root').join(','),
    expanded.stepDurations.map(duration => duration.toFixed(4)).join(','),
    expanded.arbitraryDurations ? 'arb' : 'fixed',
  ].join('|');
}

function parseCatalogChord(symbol: string): { rootPc: number; quality: BrickQuality; slashBassDegreePc?: number } | null {
  if (!symbol || symbol === 'NC') return null;
  const [upperRaw, slashRaw] = symbol.replace(/_/g, '').split('/');
  const clean = upperRaw;
  const match = clean.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) return null;
  const rootPc = notePc(match[1]);
  let type = match[2] ?? '';
  let slashBassDegreePc: number | undefined;
  if (slashRaw) {
    const bass = slashRaw.match(/^([A-G](?:#|b)?)/);
    if (bass) slashBassDegreePc = mod12(notePc(bass[1]) - rootPc);
  }
  if (type === '') type = 'maj';
  else if (type === 'M7') type = 'maj7';
  else if (type.startsWith('M7')) type = `maj7${type.slice(2)}`;
  else if (type === 'mM7') type = 'mMaj7';
  else if (type === 'o') type = 'dim';
  else if (type === 'o7') type = 'dim7';
  else if (type === '+') type = 'aug';
  else if (type === '7+' || type === '+7') type = 'aug';
  else if (type === 'sus') type = 'sus4';
  return {
    rootPc,
    quality: ivChordTypeQuality(type),
    ...(slashBassDegreePc !== undefined ? { slashBassDegreePc } : {}),
  };
}

function groupByName(bricks: readonly ImprovisorCatalogBrick[]): Map<string, ImprovisorCatalogBrick[]> {
  const grouped = new Map<string, ImprovisorCatalogBrick[]>();
  for (const brick of bricks) {
    const list = grouped.get(brick.name) ?? [];
    list.push(brick);
    grouped.set(brick.name, list);
  }
  return grouped;
}

function buildRepresentativeMap(grouped: Map<string, ImprovisorCatalogBrick[]>): Map<string, ImprovisorCatalogBrick> {
  const out = new Map<string, ImprovisorCatalogBrick>();
  for (const [name, variants] of grouped.entries()) {
    const sorted = variants.slice().sort((a, b) => representativeScore(a) - representativeScore(b));
    out.set(name, sorted[0]);
  }
  return out;
}

function representativeScore(brick: ImprovisorCatalogBrick): number {
  const invisible = brick.type === 'Invisible' ? 1000 : 0;
  const recursive = brick.blocks.some(block => block.kind === 'brick') ? 10 : 0;
  const selfRecursive = brick.blocks.some(block => block.kind === 'brick' && block.name === brick.name) ? 100 : 0;
  const wildcard = brick.blocks.some(block => block.duration === '*') ? 2 : 0;
  return invisible + selfRecursive + recursive + wildcard + brick.blocks.length;
}

function pickRepresentativeBrick(name: string): ImprovisorCatalogBrick | undefined {
  return REPRESENTATIVE_BY_NAME.get(name);
}

function familyForCatalogBrick(brick: ImprovisorCatalogBrick): BrickFamily {
  const type = brick.type;
  const name = brick.name;
  if (/Blues/i.test(name)) return 'Blues';
  if (/Minor-On|GenMinor/i.test(name)) return 'Minor-On';
  if (/On-Off|Off-On/i.test(name) || type === 'On-Off' || type === 'Off-On' || type === 'On-Off+') return 'Turnaround';
  if (/Major-On|GenMajor|Opening|On-/.test(name) || type === 'On' || type === 'Opening') return 'Major-On';
  if (/Cadence|Ending/i.test(type) || /Cadence|Amen|Plagal/i.test(name)) return 'Cadence';
  if (/Approach|Overrun/i.test(type) || /Approach|Cycle|GenDom|SuperGenDom|Side-Slip|Side-Slips/i.test(name)) return 'GenDom';
  if (/Dropback|Pullback/i.test(type) || /Dropback|Pullback|Back/i.test(name)) return 'Dropback';
  if (/Turnaround/i.test(type) || /Turnaround|POT|SPOT|Raindrop/i.test(name)) return 'Turnaround';
  if (/CESH|Misc/i.test(type) || /Borrow|Chromatic|Side/i.test(name)) return 'Borrowed';
  if (/GenII/i.test(name)) return 'GenII';
  if (/GenVI/i.test(name)) return 'GenVI';
  return brick.mode === 'Minor' ? 'Minor-On' : 'Major-On';
}

function inferRawChordFallback(blocks: ChordBlock[], index: number, songKeyPc: number): RawChordFallback {
  const block = blocks[index];
  const prev = blocks[index - 1];
  const next = blocks[index + 1];
  const quality = ivChordTypeQuality(block.type);

  if (next && isAuthenticResolution(block, next)) {
    return { family: 'Cadence', keyPc: next.rootPc };
  }
  if (next && isPredominantToDominant(block, next)) {
    return { family: 'Launcher', keyPc: next.localKeyPc ?? next.rootPc };
  }
  if (prev && isPredominantToDominant(prev, block)) {
    return { family: 'Launcher', keyPc: block.localKeyPc ?? block.rootPc };
  }
  if (isDominantFunction(block)) {
    return { family: 'GenDom', keyPc: block.localKeyPc ?? block.rootPc };
  }
  if (isBorrowedOrChromaticFallback(blocks, index, songKeyPc)) {
    return { family: 'Borrowed', keyPc: songKeyPc };
  }
  if (quality === 'minor' || quality === 'halfDim') {
    return { family: 'Minor-On', keyPc: block.rootPc };
  }
  if (quality === 'major' || quality === 'sus') {
    return { family: 'Major-On', keyPc: block.rootPc };
  }
  return { family: 'Unknown', keyPc: block.rootPc };
}

function isPredominantToDominant(from: ChordBlock, to: ChordBlock): boolean {
  if (!isDominantFunction(to)) return false;
  const fromQuality = ivChordTypeQuality(from.type);
  const predominantQuality = fromQuality === 'minor' || fromQuality === 'halfDim';
  const predominantFunction = from.functionHint === 'S' || predominantQuality;
  return predominantFunction && mod12(from.rootPc - to.rootPc) === 7;
}

function isBorrowedOrChromaticFallback(blocks: ChordBlock[], index: number, songKeyPc: number): boolean {
  const block = blocks[index];
  if (block.borrowedFrom || block.borrowedSource) return true;
  if (block.forcedScale && !isDominantFunction(block)) return true;
  if (isChromaticDiminishedNeighbor(blocks, index)) return true;

  const degree = mod12(block.rootPc - songKeyPc);
  const quality = ivChordTypeQuality(block.type);
  if (/[b#]/.test(block.roman)) return true;
  if ((quality === 'major' || quality === 'dominant' || quality === 'sus') && (degree === 1 || degree === 6 || degree === 10)) {
    return true;
  }
  return false;
}

function isChromaticDiminishedNeighbor(blocks: ChordBlock[], index: number): boolean {
  const block = blocks[index];
  if (ivChordTypeQuality(block.type) !== 'diminished') return false;
  const prev = blocks[index - 1];
  const next = blocks[index + 1];
  const nearPrev = prev ? isSemitoneNeighbor(prev.rootPc, block.rootPc) : false;
  const nearNext = next ? isSemitoneNeighbor(block.rootPc, next.rootPc) : false;
  return nearPrev || nearNext;
}

function isSemitoneNeighbor(fromPc: number, toPc: number): boolean {
  const distance = mod12(toPc - fromPc);
  return distance === 1 || distance === 11;
}

function normalizedCatalogCost(brick: ImprovisorCatalogBrick): number {
  const rawCost = IMPROVISOR_BRICK_TYPES[brick.type as keyof typeof IMPROVISOR_BRICK_TYPES] ?? 100;
  let cost = rawCost / 100;
  if (brick.type === 'Invisible') cost = 20;
  if (brick.blocks.some(block => block.kind === 'brick')) cost += 0.04;
  if (brick.qualifier) cost += 0.01;
  return cost;
}

function matchPatternCost(
  blocks: ChordBlock[],
  startIdx: number,
  pattern: BrickPattern,
  keyPc: number,
): number | null {
  let familyPenalty = 0;
  for (let k = 0; k < pattern.steps.length; k++) {
    const step = pattern.steps[k];
    const block = blocks[startIdx + k];
    if (ivExactStepMatches(step, block, keyPc)) continue;
    const familyCost = ivFamilyStepMatchCost(step, block, keyPc);
    if (familyCost === null) return null;
    familyPenalty += familyCost;
  }
  return familyPenalty;
}

function cadentialCoverageAdjustment(
  blocks: ChordBlock[],
  startIdx: number,
  endIdx: number,
  pattern: BrickPattern,
  keyPc: number,
): number {
  let adjustment = 0;
  for (let k = startIdx + 1; k < endIdx; k++) {
    if (!isAuthenticResolution(blocks[k - 1], blocks[k])) continue;
    adjustment += k === endIdx - 1 ? STRONG_CADENTIAL_COVERAGE_BONUS : CADENTIAL_COVERAGE_BONUS;
  }
  for (let k = startIdx + 2; k < endIdx; k++) {
    if (isTwoFiveOne(blocks[k - 2], blocks[k - 1], blocks[k])) {
      adjustment += k === endIdx - 1 ? STRONG_CADENTIAL_COVERAGE_BONUS : CADENTIAL_COVERAGE_BONUS;
    }
  }
  if (startIdx > 0 && isAuthenticResolution(blocks[startIdx - 1], blocks[startIdx])) {
    adjustment += cadentialArrivalSplitPenalty(pattern, blocks[startIdx], keyPc);
  }
  return adjustment;
}

function cadentialArrivalSplitPenalty(pattern: BrickPattern, arrival: ChordBlock, keyPc: number): number {
  if (/^Pop-Canon-/.test(pattern.name)) return 0;
  const degree = mod12(arrival.rootPc - keyPc);
  const startsOnRestState = degree === 0
    || degree === 9
    || pattern.family === 'Major-On'
    || pattern.family === 'Minor-On'
    || pattern.family === 'Turnaround'
    || pattern.family === 'Dropback';
  if (!startsOnRestState) return CADENTIAL_ARRIVAL_SPLIT_PENALTY * 0.5;
  return CADENTIAL_ARRIVAL_SPLIT_PENALTY;
}

function isTwoFiveOne(predominant: ChordBlock, dominant: ChordBlock, target: ChordBlock): boolean {
  const targetQuality = ivChordTypeQuality(target.type);
  if (targetQuality !== 'major' && targetQuality !== 'minor') return false;
  const predominantQuality = ivChordTypeQuality(predominant.type);
  if (predominantQuality !== 'minor' && predominantQuality !== 'halfDim') return false;
  if (!canResolveAuthentically(dominant, target)) return false;
  return mod12(predominant.rootPc - target.rootPc) === 2
    && isAuthenticResolution(dominant, target);
}

function isAuthenticResolution(from: ChordBlock, to: ChordBlock): boolean {
  const rootMotion = mod12(from.rootPc - to.rootPc);
  if (!canResolveAuthentically(from, to)) return false;
  return rootMotion === 7 || rootMotion === 1 || from.localKeyPc === to.rootPc;
}

function canResolveAuthentically(from: ChordBlock, to: ChordBlock): boolean {
  const quality = ivChordTypeQuality(from.type);
  const dominantQuality = quality === 'dominant' || quality === 'sus';
  const rootMotion = mod12(from.rootPc - to.rootPc);
  if (dominantQuality) return rootMotion === 7 || rootMotion === 1 || from.localKeyPc === to.rootPc;
  return from.functionHint === 'D' && rootMotion === 7;
}

function isDominantFunction(block: ChordBlock): boolean {
  const quality = ivChordTypeQuality(block.type);
  return block.functionHint === 'D' || quality === 'dominant' || quality === 'sus';
}

function ivExactStepMatches(step: BrickStep, block: ChordBlock, keyRootPc: number): boolean {
  const expectedRootPc = (keyRootPc + step.rootDegreePc) % 12;
  if (block.rootPc !== expectedRootPc) return false;
  if (!slashBassMatches(step, block)) return false;
  if (isIvUnsupportedChordType(block.type)) return false;
  const q = ivChordTypeQuality(block.type);
  if (step.qualities.includes('any')) return true;
  if (step.qualities.includes(q)) return true;
  return step.qualities.includes('stableMinor') && q === 'minor';
}

function ivFamilyStepMatchCost(step: BrickStep, block: ChordBlock, keyRootPc: number): number | null {
  const expectedRootPc = (keyRootPc + step.rootDegreePc) % 12;
  if (block.rootPc !== expectedRootPc) return null;
  if (!slashBassMatches(step, block)) return null;
  if (isIvUnsupportedChordType(block.type)) return null;
  if (step.qualities.includes('any')) return 0;
  const actual = ivChordTypeQuality(block.type);
  let best: number | null = null;
  for (const expected of step.qualities) {
    const cost = ivQualityFamilyMatchCost(actual, expected);
    if (cost === null) continue;
    best = best === null ? cost : Math.min(best, cost);
  }
  return best;
}

function ivQualityFamilyMatchCost(actual: BrickQuality, expected: BrickQuality): number | null {
  if (actual === expected) return 0;
  if (expected === 'any' || actual === 'any') return 0;
  if (actual === 'halfDim' && (expected === 'minor' || expected === 'stableMinor')) return 0;
  if (actual === 'sus' && expected === 'dominant') return IV_FAMILY_MATCH_COST;
  if (actual === 'augmented' && expected === 'major') return IV_FAMILY_MATCH_COST;
  if (actual === 'minor' && expected === 'stableMinor') return IV_FAMILY_MATCH_COST;
  return null;
}

function slashBassMatches(step: BrickStep, block: ChordBlock): boolean {
  if (step.slashBassDegreePc === undefined) return true;
  return block.bassPc === mod12(block.rootPc + step.slashBassDegreePc);
}

function ivChordTypeQuality(chordType: string): BrickQuality {
  if (/sus/i.test(chordType)) return 'sus';
  return chordTypeQuality(chordType);
}

function isIvUnsupportedChordType(chordType: string): boolean {
  return /6\/9/i.test(chordType);
}

function unionQualities(values: BrickQuality[]): BrickQuality[] {
  return [...new Set(values)];
}

function explicitLocalCenterPcForSpan(
  span: ChordBlock[],
  songKeyPc: number,
): number | null {
  const centers = [...new Set(span
    .map(block => block.localKeyPc)
    .filter((pc): pc is number => pc !== undefined && pc !== songKeyPc))];
  if (centers.length !== 1) return null;
  const [center] = centers;
  return span.every(block => block.localKeyPc === center) ? center : null;
}

function localCenterContinuityPenalty(span: ChordBlock[], songKeyPc: number, pattern: BrickPattern): number {
  const centers = [...new Set(span
    .map(block => block.localKeyPc)
    .filter((pc): pc is number => pc !== undefined && pc !== songKeyPc))];
  if (centers.length === 0) return 0;
  if (centers.length > 1) return MIXED_LOCAL_CENTER_SPAN_PENALTY;
  const [center] = centers;
  return span.every(block => block.localKeyPc === center) ? 0 : MIXED_LOCAL_CENTER_SPAN_PENALTY;
}

function deriveKeySegments(bricks: BrickMatch[], totalBeats: number, songKeyPc: number): KeySegment[] {
  if (bricks.length === 0) {
    return totalBeats > 0
      ? [{ startBeat: 0, endBeat: totalBeats, keyRootPc: songKeyPc, mode: 'Major' }]
      : [];
  }
  return [{ startBeat: 0, endBeat: totalBeats, keyRootPc: songKeyPc, mode: 'Major' }];
}

function scaleChildDurations(durations: number[], targetDuration: number | null): { durations: number[]; arbitrary: boolean } {
  if (durations.length === 0) return { durations: [], arbitrary: false };
  if (targetDuration === null) return { durations: durations.map(() => 1), arbitrary: true };
  const total = durations.reduce((sum, duration) => sum + Math.max(0, duration), 0);
  if (total <= 0) return { durations: durations.map(() => targetDuration / durations.length), arbitrary: false };
  const scale = targetDuration / total;
  return { durations: durations.map(duration => Math.max(0.01, duration * scale)), arbitrary: false };
}

function parseDuration(raw?: string): number | null {
  if (!raw || raw === '*') return null;
  const fraction = raw.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : numerator / denominator;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function notePc(note: string): number {
  const pc = NOTE_PCS[note];
  if (pc === undefined) return 0;
  return pc;
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function durationScalingMultiplier(actual: number[], expected: number[]): number {
  if (actual.length !== expected.length) return 8;
  const ratios: number[] = [];
  for (let i = 0; i < actual.length; i++) {
    if (expected[i] <= 0) return 8;
    ratios.push(actual[i] / expected[i]);
  }
  const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  if (mean <= 0) return 8;
  const maxDev = ratios.reduce((max, ratio) => Math.max(max, Math.abs(ratio - mean) / mean), 0);
  if (maxDev <= 0.10) return 1;
  return Math.min(8, 1 + (maxDev - 0.10) * 5);
}
