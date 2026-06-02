import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

interface AssetSet {
  name: string;
  sourceDir: string;
  targetDir: string;
  extension: string;
}

const repo = resolve(import.meta.dirname, '..');
const improvisorRoot = process.env.IMPROVISOR_ROOT ?? resolve(repo, '../Impro-Visor');

const sets: AssetSet[] = [
  {
    name: 'grammar',
    sourceDir: join(improvisorRoot, 'grammars'),
    targetDir: join(repo, 'src/core/generation/improCore/data/grammars'),
    extension: '.grammar',
  },
  {
    name: 'style',
    sourceDir: join(improvisorRoot, 'styles'),
    targetDir: join(repo, 'src/core/generation/improCore/engine/styles'),
    extension: '.sty',
  },
  {
    name: 'vocab',
    sourceDir: join(improvisorRoot, 'vocab'),
    targetDir: join(repo, 'src/core/generation/improCore/engine/vocab'),
    extension: '.voc',
  },
  {
    name: 'transform',
    sourceDir: join(improvisorRoot, 'transforms'),
    targetDir: join(repo, 'src/core/generation/improCore/engine/transforms'),
    extension: '.transform',
  },
];

function listFiles(root: string, extension: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith(extension)) out.set(relative(root, full), full);
    }
  };
  walk(root);
  return out;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

let totalFailures = 0;

for (const set of sets) {
  const source = listFiles(set.sourceDir, set.extension);
  const target = listFiles(set.targetDir, set.extension);
  const missing: string[] = [];
  const extra: string[] = [];
  const different: string[] = [];
  let matching = 0;

  for (const [rel, sourcePath] of source) {
    const targetPath = target.get(rel);
    if (!targetPath) {
      missing.push(rel);
      continue;
    }
    if (sha256(sourcePath) === sha256(targetPath)) matching++;
    else different.push(rel);
  }

  for (const rel of target.keys()) {
    if (!source.has(rel)) extra.push(rel);
  }

  const failures = missing.length + extra.length + different.length;
  totalFailures += failures;

  console.log(`${set.name}: source=${source.size} target=${target.size} matching=${matching} different=${different.length} missing=${missing.length} extra=${extra.length}`);
  for (const [label, values] of [
    ['different', different],
    ['missing', missing],
    ['extra', extra],
  ] as const) {
    if (values.length > 0) {
      const preview = values.slice(0, 12).map(v => basename(v)).join(', ');
      console.log(`  ${label}: ${preview}${values.length > 12 ? ` ... +${values.length - 12}` : ''}`);
    }
  }
}

console.log(`\n=== improvisor asset audit: ${totalFailures === 0 ? 'all byte-identical' : `${totalFailures} issues`} ===`);
process.exit(totalFailures === 0 ? 0 : 1);
