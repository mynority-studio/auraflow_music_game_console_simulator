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
const MIN_JUMP_UPPER_BOUND = 6;

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = join(repo, 'scripts/run-improvisor-oracle.sh');

const vocText = readFileSync(join(repo, 'src/core/generation/improCore/engine/vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText));

function javaChooseStateBatch(cases: TestCase[]): Map<string, ChooseState> {
  const tmp = mkdtempSync(join(tmpdir(), 'improvisor-choose-state-'));
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
    case CHORD:
      return chord.getSpell().some(ns => ns.getSemitones() === pc);
    case COLOR:
      return chord.getColor().some(ns => ns.getSemitones() === pc);
    case SCALE: {
      const scale = chord.getFirstScalePCs();
      return scale ? scale.includes(pc) : true;
    }
    case NOTE:
      return true;
    default:
      return true;
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
    if (t === CHORD) {
      counts[0]!++;
      counts[3]!++;
    } else if (t === COLOR) {
      counts[1]!++;
      counts[3]!++;
    } else {
      counts[2]!++;
    }
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

function key(state: ChooseState): string {
  return JSON.stringify({
    low: state.low,
    high: state.high,
    type: state.type,
    numTypes: state.numTypes,
    noteTypes: state.noteTypes,
  });
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

let pass = 0;
let fail = 0;
const failures: string[] = [];
const javaByLabel = javaChooseStateBatch(cases);

for (const test of cases) {
  const java = javaByLabel.get(test.label);
  if (!java) throw new Error(`Missing Java result for ${test.label}`);
  const ts = tsChooseState(test);
  if (key(java) === key(ts)) {
    pass++;
  } else {
    fail++;
    failures.push(`${test.label} java=${key(java)} ts=${key(ts)}`);
  }
}

for (const failure of failures.slice(0, 20)) console.log(`FAIL ${failure}`);
if (failures.length > 20) console.log(`... ${failures.length - 20} more failures`);
console.log(`\n=== lickgen choose-state oracle: ${pass} checks passed, ${fail} failed, cases=${cases.length} ===`);
process.exit(fail === 0 ? 0 : 1);
