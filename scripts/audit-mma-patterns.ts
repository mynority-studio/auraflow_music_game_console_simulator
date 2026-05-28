// ============================================================
// audit-mma-patterns.ts — MMA stdlib pattern 数据挖掘 + V3 度量衡对账
// ============================================================
//
// 目标:
//   1. 提取 MMA stdlib 里每个 track 的 Sequence 时间事件
//   2. 统计:beat 位、duration 取值、degree 取值、velocity 分布
//   3. 输出 audit 报告 — 哪些 degree 是 chord tone(1/3/5/7)、
//      哪些是 scale tone(2/4/6)、哪些是 extension(9/11/13)
//   4. 给 V3 patterns.ts 的"chord-tone-only"约束提供数据依据
//
// MMA Sequence 语法(从 bossanova.mma 等观察):
//   Sequence  { beat dur degree vel ; beat dur degree vel ; ... }
//   或 Sequence NamedPattern1 NamedPattern2 ... (引用 Begin Bass/Chord Define
//   定义的命名模式)
//
// 本脚本只扫 inline { ... } 块,跳过命名引用解析(避免递归复杂性)。
// 已足够给出统计分布。
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

const MMA_STDLIB = '/Users/mynority/vibe_coding/mma/lib/stdlib';

interface PatternEvent {
    beat: number;       // MMA beat 位置(1-indexed)
    durRaw: string;     // duration 原值(4 / 8 / 8/3 / 4. 等)
    degree: string;     // scale degree(1, 3, 5, b3, b7 等),或 'noPitch' 鼓事件
    velocity: number;   // 0-127
}

interface TrackPattern {
    file: string;
    track: string;
    events: PatternEvent[];
}

// ─────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────

/** 解析 MMA duration token:'4'→1 beat / '8'→0.5 / '4.'→1.5 / '8/3'→1/3 */
function durToBeats(token: string): number {
    if (token.includes('/')) {
        const [num, den] = token.split('/').map(s => parseFloat(s));
        if (num && den) return 4 / num * 1 / den * 3;  // tuple = base / tuplet factor
    }
    if (token.endsWith('.')) {
        const base = parseFloat(token.slice(0, -1));
        return base ? (4 / base) * 1.5 : NaN;
    }
    const n = parseFloat(token);
    return n ? 4 / n : NaN;
}

/**
 * 从一行 Sequence 块内容里抽 inline {...} 部分,解析事件元组。
 * MMA event = `beat dur degree vel`(空格分隔,分号分隔多事件)。
 *
 * 我们不展开命名引用(如 Basic、P1)— 只在 inline {...} 出现时解析。
 */
function parseInlineSequence(raw: string): PatternEvent[] {
    const events: PatternEvent[] = [];
    // 提取所有 {...} 内容
    const inlineBlocks = raw.match(/\{[^}]+\}/g) ?? [];
    for (const block of inlineBlocks) {
        const inner = block.slice(1, -1).trim();
        // 分号分隔的事件
        const eventStrs = inner.split(';').map(s => s.trim()).filter(s => s.length > 0);
        for (const evStr of eventStrs) {
            // 处理 "* N"(重复)语法 — 先简单跳过
            if (evStr.startsWith('*')) continue;
            const parts = evStr.split(/\s+/).filter(p => p.length > 0);
            if (parts.length < 2) continue;
            const beat = parseFloat(parts[0]);
            if (!Number.isFinite(beat)) continue;
            const dur = parts[1];
            // event 可以是:
            //   `beat dur degree vel`(bass/chord:4 字段)
            //   `beat dur vel`(drum:3 字段,无 degree)
            //   `beat dur vel1 vel2 ...`(chord 多音指定)
            if (parts.length >= 4) {
                events.push({ beat, durRaw: dur, degree: parts[2], velocity: parseInt(parts[3], 10) || 0 });
            } else if (parts.length === 3) {
                events.push({ beat, durRaw: dur, degree: 'noPitch', velocity: parseInt(parts[2], 10) || 0 });
            }
        }
    }
    return events;
}

