import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Row = [number, number, number, number, number, number, number, number];

interface JavaNoteChooserTable {
  kind: 'notechooser-prob-table';
  rows: Row[];
}

interface JavaBranchSpace {
  kind: 'notechooser-branch-space';
  distribution: Record<string, number>;
  totalBranches: number;
}

const NOTE = 1000;
const CHORD = 1001;
const SCALE = 1002;
const COLOR = 1003;
const RANDOM = 1005;
const TYPE_SENTINELS = [CHORD, COLOR, RANDOM, SCALE];

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = join(repo, 'scripts/run-improvisor-oracle.sh');

function javaTableRows(): Row[] {
  const out = execFileSync(runOracle, ['notechooser-prob-table'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return (JSON.parse(out) as JavaNoteChooserTable).rows;
}

function tsTable(): Map<string, number[]> {
  const source = readFileSync(join(repo, 'src/core/generation/improCore/engine/lickgen.ts'), 'utf8');
  const table = new Map<string, number[]>();
  const entryRe = /\['([^']+)',\s*\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(source)) !== null) {
    const values = match[2]!.split(',').map(s => Number(s.trim()));
    if (values.length === 4 && values.every(Number.isFinite)) table.set(match[1]!, values);
  }
  return table;
}

function csv(values: number[]): string {
  return values.join(',');
}

function javaBranchSpace(test: TestCase): Map<number, number> {
  const out = execFileSync(runOracle, [
    'notechooser-branch-space',
    String(test.minPitch),
    String(test.maxPitch),
    String(test.low),
    String(test.high),
    String(test.type),
    csv(test.numTypes),
    csv(test.noteTypes),
    String(test.attempt),
    String(test.doNotSwitchOctave),
  ], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const parsed = JSON.parse(out) as JavaBranchSpace;
  return new Map(Object.entries(parsed.distribution).map(([pitch, count]) => [Number(pitch), count]));
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

function typeIndex(type: number): number {
  if (type === CHORD) return 0;
  if (type === COLOR) return 1;
  if (type === RANDOM) return 2;
  if (type === SCALE) return 3;
  return 2;
}

function addCount(map: Map<number, number>, pitch: number, count: number): void {
  map.set(pitch, (map.get(pitch) ?? 0) + count);
}

function tsBranchSpace(test: TestCase, probTable: Map<string, number[]>): Map<number, number> {
  const out = new Map<number, number>();
  const t = typeIndex(test.type);
  const hC = test.numTypes[0] ? 1 : 0;
  const hL = test.numTypes[1] ? 1 : 0;
  const hR = test.numTypes[2] ? 1 : 0;
  const probs = probTable.get(`${t}-${hC}-${hL}-${hR}`);
  if (!probs) throw new Error(`Missing TS probability row ${t}-${hC}-${hL}-${hR}`);

  for (let rand1 = 1; rand1 <= 100; rand1++) {
    let remaining = rand1;
    let newType = 0;
    for (let i = 0; i < 4; i++) {
      remaining -= probs[i]!;
      if (remaining <= 0) {
        newType = i;
        break;
      }
    }
    const candidates = test.numTypes[newType]!;
    if (candidates <= 0) continue;
    for (let rand2 = 1; rand2 <= candidates; rand2++) {
      let nth = rand2;
      let pitchdiff = 0;
      for (let i = 0; i < test.noteTypes.length; i++) {
        const noteType = test.noteTypes[i]!;
        if (noteType === TYPE_SENTINELS[newType] || (newType === 3 && (noteType === CHORD || noteType === COLOR))) nth--;
        if (nth <= 0) {
          pitchdiff = i;
          break;
        }
      }
      addCount(out, test.low + pitchdiff, 1);
    }
  }
  return out;
}

interface TestCase {
  label: string;
  minPitch: number;
  maxPitch: number;
  low: number;
  high: number;
  type: number;
  numTypes: number[];
  noteTypes: number[];
  attempt: number;
  doNotSwitchOctave: boolean;
}

function noteTypesFor(haveChord: number, haveColor: number, haveRandom: number, repeats: number, offset: number): number[] {
  const grouped: number[] = [];
  for (let i = 0; i < repeats; i++) {
    if (haveChord) grouped.push(CHORD);
    if (haveColor) grouped.push(COLOR);
    if (haveRandom) grouped.push(RANDOM);
  }
  if (grouped.length === 0) throw new Error('No note types generated');
  const rot = ((offset % grouped.length) + grouped.length) % grouped.length;
  return grouped.slice(rot).concat(grouped.slice(0, rot));
}

function mapKey(map: Map<number, number>): string {
  return JSON.stringify([...map.entries()].sort((a, b) => a[0] - b[0]));
}

const rows = javaTableRows();
const probs = tsTable();
const cases: TestCase[] = [];

for (const row of rows) {
  const [rowType, haveChord, haveColor, haveRandom] = row;
  const type = TYPE_SENTINELS[rowType]!;
  for (const [label, repeats, offset] of [['single', 1, 0], ['double', 2, 1], ['triple', 3, 2]] as const) {
    const noteTypes = noteTypesFor(haveChord, haveColor, haveRandom, repeats, offset);
    cases.push({
      label: `${label}:row=${row.slice(0, 4).join('-')}`,
      minPitch: 58,
      maxPitch: 82,
      low: 60,
      high: 60 + noteTypes.length - 1,
      type,
      numTypes: countTypes(noteTypes),
      noteTypes,
      attempt: 0,
      doNotSwitchOctave: false,
    });
  }
}

let pass = 0;
let fail = 0;
const failures: string[] = [];

for (const test of cases) {
  const j = javaBranchSpace(test);
  const t = tsBranchSpace(test, probs);
  if (mapKey(j) === mapKey(t)) {
    pass++;
  } else {
    fail++;
    failures.push(`${test.label} noteTypes=${csv(test.noteTypes)} java=${mapKey(j)} ts=${mapKey(t)}`);
  }
}

for (const failure of failures.slice(0, 20)) console.log(`FAIL ${failure}`);
if (failures.length > 20) console.log(`... ${failures.length - 20} more failures`);
console.log(`\n=== notechooser branch oracle: ${pass} checks passed, ${fail} failed, cases=${cases.length} ===`);
process.exit(fail === 0 ? 0 : 1);
