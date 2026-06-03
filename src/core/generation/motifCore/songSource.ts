// ============================================================
// motifCore — Song 来源(唯一的 mg adapter 边界)
// ============================================================
//
// 按 adapter-boundary 原则:motifCore 里只有这一个文件允许 import mgEngine。
// 职责:产出一个「Song」= 和声上下文(ChordPart + 主调 + 元信息),供 motif
// 引擎消费。两种来源:
//   - buildDefaultSong():写死的 ii-V 循环(C),做基线对照
//   - smartGenSong():调 mg engine 生成真实进行(随机风格/调),转 leadsheet
//
// 复刻自 improCore/sandbox/smartGen.ts 的 mg→token + leadsheet 逻辑(那是
// 另一个 sandbox 的 UI 胶水,不跨界引用,这里自带一份最小实现)。
// ============================================================

import { ChordPart, makeChordSymbol, MEASURE_LENGTH } from '../improCore/engine';
import type { SlotNote } from '../improCore/engine';
import { Engine, Random, harmonicFunctionFromRoman, type GenerationConfig, type ChordDef, type NoteEvent } from '../mgEngine/musicEngine';
import type { SongSection } from '../mgEngine/songForm';
import { chordScaleFor, scalePcsForMode } from '../mgEngine/musicTheory';
import { parseRoadMap } from '../mgEngine/roadmapParser';
import { STYLE_DICTIONARY, type StyleName, type BorrowedSource } from '../mgEngine/styleDictionary';
import { macroFromMgStyle, type MacroStyle } from './stylePalette';

const BEAT_SLOTS = 120; // 1 拍 = 120 slot(ImproCore 时基)

/** mg NoteEvent[](beat 时基)某 part → SlotNote[](slot 时基)。复刻 smartGen.ts eventsToSlotNotes。*/
function eventsToSlotNotes(events: NoteEvent[], part: NoteEvent['part']): SlotNote[] {
    const out: SlotNote[] = [];
    for (const e of events) {
        if (e.part !== part) continue;
        if (!Number.isFinite(e.noteNumber) || e.duration <= 0) continue;
        out.push({
            pitch: e.noteNumber,
            startSlot: Math.round(e.time * BEAT_SLOTS),
            durationSlots: Math.max(1, Math.round(e.duration * BEAT_SLOTS)),
            velocity: Math.max(1, Math.min(127, Math.round(e.velocity))),
        });
    }
    return out.sort((a, b) => a.startSlot - b.startSlot || a.pitch - b.pitch);
}

/**
 * 从 mg ChordDef 提取的权威和声分析(mg 全逻辑全管道的产物,透传不改)。
 * 默认 ii-V song 无此数据(analysis 为空 → 面板回退启发式)。
 */
export interface ChordAnalysis {
    /** 绝对起始 beat(累加 duration 得到) */
    startBeat: number;
    /** 落在哪个 bar(startBeat / 4) */
    bar: number;
    roman: string;
    /** TSD 功能(effectiveFunc 优先,否则 roman 推导) */
    func: 'T' | 'S' | 'D';
    /** effectiveFunc 是否覆盖了 roman 推导的功能 */
    funcOverridden: boolean;
    borrowedFrom?: string | null;
    borrowedSource?: BorrowedSource;
    mustResolve?: boolean;
    /** 局部调级数(在 tonicization 区域内) */
    localRoman?: string;
    /** 局部分析中心 pc(≠ 主调时显示 localRoman) */
    analysisKeyPc?: number;
    // ---- mg 权威「功能→音阶」(forcedScale 优先,否则 chordScaleFor)----
    /** 该和弦推荐音阶名(相对和弦根),如 'Mixolydian' / 'Lydian' / 'Phrygian Dominant' */
    scaleName?: string;
    /** 该音阶的 pitch-class 集(已落到和弦根的绝对 pc),供"在音阶上选音" */
    scalePCs?: number[];
    /** 音阶来源:forced=planner 盖的离调色彩 / functional=chordScaleFor 推导 */
    scaleSource?: 'forced' | 'functional';
    /** 和弦根 pc(供 isAvoidNote 算相对音程) */
    chordRootPc: number;
    /** mg 和弦类型字符串(供 isAvoidNote) */
    chordType: string;
    /** 该和弦所在和声功能块的 brick 名(parseRoadMap 分析,如 'Sad-Cadence');
     *  喂给 grammar 的 brickNameAtSlot → 12052 条功能 lick 按和声功能加权选择 */
    lickBrick?: string;
}

/** mg 编曲器(generateArrangement)演绎的伴奏织体,转成 slot 时基 SlotNote。
 *  含风格化 comping(drop2/rootless voicing)+ 贝斯线(walking 等)。SmartGen 路径有。
 *  mg 不产鼓 → drums 仍由手写 groove cell 补。 */
export interface MgTexture {
    chord: SlotNote[];   // 和声织体(钢琴 comping,mg voicing)
    bass: SlotNote[];    // 贝斯线
}

