/**
 * Phase 3 — Stage 5 layerInstruments 端到端验证
 *
 * 3 风格 × seed=12345：跑完整管线，验证：
 *   1. 三轨非空（Verse/Chorus 段必须有 melody/accomp/bass）
 *   2. Pitch Space: RELATIVE 闭环
 *      - bass.pitch ∈ [24, 60]      （C1~C4，未加 keyOffset）
 *      - accomp.pitch ∈ [48, 100]   （C3~E7，避让 Bass 频段）
 *      - melody.pitch ∈ [60, 100]   （C4~E7，soprano 区）
 *   3. 全轨 onset ASC + pitch 次键 ASC（D-3）
 *   4. 所有 NoteData 落在 [0, totalDuration]（无越界）
 *   5. 同 seed × 2 → 三轨字节一致（D-1 / D-5）
 *   6. Intro/Outro 段无 melody（Conductor mask）
 *   7. NoteData 可 JSON 序列化（S-4）
 *
 * 运行：npx tsx scripts/test-stage5.ts
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import {
    GeneratedTrack, NoteData, SectionType,
} from '../src/core/generation/types';

const SEED = 12345;
const EPS = 1e-6;

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

function header(title: string): void {
    console.log(`\n${'═'.repeat(82)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(82)}`);
}

function isSorted(notes: NoteData[]): boolean {
    for (let i = 1; i < notes.length; i++) {
        const d = notes[i].onset - notes[i - 1].onset;
        if (d < -EPS) return false;
        if (Math.abs(d) <= EPS && notes[i].pitch < notes[i - 1].pitch) return false;
    }
    return true;
}

function pitchInRange(notes: NoteData[], lo: number, hi: number): boolean {
    for (const n of notes) {
        if (n.pitch < lo || n.pitch > hi) return false;
    }
    return true;
}

function notesEqual(a: NoteData[], b: NoteData[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].pitch !== b[i].pitch) return false;
        if (Math.abs(a[i].onset - b[i].onset) > EPS) return false;
        if (Math.abs(a[i].duration - b[i].duration) > EPS) return false;
        if (Math.abs(a[i].velocity - b[i].velocity) > EPS) return false;
    }
    return true;
}

function styleName(styleId: StyleId): string {
    switch (styleId) {
        case StyleId.ModernPop: return 'ModernPop';
        case StyleId.ChillJazz: return 'ChillJazz';
        case StyleId.NeoSoul:   return 'NeoSoul';
        default: return `Style#${styleId}`;
    }
}

function printTrackSummary(track: GeneratedTrack, label: string): void {
    const melody = track.melody;
    const accomp = track.accompaniment ?? [];
    const bass   = track.bass        ?? [];
    console.log(`\n  ── ${label} ──`);
    console.log(`     bpm=${track.bpm}  key=${track.key}  sections=${track.sections.length}  chords=${track.chords.length}`);
    console.log(`     melody:        ${melody.length} notes` +
        (melody.length > 0 ? `   pitch=[${minPitch(melody)}, ${maxPitch(melody)}]` : ''));
    console.log(`     accompaniment: ${accomp.length} notes` +
        (accomp.length > 0 ? `   pitch=[${minPitch(accomp)}, ${maxPitch(accomp)}]` : ''));
    console.log(`     bass:          ${bass.length} notes` +
        (bass.length > 0 ? `   pitch=[${minPitch(bass)}, ${maxPitch(bass)}]` : ''));
}

function minPitch(notes: NoteData[]): number {
    let m = Infinity;
    for (const n of notes) if (n.pitch < m) m = n.pitch;
    return m;
}
function maxPitch(notes: NoteData[]): number {
    let m = -Infinity;
    for (const n of notes) if (n.pitch > m) m = n.pitch;
    return m;
}

// ============================================================
// 单风格验证
// ============================================================

function runStyle(styleId: StyleId): GeneratedTrack {
    PRNGManager.setSeed(SEED);
    const { track } = runPipeline({ forcedStyleId: styleId });
    return track;
}

function verifyStyle(styleId: StyleId): void {
    const name = styleName(styleId);
    header(`Style: ${name}   seed=${SEED}`);

    const track = runStyle(styleId);
    printTrackSummary(track, name);

    const melody = track.melody;
    const accomp = track.accompaniment ?? [];
    const bass   = track.bass        ?? [];

    // 1. 非空（accomp + bass 至少应有；melody 取决于 conductor mask）
    check(`${name}: bass 非空`, bass.length > 0, `count=${bass.length}`);
    check(`${name}: accompaniment 非空`, accomp.length > 0, `count=${accomp.length}`);
    // melody 取决于 conductor — verse/chorus 段会有，intro/outro 不会
    // 当前默认 sections 含 Verse + Chorus，所以 melody 应非空
    check(`${name}: melody 非空`, melody.length > 0, `count=${melody.length}`);

    // 2. Pitch Space: RELATIVE 范围
    check(
        `${name}: bass.pitch ∈ [24, 60]（C1~C4 RELATIVE）`,
        bass.length === 0 || pitchInRange(bass, 24, 60),
        bass.length > 0 ? `range=[${minPitch(bass)}, ${maxPitch(bass)}]` : '',
    );
    check(
        `${name}: accompaniment.pitch ∈ [48, 100]（≥C3 避让 bass）`,
        accomp.length === 0 || pitchInRange(accomp, 48, 100),
        accomp.length > 0 ? `range=[${minPitch(accomp)}, ${maxPitch(accomp)}]` : '',
    );
    check(
        `${name}: melody.pitch ∈ [60, 100]（C4~E7 soprano）`,
        melody.length === 0 || pitchInRange(melody, 60, 100),
        melody.length > 0 ? `range=[${minPitch(melody)}, ${maxPitch(melody)}]` : '',
    );

    // 3. 排序
    check(`${name}: bass sort (onset, pitch) ASC`, isSorted(bass));
    check(`${name}: accomp sort (onset, pitch) ASC`, isSorted(accomp));
    check(`${name}: melody sort (onset, pitch) ASC`, isSorted(melody));

    // 4. 落在 [0, totalDuration]
    const totalDur = track.sections.length > 0
        ? track.sections[track.sections.length - 1].endBeat
        : 0;
    function allWithin(notes: NoteData[]): boolean {
        for (const n of notes) {
            if (n.onset < -EPS) return false;
            if (n.onset + n.duration > totalDur + EPS) return false;
        }
        return true;
    }
    check(`${name}: bass 全部落在 [0, ${totalDur}]`, allWithin(bass));
    check(`${name}: accomp 全部落在 [0, ${totalDur}]`, allWithin(accomp));
    check(`${name}: melody 全部落在 [0, ${totalDur}]`, allWithin(melody));

    // 5. Conductor mask 验证 — Intro/Outro 段不应有 melody
    function noNotesInSection(notes: NoteData[], sStart: number, sEnd: number): boolean {
        for (const n of notes) {
            if (n.onset >= sStart - EPS && n.onset < sEnd - EPS) return false;
        }
        return true;
    }
    for (const sec of track.sections) {
        if (sec.sectionType === SectionType.Intro || sec.sectionType === SectionType.Outro) {
            check(
                `${name}: ${sec.name} (${SectionType[sec.sectionType]}) 段 melody = 0 notes`,
                noNotesInSection(melody, sec.startBeat, sec.endBeat),
            );
        }
    }

    // 6. JSON 序列化（S-4）
    let jsonOK = true;
    try {
        JSON.stringify({ melody, accomp, bass });
    } catch {
        jsonOK = false;
    }
    check(`${name}: 三轨可 JSON 序列化（S-4）`, jsonOK);
}

// ============================================================
// 确定性验证（同 seed 两次跑结果字节一致）
// ============================================================

function verifyDeterminism(): void {
    header('Determinism — 同 seed 两次跑应字节一致（D-1 / D-5）');

    for (const styleId of [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul]) {
        const name = styleName(styleId);
        const t1 = runStyle(styleId);
        const t2 = runStyle(styleId);
        check(
            `${name}: melody 字节一致`,
            notesEqual(t1.melody, t2.melody),
            `len1=${t1.melody.length} len2=${t2.melody.length}`,
        );
        check(
            `${name}: accompaniment 字节一致`,
            notesEqual(t1.accompaniment ?? [], t2.accompaniment ?? []),
            `len1=${(t1.accompaniment ?? []).length} len2=${(t2.accompaniment ?? []).length}`,
        );
        check(
            `${name}: bass 字节一致`,
            notesEqual(t1.bass ?? [], t2.bass ?? []),
            `len1=${(t1.bass ?? []).length} len2=${(t2.bass ?? []).length}`,
        );
    }
}

// ============================================================
// 不同 seed 应产生不同输出（reject silence-on-seed-change bug）
// ============================================================

function verifyDifferentSeeds(): void {
    header('Different seeds → different outputs (negative determinism)');

    PRNGManager.setSeed(SEED);
    const t1 = runPipeline({ forcedStyleId: StyleId.ModernPop }).track;
    PRNGManager.setSeed(SEED + 1);
    const t2 = runPipeline({ forcedStyleId: StyleId.ModernPop }).track;

    const melodyDiffers = !notesEqual(t1.melody, t2.melody);
    const accompDiffers = !notesEqual(t1.accompaniment ?? [], t2.accompaniment ?? []);
    // bass 是 0 PRNG 但依赖 chord 进行（chord 进行随 seed 变化）→ bass 也会变
    const bassDiffers = !notesEqual(t1.bass ?? [], t2.bass ?? []);

    check('seed +1 → melody 内容变化', melodyDiffers);
    check('seed +1 → accompaniment 内容变化', accompDiffers);
    check('seed +1 → bass 内容变化（间接：chord 进行变了）', bassDiffers);
}

// ============================================================
// 端到端听感 — 打印第一段 melody / accomp / bass 的前几个 NoteData
// ============================================================

function dumpFirstNotes(): void {
    header('听感采样 — 各风格前 8 个 NoteData');

    for (const styleId of [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul]) {
        const name = styleName(styleId);
        const track = runStyle(styleId);
        console.log(`\n  ${name}:`);
        console.log(`     melody (first 8):`);
        for (let i = 0; i < Math.min(8, track.melody.length); i++) {
            const n = track.melody[i];
            console.log(
                `        onset=${n.onset.toFixed(2).padStart(6)}  ` +
                `pitch=${String(n.pitch).padStart(3)}  ` +
                `dur=${n.duration.toFixed(3)}  ` +
                `vel=${n.velocity.toFixed(3)}`,
            );
        }
        const accomp = track.accompaniment ?? [];
        console.log(`     accomp (first 8):`);
        for (let i = 0; i < Math.min(8, accomp.length); i++) {
            const n = accomp[i];
            console.log(
                `        onset=${n.onset.toFixed(2).padStart(6)}  ` +
                `pitch=${String(n.pitch).padStart(3)}  ` +
                `dur=${n.duration.toFixed(3)}  ` +
                `vel=${n.velocity.toFixed(3)}`,
            );
        }
        const bass = track.bass ?? [];
        console.log(`     bass (first 8):`);
        for (let i = 0; i < Math.min(8, bass.length); i++) {
            const n = bass[i];
            console.log(
                `        onset=${n.onset.toFixed(2).padStart(6)}  ` +
                `pitch=${String(n.pitch).padStart(3)}  ` +
                `dur=${n.duration.toFixed(3)}  ` +
                `vel=${n.velocity.toFixed(3)}`,
            );
        }
    }
}

// ============================================================
// Main
// ============================================================

function main(): void {
    console.log(`\n${'■'.repeat(82)}`);
    console.log(`  Phase 3 — Stage 5 layerInstruments E2E Verification   seed=${SEED}`);
    console.log(`${'■'.repeat(82)}`);

    verifyStyle(StyleId.ModernPop);
    verifyStyle(StyleId.ChillJazz);
    verifyStyle(StyleId.NeoSoul);
    verifyDeterminism();
    verifyDifferentSeeds();
    dumpFirstNotes();

    console.log(`\n${'═'.repeat(82)}`);
    console.log(`  SUMMARY:  ${passed} passed,  ${failed} failed   (total ${passed + failed})`);
    console.log(`${'═'.repeat(82)}`);
    if (failed > 0) {
        console.log('\n  Failures:');
        for (const f of failures) console.log(`    - ${f}`);
        process.exit(1);
    } else {
        console.log('\n  ✓ All Stage 5 checks passed — Phase 3 通过验收');
    }
}

main();
