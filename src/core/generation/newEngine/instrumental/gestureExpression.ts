// ============================================================
// newEngine · instrumental · Gesture Expression Plan
// ------------------------------------------------------------
// 器配层拥有"这件乐器如何被演奏"的计划:萨克斯/吹奏类不是 render 末端猜 GM 号,
// 而是由最终 program 生成手势表情计划,render 只按计划投影 NoteIR + MIDI CC。
// ============================================================

import { ticks, type Timebase, type Ticks } from '../foundation';
import type { InstrumentRoleName } from '../band/BandSpec';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { instrumentInfo, isSustainedInstrument } from '../knowledge/instruments';
import { isAcgPianoSongPianoProgram, isAcousticPianoProgram } from '../../../sound/GMBK5X128Voices';
import { dreamVoiceCcProfile, mayEmitAutomaticCc } from './dreamCcCapabilities';
import {
  buildSaxBreathCcEvents,
  isSaxProgram,
  SAX_CC,
  shapeSaxLegatoNotes,
  type SaxExpressionOptions,
  type SaxPitchBendEvent,
} from './saxExpression';
import type {
  GestureArticulationScope,
  GestureArticulationExclusionGroup,
  GestureContinuity,
  GestureEvidenceRef,
  GestureExpressionPlan,
  GesturePhrasePolicy,
  GestureTriggerPolicy,
  TailPolicy,
} from './InstrumentationPlan';

export interface GestureCcEvent {
  atTick: Ticks;
  controller: number;
  value: number;
}

export interface WindBreathOptions {
  breathMinBeats?: number;
  steps?: number;
}

const CC_EXPRESSION = 11;
const FULL = 112;
const SOFT = 88;
const TAPER_FRACTION = 0.4;
const TAPER_CAP_BEATS = 0.9;
const TAPER_STEPS = 6;
const DRUM_SNARE = 38;
const DRUM_SIDE_STICK = 37;
const DRUM_CHAT = 42;
const DRUM_OHAT = 46;
const DRUM_RIDE = 51;
const DRUM_PHAT = 44;
const DRUM_RIDE_BELL = 53;
const GUITAR_COMP_MAX_BEATS = 0.28;
const GUITAR_COMP_SINGLE_MAX_BEATS = 0.34;
const GUITAR_COMP_RELEASE_GAP_BEATS = 0.045;
const GUITAR_COMP_VELOCITY_CAP = 84;

type GestureContractFields = Pick<
  GestureExpressionPlan,
  'continuity' | 'articulationScope' | 'articulationExclusionGroup' | 'triggerPolicy' | 'phrasePolicy' | 'evidenceRefs'
>;

const evidence = (...refs: GestureEvidenceRef[]): readonly GestureEvidenceRef[] => refs;
const DAW_EVIDENCE = evidence('logic-articulation-set', 'cubase-expression-map');
const MIDI_EVIDENCE = evidence('logic-articulation-set', 'cubase-expression-map', 'midi-cc-table');
const SAX_EVIDENCE = evidence(
  'logic-articulation-set',
  'logic-studio-horns-keyswitch',
  'cubase-expression-map',
  'midi-cc-table',
  'sax-jazz-legato-tonguing',
  'sax-light-airflow-tonguing',
);
const STRING_EVIDENCE = evidence(
  'logic-articulation-set',
  'logic-studio-strings-keyswitch',
  'cubase-expression-map',
  'vsl-legato-overlap',
);

function contract(
  continuity: GestureContinuity,
  articulationScope: GestureArticulationScope,
  triggerPolicy: GestureTriggerPolicy,
  phrasePolicy: GesturePhrasePolicy,
  evidenceRefs: readonly GestureEvidenceRef[],
): GestureContractFields {
  const articulationExclusionGroup: GestureArticulationExclusionGroup =
    phrasePolicy === 'breath-group' ? 'breath'
    : phrasePolicy === 'rudiment-bar' ? 'rudiment'
    : triggerPolicy === 'pedal-cc' ? 'pedal'
    : continuity === 'staccato' || continuity === 'connected' || continuity === 'legato-flow' ? 'length'
    : 'none';
  return { continuity, articulationScope, articulationExclusionGroup, triggerPolicy, phrasePolicy, evidenceRefs };
}

