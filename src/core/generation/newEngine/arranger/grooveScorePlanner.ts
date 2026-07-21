// ============================================================
// newEngine · arranger · GrooveScorePlanner
// ------------------------------------------------------------
// Materializes the selected GrooveContract into a bar/section score. The
// contract remains the only rhythmic truth; instrument planners only project
// notes from this immutable score.
// ============================================================

import {
  grooveRhythmProfileForContract,
  type GrooveContract,
  type GroovePhraseBarRole,
} from '../knowledge/grooveContracts';
import {
  grooveBassPattern,
  isRegisteredBassPatternReference,
} from '../knowledge/grooveBassPatterns';
import {
  bassRoleRhythmPattern,
  compRoleRhythmPattern,
  leadRoleRhythmPattern,
  type BassRoleRhythmPattern,
  type CompRoleRhythmPattern,
  type LeadRoleRhythmPattern,
  type RoleRhythmPatternByRole,
  type RoleRhythmPatternReferenceByRole,
} from '../knowledge/roleRhythmPatterns';
import {
  materializeFunctionalPopRockFill,
  POP_ROCK_FILL_VOCABULARY_ID,
  type GrooveDrumFillFunction,
  type GrooveDrumFillScore,
} from '../knowledge/drumFillVocabulary';
import type {
  ClimaxPoint,
  GrooveBarTrajectory,
  GrooveBoundaryKind,
  GrooveBoundaryScore,
  GrooveDrumInteractionScore,
  GrooveScorePlan,
  GrooveSectionScore,
  OpeningGesturePlan,
  Section,
  SectionEntry,
  SectionId,
} from './ArrangementPlan';

export interface GrooveScoreOptions {
  strictDownbeatBoundaries?: boolean;
  climaxMap?: readonly ClimaxPoint[];
  /** Song-seeded variation after the musical function has constrained candidates. */
  fillVariantSeed?: number;
  /** Arranger-resolved Bass vocabulary; renderer must not merge competing sources. */
  bassPatternIdBySection?: Readonly<Record<SectionId, string | undefined>>;
  /** Typed role-pattern references resolved into GrooveSectionScore snapshots. */
  rolePatternBySection?: Readonly<Record<SectionId, Readonly<RoleRhythmPatternReferenceByRole> | undefined>>;
}

const ROLE_RHYTHM_ROLES = ['bass', 'comp', 'lead'] as const;

function cloneBassRoleRhythmPattern(pattern: BassRoleRhythmPattern): BassRoleRhythmPattern {
  return {
    ...pattern,
    source: { ...pattern.source },
    cells: pattern.cells.map((cell) => ({ ...cell })),
  };
}

function cloneCompRoleRhythmPattern(pattern: CompRoleRhythmPattern): CompRoleRhythmPattern {
  return {
    ...pattern,
    source: { ...pattern.source },
    cells: pattern.cells.map((cell) => ({
      ...cell,
      voiceDurationBeats: cell.voiceDurationBeats ? [...cell.voiceDurationBeats] : undefined,
    })),
  };
}

function cloneLeadRoleRhythmPattern(pattern: LeadRoleRhythmPattern): LeadRoleRhythmPattern {
  return { ...pattern, source: { ...pattern.source } };
}

function unknownRoleRhythmPattern(role: string, id: string): never {
  throw new Error(`Unknown role rhythm pattern reference for ${role}: ${id}`);
}

function materializeRoleRhythmByRole(
  references: Readonly<RoleRhythmPatternReferenceByRole> | undefined,
): RoleRhythmPatternByRole {
  if (!references) return {};
  for (const role of Object.keys(references)) {
    if (!(ROLE_RHYTHM_ROLES as readonly string[]).includes(role)) {
      unknownRoleRhythmPattern(role, String((references as Record<string, unknown>)[role]));
    }
  }

  const bass = bassRoleRhythmPattern(references.bass);
  if (references.bass !== undefined && !bass) unknownRoleRhythmPattern('bass', references.bass);
  const comp = compRoleRhythmPattern(references.comp);
  if (references.comp !== undefined && !comp) unknownRoleRhythmPattern('comp', references.comp);
  const lead = leadRoleRhythmPattern(references.lead);
  if (references.lead !== undefined && !lead) unknownRoleRhythmPattern('lead', references.lead);

  return {
    bass: bass ? cloneBassRoleRhythmPattern(bass) : undefined,
    comp: comp ? cloneCompRoleRhythmPattern(comp) : undefined,
    lead: lead ? cloneLeadRoleRhythmPattern(lead) : undefined,
  };
}

