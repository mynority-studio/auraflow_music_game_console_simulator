// ============================================================
// musicGeneration · qnUiProjection(Q+N 中间结构 → 结构化 UI 投影)
// ------------------------------------------------------------
// qn_main_engine_takeover §4.3:从 band/arrangement/harmonic/instrumentation/IR 构造结构化投影,
//   【不解析 traceGeneration 文本日志】。PipelineMonitor/AuraJam/LedMatrix 读它。
// ============================================================

import type { SongBundle } from '../newEngine/generation/GenerationController';
import type { MusicalIR } from '../newEngine/ir/MusicalIR';
import { beatsPerBarOf } from '../newEngine/arranger/phraseTiming';
import type {
  MusicGenerationUiSnapshot, UiSection, UiChord, UiPlayer, UiTrack, QnRole, BandParticipantSelection, BandParticipantState, UiGrooveContract, UiGestureExpression,
} from './types';
import { participantForRole } from './participantConstraint';
import { dream5504VoiceName, mapProgramToDream5504 } from '../../sound/GMBK5X128Voices';
import { instrumentInfo } from '../newEngine/knowledge/instruments';

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const ROLE_CHANNEL: Record<QnRole, number> = { lead: 1, comp: 2, bass: 3, pad: 4, drum: 9 };
const ROLE_ORDER: QnRole[] = ['lead', 'comp', 'bass', 'pad', 'drum'];

/** PitchClass(0..11)→ 显示音名(平号体系,与旧 MgKeyStore 一致)。 */
export function pcToKey(pc: number): string { return NOTE_NAMES[((pc % 12) + 12) % 12]; }
/** 显示音名 → PitchClass(支持升降号别名)。 */
export function keyToPc(key: string): number {
  const map: Record<string, number> = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
    G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
  };
  return map[key] ?? 0;
}

const ROMAN_NUM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
function romanLabel(r: { degree: number; accidental: string; quality: string; secondaryTarget?: { degree: number } }): string {
  const acc = r.accidental === 'b' ? 'b' : r.accidental === 'bb' ? 'bb' : r.accidental === '#' ? '#' : r.accidental === 'x' ? 'x' : '';
  const minor = r.quality === 'min' || r.quality === 'm7' || r.quality === 'm7b5' || r.quality === 'dim7' || r.quality === 'm9';
  let num = ROMAN_NUM[r.degree] ?? `${r.degree}`;
  if (minor) num = num.toLowerCase();
  const sec = r.secondaryTarget ? `/${ROMAN_NUM[r.secondaryTarget.degree] ?? ''}` : '';
  return `${acc}${num}${sec}`;
}
function chordLabel(rootPc: number, chordType: string | undefined, quality: string): string {
  return `${pcToKey(rootPc)}${chordType ?? quality}`;
}

interface ProjectionGrooveContract {
  readonly id: string;
  readonly name: string;
  readonly grid: string;
  readonly melodySwingRatio: number;
  readonly melodyStrongPocketMs: readonly number[];
  readonly melodyWeakPocketMs: readonly number[];
  readonly accentPattern: readonly number[];
}

function uiMsPair(pair: readonly number[]): [number, number] {
  const lo = Number.isFinite(pair[0]) ? pair[0] : 0;
  const hi = Number.isFinite(pair[1]) ? pair[1] : lo;
  return [lo, hi];
}

function uiGrooveContract(c: ProjectionGrooveContract): UiGrooveContract {
  return {
    id: c.id,
    name: c.name,
    grid: c.grid,
    melodySwingRatio: c.melodySwingRatio,
    melodyStrongPocketMs: uiMsPair(c.melodyStrongPocketMs),
    melodyWeakPocketMs: uiMsPair(c.melodyWeakPocketMs),
    accentPattern: [...c.accentPattern],
  };
}

function uiGesture(g: SongBundle['instrumentation']['gestureExpressionByRole'][QnRole] | undefined): UiGestureExpression | undefined {
  if (!g || g.kind === 'none') return undefined;
  return {
    kind: g.kind,
    family: g.family,
    continuity: g.continuity,
    articulationScope: g.articulationScope,
    triggerPolicy: g.triggerPolicy,
    phrasePolicy: g.phrasePolicy,
    evidenceRefs: [...g.evidenceRefs],
    articulation: g.articulation,
    noteShape: g.noteShape,
    velocityCurve: g.velocityCurve,
    pedalPolicy: g.pedalPolicy,
    rudimentPolicy: g.rudimentPolicy,
    hiHatPolicy: g.hiHatPolicy,
    breathModel: g.breathModel,
    ccControllers: [...g.ccControllers],
    bassTechniques: g.bassTechniques ? [...g.bassTechniques] : undefined,
    gateRatio: g.gateRatio,
    maxConnectBeats: g.maxConnectBeats,
    overlapBeats: g.overlapBeats,
  };
}

