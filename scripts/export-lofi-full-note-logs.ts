import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pc } from '../src/core/generation/newEngine/foundation';
import {
  buildSongBundle,
  generateSongFromBundle,
} from '../src/core/generation/newEngine/generation/GenerationController';
import {
  freezeMusicalIR,
  type MusicalIR,
  type TrackIR,
} from '../src/core/generation/newEngine/ir/MusicalIR';
import { musicalIRToSMF } from '../src/core/generation/newEngine/sandbox/midiFile';

const OUTPUT_DIR = resolve('tmp/lofi-full-note-logs');
const SEEDS = [0, 1, 3, 4, 3_600_133_724] as const;
const ROLE_ORDER = ['drum', 'bass', 'comp', 'pad', 'lead'] as const;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const DRUM_NAMES: Readonly<Record<number, string>> = {
  35: 'Acoustic Bass Drum',
  36: 'Kick',
  37: 'Side Stick / Rim',
  38: 'Snare',
  39: 'Clap',
  40: 'Electric Snare',
  42: 'Closed Hi-Hat',
  44: 'Pedal Hi-Hat',
  45: 'Low Tom',
  46: 'Open Hi-Hat',
  47: 'Mid Tom',
  49: 'Crash',
  50: 'High Tom',
  51: 'Ride',
  53: 'Ride Bell',
  54: 'Tambourine',
  62: 'High Conga',
  63: 'Low Conga',
  70: 'Shaker / Maracas',
};

interface NoteLogRow {
  eventId: string;
  role: string;
  program: number | null;
  bank: number | null;
  pitch: number;
  noteName: string;
  startTick: number;
  endTick: number;
  durationTicks: number;
  startBeat: number;
  durationBeats: number;
  bar: number;
  beatInBar: number;
  velocity: number;
  sectionId: string | null;
  chordSpanId: string | null;
  chord: string | null;
  drumPhraseId: string | null;
  topLoopId: string | null;
  phraseBarIndex: number | null;
  structuralMutation: boolean;
}

function melodicNoteName(pitch: number): string {
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function pitchLabel(role: string, pitch: number): string {
  return role === 'drum'
    ? `${DRUM_NAMES[pitch] ?? 'GM Percussion'} (${pitch})`
    : `${melodicNoteName(pitch)} (${pitch})`;
}

function chordLabel(rootPc: number, chordType: string): string {
  return `${NOTE_NAMES[((rootPc % 12) + 12) % 12]}${chordType}`;
}

function fixed(value: number, digits = 4): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

function tsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return `${value}`.replaceAll('\t', ' ').replaceAll('\n', ' ');
}

function cloneTrack(track: MusicalIR['tracks'][number]): TrackIR {
  return {
    ...track,
    notes: track.notes.map((note) => ({ ...note })),
    programChanges: track.programChanges?.map((event) => ({ ...event })),
    pedalEvents: track.pedalEvents?.map((event) => ({ ...event })),
    mix: track.mix ? { ...track.mix } : undefined,
    mixChanges: track.mixChanges?.map((event) => ({ ...event, mix: { ...event.mix } })),
    ccEvents: track.ccEvents?.map((event) => ({ ...event })),
    pitchBendEvents: track.pitchBendEvents?.map((event) => ({ ...event })),
  };
}

rmSync(OUTPUT_DIR, { recursive: true, force: true });
mkdirSync(OUTPUT_DIR, { recursive: true });

const indexRows: Array<{
  seed: number;
  archetype: string;
  phrase: string;
  topLoop: string;
  harmonyPool: string;
  harmonyPrototypes: string;
  notes: number;
}> = [];

