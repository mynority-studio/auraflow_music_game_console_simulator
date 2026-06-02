// ============================================================
// motifCore — 和声诊断器(Harmony Doctor)
// ============================================================
//
// 输入:Song(和弦上下文)+ 三轨 SlotNote(旋律/bass/织体)
// 输出:结构化和声合规报告。可复用(每次生成都能跑),非一次性探针。
//
// 检查项(按用户优先级):
//   A. 【最优先】和弦能否被正确拆解 —— root/bass/spell/color/priority/avoid
//      每个和弦逐项核:解析成功?低音符号对?色彩音/和弦内音/转位音集非空?
//   1. bass 轨:是否弹和弦内音(spell)
//   2. 织体轨:是否弹和弦标注的音(spell/color)
//   3. 旋律轨:骨干位(强拍/长音)是否落和弦音、是否撞 avoid
//      —— 参考 IMP 贴合设计:只看骨干位(重音/长音),弱拍经过音不算违规;
//         avoid 用 mg isAvoidNote(功能+调式感知)+ vocab getAvoidPCs 双重。
// ============================================================

import { Chord, type ChordPart, type SlotNote } from '../improCore/engine';
import { isAvoidNote } from '../mgEngine/musicTheory';
import type { Song } from './songSource';

const BAR = 480;
const pc = (m: number) => ((m % 12) + 12) % 12;

export interface ChordDiag {
    bar: number;
    name: string;          // 和弦名
    parsed: boolean;       // A:能否解析
    bassNote: string;      // 低音符号
    spellPCs: number[];    // 和弦内音 pc
    colorPCs: number[];    // 色彩音 pc
    avoidPCs: number[];    // 避讳音 pc
    issues: string[];      // 该和弦的问题
}

export interface TrackDiag {
    track: 'bass' | 'comp' | 'melody';
    total: number;         // 检查的音数
    inChord: number;       // 落和弦音/合规数
    violations: Array<{ slot: number; bar: number; pitch: number; reason: string }>;
    conformance: number;   // 合规率 0-1
}

export interface HarmonyReport {
    chords: ChordDiag[];
    bass: TrackDiag | null;
    comp: TrackDiag | null;
    melody: TrackDiag | null;
    summary: string[];
}

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nm = (m: number) => NOTE[pc(m)] + (Math.floor(m / 12) - 1);

// ---- A. 和弦拆解诊断 ----
function diagChords(cp: ChordPart): ChordDiag[] {
    const out: ChordDiag[] = [];
    for (const span of cp.getSpans()) {
        const ch = span.chord;
        const bar = Math.floor(span.start / BAR);
        const issues: string[] = [];
        if (ch.isNOCHORD()) {
            out.push({ bar, name: 'NC', parsed: true, bassNote: '-', spellPCs: [], colorPCs: [], avoidPCs: [], issues: [] });
            continue;
        }
        const spell = ch.getSpellMIDIarray().map(pc);
        const color = ch.getColorMIDIarray().map(pc);
        const root = ch.getRoot();
        const avoid = ch.getChordForm()?.getAvoidPCs(root) ?? [];
        const parsed = spell.length > 0;
        if (!parsed) issues.push('✗ 解析失败:无和弦内音(spell 空)');
        if (spell.length > 0 && spell.length < 3) issues.push(`⚠ 和弦音仅 ${spell.length} 个(可能词汇不全)`);
        out.push({
            bar, name: ch.getName(), parsed, bassNote: ch.getBass(),
            spellPCs: spell, colorPCs: color, avoidPCs: avoid, issues,
        });
    }
    return out;
}

