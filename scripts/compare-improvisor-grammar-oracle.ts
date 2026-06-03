import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Grammar } from '../src/core/generation/improCore/engine/grammar';
import { getDurationAbstractMelody, type GList } from '../src/core/generation/improCore/engine/terminals';
import { ChordPart } from '../src/core/generation/improCore/engine/chordpart';
import { parseScales, parseVocab, setActiveScales, setActiveVocab } from '../src/core/generation/improCore/engine/vocab';

interface JavaGrammarRun {
  kind: 'grammar-run';
  grammarFile: string;
  slots: number;
  durationSlots: number;
  sexpr: string;
  tokens: unknown[];
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = process.platform === 'win32'
  ? join(repo, 'scripts/run-improvisor-oracle.cmd')
  : join(repo, 'scripts/run-improvisor-oracle.sh');
const oracleCommand = process.platform === 'win32' ? 'cmd.exe' : runOracle;

const vocText = readFileSync(join(repo, 'src/core/generation/improCore/engine/vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText));

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

function javaGrammarRun(grammarFile: string, slots: number, seed?: number, chordSpec?: string): JavaGrammarRun {
  const args = chordSpec === undefined
    ? ['grammar-run', grammarFile, String(slots)]
    : ['grammar-run-chords', grammarFile, String(slots), chordSpec];
  if (seed !== undefined) args.push(String(seed));
  const out = execFileSync(oracleCommand, process.platform === 'win32' ? ['/c', runOracle, ...args] : args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return JSON.parse(out) as JavaGrammarRun;
}

function chordPartFromSpec(chordSpec: string): ChordPart {
  const tokens: string[] = [];
  for (const item of chordSpec.split(',')) {
    const [name, dur] = item.trim().split(':');
    if (!name || !dur) throw new Error(`Bad chord spec: ${item}`);
    const bars = Number(dur) / 480;
    if (!Number.isInteger(bars)) throw new Error(`Only 480-slot bar specs are supported in TS comparator: ${item}`);
    for (let i = 0; i < bars; i++) tokens.push(name);
  }
  return ChordPart.fromTokens(tokens, 480);
}

function tsGrammarRun(grammarFile: string, slots: number, seed?: number, chordSpec?: string): { tokens: GList; durationSlots: number } {
  const grammar = Grammar.fromText(readFileSync(grammarFile, 'utf8'));
  const cp = chordSpec === undefined ? null : chordPartFromSpec(chordSpec);
  const ctx = cp === null ? undefined : {
    familyAtSlot: (slot: number) => cp.getCurrentChord(slot)?.getFamily() ?? null,
    brickNameAtSlot: () => null,
  };
  const tokens = seed === undefined
    ? grammar.run(slots, ctx)
    : withJavaMathRandom(seed, () => grammar.run(slots, ctx));
  return { tokens, durationSlots: getDurationAbstractMelody(tokens) };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compare(label: string, grammarFile: string, slots: number, seed?: number, chordSpec?: string): boolean {
  const java = javaGrammarRun(grammarFile, slots, seed, chordSpec);
  const ts = tsGrammarRun(grammarFile, slots, seed, chordSpec);
  const okTokens = sameJson(java.tokens, ts.tokens);
  const okDuration = java.durationSlots === ts.durationSlots;
  if (okTokens && okDuration) {
    console.log(`  OK ${label} slots=${slots}${seed === undefined ? '' : ` seed=${seed}`} tokens=${java.tokens.length} duration=${java.durationSlots}`);
    return true;
  }

  console.log(`  FAIL ${label} slots=${slots}${seed === undefined ? '' : ` seed=${seed}`}`);
  if (!okDuration) console.log(`    duration java=${java.durationSlots} ts=${ts.durationSlots}`);
  if (!okTokens) {
    const max = Math.max(java.tokens.length, ts.tokens.length);
    for (let i = 0; i < max; i++) {
      if (!sameJson(java.tokens[i], ts.tokens[i])) {
        console.log(`    firstDiff index=${i}`);
        console.log(`    java=${JSON.stringify(java.tokens[i])}`);
        console.log(`    ts  =${JSON.stringify(ts.tokens[i])}`);
        break;
      }
    }
    console.log(`    javaLen=${java.tokens.length} tsLen=${ts.tokens.length}`);
  }
  return false;
}

const deterministicFiles = [
  'src/core/generation/improCore/data/grammars/_quarterNote.grammar',
  'src/core/generation/improCore/data/grammars/_halfNote.grammar',
  'src/core/generation/improCore/data/grammars/_wholeNote.grammar',
  'src/core/generation/improCore/data/grammars/_dottedHalfNote.grammar',
];

const realNoBuiltinFiles = [
  'src/core/generation/improCore/data/grammars/Bach.grammar',
  'src/core/generation/improCore/data/grammars/BillWatrous.grammar',
  'src/core/generation/improCore/data/grammars/CannonballAdderley.grammar',
  'src/core/generation/improCore/data/grammars/DexterGordon.grammar',
  'src/core/generation/improCore/data/grammars/Garzone-TriadicChord.grammar',
  'src/core/generation/improCore/data/grammars/Garzone-TriadicColor.grammar',
  'src/core/generation/improCore/data/grammars/JJJohnson.grammar',
  'src/core/generation/improCore/data/grammars/KeithJarrrett.grammar',
  'src/core/generation/improCore/data/grammars/ParkerMotif.grammar',
  'src/core/generation/improCore/data/grammars/PaulDesmondTake5.grammar',
  'src/core/generation/improCore/data/grammars/TomHarrell-Waltzes.grammar',
  'src/core/generation/improCore/data/grammars/WardellGray.grammar',
  'src/core/generation/improCore/data/grammars/WoodyShaw.grammar',
  'src/core/generation/improCore/data/grammars/chord+approach.grammar',
  'src/core/generation/improCore/data/grammars/chord.grammar',
  'src/core/generation/improCore/data/grammars/color.grammar',
  'src/core/generation/improCore/data/grammars/idiom.grammar',
  'src/core/generation/improCore/data/grammars/outside.grammar',
];

const CHORD_CONTEXT = 'Cmaj7:480,Dm7:480,G7:480,Cmaj7:480';

const tmp = mkdtempSync(join(tmpdir(), 'improvisor-oracle-'));
let pass = 0;
let fail = 0;

try {
  const mini = join(tmp, 'deterministic-mini.grammar');
  writeFileSync(mini, `
(startsymbol P)
(rule (P Y) ((BRICK 480) (P (- Y 480))) 1.0)
(rule (BRICK 480) (C8 C8 C8 C8 C8 C8 C8 C8) 1.0)
`);

  const weighted = join(tmp, 'weighted-mini.grammar');
  writeFileSync(weighted, `
(startsymbol P)
(rule (P Y) ((BRICK 480) (P (- Y 480))) 1.0)
(rule (BRICK 480) (C8 C8 C8 C8 C8 C8 C8 C8) 1.0)
(rule (BRICK 480) (L8 L8 L8 L8 L8 L8 L8 L8) 2.0)
(rule (BRICK 480) (R4 R4 R4 R4) 3.0)
`);

  const cases: Array<[string, string, number, number?, string?]> = [
    ['mini-480', mini, 480],
    ['mini-960', mini, 960],
    ...[1, 2, 3, 42, 999].flatMap((seed): Array<[string, string, number, number]> => [
      [`weighted-mini-480`, weighted, 480, seed],
      [`weighted-mini-1920`, weighted, 1920, seed],
    ]),
    ...deterministicFiles.flatMap((file): Array<[string, string, number]> => [
      [`${basename(file)}-480`, join(repo, file), 480],
      [`${basename(file)}-960`, join(repo, file), 960],
    ]),
    ...realNoBuiltinFiles.flatMap((file): Array<[string, string, number, number]> =>
      [1, 2, 42].map(seed => [`real-${basename(file)}`, join(repo, file), 1920, seed])),
    ...[1, 2, 42].map((seed): [string, string, number, number, string] => [
      'builtin-Bergonzi-method.grammar',
      join(repo, 'src/core/generation/improCore/data/grammars/Bergonzi-method.grammar'),
      1920,
      seed,
      CHORD_CONTEXT,
    ]),
  ];

  for (const [label, file, slots, seed, chordSpec] of cases) {
    if (compare(label, file, slots, seed, chordSpec)) pass++;
    else fail++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== grammar oracle: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
