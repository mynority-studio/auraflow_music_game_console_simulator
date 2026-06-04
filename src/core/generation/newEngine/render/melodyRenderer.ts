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
import { developBar, pickGrammarName, type DevNote } from '../knowledge/grammarLibrary';
import { guideToneMidi } from '../knowledge/guideTonePolicies';
import { nearestInScale } from '../knowledge/modes';
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

function spanAtBeat(plan: HarmonicPlan, beat: number): ChordSpan | undefined {
  return plan.chordTimeline.find(
    (c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats,
  );
}

/**
 * pc 收口到该和弦的【安全集 = chord-scale 去 avoid】:
 *   - 落 avoid(如 maj 的 4 度)→ snap;
 *   - 落 chord-scale 之外(离调,尤其 borrowed/副属/转调段的非调内音)→ 也 snap。
 * 就近到安全集成员(保 pc-distance 最近)。安全集空才退回原样(罕见)。
 * ★ 让旋律真正贴【当前和弦的调式音阶】,不止贴 key —— 修 Auditor 抓出的离调暴露。
 */
function safePc(pc: number, plan: HarmonicPlan, span: ChordSpan | undefined): number {
  if (!span) return pc;
  const avoid = (plan.avoidNoteMap[span.id] ?? []) as readonly number[];
  const scale = (plan.chordScaleMap[span.id] ?? []) as readonly number[];
  const inScale = scale.length === 0 || scale.includes(pc as never);
  if (!avoid.includes(pc) && inScale) return pc; // 已安全
  const safeSet = (scale.length > 0 ? scale.filter((p) => !avoid.includes(p)) : (plan.stableToneMap[span.id] ?? [])) as readonly number[];
  if (safeSet.length === 0) return pc;
  return [...safeSet].sort((a, b) => pcDistance(a, pc) - pcDistance(b, pc))[0];
}

export function renderMelody(
  anchorPlan: MelodyAnchorPlan,
  store: MotifStore,
  plan: HarmonicPlan,
  arrangement: ArrangementPlan,
  band: BandSpec,
  timebase: Timebase,
  candidateSwap?: CandidateSwap,
  restatementOverride?: Record<string, number>, // 撞音阶梯 rung2:binding 降锁上限
): TrackIR {
  const starts = phraseStartBeats(arrangement);
  const bpb = beatsPerBarOf(arrangement.meter);
  const phraseById = new Map(arrangement.phrases.map((p) => [p.id, p]));
  const notes: NoteIR[] = [];

  // 选音收口:modal regime → 逐和弦约束松,只约束在全局 primaryScale(自由跑音阶 = 色彩);
  //           tonal → 落 avoid 就近 snap 到该和弦 stable tone。
  const isModal = band.tonalityKind === 'modal';
  const resolvePc = (rawPc: number, span: ChordSpan | undefined): number =>
    isModal ? nearestInScale(mod12(rawPc), band.primaryScale) : safePc(rawPc, plan, span);

  for (const entry of anchorPlan.entries) {
    const phrase = phraseById.get(entry.phraseId);
    if (!phrase) continue;
    const cand = resolveEffectiveCandidate(entry.bindingId, store, candidateSwap);
    const motif = store.motifs[cand.motifId];
    if (!motif) continue;

    // ★ 转调:该段落实际调中心(modulationMap)→ 旋律级数解析 + head 整体移调,随和声一起升 key
    const secKey = plan.modulationMap[phrase.sectionId]?.toKey ?? band.key;
    const keyOffset = mod12(secKey - band.key);

    const pool = store.bindingCandidates[entry.bindingId];
    // head 音:强档拷贝参照候选,否则用自身锚点
    //   ★ 撞音阶梯 rung2 降锁:restatementOverride 给该 binding 设锁档上限 → 跌破 STRONG 即放开刚性复述
    const effStrength =
      restatementOverride?.[entry.bindingId] !== undefined
        ? Math.min(entry.effectiveRestatementStrength, restatementOverride[entry.bindingId])
        : entry.effectiveRestatementStrength;
    let headPitch: Midi = cand.anchorPitches[0].pitch;
    if (effStrength >= STRONG && pool.referenceBindingId) {
      const ref = resolveEffectiveCandidate(pool.referenceBindingId, store, candidateSwap);
      if (ref.realization.pitches.length > 0) headPitch = ref.realization.pitches[0].pitch;
    }
    if (keyOffset !== 0) headPitch = midi((headPitch + keyOffset)) as Midi; // hook 整体随调中心移

    const phraseStart = starts[phrase.id] ?? 0;
    const breath = arrangement.phraseBreathing.cadenceBreathBeats;
    const grammarName = pickGrammarName(motif.id); // 由 motifId 选变体 grammar(不同 motif 不同发展)
    const baseDev: DevNote[] = motif.noteSlots.map((s) => ({
      scaleDegree: s.scaleDegree,
      timeOffset: s.timeOffset,
      duration: s.duration,
    }));
    // ★ 轮廓弧线:音区随段落能量抬升,高潮段再加峰(pc 不变,只移八度 → 安全)
    const energy = arrangement.energyBySection[phrase.sectionId] ?? 0.5;
    const isClimax = arrangement.climaxMap.some((c) => c.sectionId === phrase.sectionId);
    const lift = Math.min(14, Math.round(energy * 8) + (isClimax ? 3 : 0));
    const leadLow = LEAD_LOW + lift;
    const leadHigh = leadLow + (LEAD_HIGH - LEAD_LOW);

    // ★ 连接/终止句(非 hook)→ GuideTone 线:贴和弦 3/7,voice-led,sparse(一弦一音),
    //   authentic 终止落 3 音解决。与 busy 的 hook 句形成对比。
    if (phrase.skeletonRole !== 'hook') {
      const phraseEnd = phraseStart + phrase.bars * bpb;
      const phraseChords = plan.chordTimeline.filter(
        (c) => c.startBeat < phraseEnd && c.startBeat + c.durationBeats > phraseStart,
      );
      let prev = leadLow; // 连接句坐在音区低端(从属于 hook)
      phraseChords.forEach((c, idx) => {
        const noteBeat = Math.max(phraseStart, c.startBeat);
        if (noteBeat >= phraseEnd - breath) return; // 句尾呼吸
        const isLast = idx === phraseChords.length - 1;
        const forceThird = isLast && phrase.cadenceTarget === 'authentic';
        const gt = guideToneMidi(c.rootPc, c.quality, prev, leadLow, leadHigh, forceThird);
        prev = gt;
        const noteEnd = Math.min(phraseEnd - (isLast ? breath : 0), c.startBeat + c.durationBeats);
        const dur = Math.max(0.5, noteEnd - noteBeat);
        notes.push({
          pitch: midi(gt),
          startTick: timebase.beatToTick(beats(noteBeat)),
          durationTicks: timebase.beatToTick(beats(dur)),
          velocity: 84,
        });
      });
      continue;
    }

    // hook 句:motif 逐小节 grammar 发展;末小节稀疏解决 + 句尾呼吸(留白)
    for (let bar = 0; bar < phrase.bars; bar++) {
      const barStart = phraseStart + bar * bpb;
      const isLastBar = bar === phrase.bars - 1;

      if (isLastBar && phrase.bars > 1) {
        // 句尾:单长音解决(cadence 句落主音,其余回锚点)+ 末 breath 拍留白
        // ★ 长音必须贴当前和弦安全音(否则主音落属和弦=avoid 11,长暴露被 Auditor 拦)
        const rawPc =
          phrase.role === 'cadence'
            ? mod12(secKey + degreeToSemitone(1, band.mode))
            : mod12(headPitch);
        const pc = resolvePc(rawPc, spanAtBeat(plan, barStart));
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

      // ★ grammar 变体:逐小节按 grammar 发展(transform/divide/development),取代手搓常数
      const devNotes = developBar(baseDev, grammarName, bar);
      devNotes.forEach((dn, i) => {
        const noteBeat = barStart + dn.timeOffset;
        let pitch: Midi;
        if (i === 0 && bar === 0) {
          // hook head 锚点(置入弧线音区);modal 下也收进 primaryScale
          const headPc = isModal ? nearestInScale(mod12(headPitch), band.primaryScale) : mod12(headPitch);
          pitch = pcToMidiInRange(headPc, leadLow, leadHigh);
        } else {
          const rawPc = mod12(secKey + degreeToSemitone(dn.scaleDegree, band.mode));
          const pc = resolvePc(rawPc, spanAtBeat(plan, noteBeat));
          pitch = pcToMidiInRange(pc, leadLow, leadHigh);
        }
        notes.push({
          pitch,
          startTick: timebase.beatToTick(beats(noteBeat)),
          durationTicks: timebase.beatToTick(beats(dn.duration)),
          velocity: 95,
        });
      });
    }
  }

  return { role: 'lead', notes };
}