for (const seed of SEEDS) {
  const bundle = buildSongBundle({
    seed,
    styleHint: 'lofi',
    mood: 'build',
    targetDuration: 120,
    key: pc(0),
  });
  const result = generateSongFromBundle(bundle);
  if (!result.ir || result.status === 'failed') {
    throw new Error(
      `LOFI seed ${seed} failed: ${result.report.findings.map((finding) => finding.ruleId).join(',')}`,
    );
  }
  const foundation = bundle.arrangement.lofiFoundationPlan;
  if (!foundation) throw new Error(`LOFI seed ${seed} has no FoundationPlan`);

  const ppq = bundle.timebase.ppq;
  const beatsPerBar = bundle.arrangement.meter.numerator
    * (4 / bundle.arrangement.meter.denominator);
  const scoreBarByAbsoluteBar = new Map(
    Object.values(bundle.arrangement.grooveScorePlan.bySection)
      .flatMap((section) => section.bars)
      .map((bar) => [bar.absoluteBar, bar] as const),
  );
  const roleRank = new Map(ROLE_ORDER.map((role, index) => [role, index]));
  const rows: NoteLogRow[] = [];

  for (const track of result.ir.tracks) {
    track.notes.forEach((note, noteIndex) => {
      const startTick = note.startTick as number;
      const durationTicks = note.durationTicks as number;
      const startBeat = startTick / ppq;
      const durationBeats = durationTicks / ppq;
      const absoluteBar = Math.max(0, Math.floor((startBeat + 1e-7) / beatsPerBar));
      const scoreBar = scoreBarByAbsoluteBar.get(absoluteBar);
      const chord = bundle.harmonic.chordTimeline.find((span) =>
        startBeat >= (span.startBeat as number) - 1e-7
        && startBeat < (span.startBeat as number) + (span.durationBeats as number) - 1e-7)
        ?? bundle.harmonic.chordTimeline[bundle.harmonic.chordTimeline.length - 1];
      rows.push({
        eventId: `${track.role}-${String(noteIndex + 1).padStart(4, '0')}`,
        role: track.role,
        program: track.program ?? null,
        bank: track.bank ?? null,
        pitch: note.pitch as number,
        noteName: pitchLabel(track.role, note.pitch as number),
        startTick,
        endTick: startTick + durationTicks,
        durationTicks,
        startBeat,
        durationBeats,
        bar: absoluteBar + 1,
        beatInBar: startBeat - absoluteBar * beatsPerBar + 1,
        velocity: note.velocity,
        sectionId: chord?.sectionId ?? scoreBar?.sectionId ?? null,
        chordSpanId: chord?.id ?? null,
        chord: chord ? chordLabel(chord.rootPc as number, chord.chordType ?? chord.quality) : null,
        drumPhraseId: scoreBar?.drumPhraseId ?? null,
        topLoopId: scoreBar?.drumTopLoopId ?? null,
        phraseBarIndex: scoreBar?.drumPhraseBarIndex ?? null,
        structuralMutation: scoreBar?.structuralMutation ?? false,
      });
    });
  }
  rows.sort((a, b) =>
    a.startTick - b.startTick
    || (roleRank.get(a.role as typeof ROLE_ORDER[number]) ?? 99)
      - (roleRank.get(b.role as typeof ROLE_ORDER[number]) ?? 99)
    || a.pitch - b.pitch
    || a.eventId.localeCompare(b.eventId));

  const noteCountByRole = Object.fromEntries(ROLE_ORDER.map((role) => [
    role,
    rows.filter((row) => row.role === role).length,
  ]));
  const firstLoop = bundle.arrangement.sections.find((section) => section.functionTag === 'loop');
  const summary = {
    schemaVersion: 1,
    scope: 'All FinalIR note events; no notes omitted.',
    seed,
    textSeed: seed === 3_600_133_724 ? 'zqbdwz' : null,
    generationStatus: result.status,
    tempoBpm: bundle.arrangement.tempoBpm,
    meter: `${bundle.arrangement.meter.numerator}/${bundle.arrangement.meter.denominator}`,
    ppq,
    durationTicks: result.ir.durationTicks,
    durationBeats: (result.ir.durationTicks as number) / ppq,
    totalNotes: rows.length,
    noteCountByRole,
    foundationPlan: foundation,
    compPerformance: {
      intent: foundation.compIntent,
      program: bundle.instrumentation.roleProgram.comp,
      bank: bundle.instrumentation.roleBank.comp ?? 0,
      voiceName: bundle.instrumentation.voiceNameByRole.comp ?? null,
      pedalPlan: bundle.instrumentation.pedalPlanByRole.comp ?? null,
      finalPedalEvents: (result.ir.tracks.find((track) => track.role === 'comp')?.pedalEvents ?? [])
        .map((event) => ({
          atTick: event.atTick,
          atBeat: (event.atTick as number) / ppq,
          down: event.down,
        })),
    },
    leadPresencePlan: bundle.arrangement.lofiLeadPresencePlan,
    sections: bundle.arrangement.sections,
    mainHarmonicLoop: bundle.harmonic.chordTimeline
      .filter((span) => span.sectionId === firstLoop?.id)
      .map((span) => ({
        spanId: span.id,
        chord: chordLabel(span.rootPc as number, span.chordType ?? span.quality),
        startBeat: span.startBeat,
        durationBeats: span.durationBeats,
      })),
  };

  const dir = resolve(OUTPUT_DIR, `seed-${seed}-${foundation.archetypeId}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(resolve(dir, 'full-note-log.json'), `${JSON.stringify({
    summary,
    notes: rows,
  }, null, 2)}\n`);
  writeFileSync(
    resolve(dir, 'full.mid'),
    musicalIRToSMF(result.ir, bundle.arrangement.tempoBpm, bundle.band.style),
  );
  writeFileSync(resolve(dir, 'comp.mid'), musicalIRToSMF(freezeMusicalIR({
    timebase: result.ir.timebase,
    durationTicks: result.ir.durationTicks,
    tracks: result.ir.tracks
      .filter((track) => track.role === 'comp')
      .map(cloneTrack),
  }), bundle.arrangement.tempoBpm, bundle.band.style));

  const columns: Array<keyof NoteLogRow> = [
    'eventId',
    'role',
    'program',
    'bank',
    'pitch',
    'noteName',
    'startTick',
    'endTick',
    'durationTicks',
    'startBeat',
    'durationBeats',
    'bar',
    'beatInBar',
    'velocity',
    'sectionId',
    'chordSpanId',
    'chord',
    'drumPhraseId',
    'topLoopId',
    'phraseBarIndex',
    'structuralMutation',
  ];
  const tsv = [
    columns.join('\t'),
    ...rows.map((row) => columns.map((column) => {
      const value = row[column];
      return tsvCell(typeof value === 'number' ? fixed(value) : value);
    }).join('\t')),
    '',
  ].join('\n');
  writeFileSync(resolve(dir, 'full-note-log.tsv'), tsv);

  const readable = [
    `LOFI FULL NOTE LOG · seed ${seed}`,
    `archetype=${foundation.archetypeId}`,
    `tempo=${bundle.arrangement.tempoBpm} BPM meter=${summary.meter} ppq=${ppq}`,
    `phrase=${foundation.drumPhraseId}`,
    `topLoop=${foundation.topLoopId ?? 'none'}`,
    `harmonyPool=${foundation.harmonyPoolId}`,
    `harmonyPrototypes=${[...new Set(bundle.harmonic.chordTimeline
      .map((span) => span.sourcePrototypeId)
      .filter((id): id is string => !!id))].join(',') || 'unattributed'}`,
    `notes=${rows.length} (${Object.entries(noteCountByRole).map(([role, count]) => `${role}:${count}`).join(', ')})`,
    '',
    'eventId | role | note | bar / beat | startBeat | durationBeats | tick | durationTicks | velocity | section | chord | phrase/top | mutation',
    ...rows.map((row) => [
      row.eventId,
      row.role.padEnd(5),
      row.noteName.padEnd(22),
      `B${row.bar} beat${fixed(row.beatInBar, 3)}`.padEnd(15),
      fixed(row.startBeat).padStart(8),
      fixed(row.durationBeats).padStart(7),
      `${row.startTick}`.padStart(7),
      `${row.durationTicks}`.padStart(6),
      `${row.velocity}`.padStart(3),
      row.sectionId ?? '-',
      row.chord ?? '-',
      `${row.drumPhraseId ?? '-'}/${row.topLoopId ?? '-'}`,
      row.structuralMutation ? 'mutation' : '-',
    ].join(' | ')),
    '',
  ].join('\n');
  writeFileSync(resolve(dir, 'full-note.log'), readable);

  indexRows.push({
    seed,
    archetype: foundation.archetypeId,
    phrase: foundation.drumPhraseId,
    topLoop: foundation.topLoopId ?? 'none',
    harmonyPool: foundation.harmonyPoolId,
    harmonyPrototypes: [...new Set(bundle.harmonic.chordTimeline
      .map((span) => span.sourcePrototypeId)
      .filter((id): id is string => !!id))].join(',') || 'unattributed',
    notes: rows.length,
  });
}

writeFileSync(resolve(OUTPUT_DIR, 'README.md'), [
  '# LOFI full-note logs',
  '',
  'Every exported log contains every FinalIR note from Drum, Bass, Comp, Pad and Lead.',
  'The TSV is easiest to filter; JSON preserves types and metadata; `.log` is optimized for direct reading.',
  '',
  '| Seed | Archetype | Drum phrase | TopLoop | Harmony pool / prototypes | Total notes |',
  '|---:|---|---|---|---|---:|',
  ...indexRows.map((row) =>
    `| ${row.seed} | ${row.archetype} | ${row.phrase} | ${row.topLoop} | ${row.harmonyPool} / ${row.harmonyPrototypes} | ${row.notes} |`),
  '',
].join('\n'));

console.log(`Exported ${SEEDS.length} complete LOFI note logs to ${OUTPUT_DIR}`);
