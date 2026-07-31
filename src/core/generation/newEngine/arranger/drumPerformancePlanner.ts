// ============================================================
// newEngine · arranger · DrumPerformancePlanner
// ------------------------------------------------------------
// Arranger 拥有鼓手总谱:鼓不回头看 lead/comp,而是与 bass/comp/lead 一样消费同一份
// GrooveContract + section structure。这里把宏观 groove 翻译为每段鼓手演奏合同。
// ============================================================

import type { GrooveContract } from '../knowledge/grooveContracts';
import { drumFeelProfileIdForContract } from '../knowledge/drumPerformanceKnowledge';
import type {
  DrumCymbalPolicy,
  DrumEntryMode,
  DrumFillPolicy,
  DrumForegroundGuard,
  DrumHatPolicy,
  DrumKickPolicy,
  DrumPatternFamily,
  DrumPerformanceContract,
  DrumPerformanceRole,
  DrumSnarePolicy,
  DrumTimingProfile,
  DrumTomPolicy,
  DrumVelocityProfile,
  GrooveScorePlan,
  OpeningDrumEntry,
  Section,
  SectionEntry,
  SectionId,
} from './ArrangementPlan';
import { timingSafetyForContract } from './performanceContractPlanner';

type Level = 0 | 1 | 2 | 3;

const clampLevel = (v: number): Level => Math.max(0, Math.min(3, Math.round(v))) as Level;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const DRUM_PATTERN_FAMILIES: ReadonlySet<string> = new Set([
  'citypop-disco-boogie', 'citypop-syncopated-boogie', 'pop-backbeat', 'jpop-driving-8ths', 'ballad-halftime',
  'tr808-rnb-pocket', 'tr808-dilla-pocket', 'tr808-trap-soul-halftime', 'tr808-lofi-boombap', 'tr808-lofi-dusty-break', 'tr808-lofi-minimal', 'tr808-lofi-soul-halftime',
  'rnb-neo-soul-pocket', 'rnb-dilla-pocket', 'rnb-gospel-triplet', 'rnb-neo-soul', 'rnb-dilla', 'rnb-gospel-shuffle',
  'trap-soul-halftime', 'lofi-boombap', 'lofi-dusty-break', 'lofi-minimal', 'smooth-jazz-backbeat',
  'jazz-swing-ride', 'jazz-bebop-comping', 'jazz-brush-ballad', 'jazz-ballad-light', 'jazz-bossa',
]);

function validDrumFamily(family: string | undefined): DrumPatternFamily | undefined {
  return family && DRUM_PATTERN_FAMILIES.has(family) ? family as DrumPatternFamily : undefined;
}

function isBalladFamily(family: DrumPatternFamily): boolean {
  return family === 'ballad-halftime';
}

function isPopBalladContract(contract: Pick<GrooveContract, 'id'>): boolean {
  return contract.id === 'pop_ballad_halftime';
}

function contractFamilyForRole(contract: GrooveContract, role: DrumPerformanceRole): DrumPatternFamily | undefined {
  const drum = contract.drum;
  if (!drum) return undefined;
  if (role === 'lift') return validDrumFamily(drum.liftFamily) ?? validDrumFamily(drum.timekeeperFamily);
  if (role === 'pickup') return validDrumFamily(drum.pickupFamily) ?? validDrumFamily(drum.liftFamily) ?? validDrumFamily(drum.timekeeperFamily);
  if (role === 'breakdown') return validDrumFamily(drum.breakdownFamily) ?? validDrumFamily(drum.timekeeperFamily);
  return validDrumFamily(drum.timekeeperFamily);
}