function beatsPerBarForContract(contract: GrooveContract): number {
  return contract.meter
    ? contract.meter.numerator * (4 / contract.meter.denominator)
    : contract.accentPattern.length;
}

function assertRoleRhythmMeter(
  contract: GrooveContract,
  roleRhythmByRole: Readonly<RoleRhythmPatternByRole>,
): void {
  const songBeatsPerBar = beatsPerBarForContract(contract);
  for (const pattern of Object.values(roleRhythmByRole)) {
    if (pattern && Math.abs(songBeatsPerBar - pattern.beatsPerBar) > 1e-6) {
      throw new Error(`Role rhythm ${pattern.id} meter does not match ${contract.id}`);
    }
  }
}

function sectionBarRole(section: Section, role: GroovePhraseBarRole): GroovePhraseBarRole {
  const tag = section.functionTag;
  if (role === 'turnaround') return role;
  if (tag === 'setup' || tag === 'breakdown' || tag === 'tag' || tag === 'outro') return 'breakdown';
  if (tag === 'hook' || tag === 'solo' || tag === 'build') return 'lift';
  return role;
}

function uniqueSortedBeats(beats: readonly number[], beatsPerBar: number): number[] {
  return [...new Set(beats
    .filter((beat) => Number.isFinite(beat) && beat >= 0 && beat < beatsPerBar)
    .map((beat) => Math.round(beat * 1000) / 1000))]
    .sort((a, b) => a - b);
}

function metricGroupStarts(contract: GrooveContract, beatsPerBar: number): number[] {
  const grouping = contract.beatGrouping;
  if (grouping && grouping.length > 1
    && Math.abs(grouping.reduce((sum, group) => sum + group, 0) - beatsPerBar) < 1e-6) {
    let cursor = 0;
    const starts: number[] = [];
    for (const group of grouping) {
      starts.push(cursor);
      cursor += group;
    }
    return starts;
  }
  return beatsPerBar >= 4 ? [0, Math.floor(beatsPerBar / 2)] : [0];
}

function familyForBar(contract: GrooveContract, role: GroovePhraseBarRole): string | undefined {
  const drum = contract.drum;
  if (!drum) return undefined;
  if (role === 'breakdown') return drum.breakdownFamily ?? drum.timekeeperFamily;
  if (role === 'lift') return drum.liftFamily ?? drum.timekeeperFamily;
  if (role === 'turnaround') return drum.pickupFamily ?? drum.liftFamily ?? drum.timekeeperFamily;
  return drum.timekeeperFamily;
}

function structuralKickBeats(contract: GrooveContract): number[] {
  const drum = contract.drum;
  const beatsPerBar = Math.max(1, contract.accentPattern.length);
  if (!drum) return [];
  if (drum.kickFollow === 'bass') return [0];
  const accented = contract.accentPattern
    .map((strength, beat) => ({ strength, beat }))
    .filter(({ strength }) => strength >= 1 - 1e-6)
    .map(({ beat }) => beat);
  return uniqueSortedBeats([...metricGroupStarts(contract, beatsPerBar), ...accented], beatsPerBar);
}

function structuralSnareBeats(contract: GrooveContract, role: GroovePhraseBarRole): number[] {
  const drum = contract.drum;
  const beatsPerBar = Math.max(1, contract.accentPattern.length);
  if (!drum || drum.snareFollow !== 'backbeat') return [];
  const family = familyForBar(contract, role) ?? '';
  if (family.includes('halftime') || family.includes('minimal')) return [Math.floor(beatsPerBar / 2)];
  if (beatsPerBar === 4) return [1, 3];
  const grouping = contract.beatGrouping;
  if (grouping && grouping.length > 1) {
    let cursor = 0;
    return uniqueSortedBeats(grouping.map((group) => {
      cursor += group;
      return cursor - 1;
    }), beatsPerBar);
  }
  return uniqueSortedBeats([Math.max(0, Math.floor(beatsPerBar / 2) - 1), beatsPerBar - 1], beatsPerBar);
}

