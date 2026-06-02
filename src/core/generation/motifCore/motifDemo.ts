// ============================================================
// motifCore — motif 经济听感验证(纯逻辑,A 阶段)
// ============================================================
//
// 验证的核心假设:
//   一个 motif 渲染一次 → 随和声 applyTransform 模进 + rectify 吸附
//   → 听起来像「成句的歌」,而不是 jazz 随机拼接。
//   再引入对比句 B → 随机句式(AABA/AAAB)破除 AAAA 单调。
//   和声由 Song 提供(写死 ii-V 或 mg SmartGen 真实进行),全程跟主调走。
//
// 全部用 improCore/engine 现有导出,improCore 一行不碰:
//   Grammar.run / realize  → motif 种子
//   applyTransform(transpose-diatonic) → 模进(确定性、保时值)
//   rectify → 把每段吸附到当段和弦音阶(= 雏形「流派遮罩」)
// ============================================================

import {
    realize, getGrammar, applyTransform, getTransform, rectify,
    renderComping, getStyle, applySwing,
    type SlotNote, type GrammarChordContext, type ChordPart,
} from '../improCore/engine';
import { routeFor } from './stylePalette';

// 连音感知的 swing:只对「真·直八分网格」音 warp —— 起点 AND 结尾都落在 60 的倍数上。
// 三连音/5连音(时值 40/80/160/20 等,或结尾不在 60 网格)即便起点在拍/半拍边界,
// 也是已 even 的细分,warp 会扭曲其时值并撞坏与邻音的衔接 → 全部隔离、原样保留。
// (上一版只按起点 %60 隔离,漏掉了「起点在拍上但时值是连音」的音,导致压扁+重叠。)
function swingEighths(notes: SlotNote[], ratio: number): SlotNote[] {
    if (!Number.isFinite(ratio) || Math.abs(ratio - 0.5) < 0.02) return notes;
    const onGrid: SlotNote[] = [];
    const tuplet: SlotNote[] = [];
    for (const n of notes) {
        const startOnGrid = n.startSlot % 60 === 0;
        const endOnGrid = (n.startSlot + n.durationSlots) % 60 === 0;
        (startOnGrid && endOnGrid ? onGrid : tuplet).push(n);
    }
    const warped = applySwing(onGrid, ratio);
    return [...warped, ...tuplet].sort((a, b) => a.startSlot - b.startSlot);
}
import { rootPc, type Song } from './songSource';
import { makeGuideLine, type GuideLineParams } from './guideline';
import { fractalDivide } from './fractal';

// 选音 = 忠实 IMP 纯 rectify:生成后逐音吸附到当前和弦音阶(rectify=true,IMP 默认)。
// 之前自创的 mgscale/beat/pent 档已移除(mgscale 在无 analysis 时漏吸调外音的 bug 来源)。

const BAR = 480;                  // WHOLE = 一小节 slot(BEAT=120 × 4)

export type MotifSource = { grammar: string } | { guidetone: GuideLineParams };

const clone = (m: SlotNote[]): SlotNote[] => m.map(n => ({ ...n }));

/** slot → 该位置和声功能块的 brick 名(查 song.analysis,按 startBeat→slot 区间)。
 *  无 analysis(默认 ii-V)→ null,grammar 退化为无 brick 随机选 lick。 */
function brickAtSlot(song: Song, slot: number): string | null {
    const ana = song.analysis;
    if (!ana || ana.length === 0) return null;
    const beat = slot / 120; // 120 slot/拍
    let hit: string | undefined;
    for (const a of ana) { if (a.startBeat <= beat) hit = a.lickBrick; else break; }
    return hit ?? null;
}

/** Grammar 在【整首】changes 上生成一条连贯线(Impro-Visor 原生用法,非 2-bar motif)。
 *  **单条生成** —— 忠实 IMP 默认(expectancyMultiplier=0,即不做期待择优)。
 *  之前的 pickBest 4选1 是 Expectancy 公式 + Critic 式多选一的自创混搭(IMP 两套机制独立、
 *  默认都关),会偏向选密集流畅候选、放大「突然密集」→ 已移除,回归 IMP 单条。
 *  brickNameAtSlot 喂 RoadMap 功能块名 → grammar 的 (builtin brick X) 按功能加权选 lick。 */
function grammarFull(name: string, song: Song): SlotNote[] | null {
    const g = getGrammar(name);
    if (!g) return null;
    const cp = song.cp;
    const total = cp.getTotalSlots();
    const ctx: GrammarChordContext = {
        familyAtSlot: (slot) => cp.getCurrentChord(slot)?.getFamily() ?? null,
        brickNameAtSlot: (slot) => brickAtSlot(song, slot),
    };
    return realize(g.run(total, ctx), cp).filter(n => n.startSlot < total);
}

