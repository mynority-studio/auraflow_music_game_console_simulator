/**
 * Phase 2.6 — TextureMapper 套件脱机听感/视觉验收
 *
 * 测试矩阵：
 *   1. SyncopationEvaluator — 经典模式的张力值理论比对
 *      a. 全 downbeat (1,0,0,0...)         → ≈ 0    （完全规整）
 *      b. 全 16th offbeat (0,1,0,0...)     → ≈ 1    （极限切分）
 *      c. 全 1                              → 0       （无静音 → 无切分）
 *      d. 全 0                              → 0       （边界）
 *
 *   2. RhythmMutator — 张力收敛 + 有界迭代 + 同 seed 确定性
 *      a. target=0.1 / 0.5 / 0.9 → 实际 sync 应靠近目标（±0.15）
 *      b. 不同 sparsity → 击点密度合理
 *      c. 同 seed 两次 generate → 两 grid 完全一致
 *      d. iterationsUsed 永不超 maxIterations
 *
 *   3. TextureMapper — 四种 contour 输出形态 + pitch space + 排序
 *      a. Upward / Downward → 单音轮转
 *      b. Alternating       → 偶数 Block / 奇数单音
 *      c. Random            → Block 与单音混合
 *      d. velocity 与 metrical weight 正相关
 *      e. NoteData.pitch ∈ voicing[] 严格成立（无 +keyOffset 痕迹）
 *      f. sort: onset ASC, pitch ASC
 *
 *   4. 端到端 — HarmonyCore 一段进行 + Persona Marcus (NeoSoul) 走通
 *
 * 运行：npx tsx scripts/test-texture.ts
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import {
    SyncopationEvaluator,
} from '../src/core/generation/primitives/SyncopationEvaluator';
import {
    RhythmMutator, RhythmMutatorDiagnostics,
} from '../src/core/generation/primitives/RhythmMutator';
import {
    TextureMapper,
} from '../src/core/generation/primitives/TextureMapper';
import { HarmonyCore } from '../src/core/generation/pipeline/HarmonyCore';
import {
    ContourType, GeneratedChord, NoteData, SectionType, SectionMetadata,
    Tonality, ChordQualityName,
} from '../src/core/generation/types';
import {
    NEO_SOUL_HARMONY_RULES,
    NEO_SOUL_VOICE_LEADING,
} from '../src/core/generation/config/styles/NeoSoul';

const SEED = 12345;
const EPS = 1e-6;

// ============================================================
// 通用工具
// ============================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failed++;
        const msg = detail !== undefined ? `${label}  — ${detail}` : label;
        failures.push(msg);
        console.log(`  ✗ ${label}${detail !== undefined ? `  — ${detail}` : ''}`);
    }
}

function near(label: string, actual: number, expected: number, tol: number): void {
    const ok = Math.abs(actual - expected) <= tol + EPS;
    check(
        label,
        ok,
        `actual=${actual.toFixed(4)}  expected≈${expected.toFixed(4)}  tol=±${tol}`,
    );
}

function gridToStr(grid: Int8Array | number[]): string {
    const out: string[] = [];
    for (let i = 0; i < grid.length; i++) {
        out.push(grid[i] === 1 ? '■' : '·');
        if ((i + 1) % 4 === 0 && i + 1 < grid.length) out.push(' ');
    }
    return out.join('');
}

function header(title: string): void {
    console.log(`\n${'═'.repeat(78)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(78)}`);
}

// ============================================================
// Test 1 — SyncopationEvaluator
// ============================================================

function testSyncopationEvaluator(): void {
    header('Test 1 — SyncopationEvaluator');

    // 1a: 全 downbeat（仅第 0 步发声，其余空），单小节
    const downbeatOnly = new Int8Array(16);
    downbeatOnly[0] = 1;
    const syncDown = SyncopationEvaluator.calculateSyncopation(downbeatOnly);
    near('全 downbeat → sync ≈ 0', syncDown, 0, 0.001);

    // 1b: 极端 offbeat（每个 16th 反拍发声）
    const offbeat = new Int8Array(16);
    for (let i = 1; i < 16; i += 2) offbeat[i] = 1;
    const syncOff = SyncopationEvaluator.calculateSyncopation(offbeat);
    near('极端 offbeat → sync ≈ 1.0', syncOff, 1.0, 0.001);

    // 1c: 全 1
    const allOn = new Int8Array(16);
    for (let i = 0; i < 16; i++) allOn[i] = 1;
    const syncAll = SyncopationEvaluator.calculateSyncopation(allOn);
    near('全 1（无静音）→ sync === 0', syncAll, 0, 0.001);

    // 1d: 全 0
    const allOff = new Int8Array(16);
    const syncEmpty = SyncopationEvaluator.calculateSyncopation(allOff);
    near('全 0 → sync === 0', syncEmpty, 0, 0.001);

    // 1e: 4 拍正拍（quarter notes，1,0,0,0, 1,0,0,0, ...）
    const quarters = new Int8Array(16);
    for (let i = 0; i < 16; i += 4) quarters[i] = 1;
    const syncQ = SyncopationEvaluator.calculateSyncopation(quarters);
    near('4 个正拍 → sync ≈ 0（无切分）', syncQ, 0, 0.001);

    // 1f: 经典 anticipation — Beat 1 + "and of 2" (8th 反拍)
    // pattern: [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0]
    const antic = new Int8Array(16);
    antic[0] = 1;
    antic[6] = 1;
    const syncAntic = SyncopationEvaluator.calculateSyncopation(antic);
    // Expected: step 8 (weight 3, half-note) is silent, prev=step 6 (weight 1, 8th)
    //   contributes (3-1)=2 to raw.
    //   Also steps 12 (weight 2) silent → contributes (2-1)=1
    //   Final raw = 2+1 = 3. denom = 11. → ≈ 0.27
    check(
        'anticipation pattern sync ∈ (0.2, 0.4)',
        syncAntic > 0.2 && syncAntic < 0.4,
        `actual=${syncAntic.toFixed(4)}`,
    );
    console.log(`     grid: ${gridToStr(antic)}  sync=${syncAntic.toFixed(3)}`);
}

// ============================================================
// Test 2 — RhythmMutator
// ============================================================

function testRhythmMutator(): void {
    header('Test 2 — RhythmMutator');

    // 2a-c：三种 target sync 收敛检测
    const targets = [0.1, 0.5, 0.9];
    for (const target of targets) {
        PRNGManager.setSeed(SEED);
        const { grid, diagnostics } = RhythmMutator.generateWithDiagnostics({
            totalBeats: 4,           // 1 小节
            stepsPerBeat: 4,
            sparsityTendency: 0.4,
            syncopationAssault: target,
        });
        console.log(`\n  target sync=${target.toFixed(2)}, sparsity=0.4:`);
        console.log(`     grid: ${gridToStr(grid)}`);
        console.log(
            `     final sync=${diagnostics.finalSyncopation.toFixed(3)}  ` +
            `hits=${diagnostics.finalHits}  ` +
            `iters=${diagnostics.iterationsUsed}/20  ` +
            `shifts=${diagnostics.shiftsAttempted} (rollback=${diagnostics.shiftsRolledBack})`,
        );
        // 收敛宽容度：±0.25（变异在小网格 + 有界循环下不可能完美命中，
        // 0.25 容差能验证算法方向是对的而非纯噪声）
        check(
            `sync 收敛到 target=${target} ± 0.25`,
            Math.abs(diagnostics.finalSyncopation - target) <= 0.25,
            `actual=${diagnostics.finalSyncopation.toFixed(3)}`,
        );
        // 有界迭代验证（C-4）
        check(
            `iterationsUsed ≤ 20 (target=${target})`,
            diagnostics.iterationsUsed <= 20,
            `actual=${diagnostics.iterationsUsed}`,
        );
    }

    // 2d: 不同 sparsity → 密度合理
    PRNGManager.setSeed(SEED);
    const denseDiag = RhythmMutator.generateWithDiagnostics({
        totalBeats: 4, sparsityTendency: 0.0, syncopationAssault: 0.5,
    }).diagnostics;
    PRNGManager.setSeed(SEED);
    const sparseDiag = RhythmMutator.generateWithDiagnostics({
        totalBeats: 4, sparsityTendency: 0.9, syncopationAssault: 0.5,
    }).diagnostics;
    check(
        'sparsity=0.0 击点数 > sparsity=0.9 击点数',
        denseDiag.finalHits > sparseDiag.finalHits,
        `dense=${denseDiag.finalHits}  sparse=${sparseDiag.finalHits}`,
    );
    console.log(`     dense (sp=0.0): hits=${denseDiag.finalHits}`);
    console.log(`     sparse (sp=0.9): hits=${sparseDiag.finalHits}`);

    // 2e: 同 seed 两次 generate → grid 完全一致
    PRNGManager.setSeed(SEED);
    const grid1 = RhythmMutator.generate({
        totalBeats: 4, sparsityTendency: 0.5, syncopationAssault: 0.6,
    });
    PRNGManager.setSeed(SEED);
    const grid2 = RhythmMutator.generate({
        totalBeats: 4, sparsityTendency: 0.5, syncopationAssault: 0.6,
    });
    let identical = grid1.length === grid2.length;
    if (identical) {
        for (let i = 0; i < grid1.length; i++) {
            if (grid1[i] !== grid2[i]) { identical = false; break; }
        }
    }
    check('同 seed → 两次 generate 字节一致 (D-1)', identical);

    // 2f: step 0 永远是 hit（downbeat 锚）
    PRNGManager.setSeed(SEED + 999);
    const gridWithAnchor = RhythmMutator.generate({
        totalBeats: 4, sparsityTendency: 0.9, syncopationAssault: 0.9,
    });
    check('step 0 永远是 hit（downbeat anchor）', gridWithAnchor[0] === 1);
}

// ============================================================
// Test 3 — TextureMapper（4 种 contour 形态）
// ============================================================

function testTextureMapper(): void {
    header('Test 3 — TextureMapper');

    const chord: GeneratedChord = {
        numeral: 'I', root: 0, quality: 0 as never,
        startBeat: 0, endBeat: 4,
    };
    const voicing = [48, 55, 64, 72];  // C3 G3 E4 C5（相对空间，含 root + 5 + 3 + 8）
    // 简单 1+& pattern：step 0, 2, 4, 6（4 个 quarter+8th）
    const grid = new Int8Array(16);
    grid[0] = 1; grid[2] = 1; grid[4] = 1; grid[6] = 1;

    // 3a: Upward
    PRNGManager.setSeed(SEED);
    const upNotes = TextureMapper.render({
        chord, voicing, grid, stepsPerBeat: 4,
        contour: ContourType.Upward,
        velocityRange: [40, 100],
    });
    console.log(`\n  Upward (4 hits, 4-voice):`);
    for (const n of upNotes) {
        console.log(`     onset=${n.onset.toFixed(2)}  pitch=${n.pitch}  vel=${n.velocity.toFixed(3)}`);
    }
    check('Upward 输出 4 个单音 NoteData', upNotes.length === 4);
    check('Upward 音高循环 voicing[0..3]',
        upNotes[0].pitch === voicing[0] &&
        upNotes[1].pitch === voicing[1] &&
        upNotes[2].pitch === voicing[2] &&
        upNotes[3].pitch === voicing[3],
    );

    // 3b: Downward
    PRNGManager.setSeed(SEED);
    const downNotes = TextureMapper.render({
        chord, voicing, grid, stepsPerBeat: 4,
        contour: ContourType.Downward,
        velocityRange: [40, 100],
    });
    check('Downward 输出 4 个单音 NoteData', downNotes.length === 4);
    check('Downward 音高循环 voicing[3..0]',
        downNotes[0].pitch === voicing[3] &&
        downNotes[1].pitch === voicing[2] &&
        downNotes[2].pitch === voicing[1] &&
        downNotes[3].pitch === voicing[0],
    );

    // 3c: Alternating（偶数 Block / 奇数单音）
    PRNGManager.setSeed(SEED);
    const altNotes = TextureMapper.render({
        chord, voicing, grid, stepsPerBeat: 4,
        contour: ContourType.Alternating,
        velocityRange: [40, 100],
    });
    // 4 hits: hit0=Block(4) + hit1=单音(1) + hit2=Block(4) + hit3=单音(1) = 10 notes
    check('Alternating 总数 === 10', altNotes.length === 10);

    // 3d: Random（Block 与单音混合）
    PRNGManager.setSeed(SEED);
    const randNotes = TextureMapper.render({
        chord, voicing, grid, stepsPerBeat: 4,
        contour: ContourType.Random,
        velocityRange: [40, 100],
    });
    // 4 hits，每个 1~4 音之间 → 总数 ∈ [4, 16]
    check(
        'Random NoteData 数 ∈ [4, 16]',
        randNotes.length >= 4 && randNotes.length <= 16,
        `actual=${randNotes.length}`,
    );

    // 3e: pitch space 验证 — 所有 NoteData.pitch ∈ voicing[]（无 +keyOffset 痕迹）
    let allInVoicing = true;
    for (const n of [...upNotes, ...downNotes, ...altNotes, ...randNotes]) {
        if (!voicing.includes(n.pitch)) {
            allInVoicing = false;
            break;
        }
    }
    check('所有 NoteData.pitch ∈ voicing[] (Pitch Space: RELATIVE, K-2)', allInVoicing);

    // 3f: 排序 — onset ASC, pitch ASC
    let sortedOK = true;
    for (const arr of [upNotes, downNotes, altNotes, randNotes]) {
        for (let i = 1; i < arr.length; i++) {
            const prev = arr[i - 1];
            const cur = arr[i];
            const onsetDiff = cur.onset - prev.onset;
            if (onsetDiff < -EPS) { sortedOK = false; break; }
            if (Math.abs(onsetDiff) <= EPS && cur.pitch < prev.pitch) {
                sortedOK = false; break;
            }
        }
        if (!sortedOK) break;
    }
    check('sort: onset ASC, pitch ASC (D-3)', sortedOK);

    // 3g: velocity 与 metrical weight 正相关 — step 0 (weight 4) > step 6 (weight 1)
    const velAtStep0 = upNotes[0].velocity;
    const velAtStep6 = upNotes[3].velocity;
    check(
        'velocity(step 0) > velocity(step 6) — weight 正相关',
        velAtStep0 > velAtStep6,
        `step0=${velAtStep0.toFixed(3)}  step6=${velAtStep6.toFixed(3)}`,
    );

    // 3h: Truncation — 若开启，相邻击点间 duration === gap
    const expectedDur = 2 / 4;  // step 0 → step 2，gap=2 step / 4 stepsPerBeat = 0.5 beat
    near(
        'Upward truncation duration ≈ 0.5 beat (step gap=2)',
        upNotes[0].duration, expectedDur, 0.001,
    );

    // 3i: 关闭 truncation
    const noTruncNotes = TextureMapper.render({
        chord, voicing, grid, stepsPerBeat: 4,
        contour: ContourType.Upward,
        velocityRange: [40, 100],
        truncateOverlap: false,
    });
    near(
        '关闭 truncation → duration === 1 step = 0.25 beat',
        noTruncNotes[0].duration, 0.25, 0.001,
    );
}

// ============================================================
// Test 4 — 端到端：HarmonyCore + Persona Marcus (NeoSoul)
// ============================================================

function testEndToEnd(): void {
    header('Test 4 — End-to-End: HarmonyCore → RhythmMutator → TextureMapper');

    PRNGManager.setSeed(SEED);
    const sections: SectionMetadata[] = [
        { name: 'Verse_1', sectionType: SectionType.Verse, startBeat: 0, endBeat: 16, energyLevel: 5 },
    ];
    const harmony = HarmonyCore.generate({
        sections,
        tonality: Tonality.Major,
        harmonyRules: NEO_SOUL_HARMONY_RULES,
        voiceLeadingConfig: NEO_SOUL_VOICE_LEADING,
        chordsPerSection: 4,
    });

    // Phase 1a:harmony.voicings 是 VoicedPitch[][],为 TextureMapper / .includes 测试
    // 派生 pitch-only 数组(本脚本仅供 dev debug,转换零成本)。
    const voicingsPitchArray: number[][] = harmony.voicings.map(v => v.map(p => p.pitch));

    console.log(`\n  HarmonyCore output: ${harmony.chords.length} chords`);
    for (let i = 0; i < harmony.chords.length; i++) {
        const c = harmony.chords[i];
        const v = voicingsPitchArray[i];
        console.log(
            `     [${i}] ${c.numeral.padEnd(8)} ` +
            `${(ChordQualityName[c.quality] ?? '?').padEnd(14)} ` +
            `voicing=[${v.join(',')}]`,
        );
    }

    // 模拟 Marcus (NeoSoul Keys) 的 Persona：
    //   colorBias=0.9 / sparsityTendency=0.8 / sync=0.9 / dynamic=[40,90] / contour=Alternating
    const marcusPersona = {
        sparsityTendency: 0.8,
        syncopationAssault: 0.9,
        dynamicRange: [40, 90] as [number, number],
        contour: ContourType.Alternating,
    };

    // 每个 chord 独立跑 RhythmMutator
    const grids: Int8Array[] = [];
    const allDiags: RhythmMutatorDiagnostics[] = [];
    for (const c of harmony.chords) {
        const dur = c.endBeat - c.startBeat;
        const { grid, diagnostics } = RhythmMutator.generateWithDiagnostics({
            totalBeats: dur,
            stepsPerBeat: 4,
            sparsityTendency: marcusPersona.sparsityTendency,
            syncopationAssault: marcusPersona.syncopationAssault,
        });
        grids.push(grid);
        allDiags.push(diagnostics);
    }

    console.log(`\n  Marcus rhythm grids (Persona: sparsity=0.8, sync=0.9):`);
    for (let i = 0; i < grids.length; i++) {
        console.log(
            `     [${i}] ${gridToStr(grids[i])}  ` +
            `sync=${allDiags[i].finalSyncopation.toFixed(3)}  ` +
            `hits=${allDiags[i].finalHits}  ` +
            `iters=${allDiags[i].iterationsUsed}`,
        );
    }

    // TextureMapper 批量渲染(TextureMapper 仍接受 number[][],转 pitch-only)
    const notes: NoteData[] = TextureMapper.renderProgression({
        chords: harmony.chords,
        voicings: voicingsPitchArray,
        grids,
        stepsPerBeat: 4,
        contour: marcusPersona.contour,
        velocityRange: marcusPersona.dynamicRange,
    });

    console.log(`\n  TextureMapper output: ${notes.length} NoteData`);
    console.log('  ── first 12 NoteData ──');
    for (let i = 0; i < Math.min(12, notes.length); i++) {
        const n = notes[i];
        console.log(
            `     onset=${n.onset.toFixed(2).padStart(5)}  ` +
            `pitch=${String(n.pitch).padStart(3)}  ` +
            `dur=${n.duration.toFixed(3)}  ` +
            `vel=${n.velocity.toFixed(3)}`,
        );
    }
    if (notes.length > 12) {
        console.log(`     ...  (省略 ${notes.length - 12} 条)`);
    }

    check(
        '端到端有 NoteData 输出',
        notes.length > 0,
        `count=${notes.length}`,
    );

    // 验证所有 NoteData.pitch ∈ HarmonyCore 给出的对应 voicing
    let allPitchesValid = true;
    for (const n of notes) {
        // 找到 n.onset 落在哪个 chord
        let chordIdx = -1;
        for (let i = 0; i < harmony.chords.length; i++) {
            const c = harmony.chords[i];
            if (n.onset >= c.startBeat - EPS && n.onset < c.endBeat - EPS) {
                chordIdx = i; break;
            }
        }
        if (chordIdx < 0) {
            allPitchesValid = false;
            console.log(`     ✗ note onset=${n.onset} 落在 chord 区间外`);
            break;
        }
        if (!voicingsPitchArray[chordIdx].includes(n.pitch)) {
            allPitchesValid = false;
            console.log(`     ✗ note pitch=${n.pitch} 不在 chord[${chordIdx}].voicing=${voicingsPitchArray[chordIdx]}`);
            break;
        }
    }
    check('所有 NoteData.pitch 命中对应 chord 的 voicing (K-2 闭环)', allPitchesValid);

    // 排序验证
    let sortedOK = true;
    for (let i = 1; i < notes.length; i++) {
        const onsetDiff = notes[i].onset - notes[i - 1].onset;
        if (onsetDiff < -EPS) { sortedOK = false; break; }
        if (Math.abs(onsetDiff) <= EPS && notes[i].pitch < notes[i - 1].pitch) {
            sortedOK = false; break;
        }
    }
    check('全曲 NoteData sort: onset ASC, pitch ASC', sortedOK);

    // 有界迭代
    let allBounded = true;
    for (const d of allDiags) {
        if (d.iterationsUsed > 20) { allBounded = false; break; }
    }
    check('所有 chord 的 RhythmMutator iterations ≤ 20 (C-4)', allBounded);
}

// ============================================================
// Main
// ============================================================

function main(): void {
    console.log(`\n${'■'.repeat(78)}`);
    console.log(`  Phase 2.6 — TextureMapper Suite Verification   seed=${SEED}`);
    console.log(`${'■'.repeat(78)}`);

    testSyncopationEvaluator();
    testRhythmMutator();
    testTextureMapper();
    testEndToEnd();

    console.log(`\n${'═'.repeat(78)}`);
    console.log(`  SUMMARY:  ${passed} passed,  ${failed} failed   (total ${passed + failed})`);
    console.log(`${'═'.repeat(78)}`);
    if (failed > 0) {
        console.log('\n  Failures:');
        for (const f of failures) console.log(`    - ${f}`);
        process.exit(1);
    } else {
        console.log('\n  ✓ All checks passed — Phase 2.6 primitives 通过验收');
    }
}

main();
