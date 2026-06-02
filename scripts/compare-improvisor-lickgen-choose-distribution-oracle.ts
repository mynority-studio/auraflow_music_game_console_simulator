import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ChordPart } from '../src/core/generation/improCore/engine/chordpart';
import { parseScales, parseVocab, setActiveScales, setActiveVocab } from '../src/core/generation/improCore/engine/vocab';
import type { Chord } from '../src/core/generation/improCore/engine/chord';

interface ChooseState {
  kind: 'lickgen-choose-state';
  pos: number;
  low: number;
  high: number;
  type: number;
  numTypes: number[];
  noteTypes: number[];
}

interface JavaChooseStateBatch {
  kind: 'lickgen-choose-state-batch';
  items: Array<ChooseState & { label: string }>;
}

type Row = [number, number, number, number, number, number, number, number];
interface JavaNoteChooserTable { kind: 'notechooser-prob-table'; rows: Row[]; }

interface TestCase {
  label: string;
  pos: number;
  low: number;
  high: number;
  chordSpec: string;
  type: number;
  lastPitch: number;
  minPitch: number;
  maxPitch: number;
}

const NOTE = 1000;
const CHORD = 1001;
const SCALE = 1002;
const COLOR = 1003;
const RANDOM = 1005;
const TYPE_SENTINELS = [CHORD, COLOR, RANDOM, SCALE];
const MIN_JUMP_UPPER_BOUND = 6;
const MELODY_GEN_LIMIT = 15;

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = join(repo, 'scripts/run-improvisor-oracle.sh');