export interface Song {
    cp: ChordPart;
    /** 主调 tonic 的 pitch-class(0=C);手写 motif/收尾解决/模进都按它走 */
    keyRoot: number;
    totalSlots: number;
    barCount: number;
    /** 展示用 leadsheet 文本 */
    leadsheet: string;
    /** 展示用标签,如 "SmartGen · POP · Bb · 16 小节" */
    label: string;
    /** mg 权威和声分析(SmartGen 路径有;默认 ii-V 为 undefined) */
    analysis?: ChordAnalysis[];
    /** mg 编曲器演绎的伴奏织体(SmartGen 有;默认 ii-V 为 undefined → 用手写 groove) */
    mgTexture?: MgTexture;
    /** 子乐句长度(bar);从 roman 序列自重复检测(LOFI=8/POP=4)。机制 B 留白边界用。 */
    phraseBars: number;
    /** macro 风格(伴奏三轨按它路由 IMP style)。默认 song = POP。 */
    macro: MacroStyle;
    /** 曲式段落(mg 曲式层产出:INTRO/VERSE/CHORUS/BRIDGE/OUTRO 跨度);SmartGen 有,默认 song 无。 */
    sections?: SongSection[];
}

const ROOT_LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 和弦/调名的根音 → pitch-class(支持 #/b) */
export function rootPc(name: string): number {
    const letter = name[0]?.toUpperCase() ?? 'C';
    let pc = ROOT_LETTER[letter] ?? 0;
    if (name[1] === '#') pc += 1;
    else if (name[1] === 'b') pc -= 1;
    return ((pc % 12) + 12) % 12;
}

/** 从 analysis 的 roman 序列检测子乐句周期(bar)。候选 4/8/2,60% 对齐即认定;
 *  无重复 → 整曲一句(barCount)。机制 B 用它当换气边界。 */
function detectPhraseBars(analysis: ChordAnalysis[] | undefined, barCount: number): number {
    if (!analysis || analysis.length === 0) return barCount;
    // 按 bar 取起始和弦的 roman
    const romanByBar: string[] = [];
    for (const a of analysis) { const b = Math.floor(a.startBeat / BEATS_PER_BAR); if (!romanByBar[b]) romanByBar[b] = a.roman; }
    for (const p of [4, 8, 2]) {
        if (p >= barCount || barCount % p !== 0) continue;
        let match = 0, count = 0;
        for (let i = 0; i + p < romanByBar.length; i++) {
            if (!romanByBar[i] || !romanByBar[i + p]) continue;
            count++;
            if (romanByBar[i] === romanByBar[i + p]) match++;
        }
        if (count > 0 && match / count >= 0.6) return p;
    }
    return barCount;
}

function buildSong(leadsheet: string, key: string, label: string, macro: MacroStyle, analysis?: ChordAnalysis[], sections?: SongSection[]): Song {
    const cp = ChordPart.fromText(leadsheet);
    const totalSlots = cp.getTotalSlots();
    const barCount = Math.round(totalSlots / MEASURE_LENGTH);
    return {
        cp,
        keyRoot: rootPc(key),
        totalSlots,
        barCount,
        leadsheet,
        label,
        analysis,
        phraseBars: detectPhraseBars(analysis, barCount),
        macro,
        sections,
    };
}

/** 把 mg ChordDef[](权威分析)抽成 ChordAnalysis[],按累计 beat 定位 bar。
 *  keyTonicPc/mode 供 chordScaleFor 推导功能音阶。 */
function extractAnalysis(chords: ChordDef[], keyTonicPc: number, mode: string): ChordAnalysis[] {
    // RoadMap brick 分析:把和弦进行 DP 切成功能块(Sad-Cadence / Turnaround / ...)。
    // 每个 Block 覆盖 [startIdx,endIdx] 的和弦,lickBrick = grammar 期待的精确 brick 名。
    const modeFamily: 'major' | 'minor' =
        (mode === 'Major' || mode === 'Ionian' || mode === 'Lydian' || mode === 'Mixolydian') ? 'major' : 'minor';
    let brickByIdx: (i: number) => string | undefined = () => undefined;
    try {
        const blocks = parseRoadMap(chords, modeFamily);
        brickByIdx = (i: number) => blocks.find(b => i >= b.startIdx && i <= b.endIdx)?.lickBrick;
    } catch { /* brick 分析失败不致命,降级为无 brick */ }

    const out: ChordAnalysis[] = [];
    let beat = 0;
    for (let idx = 0; idx < chords.length; idx++) {
        const c = chords[idx]!;
        const baseFunc = harmonicFunctionFromRoman(c.roman);
        const func = c.effectiveFunc ?? baseFunc;
        const chordRootPc = (((c.rootMidi % 12) + 12) % 12);

        // 音阶:planner 盖的 forcedScale 优先(离调色彩),否则 chordScaleFor 功能推导
        const scaleName = c.forcedScale ?? chordScaleFor(chordRootPc, keyTonicPc, mode, c.type);
        const scaleSource: 'forced' | 'functional' = c.forcedScale ? 'forced' : 'functional';
        // scalePcsForMode 第一参 = 音阶的根(= 和弦根,因为 scaleName 相对和弦根)
        const scalePCs = [...scalePcsForMode(chordRootPc, scaleName)].sort((a, b) => a - b);

        out.push({
            startBeat: beat,
            bar: Math.floor(beat / BEATS_PER_BAR),
            roman: c.roman,
            func,
            funcOverridden: c.effectiveFunc !== undefined && c.effectiveFunc !== baseFunc,
            borrowedFrom: c.borrowedFrom,
            borrowedSource: c.borrowedSource,
            mustResolve: c.mustResolve,
            localRoman: c.localRoman,
            analysisKeyPc: c.analysisKeyPc,
            scaleName,
            scalePCs: scalePCs.length ? scalePCs : undefined,
            scaleSource,
            chordRootPc,
            chordType: c.type,
            lickBrick: brickByIdx(idx),
        });
        beat += c.duration;
    }
    return out;
}

/** 基线:I vi ii V ×2(C),做对照 */
export function buildDefaultSong(): Song {
    return buildSong('CM7 | Am7 | Dm7 | G7 | CM7 | Am7 | Dm7 | G7', 'C', '默认 · C · ii-V ×2', 'JAZZ');
}

// ---- 以下为 mg → ImproCore token 的最小映射(复刻 smartGen.ts)----

const MG_TYPE_MAP: Record<string, string> = { maj: '', min: 'm', min7: 'm7', dom7: '7' };

function mgChordToToken(root: string, rawType: string): string {
    const mapped = MG_TYPE_MAP[rawType] ?? rawType.replace('/', '');
    if (makeChordSymbol(root + mapped)) return root + mapped;
    const minor = /^(m|min|-)/.test(rawType) && !/maj/i.test(rawType);
    for (const fb of [minor ? 'm7' : '7', minor ? 'm' : '']) {
        if (makeChordSymbol(root + fb)) return root + fb;
    }
    return root;
}

const BEATS_PER_BAR = 4;

function toLeadsheet(chords: { root: string; type: string; duration: number }[]): string {
    const bars: string[][] = [];
    let cur: string[] = [];
    let acc = 0;
    for (const c of chords) {
        cur.push(mgChordToToken(c.root, c.type));
        acc += c.duration;
        if (acc >= BEATS_PER_BAR) { bars.push(cur); cur = []; acc = 0; }
    }
    if (cur.length) bars.push(cur);
    return bars.map(b => b.join(' ')).join(' | ');
}

const KEY_POOL = ['C', 'F', 'G', 'D', 'A', 'Bb', 'Eb', 'Ab'];

/** 调 mg engine 生成一条真实进行(随机风格/调/种子)→ Song */
export function smartGenSong(): Song {
    const styles = Object.keys(STYLE_DICTIONARY) as StyleName[];
    const style = styles[Math.floor(Math.random() * styles.length)]!;
    const key = KEY_POOL[Math.floor(Math.random() * KEY_POOL.length)]!;
    const seed = 'motif_' + Math.random().toString(36).slice(2, 10);

    const config: GenerationConfig = { seed, style, key, emotion: 'auto' };
    const engine = new Engine(new Random(seed));
    // 曲式层(mg):先抽段落骨架,逐段生成进行 → 整首 48-64 小节 + 段落元数据。
    const { chords, sections } = engine.generateSongForm(config);
    const mode = engine.resolveGeneration(config).mode; // 'Major'/'Minor'/exotic

    // mg 编曲器:在同源 chords 上演绎风格化伴奏织体(drop2/rootless comping + bass)。
    // 用新 Engine + 同 seed(generateArrangement 有 per-song 可变状态);失败降级无 texture。
    let mgTexture: MgTexture | undefined;
    try {
        const arrEngine = new Engine(new Random(seed));
        const timeline = arrEngine.generateArrangement(chords, config);
        mgTexture = {
            chord: eventsToSlotNotes(timeline.events, 'chord'),
            bass: eventsToSlotNotes(timeline.events, 'bass'),
        };
    } catch { /* 编曲失败 → 用手写 groove */ }

    const leadsheet = toLeadsheet(chords);
    const analysis = extractAnalysis(chords, rootPc(key), mode);
    const song = buildSong(leadsheet, key, '', macroFromMgStyle(style), analysis, sections);
    const formLabel = sections.map(s => s.label.replace(/ \d+$/, '')).filter((v, i, a) => a[i - 1] !== v).join('-');
    return { ...song, mgTexture, label: `SmartGen · ${style} · ${key} · ${mode} · ${song.barCount} 小节 · ${formLabel}` };
}