function baseFamily(style: string, contract: GrooveContract, section: Section, role: DrumPerformanceRole): DrumPatternFamily {
  const explicit = contractFamilyForRole(contract, role);
  if (explicit) return explicit;
  const s = style.toLowerCase();
  const id = contract.id;
  if (s === 'jazz') {
    if (id.includes('smooth')) return 'smooth-jazz-backbeat';
    if (id.includes('bossa')) return 'jazz-bossa';
    if (id.includes('ballad')) return 'jazz-brush-ballad';
    return section.functionTag === 'solo' ? 'jazz-bebop-comping' : 'jazz-swing-ride';
  }
  if (s === 'rnb') {
    if (id.includes('gospel')) return 'rnb-gospel-triplet';
    if (id.includes('dilla')) return 'rnb-dilla-pocket';
    if (id.includes('trap')) return 'trap-soul-halftime';
    if (id.includes('motown')) return 'pop-backbeat';
    return 'rnb-neo-soul-pocket';
  }
  if (s === 'lofi') {
    if (id.includes('late')) return section.functionTag === 'loop' ? 'lofi-dusty-break' : 'lofi-minimal';
    if (id.includes('halftime')) return section.functionTag === 'loop' ? 'lofi-boombap' : 'lofi-minimal';
    if (id.includes('lazy') || id.includes('dusty')) return section.functionTag === 'loop' ? 'lofi-boombap' : 'lofi-dusty-break';
    return 'lofi-boombap';
  }
  if (id.includes('citypop')) {
    return section.functionTag === 'hook' || section.functionTag === 'build'
      ? 'citypop-disco-boogie'
      : 'citypop-syncopated-boogie';
  }
  if (id.includes('ballad') || contract.density === 'sparse') return 'ballad-halftime';
  if (id.includes('jpop') || contract.density === 'active') return 'jpop-driving-8ths';
  return 'pop-backbeat';
}

function roleForSection(section: Section): DrumPerformanceRole {
  const tag = section.functionTag;
  if (tag === 'setup' || tag === 'breakdown' || tag === 'outro' || tag === 'tag') return 'breakdown';
  if (tag === 'hook' || tag === 'solo') return 'lift';
  if (tag === 'build') return 'pickup';
  return 'timekeeper';
}

function entryForRole(role: DrumPerformanceRole, family: DrumPatternFamily, entry: SectionEntry | undefined): DrumEntryMode {
  if (role === 'silent') return 'none';
  if (isBalladFamily(family)) {
    if (role === 'breakdown') return 'hat-only';
    if (role === 'pickup' || role === 'lift' || entry === 'lead-in') return 'kick-hat';
  }
  if (role === 'breakdown') {
    if (family.startsWith('jazz')) return 'ride-only';
    return family === 'ballad-halftime' || family === 'lofi-minimal' || family === 'tr808-lofi-minimal' || family === 'tr808-trap-soul-halftime' ? 'kick-hat' : 'hat-only';
  }
  if (entry === 'lead-in') return 'full';
  if (role === 'pickup') return 'kick-hat';
  return 'full';
}

function openingEntryMode(entry: OpeningDrumEntry, family: DrumPatternFamily): DrumEntryMode {
  if (entry === 'none') return 'none';
  if (entry === 'kickOnly') return 'kick-only';
  if (entry === 'rideOnly') return 'ride-only';
  if (isBalladFamily(family) && (entry === 'brushLoop' || entry === 'halftimePocket' || entry === 'tomPickup')) return 'kick-hat';
  if (entry === 'fourOnFloorRamp') return 'kick-hat';
  if (entry === 'tomPickup') return 'full';
  if (entry === 'brushLoop' || entry === 'halftimePocket') return 'full';
  return 'hat-only';
}

function fillForBoundary(section: Section, next: Section | undefined, energy: number, nextEnergy: number): DrumFillPolicy {
  if (!next) return 'none';
  if (section.functionTag === 'setup' || section.functionTag === 'breakdown' || section.functionTag === 'tag') return 'none';
  const lift = nextEnergy - energy;
  if (next.functionTag === 'hook' && lift > 0.12) return 'big';
  if (next.functionTag === 'solo' || next.functionTag === 'headOut') return 'turnaround';
  if (lift > 0.08 || section.functionTag === 'build') return 'turnaround';
  if (section.repeatGroup && next.repeatGroup === section.repeatGroup) return 'none';
  return 'light';
}