// 起始音级加权随机:3/7 是 guide tone 核心(最高权),1 次之,5 最低。
// (Impro-Visor 本身无权重、默认取 3 音;这里是我们的音乐性改进)
const START_DEGREE_WEIGHTS: ReadonlyArray<[string, number]> = [['3', 4], ['7', 4], ['1', 2], ['5', 1]];
function pickStartDegree(): string {
    const total = START_DEGREE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [d, w] of START_DEGREE_WEIGHTS) { r -= w; if (r <= 0) return d; }
    return '3';
}

/** GuideTone 在【整首】changes 上生成一条导音线(Impro-Visor 原生用法)。
 *  忠实 Impro-Visor:GuideTone 本就是「稀疏长音骨架」(默认 maxDuration=HALF=240),
 *  变活跃交给 Divide/Fractal。startDegree='random' → 按权重(3/7 优先)随机选起始音级。 */
function guidetoneFull(params: GuideLineParams, cp: ChordPart): SlotNote[] {
    const startDegree = params.startDegree === 'random' || !params.startDegree ? pickStartDegree() : params.startDegree;
    const withDefault: GuideLineParams = { maxDuration: 240, ...params, startDegree }; // HALF 默认(Impro-Visor 原版)
    return makeGuideLine(cp, withDefault).map(n => ({ ...n }));
}

/** 主句 A:handwritten 用模板;grammar 抽随机细胞;guidetone 抽平滑骨架 */
/** 在整首 changes 上生成一条连贯旋律(Impro-Visor 原生管道,无 2-bar motif 复制)。
 *  grammar=lick 整段 / guidetone=导音骨架。失败回退一条简单主和弦音线。 */
export function buildFullMelody(source: MotifSource, song: Song): SlotNote[] {
    if ('guidetone' in source) {
        const line = guidetoneFull(source.guidetone, song.cp);
        return line.length ? line : guidetoneFull({ startDegree: '3' }, song.cp);
    }
    return grammarFull(source.grammar, song) ?? guidetoneFull({ startDegree: '3' }, song.cp);
}

// --- 模进:把和弦根音换算成「主调里的音级」,驱动 transpose-diatonic ---
/**
 * 后处理:用 Impro-Visor 真实 .transform 风格库装饰一段旋律。
 * name = 6 个 ROM 之一(DizzyGillespie/JoeHenderson/LesterYoung/PaulDesmond/
 * RedGarland/My)。库内 substitution 带 weight,applyTransform 内部加权随机选用,
 * 自带 guard-condition(查和弦)+ 保时值安全阀 → 比手写装饰更贴合、更地道。
 */
function applyStyleTransform(notes: SlotNote[], cp: ChordPart, name: string): SlotNote[] {
    const subs = getTransform(name);
    if (!subs || subs.length === 0) return notes;
    try {
        return applyTransform(notes, cp, subs);
    } catch {
        return notes; // 装饰失败不致命,退回原段
    }
}

// ============================================================
// 机制 B —— 乐句留白(phrase breathing)
// ------------------------------------------------------------
// Impro-Visor 靠 chorus 边界 / trading padding 给乐句间留白;我们整曲一次
// 生成,把多个 lick 无缝拼成长串(审计见 27 连音不喘气)。这里在【子乐句边界】
// (每 phraseBars 个 bar,从 song 的 roman 自重复检测)给旋律换气:把跨越边界
// 的音截到边界、并在边界前留出一段短休止,让密集流在乐句接缝处自然断开。
// 不消灭密集(级进跑动是 bebop 本色),只在乐句呼吸点切断超长无喘息的连缀。
// ============================================================

const BREATH_SLOTS = 90; // 换气留白时长(略短于八分,~3/16 拍)

function breathe(notes: SlotNote[], song: Song): SlotNote[] {
    const phraseSlots = song.phraseBars * BAR;
    if (phraseSlots <= 0 || phraseSlots >= song.totalSlots) return notes; // 整曲一句 → 不换气
    const out: SlotNote[] = [];
    // 每个子乐句边界(phraseSlots, 2×, 3×... 不含曲尾)前留出 BREATH_SLOTS 静默
    for (const n of notes) {
        if (n.pitch < 0) { out.push(n); continue; }
        const end = n.startSlot + n.durationSlots;
        // 该音跨越或贴住某个乐句边界?找它之后最近的边界
        const nextBoundary = Math.ceil((n.startSlot + 1) / phraseSlots) * phraseSlots;
        if (nextBoundary < song.totalSlots && end > nextBoundary - BREATH_SLOTS) {
            // 截到 (边界 - 换气);太短(<30)则整音丢弃,避免碎渣
            const newDur = nextBoundary - BREATH_SLOTS - n.startSlot;
            if (newDur >= 30) out.push({ ...n, durationSlots: newDur });
            // else: 落在换气窗内的音直接吃掉(成为留白的一部分)
        } else {
            out.push(n);
        }
    }
    return out;
}