const vocText = readFileSync(join(repo, 'src/core/generation/improCore/engine/vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText));

function javaTable(): Map<string, number[]> {
  const out = execFileSync(runOracle, ['notechooser-prob-table'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const parsed = JSON.parse(out) as JavaNoteChooserTable;
  return new Map(parsed.rows.map(row => [row.slice(0, 4).join('-'), row.slice(4)]));
}

function javaChooseStateBatch(cases: TestCase[]): Map<string, ChooseState> {
  const tmp = mkdtempSync(join(tmpdir(), 'improvisor-choose-dist-'));
  const file = join(tmp, 'cases.tsv');
  writeFileSync(file, cases.map(test => [
    test.label,
    test.pos,
    test.low,
    test.high,
    test.chordSpec,
    test.type,
    test.lastPitch,
    test.minPitch,
    test.maxPitch,
  ].join('\t')).join('\n'));
  try {
    const out = execFileSync(runOracle, ['lickgen-choose-state-batch', file], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
    const parsed = JSON.parse(out) as JavaChooseStateBatch;
    return new Map(parsed.items.map(item => [item.label, item]));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function chordPartFromSpec(spec: string): ChordPart {
  const tokens: string[] = [];
  for (const item of spec.split(',')) {
    const [name, dur] = item.trim().split(':');
    if (!name || !dur) throw new Error(`Bad chord spec: ${item}`);
    const bars = Number(dur) / 480;
    if (!Number.isInteger(bars)) throw new Error(`Only 480-slot multiples are supported: ${item}`);
    for (let i = 0; i < bars; i++) tokens.push(name);
  }
  return ChordPart.fromTokens(tokens, 480);
}

function checkNote(chord: Chord | null, pitch: number, type: number): boolean {
  if (!chord || chord.isNOCHORD()) return true;
  const pc = ((pitch % 12) + 12) % 12;
  switch (type) {
    case CHORD: return chord.getSpell().some(ns => ns.getSemitones() === pc);
    case COLOR: return chord.getColor().some(ns => ns.getSemitones() === pc);
    case SCALE: {
      const scale = chord.getFirstScalePCs();
      return scale ? scale.includes(pc) : true;
    }
    case NOTE: return true;
    default: return true;
  }
}

function getNoteTypes(chord: Chord | null, low: number, high: number): number[] {
  const out: number[] = [];
  for (let p = low; p <= high; p++) {
    if (checkNote(chord, p, CHORD)) out.push(CHORD);
    else if (checkNote(chord, p, COLOR)) out.push(COLOR);
    else out.push(RANDOM);
  }
  return out;
}

function countTypes(noteTypes: number[]): number[] {
  const counts = [0, 0, 0, 0];
  for (const t of noteTypes) {
    if (t === CHORD) { counts[0]!++; counts[3]!++; }
    else if (t === COLOR) { counts[1]!++; counts[3]!++; }
    else counts[2]!++;
  }
  return counts;
}

function tsChooseState(test: TestCase): ChooseState {
  const cp = chordPartFromSpec(test.chordSpec);
  let low = test.low;
  let high = test.high;
  let type = test.type;
  const lastPitch = test.lastPitch;

  if (low === high) {
    if (low !== lastPitch + 1) low--;
    if (high !== lastPitch - 1) high++;
  }
  if (low - lastPitch >= MIN_JUMP_UPPER_BOUND) low -= MIN_JUMP_UPPER_BOUND / 2;
  if (high - lastPitch <= -MIN_JUMP_UPPER_BOUND) high += MIN_JUMP_UPPER_BOUND / 2;
  if (low > high && low > lastPitch) low = high;
  if (high < low && high < lastPitch) high = low;
  if (type === NOTE) type = SCALE;

  const chord = cp.getCurrentChord(test.pos);
  if (!chord || chord.isNOCHORD()) type = RANDOM;

  let noteTypes: number[] = [];
  let numTypes: number[] = [0, 0, 0, 0];
  for (let j = 0; j === 0 || (type === CHORD && j < 3 && numTypes[0] === 0); j++) {
    noteTypes = getNoteTypes(chord, low, high);
    numTypes = countTypes(noteTypes);
    if (type === CHORD && numTypes[0] === 0) {
      if (low !== lastPitch + 1) low--;
      if (high !== lastPitch - 1) high++;
    }
  }

  return { kind: 'lickgen-choose-state', pos: test.pos, low, high, type, numTypes, noteTypes };
}

function typeIndex(type: number): number {
  if (type === CHORD) return 0;
  if (type === COLOR) return 1;
  if (type === RANDOM) return 2;
  if (type === SCALE) return 3;
  return 2;
}

function octaveFold(pitch: number, minPitch: number, maxPitch: number): number {
  let out = pitch;
  while (out > maxPitch) out -= 12;
  while (out < minPitch) out += 12;
  return out;
}

function add(map: Map<number, number>, pitch: number): void {
  map.set(pitch, (map.get(pitch) ?? 0) + 1);
}

function branchDistribution(
  state: ChooseState,
  test: TestCase,
  probsByKey: Map<string, number[]>,
  mode: 'java' | 'ts',
  attempt: number,
): Map<number, number> {
  const out = new Map<number, number>();
  const rowType = typeIndex(state.type);
  const key = `${rowType}-${state.numTypes[0] ? 1 : 0}-${state.numTypes[1] ? 1 : 0}-${state.numTypes[2] ? 1 : 0}`;
  const probs = probsByKey.get(key);
  if (!probs) throw new Error(`Missing probability row ${key}`);

  for (let rand1 = 1; rand1 <= 100; rand1++) {
    let remaining = rand1;
    let newType = 0;
    for (let i = 0; i < 4; i++) {
      remaining -= probs[i]!;
      if (remaining <= 0) { newType = i; break; }
    }
    const candidates = state.numTypes[newType]!;
    if (candidates <= 0) continue;
    for (let rand2 = 1; rand2 <= candidates; rand2++) {
      let nth = rand2;
      let pitchdiff = 0;
      for (let i = 0; i < state.noteTypes.length; i++) {
        const noteType = state.noteTypes[i]!;
        if (noteType === TYPE_SENTINELS[newType] || (newType === 3 && (noteType === CHORD || noteType === COLOR))) nth--;
        if (nth <= 0) { pitchdiff = i; break; }
      }
      let pitch = state.low + pitchdiff;
      if (mode === 'ts' || attempt >= MELODY_GEN_LIMIT - 1) pitch = octaveFold(pitch, test.minPitch, test.maxPitch);
      add(out, pitch);
    }
  }
  return out;
}

function mapKey(map: Map<number, number>): string {
  return JSON.stringify([...map.entries()].sort((a, b) => a[0] - b[0]));
}

const chordSources = [
  { chordSpec: 'Cmaj7:480', positions: [0] },
  { chordSpec: 'Dm7:480', positions: [0] },
  { chordSpec: 'G7:480', positions: [0] },
  { chordSpec: 'Bm7b5:480', positions: [0] },
  { chordSpec: 'Cdim7:480', positions: [0] },
  { chordSpec: 'Caug7:480', positions: [0] },
  { chordSpec: 'F#maj7:480', positions: [0] },
  { chordSpec: 'Bb7:480', positions: [0] },
  { chordSpec: 'NC:480', positions: [0] },
  { chordSpec: 'Cmaj7:480,Dm7:480,G7:480,Bm7b5:480', positions: [0, 480, 960, 1440] },
];
const types = [NOTE, CHORD, COLOR, RANDOM, SCALE];
const windows = [
  { name: 'flat', lowDelta: 0, highDelta: 0 },
  { name: 'flat-up1', lowDelta: 1, highDelta: 1 },
  { name: 'flat-down1', lowDelta: -1, highDelta: -1 },
  { name: 'up', lowDelta: 6, highDelta: 10 },
  { name: 'down', lowDelta: -10, highDelta: -6 },
  { name: 'normal', lowDelta: -3, highDelta: 4 },
  { name: 'tight-high', lowDelta: 4, highDelta: 5 },
  { name: 'tight-low', lowDelta: -5, highDelta: -4 },
  { name: 'wide', lowDelta: -12, highDelta: 12 },
];
const lastPitches = [55, 58, 60, 63, 72, 82];

const cases: TestCase[] = [];
for (const { chordSpec, positions } of chordSources) {
  for (const pos of positions) {
    for (const type of types) {
      for (const lastPitch of lastPitches) {
        for (const window of windows) {
          cases.push({
            label: `${chordSpec}:pos=${pos}:type=${type}:last=${lastPitch}:window=${window.name}`,
            pos,
            low: lastPitch + window.lowDelta,
            high: lastPitch + window.highDelta,
            chordSpec,
            type,
            lastPitch,
            minPitch: 58,
            maxPitch: 82,
          });
        }
      }
    }
  }
}

const probs = javaTable();
const javaStates = javaChooseStateBatch(cases);
let pass0 = 0, fail0 = 0, passFinal = 0, failFinal = 0;
const failures0: string[] = [];
const failuresFinal: string[] = [];

for (const test of cases) {
  const javaState = javaStates.get(test.label);
  if (!javaState) throw new Error(`Missing Java result for ${test.label}`);
  const tsState = tsChooseState(test);

  const java0 = branchDistribution(javaState, test, probs, 'java', 0);
  const ts0 = branchDistribution(tsState, test, probs, 'ts', 0);
  if (mapKey(java0) === mapKey(ts0)) pass0++;
  else {
    fail0++;
    failures0.push(`${test.label} java=${mapKey(java0)} ts=${mapKey(ts0)}`);
  }

  const javaFinal = branchDistribution(javaState, test, probs, 'java', MELODY_GEN_LIMIT - 1);
  const tsFinal = branchDistribution(tsState, test, probs, 'ts', MELODY_GEN_LIMIT - 1);
  if (mapKey(javaFinal) === mapKey(tsFinal)) passFinal++;
  else {
    failFinal++;
    failuresFinal.push(`${test.label} java=${mapKey(javaFinal)} ts=${mapKey(tsFinal)}`);
  }
}

for (const failure of failures0.slice(0, 10)) console.log(`FAIL attempt0 ${failure}`);
if (failures0.length > 10) console.log(`... ${failures0.length - 10} more attempt0 failures`);
for (const failure of failuresFinal.slice(0, 10)) console.log(`FAIL finalAttempt ${failure}`);
if (failuresFinal.length > 10) console.log(`... ${failuresFinal.length - 10} more finalAttempt failures`);

console.log(`\n=== lickgen choose-distribution oracle: attempt0 ${pass0} passed, ${fail0} failed; finalAttempt ${passFinal} passed, ${failFinal} failed; cases=${cases.length} ===`);
process.exit(fail0 === 0 && failFinal === 0 ? 0 : 1);
