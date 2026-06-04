// ============================================================
// newEngine · render · MelodyRenderer(Slice 1)
// ------------------------------------------------------------
// 架构定稿 Part 8.4 / 铁律12:从 MotifStore 实化 lead 声部。
//   锁深度 = f(effectiveRestatementStrength):
//     强 → head 拷贝 referenceBindingId 的有效候选 realization(跨段一致 = 记忆点)
//     中/弱 → head 用自身候选锚点;tail 用 motif scaleDegree 按当前和弦实化
//   tail 注音 chord-aware:落 avoid 则就近 snap 到 stable tone(保证 Auditor 干净)。
// Slice 1:motif 每小节复述填满 phrase;真 grammar 变体 / GuideTone tail 后续接。
// ============================================================

import { beats, midi, mod12, type Midi, type Timebase } from '../foundation';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { beatsPerBarOf, phraseStartBeats } from '../arranger/phraseTiming';
import { degreeToSemitone } from '../knowledge/scales';
import { pcToMidiInRange, pcDistance } from '../knowledge/pitchPlacement';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { MelodyAnchorPlan } from './MelodyAnchorPlan';
import {
  resolveEffectiveCandidate,
  type CandidateSwap,
  type MotifStore,
} from './MotifStore';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

const LEAD_LOW = 67;
const LEAD_HIGH = 84;
const STRONG = 0.67;
const DEV_STEPS = [0, 2, -1, 1]; // 逐小节模进偏移(scale step)→ 旋律发展,不原样重播

function wrapDegree(d: number): number {
  return (((d - 1) % 7) + 7) % 7 + 1; // → 1..7
}

function spanAtBeat(plan: HarmonicPlan, beat: number): ChordSpan | undefined {
  return plan.chordTimeline.find(
    (c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats,
  );
}

/** pc 落 avoid → 就近 snap 到该和弦 stable tone;否则原样。 */
function safePc(pc: number, plan: HarmonicPlan, span: ChordSpan | undefined): number {
  if (!span) return pc;
  const avoid = (plan.avoidNoteMap[span.id] ?? []) as readonly number[];
  if (!avoid.includes(pc)) return pc;
  const stable = (plan.stableToneMap[span.id] ?? []) as readonly number[];
  if (stable.length === 0) return pc;
  return [...stable].sort((a, b) => pcDistance(a, pc) - pcDistance(b, pc))[0];
}

export function renderMelody(
  anchorPlan: MelodyAnchorPlan,
  store: MotifStore,
  plan: HarmonicPlan,
  arrangement: ArrangementPlan,
  band: BandSpec,
  timebase: Timebase,
  candidateSwap?: CandidateSwap,
): TrackIR {
  const starts = phraseStartBeats(arrangement);
  const bpb = beatsPerBarOf(arrangement.meter);
  const phraseById = new Map(arrangement.phrases.map((p) => [p.id, p]));
  const notes: NoteIR[] = [];

  for (const entry of anchorPlan.entries) {
    const phrase = phraseById.get(entry.phraseId);
    if (!phrase) continue;
    const cand = resolveEffectiveCandidate(entry.bindingId, store, candidateSwap);
    const motif = store.motifs[cand.motifId];
    if (!motif) continue;

    const pool = store.bindingCandidates[entry.bindingId];
    // head 音:强档拷贝参照候选,否则用自身锚点
    let headPitch: Midi = cand.anchorPitches[0].pitch;
    if (entry.effectiveRestatementStrength >= STRONG && pool.referenceBindingId) {
      const ref = resolveEffectiveCandidate(pool.referenceBindingId, store, candidateSwap);
      if (ref.realization.pitches.length > 0) headPitch = ref.realization.pitches[0].pitch;
    }

    const phraseStart = starts[phrase.id] ?? 0;
    const breath = arrangement.phraseBreathing.cadenceBreathBeats;
    // ★ 轮廓弧线:音区随段落能量抬升,高潮段再加峰(pc 不变,只移八度 → 安全)
    const energy = arrangement.energyBySection[phrase.sectionId] ?? 0.5;
    const isClimax = arrangement.climaxMap.some((c) => c.sectionId === phrase.sectionId);
    const lift = Math.min(14, Math.round(energy * 8) + (isClimax ? 3 : 0));
    const leadLow = LEAD_LOW + lift;
    const leadHigh = leadLow + (LEAD_HIGH - LEAD_LOW);

    // motif 逐小节【发展】;末小节稀疏解决 + 句尾呼吸(留白),非每小节填满
    for (let bar = 0; bar < phrase.bars; bar++) {
      const barStart = phraseStart + bar * bpb;
      const isLastBar = bar === phrase.bars - 1;

      if (isLastBar && phrase.bars > 1) {
        // 句尾:单长音解决(cadence 句落主音,其余回锚点)+ 末 breath 拍留白
        // ★ 长音必须贴当前和弦安全音(否则主音落属和弦=avoid 11,长暴露被 Auditor 拦)
        const rawPc =
          phrase.role === 'cadence'
            ? mod12(band.key + degreeToSemitone(1, band.mode))
            : mod12(headPitch);
        const pc = safePc(rawPc, plan, spanAtBeat(plan, barStart));
        const pitch = pcToMidiInRange(pc, leadLow, leadHigh);
        const dur = Math.max(0.5, bpb - breath);
        notes.push({
          pitch,
          startTick: timebase.beatToTick(beats(barStart)),
          durationTicks: timebase.beatToTick(beats(dur)),
          velocity: 88,
        });
        continue;
      }

      const devStep = DEV_STEPS[bar % DEV_STEPS.length];
      motif.noteSlots.forEach((slot, i) => {
        const noteBeat = barStart + slot.timeOffset;
        let pitch: Midi;
        if (i === 0 && bar === 0) {
          pitch = pcToMidiInRange(mod12(headPitch), leadLow, leadHigh); // hook head 锚点(置入弧线音区,pc 不变)
        } else {
          const deg = wrapDegree(slot.scaleDegree + devStep);
          const rawPc = mod12(band.key + degreeToSemitone(deg, band.mode));
          const pc = safePc(rawPc, plan, spanAtBeat(plan, noteBeat));
          pitch = pcToMidiInRange(pc, leadLow, leadHigh);
        }
        notes.push({
          pitch,
          startTick: timebase.beatToTick(beats(noteBeat)),
          durationTicks: timebase.beatToTick(slot.duration),
          velocity: 95,
        });
      });
    }
  }

  return { role: 'lead', notes };
}
