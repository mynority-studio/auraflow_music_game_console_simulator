import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSeededRng } from './mgRng';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions } from './mgTokenScheduler';
import { scheduleAcgCycleCadencePhrases } from './mgAcgCycleScheduler';
import { realizeTokens } from './mgMelodyRealizer';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import { parseRoadMap } from './mgRoadMapParser';
import { ENRICHED_GRAMMAR } from '../knowledge/melodyStyleGrammarProfiles';
import { BUILTIN_GRAMMAR } from '../knowledge/melodyBuiltinGrammar';

// ============================================================
// MG full-parity Phase B-2 — full metadata 标准形状 验收(directive 3.3/3.4)
// ------------------------------------------------------------
// ScheduledToken → MgNoteEvent 携带 brickIndex/Start/End + brickName/brickFamily + grammarTokenKind/grammarSlopeRole。
// post-shaper 生产链(Phase C)据 grammarSlopeRole(inside/last)/grammarTokenKind 做边界/解决决策 → 这些字段
// 不能在到达 shaper/post-shaper 前被 strip。additive:不改 pitch/time/dur/vel。
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, '__mgOracle__');
const fixtures = readdirSync(ORACLE_DIR)
  .filter((f) => f.endsWith('.json') && f !== '_index.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ORACLE_DIR, f), 'utf8')) as { seed: string; style: string; chords: MgChordDef[]; roadMap: { bricks: unknown[] } });

describe('render/mgMelodyMetadata — full metadata 标准形状(Phase B-2)', () => {
  it('scheduleBrickExpansions:每 token 带 brickIndex + brickName + brickFamily', () => {
    for (const fx of fixtures.slice(0, 6)) {
      const perBrick = expandGrammarForRoadMap(BUILTIN_GRAMMAR, fx.roadMap.bricks as never, makeSeededRng(fx.seed));
      const sched = scheduleBrickExpansions(perBrick);
      expect(sched.length).toBeGreaterThan(0);
      for (const s of sched) {
        expect(s.brickIndex, `${fx.seed} brickIndex`).toBeTypeOf('number');
        expect(s.brickName, `${fx.seed} brickName`).toBeTypeOf('string');
        expect(s.brickFamily, `${fx.seed} brickFamily`).toBeTypeOf('string');
        expect(s.brickStartBeat, `${fx.seed} brickStartBeat`).toBeTypeOf('number');
      }
    }
  });

  it('realizeTokens:每个发声音带 grammarTokenKind + full brick 元数据(穿透 ScheduledToken)', () => {
    for (const fx of fixtures.slice(0, 6)) {
      const perBrick = expandGrammarForRoadMap(ENRICHED_GRAMMAR, fx.roadMap.bricks as never, makeSeededRng(fx.seed));
      for (let i = 0; i < perBrick.length; i++) if (perBrick[i].tokens.length === 0) perBrick[i].tokens = [{ kind: 'C', duration: 1 }];
      const sched = scheduleBrickExpansions(perBrick);
      const notes = realizeTokens({ scheduledTokens: sched, chordPart: buildChordPart(fx.chords), rng: makeSeededRng(fx.seed) }).filter((e) => e.part === 'melody');
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        expect(n.grammarTokenKind, `${fx.seed} grammarTokenKind`).toBeDefined();
        expect(n.brickName, `${fx.seed} brickName 穿透`).toBeTypeOf('string');
        expect(n.brickFamily, `${fx.seed} brickFamily 穿透`).toBeTypeOf('string');
      }
    }
  });

  it('slope 上下文:realized 音的 grammarSlopeRole ∈ {inside, last, undefined};slope 内确有 inside/last', () => {
    // 找一个含 slope 的 fixture(enriched 语料发 Slope token)
    let sawSlopeRole = false;
    for (const fx of fixtures) {
      const perBrick = expandGrammarForRoadMap(ENRICHED_GRAMMAR, fx.roadMap.bricks as never, makeSeededRng(fx.seed));
      for (let i = 0; i < perBrick.length; i++) if (perBrick[i].tokens.length === 0) perBrick[i].tokens = [{ kind: 'C', duration: 1 }];
      const sched = scheduleBrickExpansions(perBrick);
      const notes = realizeTokens({ scheduledTokens: sched, chordPart: buildChordPart(fx.chords), rng: makeSeededRng(fx.seed), preserveSlopeGrammar: fx.style.toUpperCase() === 'LOFI' }).filter((e) => e.part === 'melody');
      for (const n of notes) {
        expect(['inside', 'last', undefined]).toContain(n.grammarSlopeRole);
        if (n.grammarSlopeRole === 'inside' || n.grammarSlopeRole === 'last') sawSlopeRole = true;
      }
    }
    expect(sawSlopeRole, '至少一个 fixture 的 slope 内音被标 inside/last').toBe(true);
  });

  it('ACG scheduler:scheduled tokens 含 brickName + brickFamily(directive 3.3,来自 cadence expansion)', () => {
    const ch = (root: string, rootMidi: number, type: string): MgChordDef => ({ root, rootMidi, type, bassMidi: rootMidi, duration: 4 } as never);
    const LONG = [ch('C', 60, 'maj9'), ch('A', 57, 'm9'), ch('F', 53, 'maj9'), ch('G', 55, '9sus4'), ch('E', 64, 'm9'), ch('A', 57, 'maj9'), ch('D', 62, 'm9'), ch('G', 55, '13sus4')];
    const part = buildChordPart(LONG);
    const roadMap = parseRoadMap({ part, songKeyPc: 0 });
    const perBrick = expandGrammarForRoadMap(ENRICHED_GRAMMAR, roadMap.bricks, makeSeededRng('acg_meta'));
    const sched = scheduleAcgCycleCadencePhrases(perBrick, part);
    expect(sched.length).toBeGreaterThan(0);
    const withName = sched.filter((s) => typeof s.brickName === 'string').length;
    expect(withName, 'ACG token 带 brickName').toBeGreaterThan(0);
    // ACG: brickStart/End 反映 stretched cycle(非 brick 原始 span)
    for (const s of sched) {
      if (s.brickStartBeat !== undefined && s.brickEndBeat !== undefined) {
        expect(s.brickEndBeat - s.brickStartBeat, 'stretched cycle span > 4(非单 brick 4 拍)').toBeGreaterThan(4);
      }
    }
  });
});
