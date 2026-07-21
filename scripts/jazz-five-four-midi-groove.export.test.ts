import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveMusicIntentPlan } from '../src/core/generation/newEngine/arranger/deriveMusicIntentPlan';
import { JAZZ_5_4_ARCHETYPE_ID } from '../src/core/generation/newEngine/arranger/jazzArchetypePlanner';
import { buildSongBundle } from '../src/core/generation/newEngine/generation/GenerationController';
import { pc } from '../src/core/generation/newEngine/foundation';
import { TAKE_FIVE_ROLE_RHYTHM_SOURCE_SHA256 } from '../src/core/generation/newEngine/knowledge/roleRhythmPatterns';
import { renderSongFull } from '../src/core/generation/newEngine/render/renderCoordinator';
import { musicalIRToSMF } from '../src/core/generation/newEngine/sandbox/midiFile';

const SEED = 1662;
const PPQ = 480;
const BEATS_PER_BAR = 5;
const BAR_TICKS = PPQ * BEATS_PER_BAR;
const ROLES = new Set(['bass', 'comp', 'lead'] as const);
const OUTPUT_DIR = resolve('tmp/jazz-five-four-midi-groove/seed-1662');
const STEM = 'jazz-5-4-midi-groove-seed-1662';

const midiPath = resolve(OUTPUT_DIR, `${STEM}.mid`);
const jsonPath = resolve(OUTPUT_DIR, `${STEM}.all-notes.json`);
const csvPath = resolve(OUTPUT_DIR, `${STEM}.all-notes.csv`);
const readmePath = resolve(OUTPUT_DIR, 'README.md');