function kickResponseLimit(contract: GrooveContract, role: GroovePhraseBarRole): number {
  if (contract.drum?.kickFollow !== 'bass') return 0;
  const base = contract.density === 'active' ? 3 : contract.density === 'medium' ? 2 : 1;
  if (role === 'breakdown') return Math.max(1, base - 1);
  if (role === 'answer' || role === 'lift') return Math.min(4, base + 1);
  return base;
}

function snareResponseLimit(contract: GrooveContract, role: GroovePhraseBarRole): number {
  const follow = contract.drum?.snareFollow;
  if (!follow || follow === 'backbeat' || role === 'breakdown') return 0;
  if (role === 'lift') return 2;
  if (role === 'answer' || role === 'turnaround' || contract.density === 'active') return 2;
  return 1;
}

function drumInteractionForBar(
  contract: GrooveContract,
  role: GroovePhraseBarRole,
): GrooveDrumInteractionScore {
  return {
    kickFollow: contract.drum?.kickFollow ?? 'pulse',
    snareFollow: contract.drum?.snareFollow ?? 'backbeat',
    structuralKickBeats: structuralKickBeats(contract),
    structuralSnareBeats: structuralSnareBeats(contract, role),
    kickResponseLimit: kickResponseLimit(contract, role),
    snareResponseLimit: snareResponseLimit(contract, role),
  };
}

function boundaryFunction(
  section: Section,
  next: Section,
  energy: number,
  nextEnergy: number,
  pickup: boolean,
  climaxTarget: boolean,
): GrooveDrumFillFunction {
  if (climaxTarget) return 'climax';
  if (next.functionTag === 'outro' || next.functionTag === 'tag' || nextEnergy < energy - 0.06) return 'release';
  if (section.functionTag === 'setup' || section.functionTag === 'breakdown') return 'setup';
  if (pickup || next.functionTag === 'hook' || next.functionTag === 'solo' || next.functionTag === 'headOut' || nextEnergy > energy + 0.07) return 'lift';
  return 'continuation';
}

function boundaryIntensity(fn: GrooveDrumFillFunction, section: Section): 1 | 2 | 3 {
  if (fn === 'climax') return 3;
  if (fn === 'lift' || fn === 'setup' || section.functionTag === 'build') return 2;
  return 1;
}

function stableVariant(...parts: readonly (string | number | undefined)[]): number {
  const value = parts.join(':');
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
}

function popRockFillScore(args: {
  contract: GrooveContract;
  fn: GrooveDrumFillFunction;
  sourceBar: number;
  durationBeats: number;
  intensity: 1 | 2 | 3;
  fromSectionId?: string;
  toSectionId: string;
  variantSeed: number;
}): GrooveDrumFillScore | undefined {
  if (args.contract.drum?.fillVocabulary !== POP_ROCK_FILL_VOCABULARY_ID) return undefined;
  const intensity = args.contract.density === 'sparse' && args.intensity === 3 ? 2 : args.intensity;
  return materializeFunctionalPopRockFill({
    function: args.fn,
    variant: stableVariant(
      args.variantSeed,
      args.contract.id,
      args.sourceBar,
      args.fromSectionId,
      args.toSectionId,
      args.fn,
    ),
    durationBeats: args.durationBeats,
    intensity,
  });
}

function popRockLanding(
  contract: GrooveContract,
  fn: GrooveDrumFillFunction,
  next: Section,
): GrooveBoundaryScore['landing'] {
  if (contract.drum?.fillVocabulary !== POP_ROCK_FILL_VOCABULARY_ID) return contract.drum?.landing ?? 'none';
  if (next.functionTag === 'outro' || next.functionTag === 'tag') return 'none';
  if (fn === 'climax' || fn === 'lift' || fn === 'setup') return 'kick-crash';
  return 'kick';
}

