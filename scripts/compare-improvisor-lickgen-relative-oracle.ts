import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Chord } from '../src/core/generation/improCore/engine/chord';
import { makeRelativeNote } from '../src/core/generation/improCore/engine/lickgen';
import { parseScales, parseVocab, setActiveScales, setActiveVocab } from '../src/core/generation/improCore/engine/vocab';
import { readSexpr } from '../src/core/generation/improCore/data/sexpr-reader';
import { numberize, type GList } from '../src/core/generation/improCore/engine/terminals';

interface JavaRelativeRun {
  kind: 'relative-note';
  input: string;
  chord: string;
  note: null | { pitch: number; durationSlots: number; leadsheet: string };
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = join(repo, 'scripts/run-improvisor-oracle.sh');

const vocText = readFileSync(join(repo, 'src/core/generation/improCore/engine/vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText));

function javaRelativeBatch(cases: Array<{ input: string; chord: string }>): JavaRelativeRun[] {
  const tmp = mkdtempSync(join(tmpdir(), 'improvisor-relative-'));
  const file = join(tmp, 'cases.tsv');
  writeFileSync(file, cases.map(c => `${c.chord}\t${c.input}`).join('\n'));
  const out = execFileSync(runOracle, ['relative-note-batch', file], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  rmSync(tmp, { recursive: true, force: true });
  return JSON.parse(out) as JavaRelativeRun[];
}

function tsRelative(input: string, chordName: string): JavaRelativeRun['note'] {
  const chord = Chord.makeChord(chordName, 480);
  if (!chord) throw new Error(`Bad TS chord: ${chordName}`);
  const item = numberize(readSexpr(input)) as GList;
  const note = makeRelativeNote(item, chord);
  return note ? { pitch: note.pitch, durationSlots: note.duration, leadsheet: '' } : null;
}

function sameNote(javaNote: JavaRelativeRun['note'], tsNote: JavaRelativeRun['note']): boolean {
  if (javaNote === null || tsNote === null) return javaNote === tsNote;
  return javaNote.pitch === tsNote.pitch && javaNote.durationSlots === tsNote.durationSlots;
}

const chords = [
  'Cmaj7',
  'Dm7',
  'G7',
  'Bm7b5',
  'Cdim7',
  'Caug7',
  'F#maj7',
  'Bb7',
];

const degrees = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '-1', 'b3', '#4', 'b9'];
const durations = ['8', '4'];

const cases: Array<{ chord: string; input: string }> = [];

for (const chord of chords) {
  for (const degree of degrees) {
    for (const dur of durations) {
      cases.push({ chord, input: `(X ${degree} ${dur})` });
    }
  }
}

let pass = 0;
let fail = 0;
const javaRuns = javaRelativeBatch(cases);

for (let i = 0; i < cases.length; i++) {
  const test = cases[i]!;
  const java = javaRuns[i]!;
  const ts = tsRelative(test.input, test.chord);
  if (sameNote(java.note, ts)) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL chord=${test.chord} input=${test.input}`);
    console.log(`  java=${JSON.stringify(java.note)}`);
    console.log(`  ts  =${JSON.stringify(ts)}`);
  }
}

console.log(`=== lickgen relative-note oracle: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
