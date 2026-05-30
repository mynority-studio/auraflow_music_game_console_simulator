// ============================================================
// ImproCore engine — Comping 渲染(bass / chord / drums)
// imp/style/stylePatterns/{BassPattern,ChordPattern,DrumPattern}.java 生成路径
// ============================================================
//
// 把 Style 的 pattern 平铺填满每个和弦 bar:
//   bass:  B/X→根音 · C→和弦音(近 last,走句)· S→和弦音(音阶待补)· A→下个根音±1
//          · N→下个根音 · R→休止 · =→重复 last,放进 bass 音域、贴近上一个 bass 音
//   chord: X→击和弦 voicing(spell 折进 chord 音域)持续该时值 · R→休止
//   drum:  每 (drum 名 X4 R8 …) → channel 9 上按 drum MIDI 打点
//
// pattern 选择 = Style.getPattern 忠实移植(贪心取"≤剩余时长的最大 pattern",while 循环逐段填满);
//   V(volume)token 0 时值(不吃拍子)。未移植:getChordPattern 的 residual/split(和弦
//   pattern 跨小节连续流动)+ pattern push(抢拍量)—— 对"一小节一和弦"影响小。
//   SCALE bass 暂作和弦音。
// ============================================================

import { getDuration as durationOf } from './duration';
import { CMIDI } from './constants';
import type { Chord } from './chord';
import type { ChordPart } from './chordpart';
import type { Style, WeightedRule, DrumPattern } from './style';
import type { SlotNote } from './lickgen';
import { generateVoicing } from './voicing';

export const BASS_CHANNEL = 1;
export const CHORD_CHANNEL = 2;
export const DRUM_CHANNEL = 9;

// GM percussion:spacelessDrumName[index] → MIDI = 35 + index(MIDIBeast.java)
const DRUM_NAMES = [
    'Acoustic_Bass_Drum', 'Bass_Drum_1', 'Side_Stick', 'Acoustic_Snare', 'Hand_Clap',
    'Electric_Snare', 'Low_Floor_Tom', 'Closed_Hi-Hat', 'High_Floor_Tom', 'Pedal_Hi-Hat',
    'Low_Tom', 'Open_Hi-Hat', 'Low-Mid_Tom', 'Hi-Mid_Tom', 'Crash_Cymbal_1', 'High_Tom',
    'Ride_Cymbal_1', 'Chinese_Cymbal', 'Ride_Bell', 'Tambourine', 'Splash_Cymbal', 'Cowbell',
    'Crash_Cymbal_2', 'Vibraslap', 'Ride_Cymbal_2', 'Hi_Bongo', 'Low_Bongo', 'Mute_Hi_Conga',
    'Open_Hi_Conga', 'Low_Conga', 'High_Timbale', 'Low_Timbale', 'High_Agogo', 'Low_Agogo',
    'Cabasa', 'Maracas', 'Short_Whistle', 'Long_Whistle', 'Short_Guiro', 'Long_Guiro',
    'Claves', 'Hi_Wood_Block', 'Low_Wood_Block', 'Mute_Cuica', 'Open_Cuica', 'Mute_Triangle', 'Open_Triangle',
];
const DRUM_MIDI = new Map<string, number>(DRUM_NAMES.map((n, i) => [n, 35 + i]));

export interface CompTracks { bass: SlotNote[]; chords: SlotNote[]; drums: SlotNote[]; }

const tokenDur = (tok: string): number => {
    // V(volume)是音量指令,零时值——不能当 rest 吃拍子
    if (tok.charAt(0).toUpperCase() === 'V') return 0;
    return durationOf(tok.substring(1));
};
const patternDur = (r: WeightedRule): number => r.tokens.reduce((s, t) => s + tokenDur(t), 0);
const drumPatternDur = (dp: DrumPattern): number =>
    Math.max(0, ...dp.drums.map(d => d.hits.reduce((s, t) => s + tokenDur(t), 0)));

function pickWeighted<T extends { weight: number }>(items: T[]): T | null {
    let total = 0;
    for (const it of items) total += it.weight;
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const it of items) { r -= it.weight; if (r <= 0) return it; }
    return items[items.length - 1] ?? null;
}

/**
 * Style.getPattern 的忠实移植:取"时长 ≤ duration 的最大 pattern"(在该时长里加权随机);
 * 没有放得下的(奇数拍/pattern 都太长)→ 取 ≥ duration 中最短的(由调用方截断)。
 * 贪心偏好最大 pattern → 每段尽量用整 pattern 填,少碎片,自然合拍。
 */