function extractTrackPatterns(filePath: string): TrackPattern[] {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/).map(l => {
        const idx = l.indexOf('//');
        return idx >= 0 ? l.substring(0, idx) : l;
    });

    const out: TrackPattern[] = [];
    const fileName = path.basename(filePath, '.mma');

    let inDefineBlock = false;
    let currentTrack: string | null = null;
    let buffer: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        const beginMatch = trimmed.match(/^Begin\s+([A-Za-z][A-Za-z0-9_-]*)/i);

        if (beginMatch) {
            const name = beginMatch[1];
            if (/Define/i.test(trimmed)) {
                inDefineBlock = true;
                currentTrack = null;
            } else {
                inDefineBlock = false;
                currentTrack = name;
                buffer = [];
            }
            continue;
        }

        if (/^End\s*$/i.test(trimmed)) {
            if (currentTrack && !inDefineBlock) {
                const combined = buffer.join(' ');
                const seqMatch = combined.match(/Sequence\s+(.+?)(?=(?:Voice|Accent|Voicing|Volume|Articulate|Octave|Rtime|Rvolume|Rskip|Strum|Tone|Harmony|Direction|SeqRnd|Range|Unify|Copy|$))/i);
                if (seqMatch) {
                    const events = parseInlineSequence(seqMatch[1]);
                    if (events.length > 0) {
                        out.push({ file: fileName, track: currentTrack, events });
                    }
                }
            }
            currentTrack = null;
            inDefineBlock = false;
            continue;
        }

        if (currentTrack && !inDefineBlock) {
            buffer.push(trimmed);
        }
    }

    return out;
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

const files = fs.readdirSync(MMA_STDLIB).filter(f => f.endsWith('.mma'));
console.log(`scanning ${files.length} files...`);

const allPatterns: TrackPattern[] = [];
for (const f of files) {
    try {
        allPatterns.push(...extractTrackPatterns(path.join(MMA_STDLIB, f)));
    } catch (e) {
        console.warn(`failed ${f}:`, e);
    }
}

console.log(`extracted ${allPatterns.length} track patterns(含 inline {...}的)\n`);

// 分析:beat 位 / duration / degree / velocity 分布
const stats = {
    beatPositions: {} as Record<string, number>,
    durations: {} as Record<string, number>,
    degrees: {} as Record<string, number>,
    velocities: [] as number[],
    trackTypeCounts: {} as Record<string, number>,
};

for (const p of allPatterns) {
    stats.trackTypeCounts[p.track] = (stats.trackTypeCounts[p.track] ?? 0) + 1;
    for (const ev of p.events) {
        const beatKey = ev.beat.toString();
        stats.beatPositions[beatKey] = (stats.beatPositions[beatKey] ?? 0) + 1;
        stats.durations[ev.durRaw] = (stats.durations[ev.durRaw] ?? 0) + 1;
        stats.degrees[ev.degree] = (stats.degrees[ev.degree] ?? 0) + 1;
        if (Number.isFinite(ev.velocity)) stats.velocities.push(ev.velocity);
    }
}

