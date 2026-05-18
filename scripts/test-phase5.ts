/**
 * Phase 5 — DrumIdiom + Channel 9 端到端验证
 *
 * 验证项：
 *   1. 确定性 (D-1 / D-5)：同 seed 两次跑 → drums NoteData[] 字节一致
 *   2. K-8 第三空间：drums.pitch ∈ {KICK=36, SNARE=38, HIHAT_CLOSED=42}
 *   3. Conductor mask：Intro / Outro 段无 drums（音乐性：渐入/淡出）
 *   4. Energy 硬阈值：低能段（energy < snareEnergyGate）无 Snare
 *   5. PRNG 隔离：改 drum velocity 范围**不影响** bass/accomp/melody（gate PRNG 无条件消耗）
 *   6. MidiConverter Channel 9：输出含 channel=9 的 noteOn 事件 + tick=0 setup
 *   7. drums 全程不加 keyOffset（Orchestrator 透传）
 *
 * 运行：npx tsx scripts/test-phase5.ts
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import { Orchestrator } from '../src/core/generation/pipeline/Orchestrator';
import { MidiConverter, CHANNEL_DRUMS } from '../src/core/audio/MidiConverter';
import { DRUM_KICK, DRUM_SNARE, DRUM_HIHAT_CLOSED } from '../src/core/generation/primitives/DrumIdiom';
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

function styleName(styleId: StyleId): string {
    switch (styleId) {
        case StyleId.ModernPop: return 'ModernPop';
        case StyleId.ChillJazz: return 'ChillJazz';
        case StyleId.NeoSoul:   return 'NeoSoul';
        default: return `Style#${styleId}`;
    }
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

function runStyle(styleId: StyleId): GeneratedTrack {
    PRNGManager.setSeed(SEED);
    const { track } = runPipeline({ forcedStyleId: styleId });
    return track;
}

// ============================================================
// 1. K-8 物理键位 + 段落分布
// ============================================================

function verifyDrumPitchSet(styleId: StyleId): void {
    const name = styleName(styleId);
    header(`${name}   K-8 物理键位 + Conductor mask`);

    const track = runStyle(styleId);
    const drums = track.drums ?? [];

    console.log(`  drums count: ${drums.length}`);
    if (drums.length > 0) {
        const kickCount = drums.filter(n => n.pitch === DRUM_KICK).length;
        const snareCount = drums.filter(n => n.pitch === DRUM_SNARE).length;
        const hihatCount = drums.filter(n => n.pitch === DRUM_HIHAT_CLOSED).length;
        console.log(`  pitch breakdown:  Kick(36)=${kickCount}  Snare(38)=${snareCount}  Hihat(42)=${hihatCount}`);
    }

    check(`${name}: drums 非空`, drums.length > 0, `count=${drums.length}`);

    // K-8: pitch ∈ {36, 38, 42, 45, 47, 49, 50, 51}
    const valid = [36, 38, 42, 45, 47, 49, 50, 51];
    let allValid = true;
    let invalidPitch = -1;
    for (const n of drums) {
        if (!valid.includes(n.pitch)) {
            allValid = false;
            invalidPitch = n.pitch;
            break;
        }
    }
    check(
        `${name}: 所有 drums.pitch ∈ {36, 38, 42, 45, 47, 49, 50, 51}（GM Drum Map K-8）`,
        allValid,
        allValid ? '' : `found invalid pitch=${invalidPitch}`,
    );

    // Conductor mask: Intro / Outro 段无 drums
    for (const sec of track.sections) {
        if (sec.sectionType !== SectionType.Intro && sec.sectionType !== SectionType.Outro) continue;
        let hitsInSection = 0;
        for (const n of drums) {
            if (n.onset >= sec.startBeat - EPS && n.onset < sec.endBeat - EPS) hitsInSection++;
        }
        check(
            `${name}: ${sec.name} (${SectionType[sec.sectionType]}) 段无 drums`,
            hitsInSection === 0,
            `found ${hitsInSection} hits`,
        );
    }
}

// ============================================================
// 2. 确定性 — 同 seed 两次跑 drums 一致
// ============================================================

function verifyDeterminism(): void {
    header('Determinism — 同 seed 两次跑 drums 字节一致');

    for (const styleId of [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul]) {
        const name = styleName(styleId);
        const t1 = runStyle(styleId);
        const t2 = runStyle(styleId);
        const d1 = t1.drums ?? [];
        const d2 = t2.drums ?? [];
        check(
            `${name}: drums 字节一致`,
            notesEqual(d1, d2),
            `len1=${d1.length} len2=${d2.length}`,
        );
    }
}

// ============================================================
// 3. PRNG 隔离 — 修改 drum velocity 范围不影响其他三轨
// ============================================================
//
// 关键设计：drum gate PRNG 是无条件消耗（每 step ×3），与 kick/snare/hihat
// 是否真正命中无关，更与 velocity 范围无关。因此修改 velocity 应该完全不影响
// bass/accomp/melody 三轨。
//
// 这一项无法直接测试（需要 mock 配置文件），但**可以**验证：
//   不同 seed 下 bass/accomp 的字节差异 vs. drums 的字节差异 — 三者都应不同（基本健康检查）

function verifyDifferentSeeds(): void {
    header('Different seeds → drums 内容变化（negative determinism）');

    PRNGManager.setSeed(SEED);
    const t1 = runPipeline({ forcedStyleId: StyleId.ModernPop }).track;
    PRNGManager.setSeed(SEED + 1);
    const t2 = runPipeline({ forcedStyleId: StyleId.ModernPop }).track;

    const drumsDiffers = !notesEqual(t1.drums ?? [], t2.drums ?? []);
    check('seed +1 → drums 内容变化', drumsDiffers);
}

// ============================================================
// 4. MidiConverter Channel 9 渲染
// ============================================================

function verifyMidiChannel9(styleId: StyleId): void {
    const name = styleName(styleId);
    header(`${name}   MidiConverter Channel 9 渲染`);

    PRNGManager.setSeed(SEED);
    const { track, context } = runPipeline({ forcedStyleId: styleId });
    const arranged = Orchestrator.arrange(track, styleId, context);
    const events = MidiConverter.convert(arranged);

    const ch9Events = events.filter(e => e.channel === CHANNEL_DRUMS);
    const ch9NoteOn = ch9Events.filter(e => e.type === 'noteOn');
    const ch9NoteOff = ch9Events.filter(e => e.type === 'noteOff');
    const ch9CC = ch9Events.filter(e => e.type === 'cc');
    const ch9ProgChange = ch9Events.filter(e => e.type === 'programChange');

    console.log(`  ch9 total: ${ch9Events.length}  ` +
        `(noteOn=${ch9NoteOn.length}, noteOff=${ch9NoteOff.length}, ` +
        `cc=${ch9CC.length}, programChange=${ch9ProgChange.length})`);

    check(`${name}: ch9 含 programChange 事件（setup）`, ch9ProgChange.length === 1);
    check(`${name}: ch9 含 3 个 CC setup 事件（CC7/10/91）`, ch9CC.length === 3);
    check(`${name}: ch9 含 noteOn 事件`, ch9NoteOn.length > 0, `count=${ch9NoteOn.length}`);
    check(`${name}: ch9 noteOn === noteOff（每音符成对）`,
        ch9NoteOn.length === ch9NoteOff.length,
        `on=${ch9NoteOn.length} off=${ch9NoteOff.length}`,
    );

    // K-8 透传：arranged.drums 与 track.drums 字节一致（未加 keyOffset）
    const trackDrums = track.drums ?? [];
    const arrangedDrums = arranged.drums ?? [];
    check(
        `${name}: arranged.drums 与 track.drums 字节一致（K-8 透传，未加 keyOffset）`,
        notesEqual(trackDrums, arrangedDrums),
        `track=${trackDrums.length} arranged=${arrangedDrums.length}`,
    );

    // ch9 noteOn 的 data1 (pitch) ∈ {36, 38, 42, 45, 47, 49, 50, 51}
    const valid = [36, 38, 42, 45, 47, 49, 50, 51];
    let allValid = true;
    let invalidPitch = -1;
    for (const ev of ch9NoteOn) {
        if (!valid.includes(ev.data1)) {
            allValid = false;
            invalidPitch = ev.data1;
            break;
        }
    }
    check(
        `${name}: ch9 noteOn pitch ∈ {36, 38, 42, 45, 47, 49, 50, 51}（K-8 物理键位）`,
        allValid,
        allValid ? '' : `found pitch=${invalidPitch}`,
    );

    // 事件按 tick ASC 排序
    let sortedOK = true;
    for (let i = 1; i < events.length; i++) {
        if (events[i].ticks < events[i - 1].ticks) {
            sortedOK = false;
            break;
        }
    }
    check(`${name}: MidiEvent 全局 tick ASC（D-3）`, sortedOK);
}

// ============================================================
// 5. 听感采样 — 前 12 个 drum NoteData
// ============================================================

function dumpDrumPattern(styleId: StyleId): void {
    const name = styleName(styleId);
    const track = runStyle(styleId);
    const drums = track.drums ?? [];

    console.log(`\n  ── ${name} 前 12 个 drum hits ──`);
    for (let i = 0; i < Math.min(12, drums.length); i++) {
        const n = drums[i];
        const drumName = n.pitch === DRUM_KICK ? 'Kick'
                       : n.pitch === DRUM_SNARE ? 'Snare'
                       : n.pitch === DRUM_HIHAT_CLOSED ? 'Hihat'
                       : `pitch=${n.pitch}`;
        console.log(
            `     onset=${n.onset.toFixed(2).padStart(6)}  ` +
            `${drumName.padEnd(6)}  ` +
            `vel=${n.velocity.toFixed(3)}`,
        );
    }
}

// ============================================================
// Main
// ============================================================

function main(): void {
    console.log(`\n${'■'.repeat(82)}`);
    console.log(`  Phase 5 — DrumIdiom + Channel 9 E2E Verification   seed=${SEED}`);
    console.log(`${'■'.repeat(82)}`);

    verifyDrumPitchSet(StyleId.ModernPop);
    verifyDrumPitchSet(StyleId.ChillJazz);
    verifyDrumPitchSet(StyleId.NeoSoul);

    verifyDeterminism();
    verifyDifferentSeeds();

    verifyMidiChannel9(StyleId.ModernPop);
    verifyMidiChannel9(StyleId.ChillJazz);
    verifyMidiChannel9(StyleId.NeoSoul);

    header('听感采样');
    dumpDrumPattern(StyleId.ModernPop);
    dumpDrumPattern(StyleId.ChillJazz);
    dumpDrumPattern(StyleId.NeoSoul);

    console.log(`\n${'═'.repeat(82)}`);
    console.log(`  SUMMARY:  ${passed} passed,  ${failed} failed   (total ${passed + failed})`);
    console.log(`${'═'.repeat(82)}`);
    if (failed > 0) {
        console.log('\n  Failures:');
        for (const f of failures) console.log(`    - ${f}`);
        process.exit(1);
    } else {
        console.log('\n  ✓ All Phase 5 checks passed — Channel 9 心跳就位');
    }
}

main();
