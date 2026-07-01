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
  MusicGenerationUiSnapshot, UiSection, UiChord, UiPlayer, UiTrack, QnRole, BandParticipantSelection, BandParticipantState,
} from './types';
import { participantForRole } from './participantConstraint';

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

// GM 128 标准乐器名(UI roster/palette 用)。
const GM_NAMES = [
  'Acoustic Grand', 'Bright Piano', 'Electric Grand', 'Honky-Tonk', 'Rhodes EP', 'FM EP', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Perc Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdrive Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato', 'Harp', 'Timpani',
  'String Ens 1', 'String Ens 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Square Lead', 'Saw Lead', 'Calliope', 'Chiff Lead', 'Charang', 'Voice Lead', 'Fifths Lead', 'Bass+Lead',
  'Pad New Age', 'Pad Warm', 'Pad Polysynth', 'Pad Choir', 'Pad Bowed', 'Pad Metallic', 'Pad Halo', 'Pad Sweep',
  'FX Rain', 'FX Soundtrack', 'FX Crystal', 'FX Atmosphere', 'FX Brightness', 'FX Goblins', 'FX Echoes', 'FX Sci-Fi',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone', 'Helicopter', 'Applause', 'Gunshot',
];
const GM_FAMILIES = ['piano', 'chromatic', 'organ', 'guitar', 'bass', 'strings', 'ensemble', 'brass', 'reed', 'pipe', 'synth-lead', 'synth-pad', 'synth-fx', 'ethnic', 'percussive', 'sfx'];

export function gmName(program: number): string { return GM_NAMES[program] ?? `GM ${program}`; }
export function gmFamily(program: number): string { return GM_FAMILIES[Math.floor(((program % 128) + 128) % 128 / 8)] ?? 'other'; }

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
  const irProgramByRole = new Map<string, number>();
  for (const t of ir?.tracks ?? []) if (t.program !== undefined) irProgramByRole.set(t.role, t.program);
  const autoFilled = new Set<string>((band.autoFilledRoles ?? []).map(String));
  // participant 是否明确 selected(白名单态)→ roster state 标 selected;否则 auto。
  const selectedParticipant = new Set((participants ?? []).filter((p) => p.state === 'selected').map((p) => p.role));
  const roster: UiPlayer[] = ROLE_ORDER
    .filter((role) => instrumentation.roleProgram[role] !== undefined)
    .map((role) => {
      const program = irProgramByRole.get(role) ?? instrumentation.roleProgram[role];
      const participant = participantForRole(role, participants);
      const isAutoFilled = autoFilled.has(role);
      const state: BandParticipantState = isAutoFilled ? 'auto' : (participant && selectedParticipant.has(participant)) ? 'selected' : 'auto';
      // ★ P2:drum 走 ch9 打击,program=0 不是 Acoustic Grand → 显示成 Drum Kit(别用 melodic GM 表翻译)。
      const isDrum = role === 'drum';
      const instrumentName = isDrum ? 'Drum Kit' : gmName(program);
      const family = isDrum ? 'percussion' : gmFamily(program);
      return { role, program, instrumentName, family, state, participant, autoFilled: isAutoFilled || undefined };
    });

  // tracks(实际 IR 轨 → channel/noteCount;给 Jam/可视化)
  const tracks: UiTrack[] = (ir?.tracks ?? []).map((t) => ({
    role: t.role as QnRole,
    channel: ROLE_CHANNEL[t.role as QnRole] ?? 0,
    program: t.program ?? instrumentation.roleProgram[t.role as QnRole] ?? 0,
    instrumentName: gmName(t.program ?? instrumentation.roleProgram[t.role as QnRole] ?? 0),
    noteCount: t.notes.length,
  }));

  const tonality = band.tonalityKind === 'modal' && band.modalModeName ? String(band.modalModeName) : String(band.mode);

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
    world: String(instrumentation.orchestrationChain.world),
    spaceProfile: String(instrumentation.spaceProfile),
  };
}