const NONE_GESTURE: GestureExpressionPlan = {
  kind: 'none',
  family: 'none',
  ccControllers: [],
  ...contract('none', 'none', 'none', 'none', []),
  breathModel: 'none',
  noteShape: 'none',
  articulation: 'none',
  velocityCurve: 'none',
  pedalPolicy: 'none',
  rudimentPolicy: 'none',
  hiHatPolicy: 'none',
};

/** GM Pipe 家族(72-79):长笛/排箫/尺八/口哨/陶笛等气声管乐。 */
export function isPipeWindProgram(program: number): boolean {
  return program >= 72 && program <= 79;
}

/** GM 电钢:GM4 Electric Piano 1(Rhodes)· GM5 当前 Aura25 Electric Grand 槽位。需 electric-key-tail(尾音靠演奏,不靠 reverb)。 */
export function isElectricKeyProgram(program: number): boolean {
  return program === 4 || program === 5;
}

const ELECTRIC_KEY_LEAD_CONNECT_BEATS = 2.25; // electric-key lead:短 gate 延到下一音前,release 只做尾巴不是主体。

export function gestureExpressionForProgram(
  role: InstrumentRoleName,
  program: number | undefined,
  style = 'default',
): GestureExpressionPlan {
  if (program === undefined) return NONE_GESTURE;
  const s = style.toLowerCase();
  const info = instrumentInfo(program);

  if (role === 'drum') {
    const jazz = s === 'jazz';
    const lofi = s === 'lofi';
    const rnb = s === 'rnb';
    return {
      kind: 'drum-rudiment',
      family: 'drum',
      program,
      ccControllers: [],
      ...contract('staccato', 'attribute', 'rudiment-velocity', 'rudiment-bar', DAW_EVIDENCE),
      breathModel: 'none',
      noteShape: 'rudiment-hits',
      articulation: jazz ? 'roll' : 'ghost',
      velocityCurve: jazz ? 'walking-pulse' : rnb || lofi ? 'ghosted' : 'accented',
      pedalPolicy: 'none',
      rudimentPolicy: jazz ? 'ride-swing' : lofi ? 'lofi-dusty' : rnb ? 'laidback-ghost' : 'backbeat-ghost',
      hiHatPolicy: jazz ? 'ride-swing' : lofi ? 'dusty-closed' : rnb ? 'laidback-closed' : 'closed-open-lift',
      gateRatio: 0.25,
    };
  }

  // ACG 白名单钢琴 bass 是左手键盘触键，不套贝斯拨弦/ghost 手势；低音区由器配 register + render 末端范围保护。
  if (role === 'bass' && (isAcgPianoSongPianoProgram(program) || (s === 'acg' && isAcousticPianoProgram(program)))) {
    return {
      kind: 'keyboard-touch',
      family: 'keyboard',
      program,
      ccControllers: [],
      ...contract('connected', 'direction', 'velocity-gate', 'none', DAW_EVIDENCE),
      breathModel: 'none',
      noteShape: 'finger-legato',
      articulation: 'finger-legato',
      velocityCurve: 'soft',
      pedalPolicy: 'none',
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      gateRatio: 0.96,
      tailPolicy: 'keyboard-natural',
    };
  }

  // Contrabass is a bowed string even when it fulfils the bass role. Do not
  // give it the electric/acoustic bass pluck grammar.
  if ((program >= 40 && program <= 43) && (role === 'lead' || (role === 'bass' && program === 43))) {
    const ccProfile = dreamVoiceCcProfile(program, role);
    return {
      kind: 'bowed-string-legato',
      family: 'bowed-string',
      program,
      ccControllers: ccProfile.automaticControllers,
      ...contract('legato-flow', 'direction', 'note-overlap', 'bow-group', STRING_EVIDENCE),
      breathModel: 'none',
      noteShape: 'bow-legato',
      articulation: 'slur',
      velocityCurve: 'soft',
      pedalPolicy: 'none',
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      maxConnectBeats: 1.15,
      overlapBeats: 0.02,
      gateRatio: 1,
    };
  }

  if (role === 'bass' || info.family === 'bass') {
    if (s === 'jazz' && program === 32) {
      return {
        kind: 'bass-walk',
        family: 'bass',
        program,
        ccControllers: [],
        ...contract('connected', 'direction', 'velocity-gate', 'pluck-voice', DAW_EVIDENCE),
        breathModel: 'none',
        noteShape: 'bass-legato',
        articulation: 'walking',
        velocityCurve: 'walking-pulse',
        pedalPolicy: 'none',
        rudimentPolicy: 'none',
        hiHatPolicy: 'none',
        bassTechniques: ['walking', 'approach-tone', 'legato'],
        gateRatio: 0.96,
      };
    }
    const muted = s === 'lofi';
    return {
      kind: muted ? 'bass-muted' : 'bass-pluck-legato',
      family: 'bass',
      program,
      ccControllers: [],
      ...contract(muted ? 'staccato' : 'connected', muted ? 'attribute' : 'direction', 'velocity-gate', 'pluck-voice', DAW_EVIDENCE),
      breathModel: 'none',
      noteShape: muted ? 'bass-muted' : 'bass-legato',
      articulation: muted ? 'staccato' : 'tenuto',
      velocityCurve: muted ? 'soft' : s === 'rnb' ? 'ghosted' : 'accented',
      pedalPolicy: 'none',
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      bassTechniques: muted ? ['muted', 'ghost-note'] : s === 'rnb' ? ['pluck', 'legato', 'ghost-note', 'slide'] : ['pluck', 'legato'],
      gateRatio: muted ? 0.72 : s === 'rnb' ? 0.94 : 0.88,
    };
  }

  if (isSaxProgram(program) && role === 'lead') {
    const ccProfile = dreamVoiceCcProfile(program, role);
    return {
      kind: 'sax-breath-legato',
      family: 'sax',
      program,
      // CC11 is documented as channel expression by Dream. CC2 is only a
      // generic Breath Controller number and remains blocked until this exact
      // GMBK voice is explicitly mapped and auditioned on the hardware.
      ccControllers: ccProfile.automaticControllers,
      ...contract('legato-flow', 'direction', 'cc-lane', 'breath-group', SAX_EVIDENCE),
      breathModel: 'reed-continuous',
      noteShape: 'keyed-legato',
      articulation: 'slur',
      velocityCurve: 'soft',
      pedalPolicy: 'none',
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      maxConnectBeats: 1.1,
      overlapBeats: 0.02,
      gateRatio: 1,
      tailPolicy: 'wind-breath',
    };
  }
  if (isPipeWindProgram(program) && role === 'lead') {
    return {
      kind: 'pipe-wind-breath',
      family: 'pipe-wind',
      program,
      ccControllers: [CC_EXPRESSION],
      ...contract('connected', 'direction', 'cc-lane', 'breath-group', MIDI_EVIDENCE),
      breathModel: 'pipe-taper',
      noteShape: 'none',
      articulation: 'slur',
      velocityCurve: 'soft',
      pedalPolicy: 'none',
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      maxConnectBeats: 1.1,
      gateRatio: 0.98,
    };
  }

  if (info.family === 'keyboard' && isSustainedInstrument(program)) {
    return {
      kind: 'sustained-pad',
      family: 'pad',
      program,
      ccControllers: [],
      ...contract('legato-flow', 'direction', 'velocity-gate', 'sustain-bed', DAW_EVIDENCE),
      breathModel: 'none',
      noteShape: 'sustain-pad',
      articulation: 'tenuto',
      velocityCurve: 'soft',
      pedalPolicy: 'none',
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      gateRatio: 1,
    };
  }

  if (info.family === 'keyboard') {
    const comp = role === 'comp';
    const electricKey = isElectricKeyProgram(program);
    // Pedal is now a concrete section plan owned by InstrumentationPlan.
    // Never infer it from a style/program in this per-role static gesture.
    const pedalPolicy = 'none';
    // The note-tail shape remains valid for electric keys. CC72/CC74 values
    // are explicitly audition-required in dreamCcCapabilities, so they are
    // not auto-emitted until a board-calibrated mapping exists.
    const tailPolicy: TailPolicy = electricKey ? 'electric-key-tail' : 'keyboard-natural';
    const continuity: GestureContinuity = 'connected';
    const triggerPolicy: GestureTriggerPolicy = 'velocity-gate';
    const phrasePolicy: GesturePhrasePolicy = 'none';
    return {
      kind: 'keyboard-touch',
      family: 'keyboard',
      program,
      ccControllers: [],
      ...contract(continuity, 'direction', triggerPolicy, phrasePolicy, DAW_EVIDENCE),
      breathModel: 'none',
      noteShape: 'finger-legato',
      articulation: comp ? 'comping' : 'finger-legato',
      velocityCurve: electricKey || s === 'acg' ? 'soft' : s === 'jazz' ? 'walking-pulse' : 'accented',
      pedalPolicy,
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      gateRatio: comp ? (s === 'jazz' ? 0.72 : 0.9) : 0.98,
      tailPolicy,
    };
  }

  if (info.family === 'guitar') {
    const comp = role === 'comp';
    return {
      kind: 'guitar-pick-voice',
      family: 'guitar',
      program,
      ccControllers: [],
      ...contract('connected', 'direction', 'velocity-gate', 'pick-voice', DAW_EVIDENCE),
      breathModel: 'none',
      noteShape: 'guitar-pick',
      articulation: comp ? 'comping' : 'picked',
      velocityCurve: s === 'rnb' || s === 'lofi' ? 'ghosted' : 'accented',
      pedalPolicy: 'none',
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      gateRatio: comp ? (s === 'jazz' ? 0.62 : s === 'rnb' ? 0.72 : 0.78) : 0.94,
      tailPolicy: 'pluck-short',
    };
  }

  if (info.family === 'mallet') {
    return {
      kind: 'mallet-strike',
      family: 'mallet',
      program,
      ccControllers: [],
      ...contract('staccato', 'attribute', 'velocity-gate', 'strike-decay', DAW_EVIDENCE),
      breathModel: 'none',
      noteShape: 'strike-decay',
      articulation: 'tenuto',
      velocityCurve: 'strike-decay',
      pedalPolicy: 'none',
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      gateRatio: program === 11 ? 0.9 : 0.72,
    };
  }

  if (info.family === 'pad' || info.family === 'strings') {
    return {
      kind: 'sustained-pad',
      family: 'pad',
      program,
      ccControllers: [],
      ...contract('legato-flow', 'direction', 'velocity-gate', 'sustain-bed', DAW_EVIDENCE),
      breathModel: 'none',
      noteShape: 'sustain-pad',
      articulation: 'tenuto',
      velocityCurve: 'soft',
      pedalPolicy: 'none',
      rudimentPolicy: 'none',
      hiHatPolicy: 'none',
      gateRatio: 1,
    };
  }

  return { ...NONE_GESTURE, program };
}

