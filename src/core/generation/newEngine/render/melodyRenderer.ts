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

import { beats, midi, mod12, pc, type Midi, type Timebase } from '../foundation';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { beatsPerBarOf, phraseStartBeats } from '../arranger/phraseTiming';
import { degreeToSemitone } from '../knowledge/scales';
import { pcToMidiInRange, pcDistance } from '../knowledge/pitchPlacement';
import { developBar, pickGrammarName, type DevNote } from '../knowledge/grammarLibrary';
import { guideToneMidi } from '../knowledge/guideTonePolicies';
import { nearestInScale } from '../knowledge/modes';
import { chordContractPcs, chordScalePcs, admitNoteByContract } from './harmonicContract';
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
 * 拍位强弱(合同 gate 用):主拍(downbeat / 半小节)或长音(≥1 拍)= 强 → 须落合同;
 * 其余(弱拍、短音、off-beat)= 弱 → 容许级内/半音经过装饰。
 */
function isWeakBeatPos(beatInBar: number, bpb: number, duration: number): boolean {
  const onStrong = beatInBar === 0 || (bpb % 2 === 0 && beatInBar === bpb / 2);
  return !(onStrong || duration >= 1);
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

  // 选音收口:和声合同 gate(方向A,和弦 ⊥ 音阶三档)——
  //   tonal:① 合同(stable∪color)=强拍自由 ② 音阶内非和弦=弱拍/经过/邻音 ③ 半音=严;
  //          rejected → 就近 snap 到合同音(保音区)。modal:合同=整 mode → 自由贴 primaryScale。
  const isModal = band.tonalityKind === 'modal';
  const resolveGated = (
    rawMidi: number, span: ChordSpan | undefined, low: number, high: number,
    isWeakBeat: boolean, prevMidi?: number, nextMidi?: number,
  ): number => {
    if (isModal) return pcToMidiInRange(nearestInScale(mod12(rawMidi), band.primaryScale), low, high);
    if (!span) return rawMidi;
    const contract = chordContractPcs(plan, span.id);
    const scale = chordScalePcs(plan, span.id);
    if (admitNoteByContract({ noteMidi: rawMidi, chordContract: contract, scale, isWeakBeat, prevMidi, nextMidi }).admit) return rawMidi;
    const rawPc = mod12(rawMidi);
    let bestPc = rawPc as number;
    let bestD = 99;
    for (const p of contract) { const d = pcDistance(pc(p), rawPc); if (d < bestD) { bestD = d; bestPc = p; } }
    return pcToMidiInRange(pc(bestPc), low, high);
  };

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
    let prevMelodyMidi: number | undefined; // 同句旋律前一音(经过/邻音判定的"前")
    for (let bar = 0; bar < phrase.bars; bar++) {
      const barStart = phraseStart + bar * bpb;
      const isLastBar = bar === phrase.bars - 1;

      if (isLastBar && phrase.bars > 1) {
        // 句尾:单长音解决(cadence 句落主音,其余回锚点)+ 末 breath 拍留白
        // ★ 长音=强 → 必须落合同(gate isWeakBeat=false,非合同就近 snap 合同音)
        const rawPc =
          phrase.role === 'cadence'
            ? mod12(secKey + degreeToSemitone(1, band.mode))
            : mod12(headPitch);
        const rawMidi = pcToMidiInRange(rawPc, leadLow, leadHigh);
        const pitch = midi(resolveGated(rawMidi, spanAtBeat(plan, barStart), leadLow, leadHigh, false));
        prevMelodyMidi = pitch;
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
          // hook head 锚点 = motif 记忆点身份音,不走 gate(跨段一致性优先);modal 收进 primaryScale
          const headPc = isModal ? nearestInScale(mod12(headPitch), band.primaryScale) : mod12(headPitch);
          pitch = pcToMidiInRange(headPc, leadLow, leadHigh);
        } else {
          // ★ 和声合同 gate:强拍/长音落合同,弱拍/经过/邻音容许级内/半音短音(读相对音阶)
          const rawMidi = pcToMidiInRange(mod12(secKey + degreeToSemitone(dn.scaleDegree, band.mode)), leadLow, leadHigh);
          const nextDn = devNotes[i + 1];
          const nextMidi = nextDn ? pcToMidiInRange(mod12(secKey + degreeToSemitone(nextDn.scaleDegree, band.mode)), leadLow, leadHigh) : undefined;
          const isWeak = isWeakBeatPos(dn.timeOffset, bpb, dn.duration);
          pitch = midi(resolveGated(rawMidi, spanAtBeat(plan, noteBeat), leadLow, leadHigh, isWeak, prevMelodyMidi, nextMidi));
        }
        prevMelodyMidi = pitch;
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