const roleRank: Record<string, number> = { bass: 0, comp: 1, lead: 2, pad: 3, drum: 4 };
const pitchClasses = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function pitchName(midi: number): string {
  return `${pitchClasses[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function csvEscape(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[\n\r,"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

describe('Jazz 5/4 supplied-MIDI groove artifact export', () => {
  it('exports the final production render and a complete per-note audit', () => {
    const bundle = buildSongBundle({
      seed: SEED,
      styleHint: 'jazz',
      mood: 'modern cool piano',
      targetDuration: 57.5,
      // The supplied MIDI contributes rhythm; E minor keeps this audition in
      // the same tonal frame as the user's piano arrangement.
      key: pc(4),
      mode: 'minor',
      jazzArchetypeId: JAZZ_5_4_ARCHETYPE_ID,
      bandConstraint: {
        allowedRoles: ROLES,
        requiredRoles: ROLES,
      },
    });
    const rendered = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      bundle.seedRng,
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      bundle.acgPianoScorePlan,
    );
    const ir = rendered.ir;
    const midiBytes = musicalIRToSMF(ir, bundle.arrangement.tempoBpm, 'jazz');

    let sectionBeat = 0;
    const sectionRanges = bundle.arrangement.sections.map((section) => {
      const startBeat = sectionBeat;
      const endBeat = startBeat + section.bars * BEATS_PER_BAR;
      sectionBeat = endBeat;
      return {
        id: section.id,
        role: section.role,
        functionTag: section.functionTag,
        harmonyRole: section.harmonyRole,
        bars: section.bars,
        startBeat,
        endBeat,
        startTick: startBeat * PPQ,
        endTick: endBeat * PPQ,
      };
    });
    const bassVamp = sectionRanges.find((section) => section.id === 'bassVamp');
    if (!bassVamp) throw new Error('Jazz 5/4 form must contain bassVamp');
    const handoffTick = bassVamp.endTick;

    const allNotes = ir.tracks.flatMap((track, trackIndex) =>
      track.notes.map((note, noteIndex) => {
        const startTick = note.startTick as number;
        const durationTicks = note.durationTicks as number;
        const endTick = startTick + durationTicks;
        const startBeat = startTick / PPQ;
        const section = sectionRanges.find((range) => startBeat >= range.startBeat && startBeat < range.endBeat);
        const harmony = bundle.harmonic.chordTimeline.find((span) => {
          const lo = (span.startBeat as number) * PPQ;
          const hi = lo + (span.durationBeats as number) * PPQ;
          return startTick >= lo && startTick < hi;
        });
        const midi = note.pitch as number;
        const barIndex0 = Math.floor(startTick / BAR_TICKS);
        return {
          trackIndex,
          noteIndex,
          role: track.role,
          program: track.program,
          bank: track.bank,
          startTick,
          durationTicks,
          endTick,
          startBeat,
          barIndex0,
          barNumber1: barIndex0 + 1,
          phaseTick: startTick % BAR_TICKS,
          beatInBar0: (startTick % BAR_TICKS) / PPQ,
          beatInBar1: (startTick % BAR_TICKS) / PPQ + 1,
          midi,
          pitchName: pitchName(midi),
          velocity: note.velocity,
          sectionId: section?.id,
          sectionStartTick: section?.startTick,
          chordId: harmony?.id,
          chordRootPc: harmony?.rootPc as number | undefined,
          chordRootName: harmony ? pitchClasses[harmony.rootPc as number] : undefined,
          chordQuality: harmony?.quality,
          chordType: harmony?.chordType,
        };
      }),
    ).sort((a, b) =>
      (a.startTick - b.startTick)
      || ((roleRank[a.role] ?? 99) - (roleRank[b.role] ?? 99))
      || (a.midi - b.midi)
      || (a.noteIndex - b.noteIndex),
    );

    const canonicalNoteLines = allNotes.map((note) =>
      `${note.role}|${note.startTick}|${note.durationTicks}|${note.midi}|${note.velocity}`,
    ).join('\n') + '\n';

    const phaseAudit = Object.fromEntries(sectionRanges.map((section) => [
      section.id,
      Object.fromEntries(ir.tracks.map((track) => [
        track.role,
        uniqueSorted(track.notes
          .filter((note) => (note.startTick as number) >= section.startTick && (note.startTick as number) < section.endTick)
          .map((note) => (note.startTick as number) % BAR_TICKS)),
      ])),
    ]));

    const roleStats = Object.fromEntries(ir.tracks.map((track) => {
      const notes = allNotes.filter((note) => note.role === track.role);
      return [track.role, {
        noteCount: notes.length,
        program: track.program,
        bank: track.bank,
        firstTick: notes.at(0)?.startTick,
        lastOnTick: notes.at(-1)?.startTick,
        minMidi: Math.min(...notes.map((note) => note.midi)),
        maxMidi: Math.max(...notes.map((note) => note.midi)),
        uniqueGlobalBarPhases: uniqueSorted(notes.map((note) => note.phaseTick)),
      }];
    }));

    const harmony = bundle.harmonic.chordTimeline.map((span) => ({
      id: span.id,
      sectionId: span.sectionId,
      startBeat: span.startBeat as number,
      durationBeats: span.durationBeats as number,
      startTick: (span.startBeat as number) * PPQ,
      durationTicks: (span.durationBeats as number) * PPQ,
      barNumber1: Math.floor((span.startBeat as number) / BEATS_PER_BAR) + 1,
      beatInBar1: ((span.startBeat as number) % BEATS_PER_BAR) + 1,
      rootPc: span.rootPc as number,
      rootName: pitchClasses[span.rootPc as number],
      quality: span.quality,
      chordType: span.chordType,
      roman: span.roman,
    }));

    const payload = {
      schemaVersion: 1,
      purpose: 'Production-render audit for the MIDI-derived Jazz 5/4 GrooveContract and Arranger role score.',
      sourceMidi: {
        fileName: 'Take-Five-1.mid',
        sha256: TAKE_FIVE_ROLE_RHYTHM_SOURCE_SHA256,
        format: 0,
        sourcePpq: 192,
        tempoBpm: 167.000203,
        inferredMeter: [5, 4],
        inferredBarTicks: 960,
        inferredGrouping: [3, 2],
        emptyPrerollBars: 1,
        noteCount: 4966,
        channelNoteCounts: { drums: 1884, piano: 2091, acousticBass: 525, altoSax: 466 },
      },
      abstraction: {
        enginePpq: PPQ,
        barTicks: BAR_TICKS,
        groupBoundaryTicks: [0, 1440, 2400],
        harmonicSlots: [
          { phaseTick: 0, durationTicks: 1440, function: 'minor tonic' },
          { phaseTick: 1440, durationTicks: 960, function: 'minor dominant' },
        ],
        bassPianoLowCells: [0, 785, 1440],
        compUpperCells: [305, 960, 1920],
        compFoundationAndChordCellsAfterHandoff: [0, 305, 785, 960, 1440, 1920],
        pianoAuthoredOffbeat: {
          sourcePhase: '122/192',
          normalizedPhase: '61/96',
          strictTripletPhase: '2/3',
          leadTicksVersusStrictTripletAtEnginePpq: 15,
          instruction: 'Authored cell: do not apply a second swing or random timing humanizer.',
        },
        leadPolicy: 'Shared global 5/4 bar origin and triplet-sixteenth grammar; no fixed Bass/Comp onset mask.',
      },
      generation: {
        seed: SEED,
        style: bundle.band.style,
        mode: bundle.band.mode,
        keyPitchClass: bundle.band.key as number,
        tempoBpm: bundle.arrangement.tempoBpm,
        meter: bundle.arrangement.meter,
        grooveContractId: bundle.arrangement.songGrooveContractId,
        arrangementArchetypeId: bundle.arrangement.arrangementArchetypeId,
        durationTicks: ir.durationTicks as number,
        durationSeconds: (ir.durationTicks as number) / PPQ * 60 / bundle.arrangement.tempoBpm,
        handoff: {
          tick: handoffTick,
          beat: handoffTick / PPQ,
          barNumber1: handoffTick / BAR_TICKS + 1,
          seconds: handoffTick / PPQ * 60 / bundle.arrangement.tempoBpm,
          before: ['bass', 'lead'],
          after: ['comp', 'lead'],
        },
      },
      sections: sectionRanges,
      resolvedSectionPolicies: bundle.arrangement.resolvedArchetype?.sectionPolicyById,
      roleRhythmScoreBySection: Object.fromEntries(Object.entries(bundle.arrangement.grooveScorePlan.bySection).map(
        ([sectionId, score]) => [sectionId, score.roleRhythmByRole],
      )),
      instrumentation: {
        roleProgram: bundle.instrumentation.roleProgram,
        strictRegisterByRole: bundle.instrumentation.strictRegisterByRole,
      },
      harmony,
      phaseAudit,
      roleStats,
      finalRender: {
        midiSha256: sha256(midiBytes),
        canonicalNotesSha256: sha256(canonicalNoteLines),
        noteCount: allNotes.length,
        audit: rendered.audit,
      },
      notes: allNotes,
    };

    const columns = Object.keys(allNotes[0] ?? {});
    const csv = [
      columns.join(','),
      ...allNotes.map((note) => columns.map((column) => csvEscape(note[column as keyof typeof note])).join(',')),
    ].join('\n') + '\n';

    const bass = ir.tracks.find((track) => track.role === 'bass');
    const comp = ir.tracks.find((track) => track.role === 'comp');
    const lead = ir.tracks.find((track) => track.role === 'lead');
    if (!bass || !comp || !lead) throw new Error('The Jazz 5/4 audition requires Bass, Comp, and Lead tracks');
    const bassPhases = uniqueSorted(bass.notes.map((note) => (note.startTick as number) % BAR_TICKS));
    const compPhases = uniqueSorted(comp.notes.map((note) => (note.startTick as number) % BAR_TICKS));

    expect(bundle.arrangement.meter).toEqual({ numerator: 5, denominator: 4 });
    expect(bundle.arrangement.tempoBpm).toBeCloseTo(167.000203, 6);
    expect(bassPhases).toEqual([0, 785, 1440]);
    expect(compPhases).toEqual([0, 305, 785, 960, 1440, 1920]);
    expect(bass.notes.every((note) => (note.startTick as number) < handoffTick)).toBe(true);
    expect(comp.notes.every((note) => (note.startTick as number) >= handoffTick)).toBe(true);
    expect([...midiBytes.slice(0, 4)]).toEqual([0x4d, 0x54, 0x68, 0x64]);

    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(midiPath, Buffer.from(midiBytes));
    writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(csvPath, csv);
    writeFileSync(readmePath, `# Jazz 5/4 · supplied-MIDI groove audition\n\n` +
      `This folder is generated by the production renderer, not by a parallel MIDI mock.\n\n` +
      `- Source identity: \`${TAKE_FIVE_ROLE_RHYTHM_SOURCE_SHA256}\`\n` +
      `- Engine clock: PPQ ${PPQ}, 5/4 = ${BAR_TICKS} ticks, grouping 3+2\n` +
      `- Tempo: ${bundle.arrangement.tempoBpm} BPM\n` +
      `- Bass phases: \`${bassPhases.join(', ')}\`\n` +
      `- Comp phases: \`${compPhases.join(', ')}\`\n` +
      `- Role handoff: tick ${handoffTick}, ${payload.generation.handoff.seconds.toFixed(3)} s; Bass+Lead → Comp+Lead\n` +
      `- Instruments: Bass/Comp/Lead are all acoustic piano (GM program 0)\n` +
      `- Lead remains generated: it follows the shared bar origin and subdivision grammar, not the piano ostinato onset mask.\n\n` +
      `Files:\n\n` +
      `- \`${STEM}.mid\`: final production SMF with 5/4 time-signature meta\n` +
      `- \`${STEM}.all-notes.json\`: source analysis, contract/arranger snapshots, harmony, phase audit, and every final note\n` +
      `- \`${STEM}.all-notes.csv\`: every final note in a spreadsheet-friendly table\n`);

    console.info(`MIDI: ${relative(process.cwd(), midiPath)}`);
    console.info(`JSON: ${relative(process.cwd(), jsonPath)}`);
    console.info(`CSV: ${relative(process.cwd(), csvPath)}`);
  }, 120_000);
});