export function buildGestureExpressionByRole(
  roles: readonly InstrumentRoleName[],
  roleProgram: Partial<Record<InstrumentRoleName, number>>,
  style = 'default',
): Record<InstrumentRoleName, GestureExpressionPlan> {
  const out = {} as Record<InstrumentRoleName, GestureExpressionPlan>;
  for (const role of roles) out[role] = gestureExpressionForProgram(role, roleProgram[role], style);
  return out;
}

/**
 * Pipe wind 的 CC11 气口包络:每音起点 FULL,长音尾部渐弱。萨克斯不用这个模型,
 * 因为 sax 连吹时气压不应逐音 reset 到低值,由 sax-breath-legato 另行处理。
 */
export function buildPipeWindBreathCcEvents(
  notes: readonly NoteIR[],
  timebase: Timebase,
  opts: WindBreathOptions = {},
): GestureCcEvent[] {
  const ppq = timebase.ppq;
  const breathMin = Math.round((opts.breathMinBeats ?? 1.25) * ppq);
  const steps = Math.max(1, opts.steps ?? TAPER_STEPS);
  const sorted = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  const raw: GestureCcEvent[] = [];

  for (const n of sorted) {
    const start = n.startTick as number;
    const end = start + (n.durationTicks as number);
    raw.push({ atTick: ticks(start), controller: CC_EXPRESSION, value: FULL });
    const dur = end - start;
    if (dur < breathMin) continue;
    const taperLen = Math.min(Math.round(dur * TAPER_FRACTION), Math.round(ppq * TAPER_CAP_BEATS));
    const taperStart = end - taperLen;
    for (let s = 1; s <= steps; s++) {
      const frac = (s - 0.5) / steps;
      const value = Math.round(FULL + (SOFT - FULL) * frac);
      raw.push({ atTick: ticks(Math.round(taperStart + taperLen * frac)), controller: CC_EXPRESSION, value });
    }
  }

  raw.sort((a, b) => (a.atTick as number) - (b.atTick as number));
  const out: GestureCcEvent[] = [];
  for (const e of raw) {
    if (out.length && out[out.length - 1].atTick === e.atTick) out[out.length - 1] = e;
    else out.push(e);
  }
  return out;
}