const sortByCount = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]);
const showTop = (label: string, r: Record<string, number>, top: number = 20): void => {
    const total = Object.values(r).reduce((s, n) => s + n, 0);
    console.log(`\n${label}(total events=${total}):`);
    sortByCount(r).slice(0, top).forEach(([k, v]) => {
        const pct = ((v / total) * 100).toFixed(1);
        console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)} (${pct}%)`);
    });
};

console.log('======== MMA Pattern 度量衡审计 ========\n');
showTop('Track 类型分布', stats.trackTypeCounts, 10);
showTop('Beat 位(1-indexed,半拍精度)', stats.beatPositions, 20);
showTop('Duration token', stats.durations, 15);
showTop('Scale degree', stats.degrees, 25);

// Velocity summary
if (stats.velocities.length > 0) {
    const sorted = [...stats.velocities].sort((a, b) => a - b);
    console.log(`\nVelocity:n=${sorted.length} min=${sorted[0]} med=${sorted[Math.floor(sorted.length / 2)]} max=${sorted[sorted.length - 1]} avg=${(sorted.reduce((s, n) => s + n, 0) / sorted.length).toFixed(1)}`);
}

// ─────────────────────────────────────────────────────────────────
// V3 对账报告
// ─────────────────────────────────────────────────────────────────

console.log('\n======== V3 度量衡对账 ========\n');

console.log('【时间单位】');
console.log('  MMA:beat 位 1-indexed(1 = bar 第 1 拍 = chord 起首)');
console.log('  V3 :startBeat 0-indexed(0 = chord 起首)');
console.log('  → 转换:V3_offset = MMA_beat - 1');
console.log('');
console.log('  MMA:duration token(4 = quarter / 8 = eighth / 8/3 = triplet eighth / 4. = dotted quarter)');
console.log('  V3 :duration 单位 = beat 数(1 beat = quarter note)');
console.log('  → 转换:V3_dur = 4 / MMA_num(tuple/dot 单独处理)');
console.log('');
console.log('【音高单位】');
console.log('  MMA:scale degree(1=root, 2/3/4/5/6/7 = 调内,b3/b7 等含变化音)');
console.log('  V3 :NoteEvent.noteNumber = absolute MIDI 0-127');
console.log('  → 必须把 degree resolve 成 chord tone MIDI');
console.log('');
console.log('【velocity 单位】');
console.log('  MMA:0-127 MIDI velocity');
console.log('  V3 :NoteEvent.velocity 0-127 internal,转 NoteData velocity 时 /127 → 0-1');
console.log('');

console.log('======== Clash 风险评估 ========\n');

// Degree 分类
const chordTones = ['1', '3', '5', '7', 'b3', 'b5', 'b7'];
const scaleTones = ['2', '4', '6'];
const extensions = ['9', '11', '13', 'b9', '#9', 'b13', '#11'];

let chordToneCount = 0, scaleToneCount = 0, extensionCount = 0, otherCount = 0;
for (const [degree, count] of Object.entries(stats.degrees)) {
    if (chordTones.includes(degree)) chordToneCount += count;
    else if (scaleTones.includes(degree)) scaleToneCount += count;
    else if (extensions.includes(degree)) extensionCount += count;
    else otherCount += count;
}
const totalDeg = chordToneCount + scaleToneCount + extensionCount + otherCount;
console.log('MMA Degree 分类:');
console.log(`  Chord tones (1/3/5/7/b3/b5/b7): ${chordToneCount} (${((chordToneCount/totalDeg)*100).toFixed(1)}%)`);
console.log(`  Scale tones (2/4/6):             ${scaleToneCount} (${((scaleToneCount/totalDeg)*100).toFixed(1)}%)`);
console.log(`  Extensions (9/11/13/b9/...):     ${extensionCount} (${((extensionCount/totalDeg)*100).toFixed(1)}%)`);
console.log(`  Other (drums noPitch / unknown): ${otherCount} (${((otherCount/totalDeg)*100).toFixed(1)}%)`);

console.log('\n【V3 安全策略】');
console.log('  Phase 1:patterns 只用 chord tones(degree 1/3/5/7 → viterbi voicing 中的实音)');
console.log('    + bassMidi(chord.bassMidi 直接,已是 chord tone)');
console.log('    → 100% 保证 emit pitch ∈ chord PCs,无冲突音');
console.log('  Phase 2(后续):scale tones(2/4/6)作为 walking 经过音,只在弱拍 emit,');
console.log('    且必须能 resolve 到下一拍的 chord tone — 需要 mg chord.forcedScale');
console.log('  Phase 3(后续):extensions(9/11/13)按 chord.notesMidi 实际存在性 gate,');
console.log('    跟 V3 voicing 已有的 m2 cluster penalty 协同');