function getPattern<T extends { weight: number }>(patterns: T[], duration: number, durOf: (p: T) => number): T | null {
    let largest = 0;
    for (const p of patterns) { const d = durOf(p); if (d > largest && d <= duration) largest = d; }
    if (largest === 0) {
        let shortest = Infinity, sp: T | null = null;
        for (const p of patterns) { const d = durOf(p); if (d > 0 && d >= duration && d < shortest) { shortest = d; sp = p; } }
        return sp;
    }
    return pickWeighted(patterns.filter(p => durOf(p) === largest));
}

/** 把 pitchClass 放进 [low,high] 且最贴近 lastMidi 的八度 */
function placePC(pc: number, lastMidi: number, low: number, high: number): number {
    let best = -1, bestDist = Infinity;
    for (let m = low; m <= high; m++) {
        if (((m % 12) + 12) % 12 === pc) {
            const d = Math.abs(m - lastMidi);
            if (d < bestDist) { bestDist = d; best = m; }
        }
    }
    if (best >= 0) return best;
    let m = pc; while (m < low) m += 12; while (m > high && m - 12 >= 0) m -= 12;
    return m;
}

const SOFT_MARGIN = 6;
/** bass 音域中心(BassPattern.pressure:low + (high-low) 的音级距)*/
function bassCenter(low: number, high: number): number {
    const pcInterval = ((((high % 12) - (low % 12)) % 12) + 12) % 12;
    return low + pcInterval;
}
/** BassPattern.pressure:按音在音域里的位置,概率性(距离⁴)把偏高/偏低的音拉回中心,防 bass 飘高 */
function bassPressure(pitch: number, low: number, high: number): number {
    const center = bassCenter(low, high);
    const smHigh = center + SOFT_MARGIN, smLow = center - SOFT_MARGIN;
    if (pitch > smHigh && high > smHigh) {
        const prob = ((pitch - smHigh) / (high - smHigh)) ** 4;
        if (prob > Math.random()) return pitch - 12;
    } else if (pitch < smLow && smLow > low) {
        const prob = ((smLow - pitch) / (smLow - low)) ** 4;
        if (prob > Math.random()) return pitch + 12;
    }
    return pitch;
}

// ------------------------------------------------------------
// bass
// ------------------------------------------------------------
function renderBass(cp: ChordPart, style: Style): SlotNote[] {
    const out: SlotNote[] = [];
    const spans = cp.getSpans();
    if (style.bassPatterns.length === 0) return out;
    let lastMidi = bassCenter(style.bassLow, style.bassHigh); // 锚到音域中心(不再取中点导致偏高)

    spans.forEach((span, idx) => {
        const chord = span.chord;
        const next = spans[idx + 1]?.chord ?? chord;
        const barDur = span.end - span.start;
        let pos = 0;
        let guard = 0;
        while (pos < barDur - 1 && guard++ < 64) {
            const rule = getPattern(style.bassPatterns, barDur - pos, patternDur);
            if (!rule || patternDur(rule) <= 0) break;
            const isLast = patternDur(rule) >= barDur - pos; // 填满本 bar 的最后一段 → 用 next 做 approach
            for (const tok of rule.tokens) {
                const dur = tokenDur(tok);
                const c = tok.charAt(0).toUpperCase();
                const start = span.start + pos;
                const clipped = Math.min(dur, span.end - start);
                if (clipped > 0 && c !== 'R') {
                    const pc = bassPitchClass(c, chord, isLast ? next : chord);
                    if (pc >= 0) {
                        const placed = (c === '=') ? lastMidi : placePC(pc, lastMidi, style.bassLow, style.bassHigh);
                        const midi = bassPressure(placed, style.bassLow, style.bassHigh);
                        out.push({ pitch: midi, startSlot: start, durationSlots: clipped, velocity: 100 });
                        lastMidi = midi;
                    }
                }
                pos += dur;
                if (span.start + pos >= span.end) break;
            }
            if (isLast) break;
        }
    });
    return out;
}