function saxOptions(plan: GestureExpressionPlan, timebase: Timebase): SaxExpressionOptions {
  const ppq = timebase.ppq;
  const beatsPerBar = timebase.meter.numerator * (4 / timebase.meter.denominator);
  return {
    ppq,
    maxConnectIoiTicks: plan.maxConnectBeats === undefined ? undefined : Math.round(plan.maxConnectBeats * ppq),
    overlapTicks: plan.overlapBeats === undefined ? undefined : Math.max(1, Math.round(plan.overlapBeats * ppq)),
    phraseBoundaryTicks: Math.max(1, Math.round(beatsPerBar * ppq)),
  };
}

function clampVelocity(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}

function clampGateRatio(ratio: number | undefined): number {
  if (ratio === undefined) return 1;
  return Math.max(0.15, Math.min(1.08, ratio));
}

function withGate(notes: readonly NoteIR[], ratio: number | undefined): NoteIR[] {
  const r = clampGateRatio(ratio);
  if (Math.abs(r - 1) < 1e-6) return notes.map((n) => ({ ...n }));
  return notes.map((n) => {
    const dur = n.durationTicks as number;
    return { ...n, durationTicks: ticks(Math.max(1, Math.round(dur * r))) };
  });
}

function shapeElectricKeyLeadTailNotes(notes: readonly NoteIR[], timebase: Timebase): NoteIR[] {
  if (notes.length < 2) return notes.map((n) => ({ ...n }));
  const out = notes.map((n) => ({ ...n }));
  const order = out.map((_, i) => i).sort((a, b) => (out[a].startTick as number) - (out[b].startTick as number));
  const maxIoi = Math.round(timebase.ppq * ELECTRIC_KEY_LEAD_CONNECT_BEATS);
  for (let k = 0; k < order.length - 1; k++) {
    const i = order[k];
    const j = order[k + 1];
    const start = out[i].startTick as number;
    const nextStart = out[j].startTick as number;
    const ioi = nextStart - start;
    if (ioi <= 0 || ioi > maxIoi) continue;
    const samePitch = out[i].pitch === out[j].pitch;
    const target = samePitch ? Math.max(1, ioi - 1) : ioi;
    const current = out[i].durationTicks as number;
    out[i].durationTicks = ticks(samePitch ? Math.min(current, target) : Math.max(current, target));
  }
  return out;
}

