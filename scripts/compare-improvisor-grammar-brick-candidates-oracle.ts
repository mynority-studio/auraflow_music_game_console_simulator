import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Grammar, type GrammarChordContext } from '../src/core/generation/improCore/engine/grammar';
import { type GList, type GVal, isGList } from '../src/core/generation/improCore/engine/terminals';
import { parseScales, parseVocab, setActiveScales, setActiveVocab } from '../src/core/generation/improCore/engine/vocab';

interface Candidate {
  lhs: GList;
  rhs: GList;
  weight: number;
}

interface JavaCandidates {
  kind: 'grammar-candidates-batch-bricks';
  items: Array<{ chordSlot: number; token: GList; candidates: Candidate[] }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = join(repo, 'scripts/run-improvisor-oracle.sh');
const grammarDir = join(repo, 'src/core/generation/improCore/data/grammars');
const START_SLOTS = 1920;
const BRICK_SLOT_LENGTH = 480;

const vocText = readFileSync(join(repo, 'src/core/generation/improCore/engine/vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText));

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return 0;
    return Number.isInteger(value) ? value : Number(value.toPrecision(15));
  }
  return value;
}

function key(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function itemKey(slot: number, token: GList): string {
  return `${slot}:${key(token)}`;
}

function toSexpr(value: GVal): string {
  if (Array.isArray(value)) return `(${value.map(toSexpr).join(' ')})`;
  return String(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function brickNames(text: string): string[] {
  return unique(Array.from(text.matchAll(/\(builtin\s+brick\s+([^\s)]+)/g), m => m[1]!));
}

function brickDurations(text: string): number[] {
  const values = Array.from(text.matchAll(/\(rule\s+\(BRICK\s+([0-9]+)/g), m => Number(m[1]));
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function tsCandidates(grammar: Grammar, token: GList, chordSlot: number, ctx: GrammarChordContext): Candidate[] {
  const g = grammar as unknown as {
    getRules(): GList;
    setVars(getValsFrom: GList, getVarsFrom: GList, toSet: GList): GList | null;
    evaluate(toParse: GVal): GVal;
    startSymbol: string | null;
    chordSlot: number;
    ctx: GrammarChordContext | null;
  };
  g.chordSlot = chordSlot;
  g.ctx = ctx;
  const out: Candidate[] = [];
  for (const next of g.getRules()) {
    if (!isGList(next) || next.length === 0 || typeof next[0] !== 'string') continue;
    if (next[0] !== 'rule' || next.length !== 4) continue;
    const rawLHS = next[1]!;
    const rawRHS = next[2]!;
    const lhs: GList = isGList(rawLHS) ? rawLHS : [rawLHS];
    let rhs: GList = isGList(rawRHS) ? rawRHS : [rawRHS];
    if (typeof token[0] !== 'string' || token[0] !== lhs[0]) continue;
    const unified = g.setVars(token, lhs, rhs);
    if (unified === null) continue;
    rhs = g.evaluate(unified) as GList;
    const filtered: GVal[] = [];
    for (const ob of rhs) {
      if (isGList(ob) && ob.length === 2 && ob[0] === g.startSymbol) {
        const arg = ob[1];
        if (typeof arg === 'number' && arg <= 0) continue;
      }
      filtered.push(ob);
    }
    const weight = g.evaluate(next[3]!) as GVal;
    if (typeof weight === 'number' && weight > 0) out.push({ lhs, rhs: filtered, weight });
  }
  return out;
}

function javaCandidatesBatch(grammarFile: string, brickSpec: string, items: Array<{ slot: number; token: GList }>, tmp: string): Map<string, Candidate[]> {
  const tokenFile = join(tmp, `${basename(grammarFile)}.brick.tokens`);
  writeFileSync(tokenFile, items.map(item => `${item.slot}\t${toSexpr(item.token)}`).join('\n'));
  const out = execFileSync(runOracle, ['grammar-candidates-batch-bricks', grammarFile, String(START_SLOTS), brickSpec, tokenFile], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
  const parsed = JSON.parse(out) as JavaCandidates;
  return new Map(parsed.items.map(item => [itemKey(item.chordSlot, item.token), item.candidates]));
}

const grammarFiles = readdirSync(grammarDir)
  .filter(file => file.endsWith('.grammar'))
  .map(file => join(grammarDir, file))
  .filter(file => readFileSync(file, 'utf8').includes('builtin brick'));

let pass = 0;
let fail = 0;
let grammars = 0;
let itemCount = 0;
const failures: string[] = [];

const tmp = mkdtempSync(join(tmpdir(), 'improvisor-grammar-brick-'));
try {
  for (const grammarFile of grammarFiles) {
    const text = readFileSync(grammarFile, 'utf8');
    const names = brickNames(text);
    const durations = brickDurations(text);
    if (names.length === 0 || durations.length === 0) continue;
    grammars++;

    const brickSpec = names.map(name => `${name}:${BRICK_SLOT_LENGTH}`).join(',');
    const slotForName = new Map(names.map((name, index) => [name, index * BRICK_SLOT_LENGTH]));
    const items: Array<{ slot: number; token: GList; brick: string }> = [];
    for (const name of names) {
      const slot = slotForName.get(name)!;
      for (const duration of durations) {
        items.push({ slot, token: ['BRICK', duration], brick: name });
      }
    }

    const grammar = Grammar.fromText(text);
    (grammar as unknown as { addStart(n: number): GList | null }).addStart(START_SLOTS);
    const ctx: GrammarChordContext = {
      familyAtSlot: () => null,
      brickNameAtSlot: slot => names[Math.floor(slot / BRICK_SLOT_LENGTH)] ?? null,
    };

    const javaByItem = javaCandidatesBatch(grammarFile, brickSpec, items, tmp);
    for (const item of items) {
      itemCount++;
      const j = javaByItem.get(itemKey(item.slot, item.token)) ?? [];
      const t = tsCandidates(grammar, item.token, item.slot, ctx);
      if (key(j) === key(t)) {
        pass++;
      } else {
        fail++;
        failures.push(`${basename(grammarFile)} brick=${item.brick} slot=${item.slot} token=${toSexpr(item.token)} java=${key(j).slice(0, 500)} ts=${key(t).slice(0, 500)}`);
      }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

for (const failure of failures.slice(0, 20)) console.log(`FAIL ${failure}`);
if (failures.length > 20) console.log(`... ${failures.length - 20} more failures`);
console.log(`\n=== grammar brick candidates oracle: ${pass} checks passed, ${fail} failed, grammars=${grammars}, items=${itemCount} ===`);
process.exit(fail === 0 ? 0 : 1);
