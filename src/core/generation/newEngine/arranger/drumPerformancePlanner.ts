// ============================================================
// newEngine · arranger · DrumPerformancePlanner
// ------------------------------------------------------------
// Arranger 拥有鼓手总谱:鼓不回头看 lead/comp,而是与 bass/comp/lead 一样消费同一份
// GrooveContract + section structure。这里把宏观 groove 翻译为每段鼓手演奏合同。
// ============================================================

import type { GrooveContract } from '../knowledge/grooveContracts';
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
  Section,
  SectionEntry,
  SectionId,
} from './ArrangementPlan';
import { timingSafetyForContract } from './performanceContractPlanner';

type Level = 0 | 1 | 2 | 3;

const clampLevel = (v: number): Level => Math.max(0, Math.min(3, Math.round(v))) as Level;

function baseFamily(style: string, contract: GrooveContract, section: Section): DrumPatternFamily {
  const s = style.toLowerCase();
  const id = contract.id;
  if (s === 'jazz') {
    if (id.includes('smooth')) return 'smooth-jazz-backbeat';
    if (id.includes('bossa')) return 'jazz-bossa';
    if (id.includes('ballad')) return 'jazz-ballad-light';
    return section.functionTag === 'solo' ? 'jazz-bebop-comping' : 'jazz-swing-ride';
  }
  if (s === 'rnb') {
    if (id.includes('gospel')) return 'rnb-gospel-shuffle';
    if (id.includes('dilla')) return 'rnb-dilla';
    if (id.includes('trap')) return 'trap-soul-halftime';
    if (id.includes('motown')) return 'pop-backbeat';
    return 'rnb-neo-soul';
  }
  if (s === 'lofi') {
    if (id.includes('late')) return section.functionTag === 'loop' ? 'lofi-dusty-break' : 'lofi-minimal';
    if (id.includes('halftime')) return section.functionTag === 'loop' ? 'lofi-boombap' : 'lofi-minimal';
    if (id.includes('lazy') || id.includes('dusty')) return section.functionTag === 'loop' ? 'lofi-boombap' : 'lofi-dusty-break';
    return 'lofi-boombap';
  }
  if (id.includes('citypop')) return 'citypop-disco-boogie';
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
  if (role === 'breakdown') {
    if (family.startsWith('jazz')) return 'ride-only';
    return family === 'ballad-halftime' || family === 'lofi-minimal' ? 'kick-hat' : 'hat-only';
  }
  if (entry === 'lead-in') return 'full';
  if (role === 'pickup') return 'kick-hat';
  return 'full';
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

function hatPolicyForFamily(family: DrumPatternFamily): DrumHatPolicy {
  if (family.startsWith('jazz')) return family === 'jazz-bossa' ? 'eighths' : 'ride';
  if (family === 'smooth-jazz-backbeat') return 'shaker16';
  if (family === 'citypop-disco-boogie') return 'sixteenths';
  if (family === 'rnb-dilla' || family === 'rnb-neo-soul' || family === 'rnb-gospel-shuffle') return 'shaker16';
  if (family === 'lofi-dusty-break') return 'shaker16';
  if (family === 'lofi-boombap' || family === 'lofi-minimal') return 'eighths';
  return family === 'jpop-driving-8ths' ? 'sixteenths' : 'eighths';
}

function kickPolicyForFamily(family: DrumPatternFamily): DrumKickPolicy {
  if (family === 'ballad-halftime' || family === 'trap-soul-halftime' || family === 'lofi-minimal') return 'halftime';
  if (family === 'citypop-disco-boogie') return 'four-on-floor';
  if (family === 'jpop-driving-8ths') return 'syncopated';
  if (family === 'smooth-jazz-backbeat') return 'syncopated';
  if (family.startsWith('jazz')) return 'anchor-only';
  return 'syncopated';
}

function snarePolicyForFamily(family: DrumPatternFamily): DrumSnarePolicy {
  if (family.startsWith('jazz')) return 'jazz-comping';
  if (family === 'smooth-jazz-backbeat') return 'ghost-before-backbeat';
  if (family === 'lofi-minimal' || family === 'lofi-boombap' || family === 'lofi-dusty-break') return 'rim';
  if (family === 'rnb-dilla' || family === 'rnb-neo-soul') return 'ghost-before-backbeat';
  return 'backbeat';
}

function timingProfileForContract(contract: GrooveContract, family: DrumPatternFamily): DrumTimingProfile {
  if (family.startsWith('jazz')) return 'swing-ride';
  if (family === 'smooth-jazz-backbeat') return 'behind-snare';
  if (contract.grid === 'dilla') return 'dilla-late';
  if (family === 'lofi-boombap' || family === 'lofi-dusty-break') return 'dilla-late';
  if (family === 'rnb-neo-soul') return 'behind-snare';
  return 'tight';
}

function velocityProfileForFamily(family: DrumPatternFamily): DrumVelocityProfile {
  if (family.startsWith('jazz')) return 'ghosted';
  if (family === 'smooth-jazz-backbeat') return 'ghosted';
  if (family === 'rnb-dilla' || family === 'rnb-neo-soul' || family === 'lofi-boombap' || family === 'lofi-dusty-break') return 'ghosted';
  return family === 'jpop-driving-8ths' ? 'crescendo' : 'backbeat';
}

function feelOffsetMsForContract(contract: GrooveContract, family: DrumPatternFamily): number {
  if (contract.grid === 'dilla') return 12;
  if (family === 'lofi-boombap' || family === 'lofi-dusty-break') return 12;
  if (family === 'rnb-neo-soul' || family === 'smooth-jazz-backbeat') return 8;
  if (family.startsWith('jazz')) return 2;
  return 0;
}

export function planDrumPerformance(
  sections: readonly Section[],
  style: string,
  contractBySection: Record<SectionId, GrooveContract>,
  energyBySection: Record<SectionId, number>,
  entryBySection: Record<SectionId, SectionEntry>,
): Record<SectionId, DrumPerformanceContract> {
  const out: Record<SectionId, DrumPerformanceContract> = {};
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const next = sections[i + 1];
    const contract = contractBySection[section.id];
    const family = baseFamily(style, contract, section);
    const role = roleForSection(section);
    const energy = energyBySection[section.id] ?? 0.5;
    const nextEnergy = next ? (energyBySection[next.id] ?? energy) : energy;
    const fillPolicy = fillForBoundary(section, next, energy, nextEnergy);
    const complexity = clampLevel(contract.density === 'active' ? 3 : contract.density === 'medium' ? 2 : 1);
    const intensity = clampLevel(role === 'lift' ? complexity + 1 : role === 'breakdown' ? complexity - 1 : complexity);
    const densityCeiling = role === 'lift' ? 0.68 : role === 'breakdown' ? 0.26 : 0.48;
    const foregroundGuard: DrumForegroundGuard = role === 'lift' ? 'normal' : 'strict';
    const tomPolicy: DrumTomPolicy = fillPolicy === 'big' ? 'big-fill' : fillPolicy === 'turnaround' ? 'turnaround' : 'none';
    const cymbalPolicy: DrumCymbalPolicy = fillPolicy === 'big' ? 'hook-crash' : fillPolicy === 'turnaround' ? 'section-crash' : 'none';
    const safety = timingSafetyForContract(contract);
    out[section.id] = {
      id: `${section.id}:${contract.id}:${family}:${role}`,
      sectionId: section.id,
      role,
      patternFamily: family,
      complexity,
      intensity,
      densityCeiling,
      entryMode: entryForRole(role, family, entryBySection[section.id]),
      fillPolicy,
      fillAmount: clampLevel(fillPolicy === 'none' ? 0 : fillPolicy === 'light' ? 1 : fillPolicy === 'turnaround' ? 2 : 3),
      fillComplexity: clampLevel(fillPolicy === 'big' ? 3 : fillPolicy === 'turnaround' ? 2 : fillPolicy === 'light' ? 1 : 0),
      phraseVariation: clampLevel(role === 'lift' ? 3 : role === 'breakdown' ? 1 : 2),
      swingUnit: contract.grid === 'shuffle' || contract.grid === 'dilla' ? '16th' : '8th',
      timingProfile: timingProfileForContract(contract, family),
      safeRangeTicks: safety.safeRangeTicks,
      maxMoveTicks: safety.maxMoveTicks,
      preQuantizeGrid: safety.preQuantizeGrid,
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
