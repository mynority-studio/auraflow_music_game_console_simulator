import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Grammar } from '../src/core/generation/improCore/engine/grammar';

interface JavaGrammarAst {
  kind: 'grammar-ast';
  grammarFile: string;
  rules: unknown[];
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = join(repo, 'scripts/run-improvisor-oracle.sh');
const grammarDir = join(repo, 'src/core/generation/improCore/data/grammars');

function javaAst(grammarFile: string): JavaGrammarAst {
  const out = execFileSync(runOracle, ['grammar-ast', grammarFile], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return JSON.parse(out) as JavaGrammarAst;
}

function tsAst(grammarFile: string): unknown[] {
  return Grammar.fromText(readFileSync(grammarFile, 'utf8')).getRules() as unknown[];
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return 0;
    return Number.isInteger(value) ? value : Number(value.toPrecision(15));
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

const files = readdirSync(grammarDir)
  .filter(f => f.endsWith('.grammar'))
  .sort()
  .map(f => join(grammarDir, f));

let pass = 0;
let fail = 0;

for (const file of files) {
  const java = javaAst(file).rules;
  const ts = tsAst(file);
  if (same(java, ts)) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL ${basename(file)}`);
    const max = Math.max(java.length, ts.length);
    for (let i = 0; i < max; i++) {
      if (!same(java[i], ts[i])) {
        console.log(`  firstDiff form=${i}`);
        console.log(`  java=${JSON.stringify(normalize(java[i]))?.slice(0, 500)}`);
        console.log(`  ts  =${JSON.stringify(normalize(ts[i]))?.slice(0, 500)}`);
        break;
      }
    }
    console.log(`  javaForms=${java.length} tsForms=${ts.length}`);
  }
}

console.log(`\n=== grammar structure oracle: ${pass} passed, ${fail} failed (${files.length} files from ${grammarDir}) ===`);
process.exit(fail === 0 ? 0 : 1);
