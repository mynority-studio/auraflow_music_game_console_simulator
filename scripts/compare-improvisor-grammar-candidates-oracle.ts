import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Grammar } from '../src/core/generation/improCore/engine/grammar';
import { type GList, type GVal, isGList, isTerminal } from '../src/core/generation/improCore/engine/terminals';

interface Candidate {
  lhs: GList;
  rhs: GList;
  weight: number;
}

interface JavaCandidates {
  kind: 'grammar-candidates-batch';
  items: Array<{ token: GList; candidates: Candidate[] }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = process.platform === 'win32'
  ? join(repo, 'scripts/run-improvisor-oracle.cmd')
  : join(repo, 'scripts/run-improvisor-oracle.sh');
const oracleCommand = process.platform === 'win32' ? 'cmd.exe' : runOracle;
const grammarDir = join(repo, 'src/core/generation/improCore/data/grammars');
const START_SLOTS = 1920;
const MAX_TOKENS_PER_GRAMMAR = 2000;

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

function toSexpr(value: GVal): string {
  if (Array.isArray(value)) return `(${value.map(toSexpr).join(' ')})`;
  return String(value);
}

function javaCandidatesBatch(grammarFile: string, tokens: GList[], tmp: string): Map<string, Candidate[]> {
  const tokenFile = join(tmp, `${basename(grammarFile)}.tokens`);
  writeFileSync(tokenFile, tokens.map(toSexpr).join('\n'));
  const args = ['grammar-candidates-batch', grammarFile, String(START_SLOTS), tokenFile];
  const out = execFileSync(oracleCommand, process.platform === 'win32' ? ['/c', runOracle, ...args] : args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const parsed = JSON.parse(out) as JavaCandidates;
  return new Map(parsed.items.map(item => [key(item.token), item.candidates]));
}

function tsCandidates(grammar: Grammar, token: GList): Candidate[] {
  const g = grammar as unknown as {
    getRules(): GList;
    setVars(getValsFrom: GList, getVarsFrom: GList, toSet: GList): GList | null;
    evaluate(toParse: GVal): GVal;
    startSymbol: string | null;
  };
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

function startSymbol(grammar: Grammar): string | null {
  for (const form of grammar.getRules()) {
    if (isGList(form) && form[0] === 'startsymbol' && typeof form[1] === 'string') return form[1];
  }
  return null;
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

const files = readdirSync(grammarDir)
  .filter(f => f.endsWith('.grammar'))
  .sort()
  .map(f => join(grammarDir, f))
  .filter(f => !readFileSync(f, 'utf8').includes('(builtin'));

let grammarPass = 0;
let grammarFail = 0;
let tokenChecks = 0;
const failures: string[] = [];
const tmp = mkdtempSync(join(tmpdir(), 'improvisor-grammar-candidates-'));

try {
  for (const file of files) {
    const grammar = Grammar.fromText(readFileSync(file, 'utf8'));
    const s = startSymbol(grammar);
    if (!s) {
      grammarFail++;
      failures.push(`${basename(file)}: no startsymbol`);
      continue;
    }
    (grammar as unknown as { addStart(n: number): GList | null }).addStart(START_SLOTS);

    const queue: GList[] = [[s, START_SLOTS]];
    const seen = new Set<string>();
    const tokens: GList[] = [];
    while (queue.length > 0 && seen.size < MAX_TOKENS_PER_GRAMMAR) {
      const token = queue.shift()!;
      const tokenKey = key(token);
      if (seen.has(tokenKey)) continue;
      seen.add(tokenKey);
      tokens.push(token);
      for (const cand of tsCandidates(grammar, token)) {
        for (const child of childNonTerminals(cand.rhs)) {
          if (!seen.has(key(child))) queue.push(child);
        }
      }
    }

    const javaByToken = javaCandidatesBatch(file, tokens, tmp);
    let ok = true;
    for (const token of tokens) {
      const j = javaByToken.get(key(token)) ?? [];
      const t = tsCandidates(grammar, token);
      tokenChecks++;
      if (key(j) !== key(t)) {
        ok = false;
        failures.push(`${basename(file)} token=${toSexpr(token)} java=${key(j).slice(0, 500)} ts=${key(t).slice(0, 500)}`);
        break;
      }
    }
    if (ok) grammarPass++;
    else grammarFail++;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

for (const failure of failures.slice(0, 20)) console.log(`FAIL ${failure}`);
if (failures.length > 20) console.log(`... ${failures.length - 20} more failures`);
console.log(`\n=== grammar candidates oracle: ${grammarPass} grammars passed, ${grammarFail} failed, ${tokenChecks} reachable-token checks, slots=${START_SLOTS}, no-builtin grammars=${files.length} ===`);
process.exit(grammarFail === 0 ? 0 : 1);
