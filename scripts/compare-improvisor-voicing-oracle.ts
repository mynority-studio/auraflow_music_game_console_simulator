import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_VOICING_SETTINGS, generateVoicing } from '../src/core/generation/improCore/engine/voicing';

interface JavaVoicing {
  kind: 'voicing';
  left: number[];
  right: number[];
  chord: number[];
}

interface CaseDef {
  label: string;
  priority: number[];
  color: number[];
  root: number;
  low: number;
  high: number;
  numNotes: number;
  rightLow: number;
  rightHigh: number;
  numNotesRight: number;
  previous: number[] | null;
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = join(repo, 'scripts/run-improvisor-oracle.sh');

class JavaRandom {
  private seed: bigint;
  private static readonly multiplier = 0x5DEECE66Dn;
  private static readonly addend = 0xBn;
  private static readonly mask = (1n << 48n) - 1n;

  constructor(seed: number | bigint) {
    this.seed = (BigInt(seed) ^ JavaRandom.multiplier) & JavaRandom.mask;
  }

  private next(bits: number): number {
    this.seed = (this.seed * JavaRandom.multiplier + JavaRandom.addend) & JavaRandom.mask;
    return Number(this.seed >> (48n - BigInt(bits)));
  }

  nextDouble(): number {
    return (this.next(26) * 0x8000000 + this.next(27)) / 0x20000000000000;
  }
}

function withJavaMathRandom<T>(seed: number, fn: () => T): T {
  const oldRandom = Math.random;
  const rng = new JavaRandom(seed);
  Math.random = () => rng.nextDouble();
  try {
    return fn();
  } finally {
    Math.random = oldRandom;
  }
}

function csv(values: number[] | null): string {
  return values === null || values.length === 0 ? '-' : values.join(',');
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function applyAuraFlowMinorNinthShift(values: number[]): number[] {
  const notes = [...values].sort((a, b) => a - b);
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      if (notes[j]! - notes[i]! === 13) notes[i] = notes[i]! + 1;
    }
  }
  return sortedUnique(notes);
}

function javaVoicing(c: CaseDef, seed: number): JavaVoicing {
  const s = DEFAULT_VOICING_SETTINGS;
  const out = execFileSync(runOracle, [
    'voicing',
    String(seed),
    csv(c.priority),
    csv(c.color),
    String(c.root),
    String(c.low),
    String(c.high),
    String(c.numNotes),
    String(c.rightLow),
    String(c.rightHigh),
    String(c.numNotesRight),
    csv(c.previous),
    String(s.previousVoicingMultiplier),
    String(s.halfStepAwayMultiplier),
    String(s.fullStepAwayMultiplier),
    String(s.priorityMultiplier),
    String(s.repeatMultiplier),
    String(s.halfStepReducer),
    String(s.fullStepReducer),
  ], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return JSON.parse(out) as JavaVoicing;
}

function tsVoicing(c: CaseDef, seed: number): number[] {
  return withJavaMathRandom(seed, () => generateVoicing({
    priority: c.priority,
    color: c.color,
    rootMidi: c.root,
    low: c.low,
    high: c.high,
    numNotes: c.numNotes,
    rightLow: c.rightLow,
    rightHigh: c.rightHigh,
    numNotesRight: c.numNotesRight,
    previousVoicing: c.previous,
    settings: DEFAULT_VOICING_SETTINGS,
  }));
}

const cases: CaseDef[] = [
  { label: 'Cmaj7-rootless-two-hands', priority: [60, 64, 67, 71], color: [62, 69], root: 60, low: 48, high: 64, numNotes: 2, rightLow: 60, rightHigh: 76, numNotesRight: 2, previous: null },
  { label: 'Dm7-with-prev', priority: [62, 65, 69, 72], color: [64, 67, 71], root: 62, low: 48, high: 65, numNotes: 2, rightLow: 60, rightHigh: 77, numNotesRight: 2, previous: [52, 59, 64, 69] },
  { label: 'G7-with-prev', priority: [55, 59, 62, 65], color: [57, 64, 68], root: 55, low: 43, high: 62, numNotes: 2, rightLow: 58, rightHigh: 78, numNotesRight: 2, previous: [50, 57, 62, 67] },
  { label: 'Bm7b5-m9-pressure', priority: [59, 62, 65, 69], color: [60, 64, 67], root: 59, low: 47, high: 66, numNotes: 3, rightLow: 59, rightHigh: 79, numNotesRight: 2, previous: [58, 64, 70, 76] },
];

const seeds = Array.from({ length: 50 }, (_, i) => i + 1);
let pass = 0;
let expectedDiff = 0;
let unexpectedFail = 0;

for (const c of cases) {
  for (const seed of seeds) {
    const java = javaVoicing(c, seed);
    const ts = tsVoicing(c, seed);
    const javaSet = sortedUnique(java.chord);
    if (JSON.stringify(javaSet) === JSON.stringify(ts)) {
      pass++;
    } else if (JSON.stringify(applyAuraFlowMinorNinthShift(javaSet)) === JSON.stringify(ts)) {
      expectedDiff++;
      console.log(`EXPECTED_DIFF ${c.label} seed=${seed} reason=AuraFlow applies minor-ninth shift; Java VoicingGenerator.invertM9th leaves hands unchanged`);
      console.log(`  javaRaw=${JSON.stringify(java.chord)} javaSorted=${JSON.stringify(javaSet)}`);
      console.log(`  ts     =${JSON.stringify(ts)}`);
    } else {
      unexpectedFail++;
      console.log(`FAIL ${c.label} seed=${seed}`);
      console.log(`  javaRaw=${JSON.stringify(java.chord)} javaSorted=${JSON.stringify(javaSet)}`);
      console.log(`  ts     =${JSON.stringify(ts)}`);
    }
  }
}

console.log(`\n=== voicing oracle: ${pass} strict passed, ${expectedDiff} expected minor-ninth diffs, ${unexpectedFail} unexpected failed ===`);
process.exit(unexpectedFail === 0 ? 0 : 1);