function fillFromGrooveScore(section: Section, score: GrooveScorePlan): DrumFillPolicy {
  const candidates = score.boundaries.filter((candidate) => !candidate.opening && candidate.fromSectionId === section.id);
  const boundary = candidates.find((candidate) => candidate.toSectionId !== section.id)
    ?? candidates.at(-1);
  if (!boundary) return 'none';
  if (boundary.intensity >= 3) return 'big';
  if (boundary.intensity === 2) return 'turnaround';
  return 'light';
}

function hatPolicyForFamily(family: DrumPatternFamily): DrumHatPolicy {
  if (family.startsWith('jazz')) return family === 'jazz-bossa' ? 'eighths' : 'ride';
  if (family === 'smooth-jazz-backbeat') return 'shaker16';
  if (family === 'citypop-disco-boogie' || family === 'citypop-syncopated-boogie') return 'sixteenths';
  if (family === 'tr808-lofi-boombap' || family === 'tr808-lofi-minimal' || family === 'tr808-lofi-soul-halftime') return 'eighths';
  if (family.startsWith('tr808-')) return 'sixteenths';
  if (family === 'rnb-dilla' || family === 'rnb-dilla-pocket' || family === 'rnb-neo-soul' || family === 'rnb-neo-soul-pocket' || family === 'rnb-gospel-shuffle' || family === 'rnb-gospel-triplet') return 'shaker16';
  if (family === 'lofi-dusty-break') return 'shaker16';
  if (family === 'lofi-boombap' || family === 'lofi-minimal') return 'eighths';
  return family === 'jpop-driving-8ths' ? 'sixteenths' : 'eighths';
}

function kickPolicyForFamily(family: DrumPatternFamily): DrumKickPolicy {
  if (family === 'ballad-halftime' || family === 'trap-soul-halftime' || family === 'tr808-trap-soul-halftime' || family === 'lofi-minimal' || family === 'tr808-lofi-minimal' || family === 'tr808-lofi-soul-halftime') return 'halftime';
  if (family === 'citypop-disco-boogie') return 'four-on-floor';
  if (family === 'citypop-syncopated-boogie') return 'syncopated';
  if (family === 'jpop-driving-8ths') return 'syncopated';
  if (family === 'smooth-jazz-backbeat') return 'syncopated';
  if (family.startsWith('jazz')) return 'anchor-only';
  return 'syncopated';
}

function snarePolicyForFamily(family: DrumPatternFamily): DrumSnarePolicy {
  if (family.startsWith('jazz')) return 'jazz-comping';
  if (isBalladFamily(family)) return 'rim';
  if (family === 'smooth-jazz-backbeat') return 'ghost-before-backbeat';
  if (family === 'pop-backbeat' || family === 'jpop-driving-8ths' || family === 'citypop-syncopated-boogie') return 'ghost-before-backbeat';
  if (family === 'lofi-minimal' || family === 'lofi-boombap' || family === 'lofi-dusty-break') return 'rim';
  if (family === 'tr808-lofi-boombap' || family === 'tr808-lofi-dusty-break' || family === 'tr808-lofi-minimal' || family === 'tr808-lofi-soul-halftime') return 'rim';
  if (family.startsWith('tr808-')) return 'ghost-before-backbeat';
  if (family === 'rnb-dilla' || family === 'rnb-dilla-pocket' || family === 'rnb-neo-soul' || family === 'rnb-neo-soul-pocket') return 'ghost-before-backbeat';
  return 'backbeat';
}