// ---- 1/2. bass / comp 轨:是否弹和弦音 ----
// bass:walking bass 的弱拍经过音/approach 音是合法的(IMP 设计),只核【强拍位】(beat 1/3)落和弦音;
//       弱拍豁免(经过音是 walking 的灵魂)。comp:织体每个音都该是和弦/色彩音(无经过音概念)。
function diagAccompTrack(track: 'bass' | 'comp', notes: SlotNote[], cp: ChordPart, allowColor: boolean): TrackDiag {
    let inChord = 0;
    const violations: TrackDiag['violations'] = [];
    const isStrongBeat = (slot: number) => { const b = ((slot % BAR) + BAR) % BAR; return b === 0 || b === 240; };
    // bass 只检查强拍位;comp 检查全部
    const checked = notes.filter(n => n.pitch >= 0 && (track === 'comp' || isStrongBeat(n.startSlot)));
    for (const n of checked) {
        const ch = cp.getCurrentChord(n.startSlot);
        if (!ch || ch.isNOCHORD()) { inChord++; continue; }
        const legal = new Set(ch.getSpellMIDIarray().map(pc));
        if (allowColor) for (const c of ch.getColorMIDIarray().map(pc)) legal.add(c);
        if (legal.has(pc(n.pitch))) inChord++;
        else violations.push({ slot: n.startSlot, bar: Math.floor(n.startSlot / BAR), pitch: n.pitch, reason: `${track === 'bass' ? '强拍' : ''}${nm(n.pitch)} 非${ch.getName()}的${allowColor ? '和弦/色彩' : '和弦'}音` });
    }
    return { track, total: checked.length, inChord, violations, conformance: checked.length ? inChord / checked.length : 1 };
}

// ---- 3. 旋律:骨干位(强拍/长音)落和弦音 + avoid 检测(IMP 贴合精神)----
function isStructural(n: SlotNote): boolean {
    const inBar = ((n.startSlot % BAR) + BAR) % BAR;
    return inBar === 0 || inBar === 240 || n.durationSlots >= 240; // beat1/3 或 ≥二分
}
function diagMelody(notes: SlotNote[], cp: ChordPart, song: Song): TrackDiag {
    let ok = 0;
    const violations: TrackDiag['violations'] = [];
    const structural = notes.filter(n => n.pitch >= 0 && isStructural(n));
    for (const n of structural) {
        const ch = cp.getCurrentChord(n.startSlot);
        if (!ch || ch.isNOCHORD()) { ok++; continue; }
        const chordPCs = new Set(ch.getSpellMIDIarray().map(pc));
        const rootPc = pc(ch.getRootSemitones());
        const interval = (pc(n.pitch) - rootPc + 12) % 12;
        // 骨干位应落和弦音;且不撞 avoid(mg 功能感知 + vocab 表)
        const ana = song.analysis?.find(a => n.startSlot >= a.startBeat * 120);
        const func = ana?.func ?? 'T';
        const avoidByMg = isAvoidNote(interval, ch.getType(), ana?.scaleName ?? '', false, func);
        const avoidByVocab = (ch.getChordForm()?.getAvoidPCs(ch.getRoot()) ?? []).includes(pc(n.pitch));
        if (chordPCs.has(pc(n.pitch))) ok++;
        else if (avoidByMg || avoidByVocab) {
            violations.push({ slot: n.startSlot, bar: Math.floor(n.startSlot / BAR), pitch: n.pitch, reason: `骨干位 ${nm(n.pitch)} 撞 avoid(${ch.getName()})` });
        } else ok++; // 非和弦音但非 avoid(如可用张力音)→ 容许
    }
    return { track: 'melody', total: structural.length, inChord: ok, violations, conformance: structural.length ? ok / structural.length : 1 };
}

/** 主入口:跑全套和声诊断 */
export function diagnoseHarmony(
    song: Song,
    tracks: { melody?: SlotNote[]; bass?: SlotNote[]; comp?: SlotNote[] },
): HarmonyReport {
    const cp = song.cp;
    const chords = diagChords(cp);
    const bass = tracks.bass ? diagAccompTrack('bass', tracks.bass, cp, false) : null;
    const comp = tracks.comp ? diagAccompTrack('comp', tracks.comp, cp, true) : null;
    const melody = tracks.melody ? diagMelody(tracks.melody, cp, song) : null;

    const summary: string[] = [];
    const badChords = chords.filter(c => c.issues.length > 0);
    summary.push(`A. 和弦拆解:${chords.length - badChords.length}/${chords.length} 正常${badChords.length ? ` ✗ ${badChords.length} 个有问题` : ' ✓'}`);
    if (bass) summary.push(`1. bass 和弦内音:${(bass.conformance * 100).toFixed(0)}% (${bass.violations.length} 违规)`);
    if (comp) summary.push(`2. 织体和弦音:${(comp.conformance * 100).toFixed(0)}% (${comp.violations.length} 违规)`);
    if (melody) summary.push(`3. 旋律骨干位贴合:${(melody.conformance * 100).toFixed(0)}% (${melody.violations.length} avoid 违规 / 共 ${melody.total} 骨干音)`);

    return { chords, bass, comp, melody, summary };
}
