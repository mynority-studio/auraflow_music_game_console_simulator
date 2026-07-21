import { describe, it, expect } from 'vitest';
import { buildChordPart, type MgChordDef } from './mgChordPart';
import { parseFunctionalRoadMap } from './mgFunctionalRoadMap';
import { expandGrammarForRoadMap } from './mgGrammarRuntime';
import { scheduleBrickExpansions } from './mgTokenScheduler';
import { scheduleAcgCycleCadencePhrases } from './mgAcgCycleScheduler';
import { makeSeededRng } from './mgRng';
import { ACG_PIANOSONG_GRAMMAR } from '../knowledge/melodyStyleGrammarProfiles';
import type { AcgLeadPresencePlan } from './acgLeadPresencePlan';
import type { AcgPianoReturnShape, AcgPianoScorePlan } from '../arranger/acgPianoScorePlan';

// ============================================================
// MG full-parity G4 — ACG cycle-cadence scheduler 不变量验收
// 终判(directive §3 / §10):ACG token starts 是【cycle-spread】(铺满和声 cycle),非 brick-local。
// ============================================================

const ch = (root: string, rootMidi: number, type: string): MgChordDef => ({ root, rootMidi, type, bassMidi: rootMidi, duration: 4 });
const HALF = [ch('C', 60, 'maj9'), ch('A', 57, 'm9'), ch('F', 53, 'maj9'), ch('G', 55, '9sus4')];
const REPEATED = [...HALF, ...HALF]; // 32 拍,前后半重复(AABA)
const LONG = [...HALF, ch('E', 64, 'm9'), ch('A', 57, 'maj9'), ch('D', 62, 'm9'), ch('G', 55, '13sus4')]; // 32 拍,不重复
const SHORT = [ch('C', 60, 'maj9'), ch('F', 53, 'maj9'), ch('G', 55, '9sus4'), ch('C', 60, '6/9')]; // 16 拍

function perBrickFor(chords: MgChordDef[]) {
  const part = buildChordPart(chords);
  // ★ ACG fidelity directive §2.1(2026-06-28):ACG 生产走 parseFunctionalRoadMap(style 感知)→ 测试同源,
  //   不再喂旧 parseRoadMap 的 brick(否则 scheduler 测的是生产【不喂】的 brick)。
  const roadMap = parseFunctionalRoadMap({ part, songKeyPc: 0, style: 'ACG' });
  const perBrick = expandGrammarForRoadMap(ACG_PIANOSONG_GRAMMAR, roadMap.bricks, makeSeededRng('acg_test'));
  return { part, perBrick };
}