function beatsPerBar(timebase: Timebase): number {
  return timebase.meter.numerator * (4 / timebase.meter.denominator);
}

function beatPhase(tick: number, timebase: Timebase): number {
  const bpb = beatsPerBar(timebase);
  return ((tick / timebase.ppq) % bpb + bpb) % bpb;
}

function nearBeat(phase: number, target: number): boolean {
  return Math.abs(phase - target) <= 0.11;
}

function velocityScaleForCurve(plan: GestureExpressionPlan, n: NoteIR, idx: number, timebase: Timebase): number {
  const phase = beatPhase(n.startTick as number, timebase);
  const frac = phase - Math.floor(phase);
  const onBeat = Math.min(frac, 1 - frac) < 0.09;
  const halfBar = beatsPerBar(timebase) / 2;
  switch (plan.velocityCurve) {
    case 'soft':
      return 0.9;
    case 'accented':
      return nearBeat(phase, 0) ? 1.08 : nearBeat(phase, halfBar) ? 1.03 : onBeat ? 0.98 : 0.92;
    case 'ghosted':
      return onBeat ? 0.96 : 0.74;
    case 'walking-pulse':
      return nearBeat(phase, 0) || nearBeat(phase, halfBar) ? 1.04 : idx % 2 === 0 ? 0.98 : 0.9;
    case 'strike-decay':
      return idx === 0 ? 1.04 : 0.88;
    case 'linear':
    case 'none':
    default:
      return 1;
  }
}