/** 把整曲最后一个发声音改写成 ≤ 它的最近主音 —— 给曲尾一个解决感 */
function resolveToTonic(notes: SlotNote[], keyRoot: number): SlotNote[] {
    const out = clone(notes);
    for (let i = out.length - 1; i >= 0; i--) {
        const n = out[i]!;
        if (n.pitch < 0) continue;
        const down = (((n.pitch % 12) + 12) % 12 - keyRoot + 12) % 12; // 落到 ≤ 当前音的最近主音
        n.pitch = n.pitch - down;
        break;
    }
    return out;
}

export interface Phrase {
    melody: SlotNote[];
    chords: SlotNote[];
    pitches: number[];
}

/**
 * 主入口 — 全面拥抱 Impro-Visor 管道:在整首 changes 上生成一条连贯旋律,
 * 过后处理(Transform 装饰 → Divide 概率细分)→ 遮罩 → 返回。
 * 不再有 2-bar motif / form 复制 / 句式层(句式结构交给 grammar/GT 自身)。
 * resolveEnd=true 时,把最后一个发声音落主音给个结束感。
 */
export function buildPhrase(source: MotifSource, song: Song, opts: { transform?: string; divideProb?: number; resolveEnd?: boolean; breath?: boolean } = {}): Phrase {
    const { cp, keyRoot } = song;
    const transform = opts.transform && opts.transform !== 'off' ? opts.transform : null;
    const divideProb = opts.divideProb ?? 0;

    const route = routeFor(song.macro);
    let melody = buildFullMelody(source, song);
    if (transform) melody = applyStyleTransform(melody, cp, transform);
    if (divideProb > 0 && Math.random() < divideProb) melody = fractalDivide(melody, { numTimes: 1 });
    melody = rectify(melody, cp); // IMP 纯 rectify:吸附到当前和弦音阶
    if (opts.breath !== false) melody = breathe(melody, song); // 机制 B:乐句边界换气(默认开)
    if (opts.resolveEnd) melody = resolveToTonic(melody, keyRoot);
    melody = swingEighths(melody, route.melodySwing); // 连音感知 swing(只 warp 主拍八分,不压连音)

    let chords = buildBacking(song);
    chords = swingEighths(chords, route.compSwing);

    return {
        melody,
        chords,
        pitches: melody.filter(n => n.pitch >= 0).map(n => n.pitch),
    };
}

// 把 pc 放进 [lo,hi] 音区内最接近 center 的那个八度;区内无匹配则放宽到全音域取最近
function placeInZone(pc: number, lo: number, hi: number, center: number): number {
    let best = -1, bestD = Infinity;
    for (let m = lo; m <= hi; m++) {
        if (((m % 12) + 12) % 12 !== pc) continue;
        const d = Math.abs(m - center);
        if (d < bestD) { bestD = d; best = m; }
    }
    if (best >= 0) return best;
    // 区内无该 pc(音区太窄)→ 取离 center 最近的同 pc 音(全键盘)
    best = pc + 12 * Math.round((center - pc) / 12);
    return best;
}

/**
 * 和声铺底 —— mg「两边开中间密」垂直分布(vertical spread):
 *   外声部(结构音 root/3/5):root 放低外区(D3-G3),5 放高外区(G4-C5),间距大;
 *   内声部(色彩音 7/9/13):紧凑塞中间 cluster(A3-E4)。
 *   音区整体 ≥ 55,避开 bass(43-57)。
 * mg 织体存在则优先用 mg comping(已含 wide voicing)。
 */
function buildBacking(song: Song): SlotNote[] {
    if (song.mgTexture && song.mgTexture.chord.length > 0) {
        return song.mgTexture.chord.map(n => ({ ...n, velocity: Math.round((n.velocity ?? 80) * 0.55) }));
    }
    const out: SlotNote[] = [];
    for (const span of song.cp.getSpans()) {
        const ch = span.chord;
        if (ch.isNOCHORD()) continue;
        const rootPc = ((ch.getRootSemitones() % 12) + 12) % 12;
        const spellPc = ch.getSpellMIDIarray().map(m => ((m % 12) + 12) % 12); // [root,3,5,7...]
        const colorPc = ch.getColorMIDIarray().map(m => ((m % 12) + 12) % 12); // 9/11/13

        const voicing: number[] = [];
        // 外声部低:root(D3-G3 ~ 50-55,压在 bass 之上一点)
        voicing.push(placeInZone(rootPc, 55, 62, 57));
        // 内声部:3 音 + 7 音紧凑在中间 cluster(60-71)
        const third = spellPc[1]; const seventh = spellPc[3] ?? spellPc[2];
        if (third !== undefined) voicing.push(placeInZone(third, 60, 71, 64));
        if (seventh !== undefined) voicing.push(placeInZone(seventh, 60, 71, 67));
        // 一个色彩音(9/13)入内高区(65-72)
        if (colorPc[0] !== undefined) voicing.push(placeInZone(colorPc[0], 65, 73, 69));
        // 外声部高:5 音放高外区(67-76),拉开上方
        const fifth = spellPc[2];
        if (fifth !== undefined) voicing.push(placeInZone(fifth, 67, 76, 72));

        const uniq = [...new Set(voicing)].sort((a, b) => a - b);
        for (const p of uniq) {
            out.push({ pitch: p, startSlot: span.start, durationSlots: span.end - span.start, velocity: 64 });
        }
    }
    return out;
}