function barTrajectory(args: {
  section: Section;
  next: Section | undefined;
  barInSection: number;
  phraseBars: number;
  energy: number;
  nextEnergy: number;
  climaxTarget: boolean;
  nextIsClimax: boolean;
}): GrooveBarTrajectory {
  if (args.climaxTarget) return args.barInSection === 0 ? 'arrival' : 'peak';
  const phraseRampStart = Math.max(0, args.section.bars - args.phraseBars);
  const shortRampStart = Math.max(0, args.section.bars - 2);
  if (args.section.functionTag === 'outro' || args.section.functionTag === 'tag') return 'falling';
  if (args.nextEnergy < args.energy - 0.06 && args.barInSection >= shortRampStart) return 'falling';
  if (args.section.functionTag === 'build'
    || (args.nextIsClimax && args.barInSection >= phraseRampStart)
    || (args.next && args.nextEnergy > args.energy + 0.07 && args.barInSection >= shortRampStart)) return 'rising';
  return 'settled';
}

function barEnergy(
  trajectory: GrooveBarTrajectory,
  section: Section,
  barInSection: number,
  energy: number,
  nextEnergy: number,
  climaxIntensity: number,
): number {
  if (trajectory === 'arrival' || trajectory === 'peak') return Math.min(1, energy + climaxIntensity * 0.05);
  const progress = section.bars <= 1 ? 1 : barInSection / (section.bars - 1);
  if (trajectory === 'rising') return Math.min(1, energy + Math.max(0, nextEnergy - energy) * progress * 0.75);
  if (trajectory === 'falling') return Math.max(0, energy * (1 - progress * 0.1));
  return energy;
}

function boundaryKind(
  section: Section,
  next: Section,
  entry: SectionEntry | undefined,
  fillFamily: string,
): GrooveBoundaryKind {
  if (fillFamily === 'lofi-one-shot' && (next.functionTag === 'hook' || entry === 'lead-in')) return 'dropout';
  if (section.functionTag === 'setup' || section.functionTag === 'breakdown' || entry === 'lead-in') return 'pickup';
  return 'fill';
}

function planSectionBoundary(args: {
  section: Section;
  next: Section;
  contract: GrooveContract;
  sourceBar: number;
  energy: number;
  nextEnergy: number;
  entry: SectionEntry | undefined;
  strict: boolean;
  climaxTarget: boolean;
  fillVariantSeed: number;
}): GrooveBoundaryScore | undefined {
  if (args.strict) return undefined;
  const drum = args.contract.drum;
  if (!drum) return undefined;
  const profile = grooveRhythmProfileForContract(args.contract);
  const repeated = !!args.section.repeatGroup && args.section.repeatGroup === args.next.repeatGroup;
  if (repeated && args.entry !== 'lead-in') return undefined;
  const isSetup = args.section.functionTag === 'setup' || args.section.functionTag === 'breakdown';
  if (isSetup && !profile.transition.allowSetupPickup) return undefined;

  const pickup = isSetup || args.entry === 'lead-in';
  const fillFunction = boundaryFunction(
    args.section,
    args.next,
    args.energy,
    args.nextEnergy,
    pickup,
    args.climaxTarget,
  );
  const intensity = boundaryIntensity(fillFunction, args.section);
  const strong = intensity >= 2;
  const fillFamily = pickup
    ? drum.fillFamilies.pickup
    : strong ? drum.fillFamilies.strong : drum.fillFamilies.light;
  const durationBeats = strong ? profile.transition.strongBeats : profile.transition.lightBeats;
  return {
    id: `${args.section.id}->${args.next.id}:${fillFamily}`,
    fromSectionId: args.section.id,
    toSectionId: args.next.id,
    sourceBar: args.sourceBar,
    landingBar: args.sourceBar + 1,
    kind: boundaryKind(args.section, args.next, args.entry, fillFamily),
    intensity,
    durationBeats,
    baseMask: strong ? profile.transition.strongBaseMask : profile.transition.lightBaseMask,
    drumFillFamily: fillFamily,
    fillFunction,
    fillScore: popRockFillScore({
      contract: args.contract,
      fn: fillFunction,
      sourceBar: args.sourceBar,
      durationBeats,
      intensity,
      fromSectionId: args.section.id,
      toSectionId: args.next.id,
      variantSeed: args.fillVariantSeed,
    }),
    landing: popRockLanding(args.contract, fillFunction, args.next),
    opening: false,
  };
}

