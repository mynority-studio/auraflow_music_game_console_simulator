// ============================================================
// newEngine · arranger · LOFI Phrase Interaction Planner
// ------------------------------------------------------------
// Compiles one shared ensemble sentence before any instrument emits notes.
// LOFI's selected eight-bar blueprint owns statement/variation/rest/return;
// this plan adds Comp/Bass/Drum response and stable pocket relationships.
// ============================================================

import type {
  LofiPhraseArcPhase,
  LofiPhraseBarInteraction,
  LofiPhraseInteractionPlan,
  LofiLeadPresencePlan,
  MotifBinding,
  Phrase,
  Section,
} from './ArrangementPlan';
import type { LofiLeadPhraseBlueprint } from '../knowledge/lofiLeadPhraseBlueprints';

const ARC_PHASES: readonly LofiPhraseArcPhase[] = ['settle', 'grow', 'crest', 'release'];

const BASE_SCALE_BY_PHASE: Readonly<Record<LofiPhraseArcPhase, number>> = {
  settle: 0.95,
  grow: 1,
  crest: 1.06,
  release: 0.91,
};

export function planLofiPhraseInteraction(args: {
  sections: readonly Section[];
  phrases: readonly Phrase[];
  motifBindings: readonly MotifBinding[];
  leadPresence: Readonly<LofiLeadPresencePlan>;
  leadBlueprint?: Readonly<LofiLeadPhraseBlueprint>;
  phraseBars: number;
  /** Metric input from Arranger; LOFI normally writes the answer at beat 2. */
  beatsPerBar?: number;
}): LofiPhraseInteractionPlan {
  const phraseBars = Math.max(2, Math.round(args.phraseBars));
  const beatsPerBar = Math.max(2, args.beatsPerBar ?? 4);
  // The late half-bar answer leaves the lead-rest downbeat audible, then
  // offers a clear middle-register reply before the next lead entrance.
  const compAnswerEntryBeat = Math.max(1.5, Math.min(beatsPerBar - 0.5, beatsPerBar * 0.5));
  const phraseBySectionSlot = new Map(
    args.phrases.map((phrase) => [`${phrase.sectionId}:${phrase.phraseSlot}`, phrase]),
  );
  const motifByPhrase = new Map(
    args.motifBindings.map((binding) => [binding.phraseId, binding.motifId]),
  );
  const bySection: Record<string, LofiPhraseBarInteraction[]> = {};
  const bars: LofiPhraseBarInteraction[] = [];
  let absoluteBar = 0;

  for (const section of args.sections) {
    const active = new Set(args.leadPresence.activeBarsBySection[section.id] ?? []);
    const sectionBars: LofiPhraseBarInteraction[] = [];
    for (let barInSection = 0; barInSection < section.bars; barInSection++) {
      const phraseBarIndex = barInSection % phraseBars;
      const arcPhase = ARC_PHASES[phraseBarIndex % ARC_PHASES.length] ?? 'settle';
      const phraseSlot = Math.floor(barInSection / phraseBars);
      const phrase = phraseBySectionSlot.get(`${section.id}:${phraseSlot}`);
      const motifId = section.functionTag === 'loop'
        ? `m-${section.repeatGroup ?? section.id}-lofi-answer`
        : phrase ? motifByPhrase.get(phrase.id) : undefined;
      const leadIsActive = active.has(barInSection);
      const previousIsActive = active.has(barInSection - 1);
      const nextIsActive = active.has(barInSection + 1);
      const answerWindow = !leadIsActive && previousIsActive && nextIsActive;
      const cycleBars = args.leadBlueprint?.cycleBars ?? 8;
      const activePosition = ((barInSection % cycleBars) + cycleBars) % cycleBars;
      const blueprintRole = args.leadBlueprint?.roleByCycleBar[activePosition];
      const leadRole = !leadIsActive
        ? 'rest'
        : blueprintRole && blueprintRole !== 'rest'
          ? blueprintRole
          : activePosition === 4
          ? 'statement'
          : activePosition === 5
            ? 'variation'
            : activePosition === 7
              ? 'return'
              : previousIsActive ? 'variation' : 'statement';
      const compRole = leadIsActive ? 'support' : answerWindow ? 'answer' : 'bed';
      const bassRole = leadIsActive ? 'lock' : answerWindow ? 'release' : 'anchor';
      const drumRole = answerWindow ? 'answer' : leadRole === 'return' ? 'settle' : 'core';
      const tensionIntent = leadRole === 'return'
        ? 'resolve'
        : leadRole === 'variation'
          ? 'build'
          : answerWindow || leadRole === 'statement'
            ? 'open'
            : 'stable';
      const base = BASE_SCALE_BY_PHASE[arcPhase];
      const interaction: LofiPhraseBarInteraction = {
        sectionId: section.id,
        barInSection,
        absoluteBar: absoluteBar + barInSection,
        phraseId: phrase?.id,
        motifId,
        phraseBarIndex,
        arcPhase,
        leadRole,
        compRole,
        ...(compRole === 'answer' ? { compAnswerEntryBeat } : {}),
        bassRole,
        drumRole,
        tensionIntent,
        velocityScaleByRole: {
          lead: leadRole === 'rest' ? 1 : leadRole === 'variation' ? base * 1.03 : leadRole === 'return' ? base * 0.98 : base,
          comp: compRole === 'support' ? base * 0.82 : compRole === 'answer' ? base * 1.06 : base * 0.96,
          bass: bassRole === 'release' ? base * 0.94 : base,
          drum: drumRole === 'answer' ? base * 1.04 : drumRole === 'settle' ? base * 0.96 : base,
        },
      };
      sectionBars.push(interaction);
      bars.push(interaction);
    }
    bySection[section.id] = sectionBars;
    absoluteBar += section.bars;
  }

  return {
    phraseBars,
    bars,
    bySection,
    pocket: {
      kickAnchorMs: 0,
      kickOffbeatMs: -5,
      snareDragMs: 20,
      hatOnbeatMs: 1,
      hatOffbeatMs: 10,
    },
  };
}
