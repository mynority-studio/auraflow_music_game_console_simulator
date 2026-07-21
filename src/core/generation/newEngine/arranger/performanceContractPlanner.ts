// ============================================================
// newEngine · arranger · PerformanceContractPlanner
// ------------------------------------------------------------
// DAW 风格总谱:Arranger 一次性下发每段每个乐手的演奏合同。
// Instrumentation/render 只解释合同,不在末端重新决定谁前景、怎么 swing、怎么连奏。
// ============================================================

import type { InstrumentRoleName } from '../band/BandSpec';
import { rhythmSwingSourceForContract, type GrooveContract } from '../knowledge/grooveContracts';
import type {
  DrumFillPolicy,
  DrumPerformanceContract,
  DrumSwingUnit,
  PerformanceArticulationExclusionGroup,
  PerformanceArticulationScope,
  PerformanceContinuity,
  PerformanceFollowSource,
  KeyboardMotion,
  PerformancePreQuantizeGrid,
  RolePerformanceContract,
  Section,
  SectionEntry,
  SectionId,
} from './ArrangementPlan';

const ALL_ROLES: readonly InstrumentRoleName[] = ['bass', 'comp', 'pad', 'lead', 'drum'];
const BASE_PPQ = 480;

function clampLevel(v: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.round(v))) as 0 | 1 | 2 | 3;
}

function swingUnitFor(contract: GrooveContract): DrumSwingUnit {
  return rhythmSwingSourceForContract(contract) === 'straight-sixteenths' ? '16th' : '8th';
}

export function timingSafetyForContract(contract: GrooveContract): {
  safeRangeTicks: number;
  maxMoveTicks: number;
  preQuantizeGrid: PerformancePreQuantizeGrid;
  humanizeAmount: 0 | 1 | 2 | 3;
} {
  if (rhythmSwingSourceForContract(contract) === 'authored') {
    return { safeRangeTicks: 8, maxMoveTicks: Math.round(BASE_PPQ * 0.08), preQuantizeGrid: 'none', humanizeAmount: 2 };
  }
  if (contract.grid === 'dilla') return { safeRangeTicks: 4, maxMoveTicks: Math.round(BASE_PPQ * 0.07), preQuantizeGrid: '16th', humanizeAmount: 3 };
  if (contract.grid === 'swing' || contract.grid === 'shuffle') return { safeRangeTicks: 8, maxMoveTicks: Math.round(BASE_PPQ * 0.08), preQuantizeGrid: contract.grid === 'shuffle' ? '16th' : '8th', humanizeAmount: 2 };
  if (contract.grid === 'rubato') return { safeRangeTicks: 10, maxMoveTicks: Math.round(BASE_PPQ * 0.05), preQuantizeGrid: 'none', humanizeAmount: 2 };
  return { safeRangeTicks: 8, maxMoveTicks: Math.round(BASE_PPQ * 0.025), preQuantizeGrid: '16th', humanizeAmount: contract.density === 'sparse' ? 2 : 1 };
}

function foregroundRoleFor(section: Section, activeRoles: readonly InstrumentRoleName[]): InstrumentRoleName {
  const tag = section.functionTag ?? '';
  if ((tag === 'hook' || tag === 'solo' || tag === 'head' || tag === 'headOut') && activeRoles.includes('lead')) return 'lead';
  if ((tag === 'setup' || tag === 'story' || tag === 'loop') && activeRoles.includes('comp')) return 'comp';
  if (activeRoles.includes('lead')) return 'lead';
  if (activeRoles.includes('comp')) return 'comp';
  if (activeRoles.includes('bass')) return 'bass';
  return activeRoles[0] ?? 'comp';
}

function roleEntry(role: InstrumentRoleName, entry: SectionEntry | undefined, active: boolean, section: Section): RolePerformanceContract['entryMode'] {
  if (!active) return 'none';
  if (section.functionTag === 'breakdown' && role === 'drum') return 'dropout';
  if (entry === 'lead-in' && (role === 'drum' || role === 'bass' || role === 'comp')) return 'pickup';
  if (section.functionTag === 'setup' && (role === 'lead' || role === 'pad')) return 'delayed';
  return 'downbeat';
}

function continuityForRole(role: InstrumentRoleName, style: string, contract: GrooveContract): PerformanceContinuity {
  const s = style.toLowerCase();
  if (role === 'drum') return 'staccato';
  if (role === 'pad') return 'legato-flow';
  if (role === 'lead') return s === 'jazz' || contract.articulation === 'bebop' || contract.articulation === 'ballad' ? 'legato-flow' : 'connected';
  if (role === 'comp') return s === 'jazz' || s === 'blues' ? 'connected' : 'pedal-legato';
  if (role === 'bass') return s === 'lofi' ? 'staccato' : 'connected';
  return 'connected';
}

function scopeFor(continuity: PerformanceContinuity): PerformanceArticulationScope {
  if (continuity === 'none') return 'none';
  return continuity === 'staccato' ? 'attribute' : 'direction';
}

function exclusionFor(role: InstrumentRoleName, continuity: PerformanceContinuity): PerformanceArticulationExclusionGroup {
  if (role === 'drum') return 'rudiment';
  if (continuity === 'pedal-legato') return 'pedal';
  if (continuity === 'legato-flow') return role === 'lead' ? 'breath' : 'length';
  if (continuity === 'staccato' || continuity === 'connected') return 'length';
  return 'none';
}

function phrasePolicyFor(role: InstrumentRoleName, continuity: PerformanceContinuity): RolePerformanceContract['phrasePolicy'] {
  if (role === 'drum') return 'rudiment-bar';
  if (role === 'lead' && continuity === 'legato-flow') return 'breath-group';
  if (role === 'comp' && continuity === 'pedal-legato') return 'pedal-harmony';
  if (role === 'bass') return 'pluck-voice';
  if (role === 'pad') return 'sustain-bed';
  return 'none';
}

