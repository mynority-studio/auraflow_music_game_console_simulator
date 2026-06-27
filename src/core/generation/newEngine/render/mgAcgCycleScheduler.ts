// ============================================================
// newEngine · render · ACG cycle-cadence scheduler(MG full-parity 升级 · G4)
// ------------------------------------------------------------
// 忠实 port 自【当前】../melodygenerative generateImprovisorMelody.ts:
//   scheduleAcgCycleCadencePhrases / inferAcgCycleSpans / hasRepeatedHalves /
//   pickAcgCadenceExpansion / scoreAcgCadenceSource / spreadTokensAcrossAcgCycle / 等。
// ACG 旋律【不是】brick-by-brick lick chain —— 它把一条 cadence 式上行长句【铺满一个和声 cycle】,
// 让钢琴织体呼吸。ACG 风格【不走】scheduleBrickExpansions,走此 cycle scheduler。
// ★ Phase B-2(2026-06-28):ScheduledToken 现带 full brick 元数据 —— ACG stretched cycle 的 brick identity
//   (name/family/index)来自选中的 cadence expansion,brickStart/EndBeat 反映 stretched cycle(directive 3.3)。
//   其余逐函数对齐当前 MG。纯函数无 rng → 确定性。
// ============================================================

import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';
import type { ScheduledToken } from './mgTokenScheduler';
import type { ChordPart } from './mgChordPart';
import type { BrickMatch } from './mgRoadMapParser';

type BrickExpansion = { brickIndex: number; brick: BrickMatch; tokens: AbstractMelodyToken[] };

/** ACG 成曲旋律调度:每个和声 cycle 铺一条 cadence 长句(忠实 MG)。 */
export function scheduleAcgCycleCadencePhrases(expansions: BrickExpansion[], chordPart: ChordPart): ScheduledToken[] {
  const cycles = inferAcgCycleSpans(chordPart);
  const globalCadence = pickAcgCadenceExpansion(expansions, 0, chordPart.totalBeats);
  const out: ScheduledToken[] = [];
  for (const cycle of cycles) {
    const local = pickAcgCadenceExpansion(expansions, cycle.startBeat, cycle.endBeat);
    const source = local ?? globalCadence;
    const tokens = source?.tokens?.length ? source.tokens : fallbackAcgCycleCadenceTokens();
    const brickMeta = source ? { brickIndex: source.brickIndex, name: source.brick.name, family: source.brick.family } : {};
    out.push(...spreadTokensAcrossAcgCycle(tokens, cycle.startBeat, cycle.endBeat, brickMeta));
  }
  return out.sort((a, b) => a.startBeat - b.startBeat);
}

function inferAcgCycleSpans(chordPart: ChordPart): Array<{ startBeat: number; endBeat: number }> {
  const total = chordPart.totalBeats;
  if (total <= 0) return [];
  const half = total / 2;
  const cycleBeats = total >= 32 && hasRepeatedHalves(chordPart, half)
    ? half
    : total >= 32
      ? 32
      : Math.max(16, total);
  const cycles: Array<{ startBeat: number; endBeat: number }> = [];
  for (let start = 0; start < total - 0.001; start += cycleBeats) {
    cycles.push({ startBeat: start, endBeat: Math.min(total, start + cycleBeats) });
  }
  return cycles;
}

function hasRepeatedHalves(chordPart: ChordPart, halfBeat: number): boolean {
  if (!Number.isFinite(halfBeat) || halfBeat < 16) return false;
  const blocks = chordPart.blocks;
  const left = blocks.filter((block) => block.startBeat < halfBeat - 0.001);
  const right = blocks.filter((block) => block.startBeat >= halfBeat - 0.001);
  if (left.length === 0 || left.length !== right.length) return false;
  return left.every((a, index) => {
    const b = right[index];
    return Boolean(b)
      && Math.abs((a.startBeat + halfBeat) - b.startBeat) < 0.001
      && Math.abs(a.durationBeats - b.durationBeats) < 0.001
      && a.rootPc === b.rootPc
      && a.bassPc === b.bassPc
      && a.type === b.type;
  });
}