/** 把和弦音收进 [48,64] 一带,做个简单 close voicing */
function normalizeRegister(midis: number[]): number[] {
    const out = midis.map(m => {
        let p = m;
        while (p > 64) p -= 12;
        while (p < 48) p += 12;
        return p;
    });
    return Array.from(new Set(out)).sort((a, b) => a - b);
}

// ============================================================
// Groove —— 律动的重复
// ------------------------------------------------------------
// 节奏 cell(鼓)每 bar 原样平铺 = 律动重复;贝斯/comp 的节奏格子也每 bar
// 重复,但音高跟着和声走(按 slot 查 ChordPart 当前和弦 → 自动处理经过和弦)。
// ============================================================

const KICK = 36, SNARE = 38, HH_CLOSED = 42, HH_OPEN = 46;

export interface GrooveTracks {
    drums: SlotNote[];
    bass: SlotNote[];
    comp: SlotNote[];
}

/** 1-bar 鼓格子(slot 相对 bar 起点) */
function drumCell(): Array<{ pitch: number; slot: number; dur: number; vel: number }> {
    const cell: Array<{ pitch: number; slot: number; dur: number; vel: number }> = [
        { pitch: KICK, slot: 0, dur: 120, vel: 96 },
        { pitch: KICK, slot: 240, dur: 120, vel: 88 },
        { pitch: SNARE, slot: 120, dur: 120, vel: 82 },
        { pitch: SNARE, slot: 360, dur: 120, vel: 82 },
    ];
    for (let e = 0; e < 8; e++) {
        const slot = e * 60;
        cell.push({ pitch: slot === 420 ? HH_OPEN : HH_CLOSED, slot, dur: 60, vel: e % 2 === 1 ? 28 : 40 });
    }
    return cell;
}

/** 手写鼓格子兜底(IMP style 取不到鼓时用) */
function fallbackDrums(song: Song): SlotNote[] {
    const drums: SlotNote[] = [];
    const cell = drumCell();
    for (let bar = 0; bar < song.barCount; bar++) {
        const base = bar * BAR;
        for (const d of cell) drums.push({ pitch: d.pitch, startSlot: base + d.slot, durationSlots: d.dur, velocity: d.vel });
    }
    return drums;
}

/**
 * 三轨伴奏(drums / bass / comp),按 song.macro 路由:
 *   - IMP 路由:renderComping(cp, IMP style) → drums/bass 用 IMP 流派织体;
 *     comp(和弦轨)= buildBacking 的 generateVoicing(drop2/宽排/voice-leading,保留 mg voicing 美学);
 *   - mg 路由(LOFI):drums 用手写格子(mg 无鼓),bass/comp 用 mgTexture。
 * 三轨独立返回,调用方可任意 mute。swing 由调用方按 route.compSwing 统一 warp。
 */
export function buildGroove(song: Song): GrooveTracks {
    const route = routeFor(song.macro);
    const sw = (n: SlotNote[]): SlotNote[] => swingEighths(n, route.compSwing); // 三轨连音感知 swing

    // LOFI / mg 路由:鼓手写,bass/comp 走 mgTexture(comp 留给 buildBacking)
    if (route.source === 'mg') {
        const bass = song.mgTexture ? song.mgTexture.bass.map(n => ({ ...n })) : [];
        return { drums: sw(fallbackDrums(song)), bass: sw(bass), comp: [] };
    }

    // IMP 路由:取该风格的 .sty,渲染三轨
    const style = route.impStyle ? getStyle(route.impStyle) : null;
    if (!style) return { drums: sw(fallbackDrums(song)), bass: [], comp: [] };
    const tracks = renderComping(song.cp, style);
    // drums/bass 用 IMP;comp 轨交给 buildBacking 的 voicing 美学(这里返回空,避免与铺底重复)
    return { drums: sw(tracks.drums), bass: sw(tracks.bass), comp: [] };
}