function withVelocityCurve(notes: readonly NoteIR[], plan: GestureExpressionPlan, timebase: Timebase): NoteIR[] {
  if (plan.velocityCurve === 'none' || notes.length === 0) return notes.map((n) => ({ ...n }));
  return notes.map((n, idx) => ({ ...n, velocity: clampVelocity(n.velocity * velocityScaleForCurve(plan, n, idx, timebase)) }));
}

function shapeKeyboardOrPadNotes(track: TrackIR, plan: GestureExpressionPlan, timebase: Timebase): NoteIR[] {
  if (track.role === 'lead') {
    if (plan.tailPolicy === 'electric-key-tail') {
      // The electric-key plan already declares a soft touch. Lead used to
      // execute only its gate/tail and accidentally bypass this final velocity
      // curve, leaving GM4/5 close to forte for the whole phrase.
      return withVelocityCurve(shapeElectricKeyLeadTailNotes(track.notes, timebase), plan, timebase);
    }
    return track.notes.map((n) => ({ ...n })); // MG lead grammar/velocity parity 由 lead renderer 拥有;吹奏 lead 走上面的专用分支。
  }
  const ratio = clampGateRatio(plan.gateRatio);
  const gated = track.role === 'comp' && plan.kind === 'keyboard-touch'
    ? track.notes.map((n) => {
        const dur = n.durationTicks as number;
        if (dur > timebase.ppq) return { ...n }; // 长 texture/wash 维持连续性;短触键才按手势收 release。
        return { ...n, durationTicks: ticks(Math.max(1, Math.round(dur * ratio))) };
      })
    : withGate(track.notes, plan.gateRatio);
  if (track.role === 'comp' && plan.kind === 'keyboard-touch') {
    return gated.map((n, idx) => ({
      ...n,
      velocity: clampVelocity(n.velocity * Math.min(1, velocityScaleForCurve(plan, n, idx, timebase))),
    }));
  }
  return withVelocityCurve(gated, plan, timebase);
}

function withBassTechniqueCurve(notes: readonly NoteIR[], plan: GestureExpressionPlan, timebase: Timebase): NoteIR[] {
  const techniques = plan.bassTechniques ?? [];
  if (!techniques.includes('ghost-note') && !techniques.includes('muted') && !techniques.includes('walking')) return notes.map((n) => ({ ...n }));
  return notes.map((n, idx) => {
    const phase = beatPhase(n.startTick as number, timebase);
    const frac = phase - Math.floor(phase);
    let scale = 1;
    if (techniques.includes('ghost-note') && Math.min(frac, 1 - frac) > 0.09) scale *= 0.72;
    if (techniques.includes('muted')) scale *= 0.9;
    if (techniques.includes('walking') && idx % 2 === 1) scale *= 0.94;
    return { ...n, velocity: clampVelocity(n.velocity * scale) };
  });
}

