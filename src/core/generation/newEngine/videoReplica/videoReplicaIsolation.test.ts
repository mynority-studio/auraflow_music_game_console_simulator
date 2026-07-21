import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface ImportedBinding {
  importedName: string;
  typeOnly: boolean;
}

interface ModuleDependency {
  moduleSpecifier: string;
  bindings: ImportedBinding[];
}

const GENERATION_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE_ROOT = resolve(GENERATION_ROOT, '../..');
const VIDEO_REPLICA_ROOT = fileURLToPath(new URL('./', import.meta.url));
const PROCEDURAL_ROOTS = [
  'newEngine/arranger',
  'newEngine/harmony',
  'newEngine/render',
  'newEngine/generation',
  'musicGeneration',
] as const;

const EXPECTED_VIDEO_REPLICA_DEPENDENCIES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {};

function listProductionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listProductionSources(path);
    if (!/\.tsx?$/u.test(entry.name) || /\.(?:test|spec)\.tsx?$/u.test(entry.name) || entry.name.endsWith('.d.ts')) {
      return [];
    }
    return [path];
  });
}

function dependenciesOf(file: string): ModuleDependency[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const dependencies: ModuleDependency[] = [];

  const addDependency = (
    moduleSpecifier: ts.Expression | undefined,
    bindings: ImportedBinding[],
  ): void => {
    if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)) {
      dependencies.push({ moduleSpecifier: moduleSpecifier.text, bindings });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings: ImportedBinding[] = [];
      if (!clause) {
        bindings.push({ importedName: '*side-effect*', typeOnly: false });
      } else {
        if (clause.name) bindings.push({ importedName: 'default', typeOnly: clause.isTypeOnly });
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          bindings.push({ importedName: '*', typeOnly: clause.isTypeOnly });
        } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            bindings.push({
              importedName: element.propertyName?.text ?? element.name.text,
              typeOnly: clause.isTypeOnly || element.isTypeOnly,
            });
          }
        }
      }
      addDependency(node.moduleSpecifier, bindings);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const bindings: ImportedBinding[] = [];
      if (!node.exportClause) {
        bindings.push({ importedName: '*', typeOnly: node.isTypeOnly });
      } else if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          bindings.push({
            importedName: element.propertyName?.text ?? element.name.text,
            typeOnly: node.isTypeOnly || element.isTypeOnly,
          });
        }
      }
      addDependency(node.moduleSpecifier, bindings);
    } else if (
      ts.isCallExpression(node)
      && node.arguments.length === 1
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      addDependency(node.arguments[0], [{ importedName: '*', typeOnly: false }]);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return dependencies;
}

function isVideoReplicaModule(moduleSpecifier: string): boolean {
  return /(?:^|\/)videoReplica(?:\/|$)/u.test(moduleSpecifier);
}

function isVideoReplicaBarrel(moduleSpecifier: string): boolean {
  return /(?:^|\/)videoReplica(?:\/index)?$/u.test(moduleSpecifier.replace(/\/+$/u, ''));
}

function dependencyShape(dependencies: readonly ModuleDependency[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const dependency of dependencies) {
    const bindings = result[dependency.moduleSpecifier] ?? [];
    bindings.push(...dependency.bindings.map((binding) => (
      `${binding.importedName}:${binding.typeOnly ? 'type' : 'value'}`
    )));
    result[dependency.moduleSpecifier] = bindings.sort();
  }
  return result;
}

const productionSources = PROCEDURAL_ROOTS
  .flatMap((directory) => listProductionSources(resolve(GENERATION_ROOT, directory)))
  .sort();
const dependenciesByFile = new Map(productionSources.map((file) => [file, dependenciesOf(file)]));
const allProductionConsumers = listProductionSources(SOURCE_ROOT)
  .filter((file) => !file.startsWith(VIDEO_REPLICA_ROOT))
  .sort();

describe('videoReplica · procedural architecture isolation', () => {
  it('forbids every videoReplica import from UI and non-audit product sources', () => {
    const violations = allProductionConsumers.flatMap((file) => dependenciesOf(file)
      .filter((dependency) => isVideoReplicaModule(dependency.moduleSpecifier))
      .map((dependency) => `${relative(SOURCE_ROOT, file)} -> ${dependency.moduleSpecifier}`));

    expect(violations).toEqual([]);
  });

  it('keeps fixed-score route IDs and UI labels out of product source contracts', () => {
    const forbidden = /referenceScoreId|MusicReferenceScoreId|VIDEO PIANO REF|VIDEO PIANO · FIXED/u;
    const violations = allProductionConsumers
      .filter((file) => forbidden.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SOURCE_ROOT, file));

    expect(violations).toEqual([]);
  });

  it('forbids candidate imports and the broad barrel from every production consumer', () => {
    const violations = allProductionConsumers.flatMap((file) => dependenciesOf(file).flatMap((dependency) => {
      const relativeFile = relative(SOURCE_ROOT, file);
      if (isVideoReplicaBarrel(dependency.moduleSpecifier)) {
        return [`${relativeFile} -> ${dependency.moduleSpecifier}#barrel`];
      }
      return dependency.bindings
        .filter((binding) => /^TAKE_FIVE_.*_CURATION_CANDIDATE(?:_V\d+)?$/u.test(binding.importedName))
        .map((binding) => `${relativeFile} -> ${dependency.moduleSpecifier}#${binding.importedName}`);
    }));

    expect(violations).toEqual([]);
  });

  it('forbids candidate fixed scores from procedural imports', () => {
    const violations = [...dependenciesByFile].flatMap(([file, dependencies]) => dependencies.flatMap((dependency) => (
      dependency.bindings
        .filter((binding) => /^TAKE_FIVE_.*_CURATION_CANDIDATE(?:_V\d+)?$/u.test(binding.importedName))
        .map((binding) => `${relative(GENERATION_ROOT, file)} -> ${dependency.moduleSpecifier}#${binding.importedName}`)
    )));

    expect(violations).toEqual([]);
  });

  it('forbids the videoReplica barrel from procedural imports', () => {
    const violations = [...dependenciesByFile].flatMap(([file, dependencies]) => dependencies
      .filter((dependency) => isVideoReplicaBarrel(dependency.moduleSpecifier))
      .map((dependency) => `${relative(GENERATION_ROOT, file)} -> ${dependency.moduleSpecifier}`));

    expect(violations).toEqual([]);
  });

  it('allows no procedural adapter or product request contract to import videoReplica', () => {
    const auditedFiles = new Set(Object.keys(EXPECTED_VIDEO_REPLICA_DEPENDENCIES));
    const unexpectedDependencies: string[] = [];

    for (const [file, dependencies] of dependenciesByFile) {
      const relativeFile = relative(GENERATION_ROOT, file);
      const videoReplicaDependencies = dependencies.filter((dependency) => (
        isVideoReplicaModule(dependency.moduleSpecifier)
      ));
      const expected = EXPECTED_VIDEO_REPLICA_DEPENDENCIES[relativeFile];
      if (expected) {
        expect(dependencyShape(videoReplicaDependencies), relativeFile).toEqual(expected);
        auditedFiles.delete(relativeFile);
      } else {
        unexpectedDependencies.push(...videoReplicaDependencies.map((dependency) => (
          `${relativeFile} -> ${dependency.moduleSpecifier}`
        )));
      }
    }

    expect([...auditedFiles]).toEqual([]);
    expect(unexpectedDependencies).toEqual([]);
  });
});