function planOpeningBoundary(
  first: Section | undefined,
  contract: GrooveContract | undefined,
  opening: OpeningGesturePlan,
  fillVariantSeed: number,
): GrooveBoundaryScore | undefined {
  if (!first || !contract?.drum || opening.mode !== 'pickupFill' || opening.pickupBars === 0 || first.bars < 2) return undefined;
  const profile = grooveRhythmProfileForContract(contract);
  const intensity = opening.intensity === 'bold' ? 3 : opening.intensity === 'medium' ? 2 : 1;
  const durationBeats = profile.transition.openingPickupBeats;
  return {
    id: `opening->${first.id}:${contract.drum.fillFamilies.pickup}`,
    toSectionId: first.id,
    sourceBar: 0,
    landingBar: 1,
    kind: 'pickup',
    intensity,
    durationBeats,
    baseMask: 'replace-bar',
    drumFillFamily: contract.drum.fillFamilies.pickup,
    fillFunction: 'opening',
    fillScore: popRockFillScore({
      contract,
      fn: 'opening',
      sourceBar: 0,
      durationBeats,
      intensity,
      toSectionId: first.id,
      variantSeed: fillVariantSeed,
    }),
    landing: contract.drum.landing,
    opening: true,
  };
}

function allowsInternalCadence(section: Section): boolean {
  return section.functionTag !== 'setup'
    && section.functionTag !== 'breakdown'
    && section.functionTag !== 'tag'
    && section.functionTag !== 'outro';
}

function planInternalCadences(
  sections: readonly Section[],
  contractBySection: Record<SectionId, GrooveContract>,
  bySection: Record<SectionId, GrooveSectionScore>,
  strict: boolean,
  fillVariantSeed: number,
): GrooveBoundaryScore[] {
  if (strict) return [];
  const cadences: GrooveBoundaryScore[] = [];
  let sectionStartBar = 0;
  for (const section of sections) {
    const contract = contractBySection[section.id];
    const drum = contract.drum;
    const profile = grooveRhythmProfileForContract(contract);
    const cadenceBars = profile.transition.cadenceEveryBars;
    if (drum && allowsInternalCadence(section)) {
      // Never replace the final bar here: the section-boundary gesture owns it.
      for (let sourceInSection = cadenceBars - 1; sourceInSection < section.bars - 1; sourceInSection += cadenceBars) {
        const sourceBar = sectionStartBar + sourceInSection;
        const durationBeats = profile.transition.lightBeats;
        cadences.push({
          id: `${section.id}:cadence-${sourceInSection + 1}:${drum.fillFamilies.light}`,
          fromSectionId: section.id,
          toSectionId: section.id,
          sourceBar,
          landingBar: sourceBar + 1,
          kind: 'fill',
          intensity: 1,
          durationBeats,
          baseMask: profile.transition.lightBaseMask,
          drumFillFamily: drum.fillFamilies.light,
          fillFunction: 'continuation',
          fillScore: popRockFillScore({
            contract,
            fn: 'continuation',
            sourceBar,
            durationBeats,
            intensity: 1,
            fromSectionId: section.id,
            toSectionId: section.id,
            variantSeed: fillVariantSeed,
          }),
          landing: popRockLanding(contract, 'continuation', section),
          opening: false,
        });
        const source = bySection[section.id]?.bars[sourceInSection];
        if (source) {
          source.role = 'turnaround';
          source.drumInteraction = drumInteractionForBar(contract, 'turnaround');
        }
      }
    }
    sectionStartBar += section.bars;
  }
  return cadences;
}