function timingProfileForContract(contract: GrooveContract, family: DrumPatternFamily): DrumTimingProfile {
  if (family.startsWith('jazz')) return 'swing-ride';
  if (isBalladFamily(family)) return 'behind-snare';
  if (family === 'smooth-jazz-backbeat') return 'behind-snare';
  if (family === 'pop-backbeat' || family === 'jpop-driving-8ths') return 'behind-snare';
  if (contract.id === 'lofi_soul_boombap' || contract.id === 'lofi_ambient_study') return 'tight';
  if (contract.id === 'lofi_halftime_dusty') return 'behind-snare';
  if (contract.grid === 'dilla') return 'dilla-late';
  if (family === 'tr808-dilla-pocket' || family === 'tr808-lofi-boombap' || family === 'tr808-lofi-dusty-break') return 'dilla-late';
  if (family === 'lofi-boombap' || family === 'lofi-dusty-break') return 'dilla-late';
  if (family === 'rnb-neo-soul' || family === 'rnb-neo-soul-pocket' || family === 'tr808-rnb-pocket') return 'behind-snare';
  return 'tight';
}

function velocityProfileForFamily(family: DrumPatternFamily): DrumVelocityProfile {
  if (family.startsWith('jazz')) return 'ghosted';
  if (isBalladFamily(family)) return 'ghosted';
  if (family === 'smooth-jazz-backbeat') return 'ghosted';
  if (family === 'pop-backbeat' || family === 'jpop-driving-8ths') return 'ghosted';
  if (family.startsWith('tr808-')) return 'ghosted';
  if (family === 'rnb-dilla' || family === 'rnb-dilla-pocket' || family === 'rnb-neo-soul' || family === 'rnb-neo-soul-pocket' || family === 'lofi-boombap' || family === 'lofi-dusty-break') return 'ghosted';
  return 'backbeat';
}

function feelOffsetMsForContract(contract: GrooveContract, family: DrumPatternFamily): number {
  if (isBalladFamily(family)) return 7;
  if (family === 'pop-backbeat') return 5;
  if (family === 'jpop-driving-8ths') return 4;
  if (contract.id === 'lofi_soul_boombap' || contract.id === 'lofi_ambient_study') return 3;
  if (contract.id === 'lofi_halftime_dusty') return 6;
  if (contract.grid === 'dilla') return 12;
  if (family === 'tr808-dilla-pocket' || family === 'tr808-lofi-boombap' || family === 'tr808-lofi-dusty-break') return 12;
  if (family === 'lofi-boombap' || family === 'lofi-dusty-break') return 12;
  if (family === 'rnb-neo-soul' || family === 'rnb-neo-soul-pocket' || family === 'tr808-rnb-pocket' || family === 'smooth-jazz-backbeat') return 8;
  if (family.startsWith('jazz')) return 2;
  return 0;
}

function densityCeilingForFamily(role: DrumPerformanceRole, family: DrumPatternFamily): number {
  const base = role === 'lift' ? 0.68 : role === 'breakdown' ? 0.26 : 0.48;
  if (isBalladFamily(family)) return clamp01(role === 'lift' ? 0.42 : role === 'breakdown' ? 0.18 : 0.30);
  if (family === 'pop-backbeat') return clamp01(role === 'lift' ? 0.78 : role === 'breakdown' ? 0.32 : 0.64);
  if (family === 'citypop-disco-boogie') return clamp01(role === 'lift' ? 0.94 : role === 'breakdown' ? 0.42 : 0.82);
  if (family === 'citypop-syncopated-boogie') return clamp01(role === 'lift' ? 0.88 : role === 'breakdown' ? 0.38 : 0.76);
  if (family === 'jpop-driving-8ths') return clamp01(role === 'lift' ? 0.88 : role === 'breakdown' ? 0.34 : 0.74);
  if (family.startsWith('tr808-')) return clamp01(role === 'lift' ? 0.78 : role === 'breakdown' ? 0.34 : 0.66);
  if (family === 'rnb-neo-soul-pocket' || family === 'rnb-dilla-pocket' || family === 'rnb-gospel-triplet') return clamp01(base + 0.10);
  if (family === 'jazz-brush-ballad') return clamp01(base - 0.08);
  return base;
}