/** band/arrangement/harmonic/instrumentation + IR → 结构化 UI 投影(不碰 trace)。 */
export function buildUiSnapshot(bundle: SongBundle, ir: MusicalIR | null, seed: number, participants?: BandParticipantSelection[]): MusicGenerationUiSnapshot {
  const { band, arrangement, harmonic, instrumentation } = bundle;
  const bpb = beatsPerBarOf(arrangement.meter);

  // sections(累计 bars → startBeat)
  let cursor = 0;
  const sections: UiSection[] = arrangement.sections.map((s) => {
    const startBeat = cursor;
    const endBeat = cursor + s.bars * bpb; // ★ 段末拍(消费者:AuraBar/AuraJam 段命中/jam 定时;取代旧 GeneratedTrack 内联算)
    cursor = endBeat;
    return { id: String(s.id), role: String(s.role), functionTag: s.functionTag ? String(s.functionTag) : undefined, bars: s.bars, startBeat, endBeat };
  });

  // chords(harmonic.chordTimeline)
  const chords: UiChord[] = harmonic.chordTimeline.map((c) => ({
    roman: romanLabel(c.roman),
    label: chordLabel(c.rootPc as number, c.chordType, String(c.quality)),
    rootPc: c.rootPc as number,
    quality: String(c.quality),
    startBeat: c.startBeat as number,
    durationBeats: c.durationBeats as number,
    sectionId: String(c.sectionId),
  }));

  // roster(乐手 = instrumentation.roleProgram 的角色;音色只读取自【最终 IR program】)。
  // ★ program 取【最终 IR 实际 program】(器配层选中,只读),回退 roleProgram。Band Selection 不再写 program。
  const irVoiceByRole = new Map<string, { program: number; bank?: number }>();
  for (const t of ir?.tracks ?? []) {
    if (t.program !== undefined) irVoiceByRole.set(t.role, { program: t.program, bank: t.bank });
  }
  const autoFilled = new Set<string>((band.autoFilledRoles ?? []).map(String));
  // participant 是否明确 selected(白名单态)→ roster state 标 selected;否则 auto。
  const selectedParticipant = new Set((participants ?? []).filter((p) => p.state === 'selected').map((p) => p.role));
  const roster: UiPlayer[] = ROLE_ORDER
    .filter((role) => instrumentation.roleProgram[role] !== undefined)
    .map((role) => {
      const voice = irVoiceByRole.get(role);
      const program = mapProgramToDream5504(voice?.program ?? instrumentation.roleProgram[role], role, band.style);
      const bank = voice?.bank;
      const participant = participantForRole(role, participants);
      const isAutoFilled = autoFilled.has(role);
      const state: BandParticipantState = isAutoFilled ? 'auto' : (participant && selectedParticipant.has(participant)) ? 'selected' : 'auto';
      // ★ drum 走 ch9 打击,program=0/8/16... 不是旋律 GM 表,显示 GMBK5X128 真实鼓组名。
      const isDrum = role === 'drum';
      const instrumentName = dream5504VoiceName(bank, program, role) ?? `Dream5504 PC${program}`;
      const family = isDrum ? 'percussion' : instrumentInfo(program).family;
      return { role, program, bank: bank || undefined, instrumentName, family, state, participant, autoFilled: isAutoFilled || undefined, gesture: uiGesture(instrumentation.gestureExpressionByRole[role]) };
    });

  // tracks(实际 IR 轨 → channel/noteCount;给 Jam/可视化)
  const tracks: UiTrack[] = (ir?.tracks ?? []).map((t) => {
    const role = t.role as QnRole;
    const program = mapProgramToDream5504(t.program ?? instrumentation.roleProgram[role] ?? 0, role, band.style);
    return {
      role,
      channel: ROLE_CHANNEL[role] ?? 0,
      program,
      bank: t.bank || undefined,
      instrumentName: dream5504VoiceName(t.bank, program, role) ?? `Dream5504 PC${program}`,
      noteCount: t.notes.length,
    };
  });

  const tonality = band.tonalityKind === 'modal' && band.modalModeName ? String(band.modalModeName) : String(band.mode);
  const grooveContract = uiGrooveContract(arrangement.songGrooveContract);
  const grooveContractBySection = Object.fromEntries(
    Object.entries(arrangement.grooveContractBySection ?? {}).map(([sectionId, contract]) => [String(sectionId), uiGrooveContract(contract)]),
  );

  return {
    seed,
    styleHint: band.style,
    key: pcToKey(band.key as number),
    tonality,
    bpm: arrangement.tempoBpm,
    timeSignature: [arrangement.meter.numerator, arrangement.meter.denominator],
    sections,
    chords,
    roster,
    tracks,
    grooveContract,
    grooveContractBySection,
    world: String(instrumentation.orchestrationChain.world),
    spaceProfile: String(instrumentation.spaceProfile),
  };
}
