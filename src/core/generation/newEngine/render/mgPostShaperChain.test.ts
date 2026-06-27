import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSeededRng } from './mgRng';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions } from './mgTokenScheduler';
import { realizeTokens, type MgNoteEvent } from './mgMelodyRealizer';
import { buildGuideTonePlan } from './mgGuideTonePlanner';
import { renderStyleFeel, feelForStyle } from './mgStyleRenderer';
import { buildChordPart } from './mgChordPart';
import {
  shapeMelodyHarmony, enforceMonophonicMelody, applyMelodyBoundaryVoiceLeadingContract,
  extendMelodyTailHolds, finalizeMelodyBoundaryVoiceLeading,
} from './mgMelodyShaper';
import { ENRICHED_GRAMMAR } from '../knowledge/melodyStyleGrammarProfiles';

// ============================================================
// MG full-parity Phase C-2 — post-shaper 生产链验收(directive 3.4)
// ------------------------------------------------------------
// shapeMelodyHarmony byte-exact ≠ final lead:MG 在 shaper 之后还跑 enforceMonophonicMelody /
// applyMelodyBoundaryVoiceLeadingContract / extendMelodyTailHolds / finalizeMelodyBoundaryVoiceLeading
// (grammarSlopeRole/brick 边界感知)。验:① 这 4 个在生产真改 lead(非 dormant)② grammarSlopeRole
// inside vs last 让 boundary VL 行为不同(metadata 真被消费,不能 strip)。
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = join(HERE, '__mgOracle__');
const fixtures = readdirSync(ORACLE_DIR)
  .filter((f) => f.endsWith('.json') && f !== '_index.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(ORACLE_DIR, f), 'utf8')) as { seed: string; style: string; chords: never[]; roadMap: { bricks: never[] }; shaper: { shaperArgs: { style: string; musicKey: string; musicMode: string; tonalCharacter: 'tonal' | 'modal' } } | null });

function shapedFor(fx: typeof fixtures[number]): { shaped: MgNoteEvent[]; a: { style: string; musicKey: string; musicMode: string; tonalCharacter: 'tonal' | 'modal' }; chords: never[] } {
  const a = fx.shaper!.shaperArgs;
  const rng = makeSeededRng(fx.seed);
  const pb = expandGrammarForRoadMap(ENRICHED_GRAMMAR, fx.roadMap.bricks, rng);
  for (let i = 0; i < pb.length; i++) if (pb[i].tokens.length === 0) pb[i].tokens = [{ kind: 'C', duration: 1 }];
  const cp = buildChordPart(fx.chords);
  const raw = realizeTokens({ scheduledTokens: scheduleBrickExpansions(pb), chordPart: cp, rng, guideTonePlan: buildGuideTonePlan({ chordPart: cp } as never) });
  const styled = renderStyleFeel({ events: raw, feel: feelForStyle(a.style as never), rng } as never) as MgNoteEvent[];
  const shaped = (shapeMelodyHarmony as never as (...x: unknown[]) => MgNoteEvent[])(a.style, styled, fx.chords, a.musicKey, a.musicMode, a.tonalCharacter, a.style === 'LOFI');
  return { shaped, a, chords: fx.chords };
}

const key = (n: MgNoteEvent[]) => n.filter((e) => e.part === 'melody').map((e) => `${e.noteNumber}@${e.time.toFixed(3)}+${e.duration.toFixed(3)}`).join(',');
const postChain = (shaped: MgNoteEvent[], chords: never[], a: { style: string; musicKey: string; musicMode: string; tonalCharacter: 'tonal' | 'modal' }) => {
  let m = enforceMonophonicMelody(shaped);
  m = (applyMelodyBoundaryVoiceLeadingContract as never as (...x: unknown[]) => MgNoteEvent[])(m, chords, a.style, a.musicKey, a.musicMode, a.tonalCharacter);
  m = (extendMelodyTailHolds as never as (...x: unknown[]) => MgNoteEvent[])(m, chords, a.style, a.musicKey, a.musicMode);
  m = (finalizeMelodyBoundaryVoiceLeading as never as (...x: unknown[]) => MgNoteEvent[])(m, chords, a.style, a.musicKey, a.musicMode, a.tonalCharacter);
  return m;
};

describe('render/mgPostShaperChain — post-shaper 生产链(Phase C-2)', () => {
  it('4 个 post-shaper 函数在生产真改 final lead(非 dormant)+ 输出合法', () => {
    let changed = 0;
    for (const fx of fixtures.filter((f) => f.shaper)) {
      const { shaped, a, chords } = shapedFor(fx);
      const after = postChain(shaped, chords, a);
      expect(after.length).toBeGreaterThan(0);
      for (const n of after.filter((e) => e.part === 'melody')) {
        expect(n.noteNumber).toBeGreaterThanOrEqual(24);
        expect(n.noteNumber).toBeLessThanOrEqual(108);
        expect(n.duration).toBeGreaterThan(0);
      }
      if (key(shaped) !== key(after)) changed++;
    }
    expect(changed, 'post-shaper 链对多数 seed 真改 lead').toBeGreaterThan(fixtures.length / 2);
  });

  it('确定性:同输入两次 post-shaper 一致', () => {
    const fx = fixtures.find((f) => f.shaper && f.style === 'JAZZ')!;
    const { shaped, a, chords } = shapedFor(fx);
    expect(key(postChain(shaped, chords, a))).toBe(key(postChain(shaped, chords, a)));
  });

  it('★ directive 3.4:grammarSlopeRole inside vs last → applyMelodyBoundaryVoiceLeadingContract 行为不同(metadata 真被消费)', () => {
    // 同一条 melody,所有音的 grammarSlopeRole 全设 inside vs 全设 last → boundary VL 输出应不同
    //   (inside 受保护不被边界改写;last 可被改写)。证 grammarSlopeRole 不能在到达 post-shaper 前被 strip。
    let sawDiff = false;
    for (const fx of fixtures.filter((f) => f.shaper && (f.style === 'JAZZ' || f.style === 'RNB' || f.style === 'POP'))) {
      const { shaped, a, chords } = shapedFor(fx);
      const allInside = shaped.map((e) => ({ ...e, grammarSlopeRole: 'inside' as const }));
      const allLast = shaped.map((e) => ({ ...e, grammarSlopeRole: 'last' as const }));
      const rInside = (applyMelodyBoundaryVoiceLeadingContract as never as (...x: unknown[]) => MgNoteEvent[])(allInside, chords, a.style, a.musicKey, a.musicMode, a.tonalCharacter);
      const rLast = (applyMelodyBoundaryVoiceLeadingContract as never as (...x: unknown[]) => MgNoteEvent[])(allLast, chords, a.style, a.musicKey, a.musicMode, a.tonalCharacter);
      if (key(rInside) !== key(rLast)) { sawDiff = true; break; }
    }
    expect(sawDiff, 'grammarSlopeRole inside≠last 至少在一个 seed 改变 boundary VL 输出').toBe(true);
  });
});