/** bass 记号 → pitchClass(-1 表示休止/重复) */
function bassPitchClass(c: string, chord: Chord, next: Chord): number {
    switch (c) {
        case 'B': case 'X': return chord.getRootSemitones();
        case 'N': return next.getRootSemitones();
        case 'A': { // 下个根音 ±1 半音
            const t = next.getRootSemitones();
            return Math.random() < 0.5 ? (t + 1) % 12 : (t + 11) % 12;
        }
        case 'C': case 'S': { // 随机和弦音
            const spell = chord.getSpellMIDIarray();
            return spell.length ? ((spell[Math.floor(Math.random() * spell.length)]! % 12) + 12) % 12 : chord.getRootSemitones();
        }
        case '=': return chord.getRootSemitones(); // EQUAL(实际用 lastMidi)
        default: { // 数字/scale degree:回退根音
            const spell = chord.getSpellMIDIarray();
            return spell.length ? ((spell[0]! % 12) + 12) % 12 : chord.getRootSemitones();
        }
    }
}

// ------------------------------------------------------------
// chord(comping 击和弦)
// ------------------------------------------------------------
function voicing(chord: Chord, low: number, high: number): number[] {
    const out: number[] = [];
    for (const m of chord.getSpellMIDIarray()) {
        let p = ((m % 12) + 12) % 12;
        while (p < low) p += 12;
        if (p <= high) out.push(p);
    }
    return out;
}

function renderChords(cp: ChordPart, style: Style): SlotNote[] {
    const out: SlotNote[] = [];
    const spans = cp.getSpans();
    if (style.chordPatterns.length === 0) return out;

    const mid = Math.floor((style.chordLow + style.chordHigh) / 2);
    let prev: number[] | null = null;
    for (const span of spans) {
        const chord = span.chord;
        // Phase 5/6:双手 VoicingGenerator(LH 低段 + RH 高段)+ voice leading(传 prev)
        const gv = generateVoicing({
            priority: chord.getPriorityMIDIarray(),
            color: chord.getColorMIDIarray(),
            rootMidi: chord.getRootSemitones() + CMIDI,
            low: style.chordLow, high: mid, numNotes: 2,
            rightLow: mid, rightHigh: style.chordHigh, numNotesRight: 2,
            previousVoicing: prev,
        });
        const v = gv.length > 0 ? gv : voicing(chord, style.chordLow, style.chordHigh); // 兜底 close voicing
        if (gv.length > 0) prev = gv;
        const barDur = span.end - span.start;
        let pos = 0, guard = 0;
        while (pos < barDur - 1 && guard++ < 64) {
            const rule = getPattern(style.chordPatterns, barDur - pos, patternDur);
            if (!rule || patternDur(rule) <= 0) break;
            const isLast = patternDur(rule) >= barDur - pos;
            for (const tok of rule.tokens) {
                const dur = tokenDur(tok);
                const start = span.start + pos;
                const clipped = Math.min(dur, span.end - start);
                if (clipped > 0 && tok.charAt(0).toUpperCase() === 'X') {
                    for (const p of v) out.push({ pitch: p, startSlot: start, durationSlots: clipped, velocity: 72 });
                }
                pos += dur;
                if (span.start + pos >= span.end) break;
            }
            if (isLast) break;
        }
    }
    return out;
}

// ------------------------------------------------------------
// drums
// ------------------------------------------------------------
function renderDrums(cp: ChordPart, style: Style): SlotNote[] {
    const out: SlotNote[] = [];
    const spans = cp.getSpans();
    if (style.drumPatterns.length === 0) return out;

    for (const span of spans) {
        const barDur = span.end - span.start;
        let pos = 0, guard = 0;
        while (pos < barDur - 1 && guard++ < 16) {
            const dp = getPattern(style.drumPatterns, barDur - pos, drumPatternDur);
            if (!dp || drumPatternDur(dp) <= 0) break;
            const isLast = drumPatternDur(dp) >= barDur - pos;
            for (const line of dp.drums) {
                const midi = DRUM_MIDI.get(line.name);
                if (midi === undefined) continue;
                let off = 0;
                for (const tok of line.hits) {
                    const dur = tokenDur(tok);
                    const start = span.start + pos + off;
                    if (tok.charAt(0).toUpperCase() === 'X' && start < span.end) {
                        out.push({ pitch: midi, startSlot: start, durationSlots: Math.min(dur, 30), velocity: 92 });
                    }
                    off += dur;
                }
            }
            pos += drumPatternDur(dp);
            if (isLast) break;
        }
    }
    return out;
}

/** 渲染整段 comping(bass + chords + drums)*/
export function renderComping(cp: ChordPart, style: Style): CompTracks {
    return { bass: renderBass(cp, style), chords: renderChords(cp, style), drums: renderDrums(cp, style) };
}