function followSourceFor(role: InstrumentRoleName): PerformanceFollowSource {
  if (role === 'bass' || role === 'comp' || role === 'pad') return 'chords';
  return 'none';
}

function densityBudgetFor(role: InstrumentRoleName, density: number, foreground: boolean): number {
  const base = role === 'drum' ? 0.58 : role === 'pad' ? 0.34 : role === 'bass' ? 0.46 : role === 'comp' ? 0.52 : 0.62;
  const fg = foreground ? 0.14 : -0.08;
  return Math.max(0.12, Math.min(0.82, base + density * 0.18 + fg));
}

function roleFillPolicy(role: InstrumentRoleName, drum: DrumPerformanceContract | undefined): DrumFillPolicy {
  return role === 'drum' ? (drum?.fillPolicy ?? 'none') : 'none';
}

function keyboardMotionForRole(
  role: InstrumentRoleName,
  style: string,
  section: Section,
  contract: GrooveContract,
  active: boolean,
  continuity: PerformanceContinuity,
): KeyboardMotion {
  if (!active) return 'none';
  const normalized = style.toLowerCase();
  if (role === 'comp') {
    if (contract.articulation === 'short') return 'percussive';
    // Jazz comping is normally a dry, syncopated response to the ride/bass
    // time. Only an explicit ballad/sparse sentence earns the lyrical damper
    // lane; treating bebop/swing as a generic broken chord leaves CC64 down
    // across dense attacks and turns the real piano into a wash.
    if (normalized === 'jazz') {
      if (contract.articulation === 'ballad' || contract.density === 'sparse'
        || section.functionTag === 'setup' || section.functionTag === 'tag' || section.functionTag === 'outro') return 'lyrical';
      return 'syncopated-comp';
    }
    // An active CityPop/RNB groove is a rhythmic keyboard statement. It must
    // reserve the right to be dry before a concrete texture is rendered.
    if (contract.density === 'active' && (normalized === 'pop' || normalized === 'rnb')) return 'sixteenth-ostinato';
    if (contract.grid === 'dilla' || contract.grid === 'shuffle') return 'syncopated-comp';
    if (normalized === 'acg' || contract.articulation === 'ballad' || contract.density === 'sparse'
      || section.functionTag === 'setup' || section.functionTag === 'tag' || section.functionTag === 'outro') return 'lyrical';
    return 'broken-chord';
  }
  if (role === 'lead') return continuity === 'legato-flow' ? 'lyrical' : 'none';
  // ACG bass/comp/lead are one scored piano player. Instrumentation groups
  // their pedal state only when the selected voice is a documented piano.
  if (role === 'bass' && normalized === 'acg') return 'lyrical';
  return 'none';
}

export function planRolePerformance(
  sections: readonly Section[],
  style: string,
  activeRoles: readonly InstrumentRoleName[],
  contractBySection: Record<SectionId, GrooveContract>,
  densityBySection: Record<SectionId, number>,
  entryBySection: Record<SectionId, SectionEntry>,
  drumPerformanceBySection: Record<SectionId, DrumPerformanceContract>,
): Record<InstrumentRoleName, Record<SectionId, RolePerformanceContract>> {
  const out = Object.fromEntries(ALL_ROLES.map((role) => [role, {}])) as Record<InstrumentRoleName, Record<SectionId, RolePerformanceContract>>;
  const active = new Set(activeRoles);
  for (const section of sections) {
    const contract = contractBySection[section.id];
    const density = densityBySection[section.id] ?? 0.5;
    const foregroundRole = foregroundRoleFor(section, activeRoles);
    const safety = timingSafetyForContract(contract);
    const dynamicsRange = clampLevel((density * 3) + ((section.functionTag === 'hook' || section.functionTag === 'solo') ? 0.5 : 0));

    for (const role of ALL_ROLES) {
      const roleActive = active.has(role);
      const continuity = roleActive ? continuityForRole(role, style, contract) : 'none';
      const foreground = role === foregroundRole && roleActive;
      const drum = drumPerformanceBySection[section.id];
      out[role][section.id] = {
        id: `${section.id}:${role}:${contract.id}`,
        sectionId: section.id,
        role,
        active: roleActive,
        entryMode: roleEntry(role, entryBySection[section.id], roleActive, section),
        foreground,
        foregroundRole,
        densityBudget: roleActive ? densityBudgetFor(role, density, foreground) : 0,
        grooveContractId: contract.id,
        rhythmGrid: contract.grid,
        swingUnit: swingUnitFor(contract),
        safeRangeTicks: safety.safeRangeTicks,
        maxMoveTicks: safety.maxMoveTicks,
        preQuantizeGrid: safety.preQuantizeGrid,
        humanizeAmount: safety.humanizeAmount,
        dynamicsRange,
        continuity,
        articulationScope: scopeFor(continuity),
        articulationExclusionGroup: exclusionFor(role, continuity),
        phrasePolicy: phrasePolicyFor(role, continuity),
        fillPolicy: roleFillPolicy(role, drum),
        phraseVariation: role === 'drum' ? (drum?.phraseVariation ?? 0) : clampLevel(foreground ? 3 : density * 2),
        feelOffsetMs: role === 'drum' ? (drum?.feelOffsetMs ?? 0) : role === 'bass' ? contract.bassPocketMs[1] : role === 'lead' ? contract.melodyWeakPocketMs[1] : contract.chordPocketMs[1],
        followSource: followSourceFor(role),
        keyboardMotion: keyboardMotionForRole(role, style, section, contract, roleActive, continuity),
      };
    }
  }
  return out;
}