function pickAcgCadenceExpansion(expansions: BrickExpansion[], startBeat: number, endBeat: number): BrickExpansion | null {
  const candidates = expansions
    .filter((expansion) => expansion.tokens.length > 0)
    .filter((expansion) => {
      const brickStart = expansion.brick.startBeat;
      return brickStart >= startBeat - 0.001 && brickStart < endBeat - 0.001;
    })
    .map((expansion) => ({ expansion, score: scoreAcgCadenceSource(expansion.brick, expansion.tokens) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.expansion ?? null;
}

function scoreAcgCadenceSource(brick: BrickMatch, tokens: AbstractMelodyToken[]): number {
  const audible = tokens.filter(isPlayableToken);
  if (audible.length < 3) return 0;
  const longToneCount = audible.filter((token) => token.duration >= 1 || token.kind === 'G').length;
  const rests = tokens.filter((token) => token.kind === 'R').reduce((sum, token) => sum + token.duration, 0);
  const authored = tokenDurationTotal(tokens);
  const restRatio = authored > 0 ? rests / authored : 0;
  const densityPenalty = Math.max(0, audible.length - 10) * 1.2;
  let score = 1;
  if (brick.family === 'Cadence') score += 14;
  if (/Cadence/i.test(brick.name)) score += 6;
  if (longToneCount > 0) score += 3 + longToneCount;
  if (restRatio >= 0.18) score += 2;
  if (audible.length >= 4 && audible.length <= 9) score += 2;
  return score - densityPenalty;
}

// ★ Phase B-2(directive 3.3):ACG stretched cycle 的 brick 元数据 —— source brick identity(name/family/index)
//   来自选中的 cadence expansion;brickStartBeat/EndBeat 反映【stretched cycle】(非 brick 原始 span)。
function spreadTokensAcrossAcgCycle(
  tokens: AbstractMelodyToken[],
  cycleStart: number,
  cycleEnd: number,
  brick: { brickIndex?: number; name?: string; family?: string } = {},
): ScheduledToken[] {
  const sourceTotal = tokenDurationTotal(tokens);
  const cycleDuration = Math.max(0, cycleEnd - cycleStart);
  if (sourceTotal <= 0 || cycleDuration <= 0) return [];
  const usableDuration = Math.max(1, cycleDuration - 0.5);
  const stretch = usableDuration / sourceTotal;
  const durationScale = Math.max(1, Math.min(1.65, Math.pow(stretch, 0.32)));
  const out: ScheduledToken[] = [];
  let cursor = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const mappedStart = cycleStart + (cursor / sourceTotal) * usableDuration;
    const startBeat = isStructuralAcgToken(token, tokens, i)
      ? snapToAcgLandingBeat(mappedStart, cycleStart, cycleEnd)
      : mappedStart;

    if (token.duration === 0) {
      out.push({ token, startBeat });
      continue;
    }

    const shaped = shapeAcgCycleTokenDuration(token, durationScale);
    if (startBeat < cycleEnd - 0.01) out.push({ token: shaped, startBeat });
    cursor += token.duration;
  }
  // ★ Phase B-2:盖 full brick 元数据(含 closeOpenSlopeGroups 补的合成 SlopeExit);start/end = stretched cycle。
  return closeOpenSlopeGroups(out).map((st) => ({
    ...st,
    brickIndex: brick.brickIndex,
    brickStartBeat: cycleStart,
    brickEndBeat: cycleEnd,
    brickName: brick.name,
    brickFamily: brick.family,
  }));
}

function tokenDurationTotal(tokens: AbstractMelodyToken[]): number {
  return tokens.reduce((sum, token) => sum + Math.max(0, token.duration), 0);
}

function isPlayableToken(token: AbstractMelodyToken): boolean {
  return token.kind !== 'R' && token.kind !== 'SlopeEnter' && token.kind !== 'SlopeExit';
}

function isStructuralAcgToken(token: AbstractMelodyToken, tokens: AbstractMelodyToken[], index: number): boolean {
  if (!isPlayableToken(token)) return false;
  if (token.kind === 'G') return true;
  if (token.duration >= 1) return true;
  return tokens.slice(index + 1).every((next) => !isPlayableToken(next));
}

function shapeAcgCycleTokenDuration(token: AbstractMelodyToken, durationScale: number): AbstractMelodyToken {
  if (token.duration === 0) return token;
  if (token.kind === 'R') {
    return { ...token, duration: Math.max(0.5, Math.min(4, token.duration * durationScale)) } as AbstractMelodyToken;
  }
  const maxDuration = token.kind === 'G'
    ? 2.75
    : token.duration >= 1
      ? 1.75
      : 0.85;
  const duration = Math.max(0.25, Math.min(maxDuration, token.duration * durationScale));
  return { ...token, duration } as AbstractMelodyToken;
}

function snapToAcgLandingBeat(time: number, cycleStart: number, cycleEnd: number): number {
  const candidates: number[] = [];
  for (let t = cycleStart; t < cycleEnd - 0.001; t += 4) candidates.push(t);
  const midpoint = cycleStart + (cycleEnd - cycleStart) / 2;
  candidates.push(midpoint, Math.max(cycleStart, cycleEnd - 4));
  let best = time;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - time);
    if (distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return bestDistance <= 0.85 ? best : time;
}

function closeOpenSlopeGroups(entries: ScheduledToken[]): ScheduledToken[] {
  let depth = 0;
  for (const entry of entries) {
    if (entry.token.kind === 'SlopeEnter') depth++;
    else if (entry.token.kind === 'SlopeExit') depth = Math.max(0, depth - 1);
  }
  if (depth === 0) return entries;
  const last = entries[entries.length - 1];
  const lastBeat = last?.startBeat ?? 0;
  return [
    ...entries,
    ...Array.from({ length: depth }, () => ({ token: { kind: 'SlopeExit', duration: 0 } as AbstractMelodyToken, startBeat: lastBeat })),
  ];
}

function fallbackAcgCycleCadenceTokens(): AbstractMelodyToken[] {
  return [
    { kind: 'R', duration: 0.5 }, { kind: 'C', duration: 0.5 }, { kind: 'L', duration: 0.5 },
    { kind: 'C', duration: 0.5 }, { kind: 'R', duration: 0.5 }, { kind: 'L', duration: 0.5 },
    { kind: 'C', duration: 1 }, { kind: 'G', duration: 2 }, { kind: 'R', duration: 1 },
    { kind: 'C', duration: 0.5 }, { kind: 'R', duration: 0.5 },
  ];
}