export function planDrumPerformance(
  sections: readonly Section[],
  style: string,
  contractBySection: Record<SectionId, GrooveContract>,
  energyBySection: Record<SectionId, number>,
  entryBySection: Record<SectionId, SectionEntry>,
  openingDrumEntry?: OpeningDrumEntry,
  grooveScorePlan?: GrooveScorePlan,
): Record<SectionId, DrumPerformanceContract> {
  const out: Record<SectionId, DrumPerformanceContract> = {};
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const next = sections[i + 1];
    const contract = contractBySection[section.id];
    const role = roleForSection(section);
    const family = baseFamily(style, contract, section, role);
    const energy = energyBySection[section.id] ?? 0.5;
    const nextEnergy = next ? (energyBySection[next.id] ?? energy) : energy;
    const scoredFillPolicy = grooveScorePlan
      ? fillFromGrooveScore(section, grooveScorePlan)
      : fillForBoundary(section, next, energy, nextEnergy);
    const isPopBallad = isPopBalladContract(contract);
    const isLofi = style.toLowerCase() === 'lofi';
    const fillPolicy = isPopBallad
      ? (scoredFillPolicy === 'none' ? 'none' : 'light')
      : isLofi && scoredFillPolicy === 'big' ? 'turnaround' : scoredFillPolicy;
    const complexity = isPopBallad ? 1 : clampLevel(contract.density === 'active' ? 3 : contract.density === 'medium' ? 2 : 1);
    const intensity = isPopBallad
      ? clampLevel(role === 'lift' || role === 'pickup' ? 1 : 0)
      : clampLevel(role === 'lift' ? complexity + 1 : role === 'breakdown' ? complexity - 1 : complexity);
    const densityCeiling = densityCeilingForFamily(role, family);
    const foregroundGuard: DrumForegroundGuard = isPopBallad ? 'strict' : role === 'lift' ? 'normal' : 'strict';
    const tomPolicy: DrumTomPolicy = isPopBallad || isLofi ? 'none' : fillPolicy === 'big' ? 'big-fill' : fillPolicy === 'turnaround' ? 'turnaround' : 'none';
    const cymbalPolicy: DrumCymbalPolicy = isPopBallad || isLofi ? 'none' : fillPolicy === 'big' ? 'hook-crash' : fillPolicy === 'turnaround' ? 'section-crash' : 'none';
    const safety = timingSafetyForContract(contract);
    out[section.id] = {
      id: `${section.id}:${contract.id}:${family}:${role}`,
      sectionId: section.id,
      grooveContractId: contract.id,
      feelProfileId: drumFeelProfileIdForContract(contract),
      role,
      kitProgram: contract.drum?.kitProgram ?? 8,
      patternFamily: family,
      complexity,
      intensity,
      densityCeiling,
      entryMode: i === 0 && openingDrumEntry !== undefined
        ? openingEntryMode(openingDrumEntry, family)
        : entryForRole(role, family, entryBySection[section.id]),
      fillPolicy,
      fillAmount: clampLevel(fillPolicy === 'none' ? 0 : fillPolicy === 'light' ? 1 : fillPolicy === 'turnaround' ? 2 : 3),
      fillComplexity: clampLevel(fillPolicy === 'big' ? 3 : fillPolicy === 'turnaround' ? 2 : fillPolicy === 'light' ? 1 : 0),
      phraseVariation: isPopBallad || isLofi ? clampLevel(isPopBallad && role === 'lift' ? 1 : 0) : clampLevel(role === 'lift' ? 3 : role === 'breakdown' ? 1 : 2),
      timingProfile: timingProfileForContract(contract, family),
      maxMoveTicks: safety.maxMoveTicks,
      humanizeAmount: safety.humanizeAmount,
      feelOffsetMs: feelOffsetMsForContract(contract, family),
      velocityProfile: velocityProfileForFamily(family),
      kickPolicy: kickPolicyForFamily(family),
      snarePolicy: snarePolicyForFamily(family),
      hatPolicy: hatPolicyForFamily(family),
      cymbalPolicy,
      tomPolicy,
      foregroundGuard,
    };
  }
  return out;
}