function shapeBassNotes(track: TrackIR, plan: GestureExpressionPlan, timebase: Timebase): NoteIR[] {
  const gated = withGate(track.notes, plan.gateRatio);
  const curved = withVelocityCurve(gated, plan, timebase);
  return withBassTechniqueCurve(curved, plan, timebase);
}

function shapeGuitarNotes(track: TrackIR, plan: GestureExpressionPlan, timebase: Timebase): NoteIR[] {
  const gated = withGate(track.notes, plan.gateRatio);
  const curved = withVelocityCurve(gated, plan, timebase);
  const groups = new Map<number, number>();
  for (const n of curved) {
    const start = n.startTick as number;
    groups.set(start, (groups.get(start) ?? 0) + 1);
  }
  const starts = [...groups.keys()].sort((a, b) => a - b);
  const startIndex = new Map(starts.map((start, idx) => [start, idx]));
  const releaseGap = Math.max(1, Math.round(timebase.ppq * GUITAR_COMP_RELEASE_GAP_BEATS));

  return curved.map((n) => {
    const start = n.startTick as number;
    const groupSize = groups.get(start) ?? 1;
    const nextStart = starts[(startIndex.get(start) ?? -1) + 1];
    const baseMaxBeats = groupSize > 1 ? GUITAR_COMP_MAX_BEATS : GUITAR_COMP_SINGLE_MAX_BEATS;
    const maxByGesture = Math.max(1, Math.round(timebase.ppq * baseMaxBeats));
    const maxByNext = nextStart === undefined ? maxByGesture : Math.max(1, nextStart - start - releaseGap);
    const durationTicks = ticks(Math.min(n.durationTicks as number, maxByGesture, maxByNext));
    const groupScale = groupSize >= 4 ? 0.82 : groupSize === 3 ? 0.86 : groupSize === 2 ? 0.9 : 1;
    const velocity = Math.min(GUITAR_COMP_VELOCITY_CAP, clampVelocity(n.velocity * groupScale));
    return { ...n, durationTicks, velocity };
  });
}

function isDrumPitch(n: NoteIR, pitch: number): boolean {
  return (n.pitch as number) === pitch;
}

function isHat(n: NoteIR): boolean {
  const p = n.pitch as number;
  return p === DRUM_CHAT || p === DRUM_OHAT || p === DRUM_PHAT || p === DRUM_RIDE || p === DRUM_RIDE_BELL;
}

function shapeDrumVelocity(n: NoteIR, plan: GestureExpressionPlan, timebase: Timebase, index: number): number {
  const phase = beatPhase(n.startTick as number, timebase);
  let scale = velocityScaleForCurve(plan, n, index, timebase);
  if (plan.rudimentPolicy === 'ride-swing') {
    if (isDrumPitch(n, DRUM_RIDE) || isDrumPitch(n, DRUM_RIDE_BELL)) scale *= nearBeat(phase, 0) || nearBeat(phase, 2) ? 1.05 : 0.92;
    if (isDrumPitch(n, DRUM_SNARE)) scale *= 0.72;
  } else if (plan.rudimentPolicy === 'lofi-dusty') {
    if (isDrumPitch(n, DRUM_SNARE) || isDrumPitch(n, DRUM_SIDE_STICK)) scale *= 0.86;
    if (isHat(n)) scale *= 0.82;
  } else if (plan.rudimentPolicy === 'laidback-ghost') {
    if (isDrumPitch(n, DRUM_SNARE) && !nearBeat(phase, 1) && !nearBeat(phase, 3)) scale *= 0.72;
  } else if (plan.rudimentPolicy === 'backbeat-ghost') {
    if (isDrumPitch(n, DRUM_SNARE) && !nearBeat(phase, 1) && !nearBeat(phase, 3)) scale *= 0.62;
  }
  if (plan.hiHatPolicy === 'dusty-closed' && isHat(n)) scale *= 0.84;
  if (plan.hiHatPolicy === 'laidback-closed' && isHat(n) && !Number.isInteger(phase)) scale *= 0.9;
  if (plan.hiHatPolicy === 'closed-open-lift' && isDrumPitch(n, DRUM_OHAT)) scale *= 1.12;
  return clampVelocity(n.velocity * scale);
}

