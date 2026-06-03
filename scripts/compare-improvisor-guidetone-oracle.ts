import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ChordPart } from '../src/core/generation/improCore/engine/chordpart';
import { parseScales, parseVocab, setActiveScales, setActiveVocab } from '../src/core/generation/improCore/engine/vocab';
import { makeGuideLine } from '../src/core/generation/motifCore/guideline';

type NoteJson = { pitch: number; startSlot: number; durationSlots: number };
type JavaGuideTone = { kind: 'guidetone'; durationSlots: number; notes: NoteJson[] };

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = process.platform === 'win32'
  ? join(repo, 'scripts/run-improvisor-oracle.cmd')
  : join(repo, 'scripts/run-improvisor-oracle.sh');
const oracleCommand = process.platform === 'win32' ? 'cmd.exe' : runOracle;

const vocText = readFileSync(join(repo, 'src/core/generation/improCore/engine/vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText));

function chordPartFromSpec(spec: string): ChordPart {
  const tokens: string[] = [];
  for (const item of spec.split(',')) {
    const [name, dur] = item.trim().split(':');
    if (!name || !dur) throw new Error(`Bad chord spec: ${item}`);
    const bars = Number(dur) / 480;
    if (!Number.isInteger(bars)) throw new Error(`Only 480-slot chords are supported in this comparator: ${item}`);
    for (let i = 0; i < bars; i++) tokens.push(name);
  }
  return ChordPart.fromTokens(tokens, 480);
}

function javaGuideTone(c: CaseDef): JavaGuideTone {
  const args = [
    'guidetone',
    c.chords,
    String(c.direction),
    c.startDegree,
    c.startDegree2,
    String(c.alternating),
    String(c.low),
    String(c.high),
    String(c.maxDuration),
    String(c.mix),
    String(c.allowColor),
  ];
  const out = execFileSync(oracleCommand, process.platform === 'win32' ? ['/c', runOracle, ...args] : args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return JSON.parse(out) as JavaGuideTone;
}

interface CaseDef {
  label: string;
  chords: string;
  direction: number;
  startDegree: string;
  startDegree2: string;
  alternating: boolean;
  low: number;
  high: number;
  maxDuration: number;
  mix: boolean;
  allowColor: boolean;
}

const cases: CaseDef[] = [
  {
    label: 'single-default-ii-v',
    chords: 'Dm7:480,G7:480,CM7:480,A7:480,Dm7:480,G7:480,CM7:480,CM7:480',
    direction: 0,
    startDegree: '3',
    startDegree2: '1',
    alternating: true,
    low: 55,
    high: 84,
    maxDuration: 240,
    mix: false,
    allowColor: true,
  },
  {
    label: 'single-desc-twy',
    chords: 'EbM7:480,EbM7:480,Dm7b5:480,G7:480,Cm7:480,Cm7:480,Bbm7:480,Eb7:480',
    direction: -1,
    startDegree: '3',
    startDegree2: '1',
    alternating: true,
    low: 55,
    high: 84,
    maxDuration: 240,
    mix: false,
    allowColor: true,
  },
  {
    label: 'two-line-mix',
    chords: 'Dm7:480,G7:480,CM7:480,A7:480',
    direction: 0,
    startDegree: '3',
    startDegree2: '7',
    alternating: true,
    low: 55,
    high: 84,
    maxDuration: 240,
    mix: true,
    allowColor: true,
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const java = javaGuideTone(c).notes;
  const ts = makeGuideLine(chordPartFromSpec(c.chords), {
    direction: c.direction,
    startDegree: c.startDegree,
    startDegree2: c.startDegree2,
    alternating: c.alternating,
    mix: c.mix,
    allowColor: c.allowColor,
    lowLimit: c.low,
    highLimit: c.high,
    maxDuration: c.maxDuration,
  }).map(({ pitch, startSlot, durationSlots }) => ({ pitch, startSlot, durationSlots }));

  if (ts && JSON.stringify(java) === JSON.stringify(ts)) {
    pass++;
    console.log(`OK ${c.label} notes=${java.length}`);
  } else {
    fail++;
    console.log(`FAIL ${c.label}`);
    console.log(`  java=${JSON.stringify(java)}`);
    console.log(`  ts  =${ts ? JSON.stringify(ts) : 'MISSING: TS has no two-line/mix GuideTone implementation'}`);
  }
}

console.log(`\n=== guidetone oracle: ${pass} passed, ${fail} failed ===`);
