import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Grammar, type GrammarChordContext } from '../src/core/generation/improCore/engine/grammar';
import { ChordPart } from '../src/core/generation/improCore/engine/chordpart';
import { type GList, type GVal, isGList, isTerminal } from '../src/core/generation/improCore/engine/terminals';
import { parseScales, parseVocab, setActiveScales, setActiveVocab } from '../src/core/generation/improCore/engine/vocab';

interface Candidate {
  lhs: GList;
  rhs: GList;
  weight: number;
}

interface JavaCandidates {
  kind: 'grammar-candidates-batch-chords';
  items: Array<{ chordSlot: number; token: GList; candidates: Candidate[] }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = process.platform === 'win32'
  ? join(repo, 'scripts/run-improvisor-oracle.cmd')
  : join(repo, 'scripts/run-improvisor-oracle.sh');
const oracleCommand = process.platform === 'win32' ? 'cmd.exe' : runOracle;
const grammarFile = join(repo, 'src/core/generation/improCore/data/grammars/Bergonzi-method.grammar');
const START_SLOTS = 1920;
const CHORD_SPEC = 'Cmaj7:480,Dm7:480,G7:480,Bm7b5:480,Cdim7:480,Caug7:480,C7sus4:480';
const CHORD_SLOTS = [0, 480, 960, 1440, 1920, 2400, 2880];
const MAX_TOKENS = 5000;

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

function chordPartFromSpec(chordSpec: string): ChordPart {
  const tokens: string[] = [];
  for (const item of chordSpec.split(',')) {
    const [name, dur] = item.trim().split(':');
    if (!name || !dur) throw new Error(`Bad chord spec: ${item}`);
    const bars = Number(dur) / 480;
    if (!Number.isInteger(bars)) throw new Error(`Only 480-slot bar specs are supported: ${item}`);
    for (let i = 0; i < bars; i++) tokens.push(name);
  }
  return ChordPart.fromTokens(tokens, 480);
}

function javaCandidatesBatch(items: Array<{ slot: number; token: GList }>, tmp: string): Map<string, Candidate[]> {
  const tokenFile = join(tmp, `${basename(grammarFile)}.chord-family.tokens`);
  writeFileSync(tokenFile, items.map(item => `${item.slot}\t${toSexpr(item.token)}`).join('\n'));
  const args = ['grammar-candidates-batch-chords', grammarFile, String(START_SLOTS), CHORD_SPEC, tokenFile];
  const out = execFileSync(oracleCommand, process.platform === 'win32' ? ['/c', runOracle, ...args] : args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const parsed = JSON.parse(out) as JavaCandidates;
  return new Map(parsed.items.map(item => [itemKey(item.chordSlot, item.token), item.candidates]));
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

function startSymbol(grammar: Grammar): string {
  for (const form of grammar.getRules()) {
    if (isGList(form) && form[0] === 'startsymbol' && typeof form[1] === 'string') return form[1];
  }
  throw new Error('No startsymbol');
}

function childNonTerminals(rhs: GList): GList[] {
  const out: GList[] = [];
  for (const item of rhs) {
    if (isTerminal(item)) continue;
    if (isGList(item)) out.push(item);
    else if (typeof item === 'string') out.push([item]);
  }
  return out;
}

const cp = chordPartFromSpec(CHORD_SPEC);
const ctx: GrammarChordContext = {
  familyAtSlot: slot => cp.getCurrentChord(slot)?.getFamily() ?? null,
  brickNameAtSlot: () => null,
};
const grammar = Grammar.fromText(readFileSync(grammarFile, 'utf8'));
(grammar as unknown as { addStart(n: number): GList | null }).addStart(START_SLOTS);
const start = startSymbol(grammar);

const queue: Array<{ slot: number; token: GList }> = CHORD_SLOTS.map(slot => ({ slot, token: [start, START_SLOTS] }));
const seen = new Set<string>();
const items: Array<{ slot: number; token: GList }> = [];

while (queue.length > 0 && seen.size < MAX_TOKENS) {
  const item = queue.shift()!;
  const seenKey = itemKey(item.slot, item.token);
  if (seen.has(seenKey)) continue;
  seen.add(seenKey);
  items.push(item);
  for (const cand of tsCandidates(grammar, item.token, item.slot, ctx)) {
    for (const child of childNonTerminals(cand.rhs)) {
      if (!seen.has(itemKey(item.slot, child))) queue.push({ slot: item.slot, token: child });
    }
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'improvisor-grammar-chord-family-'));
let pass = 0;
let fail = 0;
const failures: string[] = [];

try {
  const javaByItem = javaCandidatesBatch(items, tmp);
  for (const item of items) {
    const j = javaByItem.get(itemKey(item.slot, item.token)) ?? [];
    const t = tsCandidates(grammar, item.token, item.slot, ctx);
    if (key(j) === key(t)) {
      pass++;
    } else {
      fail++;
      const family = cp.getCurrentChord(item.slot)?.getFamily() ?? 'null';
      failures.push(`slot=${item.slot} family=${family} token=${toSexpr(item.token)} java=${key(j).slice(0, 500)} ts=${key(t).slice(0, 500)}`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

for (const failure of failures.slice(0, 20)) console.log(`FAIL ${failure}`);
if (failures.length > 20) console.log(`... ${failures.length - 20} more failures`);
console.log(`\n=== grammar chord-family candidates oracle: ${pass} checks passed, ${fail} failed, grammar=${basename(grammarFile)}, slots=${CHORD_SLOTS.length}, items=${items.length} ===`);
process.exit(fail === 0 ? 0 : 1);
