import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Row = [number, number, number, number, number, number, number, number];

interface JavaNoteChooserTable {
  kind: 'notechooser-prob-table';
  rows: Row[];
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const runOracle = process.platform === 'win32'
  ? join(repo, 'scripts/run-improvisor-oracle.cmd')
  : join(repo, 'scripts/run-improvisor-oracle.sh');
const oracleCommand = process.platform === 'win32' ? 'cmd.exe' : runOracle;

function javaTable(): Map<string, number[]> {
  const args = ['notechooser-prob-table'];
  const out = execFileSync(oracleCommand, process.platform === 'win32' ? ['/c', runOracle, ...args] : args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const parsed = JSON.parse(out) as JavaNoteChooserTable;
  const table = new Map<string, number[]>();
  for (const row of parsed.rows) {
    table.set(row.slice(0, 4).join('-'), row.slice(4));
  }
  return table;
}

function tsTable(): Map<string, number[]> {
  const source = readFileSync(join(repo, 'src/core/generation/improCore/engine/lickgen.ts'), 'utf8');
  const table = new Map<string, number[]>();
  const entryRe = /\['([^']+)',\s*\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(source)) !== null) {
    const values = match[2]!.split(',').map(s => Number(s.trim()));
    if (values.length === 4 && values.every(Number.isFinite)) {
      table.set(match[1]!, values);
    }
  }
  return table;
}

const java = javaTable();
const ts = tsTable();
let failures = 0;

for (const [key, javaValues] of java) {
  const tsValues = ts.get(key);
  if (!tsValues) {
    console.log(`FAIL missing TS row ${key}: java=${JSON.stringify(javaValues)}`);
    failures++;
  } else if (JSON.stringify(javaValues) !== JSON.stringify(tsValues)) {
    console.log(`FAIL row ${key}: java=${JSON.stringify(javaValues)} ts=${JSON.stringify(tsValues)}`);
    failures++;
  }
}

for (const key of ts.keys()) {
  if (!java.has(key)) {
    console.log(`FAIL extra TS row ${key}: ts=${JSON.stringify(ts.get(key))}`);
    failures++;
  }
}

if (failures === 0) {
  console.log(`=== notechooser probability-table oracle: ${java.size} rows passed, 0 failed ===`);
} else {
  console.log(`=== notechooser probability-table oracle: ${java.size - failures} passed, ${failures} failed ===`);
}

process.exit(failures === 0 ? 0 : 1);