function shapeDrumNotes(track: TrackIR, plan: GestureExpressionPlan, timebase: Timebase): NoteIR[] {
  const gated = withGate(track.notes, plan.gateRatio);
  return gated.map((n, index) => ({ ...n, velocity: shapeDrumVelocity(n, plan, timebase, index) }));
}

/** Keep generation inside the per-voice 5504 capability contract. */
function permittedGestureCcEvents(
  track: TrackIR,
  plan: GestureExpressionPlan,
  events: readonly GestureCcEvent[],
): GestureCcEvent[] {
  const program = track.program ?? plan.program;
  if (program === undefined) return [];
  const profile = dreamVoiceCcProfile(program, track.role);
  return events.filter((event) => mayEmitAutomaticCc(profile, event.controller));
}

export function applyGestureExpressionToTrack(
  track: TrackIR,
  plan: GestureExpressionPlan | undefined,
  timebase: Timebase,
): { notes: NoteIR[]; ccEvents?: GestureCcEvent[]; pitchBendEvents?: SaxPitchBendEvent[] } {
  if (!plan || plan.kind === 'none') return { notes: track.notes };
  if (plan.kind === 'sax-breath-legato') {
    if (track.role !== 'lead') return { notes: track.notes };
    const opts = saxOptions(plan, timebase);
    const breathGrouped = plan.phrasePolicy === 'breath-group';
    const shouldConnect = breathGrouped && (plan.continuity === 'legato-flow' || plan.continuity === 'connected');
    const notes = shouldConnect ? shapeSaxLegatoNotes(track.notes, opts) : withGate(track.notes, plan.gateRatio);
    const ccEvents = plan.triggerPolicy === 'cc-lane'
      ? buildSaxBreathCcEvents(notes, opts).sort((a, b) => (a.atTick as number) - (b.atTick as number) || a.controller - b.controller)
      : [];
    const permittedCcEvents = permittedGestureCcEvents(track, plan, ccEvents);
    return {
      notes,
      ccEvents: permittedCcEvents.length ? permittedCcEvents : undefined,
    };
  }
  if (plan.kind === 'pipe-wind-breath') {
    if (track.role !== 'lead') return { notes: track.notes };
    const ccEvents = plan.triggerPolicy === 'cc-lane' ? buildPipeWindBreathCcEvents(track.notes, timebase) : [];
    const permittedCcEvents = permittedGestureCcEvents(track, plan, ccEvents);
    return { notes: track.notes, ccEvents: permittedCcEvents.length ? permittedCcEvents : undefined };
  }
  if (plan.kind === 'bowed-string-legato') {
    if (track.role !== 'lead') return { notes: track.notes };
    return { notes: track.notes };
  }
  if (plan.kind === 'bass-pluck-legato' || plan.kind === 'bass-walk' || plan.kind === 'bass-muted') {
    return { notes: track.role === 'bass' ? shapeBassNotes(track, plan, timebase) : track.notes };
  }
  if (plan.kind === 'guitar-pick-voice') {
    return { notes: track.role === 'comp' ? shapeGuitarNotes(track, plan, timebase) : track.notes };
  }
  if (plan.kind === 'drum-rudiment') {
    return { notes: track.role === 'drum' ? shapeDrumNotes(track, plan, timebase) : track.notes };
  }
  if (plan.kind === 'keyboard-touch' || plan.kind === 'mallet-strike' || plan.kind === 'sustained-pad') {
    const notes = shapeKeyboardOrPadNotes(track, plan, timebase);
    return { notes };
  }
  return { notes: track.notes };
}