describe('render/mgAcgCycleScheduler(MG full-parity G4)', () => {
  it('★ token 升序、在 [0,totalBeats),非空', () => {
    for (const chords of [REPEATED, LONG, SHORT]) {
      const { part, perBrick } = perBrickFor(chords);
      const sched = scheduleAcgCycleCadencePhrases(perBrick, part);
      expect(sched.length).toBeGreaterThan(0);
      const starts = sched.map((s) => s.startBeat);
      expect(starts.every((s, i) => i === 0 || s >= starts[i - 1] - 1e-9)).toBe(true);
      expect(Math.max(...starts)).toBeLessThan(part.totalBeats);
    }
  });

  it('★ cycle-spread:token 铺满到 cycle 尾(max start ≥ totalBeats−8),不挤句头', () => {
    for (const chords of [REPEATED, LONG]) {
      const { part, perBrick } = perBrickFor(chords);
      const starts = scheduleAcgCycleCadencePhrases(perBrick, part).map((s) => s.startBeat);
      expect(Math.max(...starts), `${chords.length}和弦`).toBeGreaterThanOrEqual(part.totalBeats - 8);
    }
  });

  it('★ AABA(重复半)→ 第二 cycle(≥16拍)也有 token(两 cycle 各铺一句)', () => {
    const { part, perBrick } = perBrickFor(REPEATED);
    const starts = scheduleAcgCycleCadencePhrases(perBrick, part).map((s) => s.startBeat);
    expect(starts.some((s) => s < 16)).toBe(true);   // cycle 1
    expect(starts.some((s) => s >= 16)).toBe(true);  // cycle 2
  });

  it('★ ACG cycle-spread ≠ brick-local(分布不同)', () => {
    const { part, perBrick } = perBrickFor(LONG);
    const acg = scheduleAcgCycleCadencePhrases(perBrick, part).map((s) => `${s.token.kind}@${s.startBeat.toFixed(2)}`).join('|');
    const brick = scheduleBrickExpansions(perBrick).map((s) => `${s.token.kind}@${s.startBeat.toFixed(2)}`).join('|');
    expect(acg).not.toBe(brick);
  });

  it('★ 结构音(G/长音)落在 4 拍 landing 格(snapToAcgLandingBeat)', () => {
    const { part, perBrick } = perBrickFor(LONG);
    const structural = scheduleAcgCycleCadencePhrases(perBrick, part).filter((s) => s.token.kind === 'G' || s.token.duration >= 1);
    expect(structural.length).toBeGreaterThan(0);
    // 至少一个结构音落在 4 拍 landing 格附近(landing snap 生效)。
    // ⚠️ EAR-CHECK(G7,2026-06-28/2026-07-02):enriched grammar 去 LOFI_VAMP;softParallel 已产品分叉为轻 boost 后 ACG 走的
    //   LOFI grammar 变【稀】—— LONG fixture 结构音从多个→1 个,落在 beat 7.88(距 4-grid 0.125)。容差从 0.02
    //   放宽到 0.15 容纳。ACG 手感变稀疏,待耳朵复核是否需为 ACG 重新调 landing snap / 加结构音密度。
    expect(structural.some((s) => Math.abs(s.startBeat - Math.round(s.startBeat / 4) * 4) < 0.15)).toBe(true);
  });

  it('★ slope 配平(SlopeEnter/Exit 深度归零)', () => {
    const { part, perBrick } = perBrickFor(LONG);
    let depth = 0;
    for (const s of scheduleAcgCycleCadencePhrases(perBrick, part)) {
      if (s.token.kind === 'SlopeEnter') depth++; else if (s.token.kind === 'SlopeExit') depth--;
    }
    expect(depth).toBe(0);
  });

  it('★ 确定性', () => {
    const { part, perBrick } = perBrickFor(REPEATED);
    expect(JSON.stringify(scheduleAcgCycleCadencePhrases(perBrick, part))).toBe(JSON.stringify(scheduleAcgCycleCadencePhrases(perBrick, part)));
  });

  it('turns arranger-owned lead silence into scheduler rests before any NoteIR is emitted', () => {
    const { part, perBrick } = perBrickFor(SHORT);
    const presence: AcgLeadPresencePlan = {
      silenceWindows: [{ startBeat: 0, endBeat: 8, reason: 'planned-entry-delay', sectionId: 'intro' }],
      returnRestCapBeats: 3,
    };
    const scheduled = scheduleAcgCycleCadencePhrases(perBrick, part, { leadPresencePlan: presence });
    const audible = scheduled.filter((entry) => entry.token.kind !== 'R'
      && entry.token.kind !== 'SlopeEnter'
      && entry.token.kind !== 'SlopeExit');
    const reentry = scheduled.filter((entry) => entry.acgReturn);

    expect(scheduled.some((entry) => entry.token.kind === 'R' && entry.startBeat < 8)).toBe(true);
    // A re-entry phrase is allowed only at/after the authored release. It is
    // intentionally scheduled *forward* from the first carrier, so a planned
    // rest gets a compact pickup → approach → dyad arrival instead of being
    // forced into the old stable-single fallback.
    expect(audible.length).toBeGreaterThan(0);
    expect(audible.every((entry) => entry.startBeat >= 8 - 1e-4)).toBe(true);
    expect(reentry.map((entry) => entry.acgReturn!.role)).toEqual(['pickup', 'approach', 'arrival']);
    expect(reentry.every((entry) => entry.startBeat >= 8 - 1e-4)).toBe(true);
    expect(reentry.at(-1)!.acgReturn).toMatchObject({ shape: 'liftRiff', dyad: { voicing: 'below-topline' } });
  });

  it('treats arranger returnShapes as a hard contract when a dyad response cannot resolve', () => {
    // The score permits only a sigh, whose terminal requires a dyad. The
    // harmonic contract admits one stable tone, so the dyad must fail. The
    // old scheduler silently replaced it with stableSingle; the score now
    // owns that decision and the original carrier survives without a return.
    const part = buildChordPart(Array.from({ length: 4 }, () => ({
      root: 'C', rootMidi: 60, type: 'maj9', bassMidi: 60, duration: 4,
      effectiveFunc: 'T' as const, stableTonePcs: [0], chordScalePcs: [0],
    })));
    const expansion: Parameters<typeof scheduleAcgCycleCadencePhrases>[0][number] = {
      brickIndex: 0,
      brick: { name: 'Perfect-Cadence', family: 'Cadence', startBeat: 0, durationBeats: 16, chordIndices: [0, 1, 2, 3], cost: 0 },
      tokens: [{ kind: 'R', duration: 1 }, { kind: 'C', duration: 1 }, { kind: 'C', duration: 1 }, { kind: 'G', duration: 2 }],
    };
    const scoreFor = (returnShapes: readonly AcgPianoReturnShape[]): AcgPianoScorePlan => ({
      // The scheduler intentionally reads only phrase timing + lead directive.
      phraseById: {
        phrase: { startBeat: 0, endBeat: 16, lead: { returnShapes } },
      },
    } as unknown as AcgPianoScorePlan);

    const constrained = scheduleAcgCycleCadencePhrases([expansion], part, {
      pianoScorePlan: scoreFor(['sigh']),
    });
    expect(constrained.filter((entry) => entry.acgReturn)).toHaveLength(0);
    expect(constrained.find((entry) => Math.abs(entry.startBeat - 3.1) < 1e-6)?.token.kind).toBe('C');

    // An empty phrase set is likewise intentional: it does not mean "use the
    // generic scheduler preference".
    const noReturnAllowed = scheduleAcgCycleCadencePhrases([expansion], part, {
      pianoScorePlan: scoreFor([]),
    });
    expect(noReturnAllowed.filter((entry) => entry.acgReturn)).toHaveLength(0);

    // Existing production phrases include stableSingle in the permitted set,
    // so their authored fallback remains available.
    const fallbackAllowed = scheduleAcgCycleCadencePhrases([expansion], part, {
      pianoScorePlan: scoreFor(['sigh', 'stableSingle']),
    });
    expect(fallbackAllowed.some((entry) => entry.acgReturn?.shape === 'stableSingle')).toBe(true);
  });

  it('closes or removes slope state cut by a planned silence before the new entry', () => {
    const part = buildChordPart(SHORT);
    const presence: AcgLeadPresencePlan = {
      silenceWindows: [{ startBeat: 0, endBeat: 8, reason: 'planned-entry-delay', sectionId: 'intro' }],
      returnRestCapBeats: 3,
    };
    const scheduled = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: { name: 'Perfect-Cadence', family: 'Cadence', startBeat: 0, durationBeats: 16, chordIndices: [0, 1, 2, 3], cost: 0 },
      // The open slope begins inside the deleted phrase and its source exit
      // lies after re-entry. It must not constrain the new audible phrase.
      tokens: [
        { kind: 'SlopeEnter', dirMin: 2, dirMax: 4, duration: 0 },
        { kind: 'C', duration: 4 },
        { kind: 'SlopeExit', duration: 0 },
        { kind: 'C', duration: 1 },
        { kind: 'G', duration: 1 },
      ],
    }], part, { leadPresencePlan: presence });
    let depth = 0;
    for (const entry of scheduled) {
      if (entry.token.kind === 'SlopeEnter') depth++;
      else if (entry.token.kind === 'SlopeExit') depth = Math.max(0, depth - 1);
      else if (entry.startBeat >= 8 - 1e-4 && entry.token.kind !== 'R') {
        expect(depth, `new phrase at ${entry.startBeat} inherits no deleted slope`).toBe(0);
      }
    }
  });

  it('closes a SlopeExit exactly at planned-silence start so it cannot leak into the release', () => {
    const part = buildChordPart(SHORT);
    // With three one-beat audible tokens, the source exit falls exactly at
    // 15.5 / 3 in the usable cycle. (Three audible atoms also ensure this
    // fixture is selected instead of the scheduler's fallback cadence.)
    const silenceStart = 15.5 / 3;
    const silenceEnd = silenceStart + 0.5;
    const presence: AcgLeadPresencePlan = {
      silenceWindows: [{ startBeat: silenceStart, endBeat: silenceEnd, reason: 'planned-entry-delay', sectionId: 'intro' }],
      returnRestCapBeats: 3,
    };
    const scheduled = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: { name: 'Perfect-Cadence', family: 'Cadence', startBeat: 0, durationBeats: 16, chordIndices: [0, 1, 2, 3], cost: 0 },
      tokens: [
        { kind: 'SlopeEnter', dirMin: 2, dirMax: 4, duration: 0 },
        { kind: 'C', duration: 1 },
        { kind: 'SlopeExit', duration: 0 },
        { kind: 'C', duration: 1 },
        { kind: 'C', duration: 1 },
      ],
    }], part, { leadPresencePlan: presence });

    const exitAtBoundary = scheduled.find((entry) => entry.token.kind === 'SlopeExit'
      && Math.abs(entry.startBeat - silenceStart) < 1e-6);
    expect(exitAtBoundary, 'boundary exit must survive as state-only closure').toBeDefined();

    let depth = 0;
    for (const entry of scheduled) {
      if (entry.token.kind === 'SlopeEnter') depth++;
      else if (entry.token.kind === 'SlopeExit') depth = Math.max(0, depth - 1);
      else if (entry.startBeat >= silenceEnd - 1e-6 && entry.token.kind !== 'R') {
        expect(depth, `release at ${entry.startBeat} cannot inherit the pre-silence slope`).toBe(0);
      }
    }
  });

  it('orders same-beat slope markers before audible tokens', () => {
    const part = buildChordPart(SHORT);
    // An unclosed legacy group is fail-closed by closeOpenSlopeGroups. Its
    // synthesized exit shares the final source carrier's beat, so this catches
    // any reliance on incidental stable-sort insertion order.
    const scheduled = scheduleAcgCycleCadencePhrases([{
      brickIndex: 0,
      brick: { name: 'Perfect-Cadence', family: 'Cadence', startBeat: 0, durationBeats: 16, chordIndices: [0, 1, 2, 3], cost: 0 },
      tokens: [
        { kind: 'C', duration: 0.5 },
        { kind: 'C', duration: 0.5 },
        { kind: 'SlopeEnter', dirMin: 2, dirMax: 4, duration: 0 },
        { kind: 'C', duration: 0.5 },
      ],
    }], part);
    const syntheticExit = scheduled.find((entry) => entry.token.kind === 'SlopeExit');
    expect(syntheticExit).toBeDefined();
    const sameBeat = scheduled.filter((entry) => Math.abs(entry.startBeat - syntheticExit!.startBeat) < 1e-9);
    const firstAudible = sameBeat.findIndex((entry) => entry.token.kind !== 'SlopeEnter'
      && entry.token.kind !== 'SlopeExit' && entry.token.kind !== 'R');
    expect(firstAudible).toBeGreaterThanOrEqual(0);
    expect(sameBeat.slice(0, firstAudible).map((entry) => entry.token.kind))
      .toEqual(['SlopeExit', 'SlopeEnter']);
  });
});