export function planGrooveScore(
  sections: readonly Section[],
  contractBySection: Record<SectionId, GrooveContract>,
  energyBySection: Record<SectionId, number>,
  entryBySection: Record<SectionId, SectionEntry>,
  openingGesture: OpeningGesturePlan,
  options: GrooveScoreOptions = {},
): GrooveScorePlan {
  const bySection: Record<SectionId, GrooveSectionScore> = {};
  const boundaries: GrooveBoundaryScore[] = [];
  const fallbackClimax = [...sections].reverse().find((section) => section.role === 'chorus');
  const climaxPoints = options.climaxMap ?? (fallbackClimax ? [{ sectionId: fallbackClimax.id, intensity: 1 }] : []);
  const climaxBySection = new Map(climaxPoints.map((point) => [point.sectionId, point.intensity]));
  const fillVariantSeed = Number.isFinite(options.fillVariantSeed) ? options.fillVariantSeed! : 0;
  let absoluteBar = 0;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    const next = sections[sectionIndex + 1];
    const contract = contractBySection[section.id];
    const bassPatternId = options.bassPatternIdBySection?.[section.id];
    const bassPattern = grooveBassPattern(bassPatternId);
    const roleRhythmByRole = materializeRoleRhythmByRole(
      options.rolePatternBySection?.[section.id],
    );
    if (!isRegisteredBassPatternReference(bassPatternId)) {
      throw new Error(`Unknown Bass pattern reference: ${bassPatternId}`);
    }
    if (bassPattern) {
      const songBeatsPerBar = beatsPerBarForContract(contract);
      if (Math.abs(songBeatsPerBar - bassPattern.beatsPerBar) > 1e-6) {
        throw new Error(`Bass groove ${bassPattern.id} meter does not match ${contract.id}`);
      }
    }
    assertRoleRhythmMeter(contract, roleRhythmByRole);
    const profile = grooveRhythmProfileForContract(contract);
    const phraseBars = profile.phraseShape.length;
    const energy = energyBySection[section.id] ?? 0.5;
    const nextEnergy = next ? (energyBySection[next.id] ?? energy) : energy;
    const climaxIntensity = climaxBySection.get(section.id) ?? 0;
    bySection[section.id] = {
      sectionId: section.id,
      grooveContractId: contract.id,
      bassPatternId,
      roleRhythmByRole,
      bars: Array.from({ length: section.bars }, (_, barInSection) => {
        const phraseBarIndex = barInSection % phraseBars;
        const role = sectionBarRole(section, profile.phraseShape[phraseBarIndex]);
        const trajectory = barTrajectory({
          section,
          next,
          barInSection,
          phraseBars,
          energy,
          nextEnergy,
          climaxTarget: climaxBySection.has(section.id),
          nextIsClimax: !!next && climaxBySection.has(next.id),
        });
        return {
          sectionId: section.id,
          barInSection,
          absoluteBar: absoluteBar + barInSection,
          phraseIndex: Math.floor(barInSection / phraseBars),
          phraseBarIndex,
          role,
          beatStrength: [...contract.accentPattern],
          subdivision: profile.subdivision,
          subdivisionAccent: [...profile.subdivisionAccent],
          phraseAccent: profile.phraseAccent[phraseBarIndex] ?? 1,
          energy: barEnergy(trajectory, section, barInSection, energy, nextEnergy, climaxIntensity),
          trajectory,
          drumInteraction: drumInteractionForBar(contract, role),
        };
      }),
    };
    absoluteBar += section.bars;
  }

  let sourceBar = 0;
  for (let index = 0; index < sections.length - 1; index++) {
    const section = sections[index];
    const next = sections[index + 1];
    sourceBar += section.bars;
    const boundary = planSectionBoundary({
      section,
      next,
      contract: contractBySection[section.id],
      sourceBar: sourceBar - 1,
      energy: energyBySection[section.id] ?? 0.5,
      nextEnergy: energyBySection[next.id] ?? 0.5,
      entry: entryBySection[next.id],
      strict: options.strictDownbeatBoundaries ?? false,
      climaxTarget: climaxBySection.has(next.id),
      fillVariantSeed,
    });
    if (!boundary) continue;
    boundaries.push(boundary);
    const source = bySection[section.id]?.bars[section.bars - 1];
    if (source) {
      source.role = 'turnaround';
      source.drumInteraction = drumInteractionForBar(contractBySection[section.id], 'turnaround');
    }
  }

  const first = sections[0];
  const opening = planOpeningBoundary(
    first,
    first ? contractBySection[first.id] : undefined,
    openingGesture,
    fillVariantSeed,
  );
  if (opening) boundaries.unshift(opening);

  boundaries.push(...planInternalCadences(
    sections,
    contractBySection,
    bySection,
    options.strictDownbeatBoundaries ?? false,
    fillVariantSeed,
  ));
  boundaries.sort((a, b) => a.sourceBar - b.sourceBar || Number(a.opening) - Number(b.opening));

  return {
    grooveContractId: first ? contractBySection[first.id].id : 'none',
    bySection,
    boundaries,
  };
}
