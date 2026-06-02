// ============================================================
// ImproCore engine — 和弦词汇(ChordForm)· 纯逻辑层
// imp/data/ChordForm.java(makeChordForm + getSpell/getColor/getPriority)
// 数据源:My.voc(Impro-Visor 官方和弦词汇,统一以 C 定义)
// ============================================================
//
// 本模块不含 Vite `?raw` import,可在 Node/tsx 下直接测试。
// 实际词汇文本由 vocab-rom.ts(`?raw`)或测试(fs 读)经 setActiveVocab 注入。
//
// 词汇统一用 C 定义,运行时按 root 移调(findRise C→root,整列 transpose)。
//   getSpell(root) / getColor(root) / getPriority(root)
//   `(same X)` 是别名(无 spelling),lookup 时跟随到真正定义。
// ============================================================

import { readMultiSexpr } from '../data/sexpr-reader';
import type { Polylist } from '../data/polylist';
import {
    NoteSymbol,
    makeNoteSymbol,
    transposeNoteSymbolList,
    noteSymbolListToMIDIarray,
    findRiseFromC,
    pitchClassIndexFromName,
} from './pitch';

// ------------------------------------------------------------
// ChordForm
// ------------------------------------------------------------

/** vocab 的 (approach (target a1 a2 …) …):每条 = 一个目标和弦音 + 引向它的 approach tones(均以 C 表示)*/
export interface ApproachEntry {
    readonly target: NoteSymbol;
    readonly approaches: NoteSymbol[];
}

export class ChordForm {
    readonly name: string;
    readonly family: string;
    readonly same: string | null;
    readonly spell: NoteSymbol[];      // 以 C 表示
    readonly color: NoteSymbol[];
    readonly priority: NoteSymbol[];
    readonly scales: string[][];       // 每项如 ['C','major'](Phase 3 再解析成实际音阶)
    readonly avoid: NoteSymbol[];      // vocab 的 (avoid ...) — 该躲的音(以 C 表示)
    readonly approach: ApproachEntry[]; // vocab 的 (approach ...) — 每个和弦音的 approach tones(以 C 表示)

    constructor(init: {
        name: string; family: string; same: string | null;
        spell: NoteSymbol[]; color: NoteSymbol[]; priority: NoteSymbol[]; scales: string[][];
        avoid?: NoteSymbol[];
        approach?: ApproachEntry[];
    }) {
        this.name = init.name;
        this.family = init.family;
        this.same = init.same;
        this.spell = init.spell;
        this.color = init.color;
        this.priority = init.priority;
        this.scales = init.scales;
        this.avoid = init.avoid ?? [];
        this.approach = init.approach ?? [];
    }

    private rise(root: string): number {
        const idx = pitchClassIndexFromName(root);
        if (idx === null) throw new Error(`ChordForm: bad root "${root}"`);
        return findRiseFromC(idx);
    }

    getSpell(root: string): NoteSymbol[] { return transposeNoteSymbolList(this.spell, this.rise(root)); }
    getColor(root: string): NoteSymbol[] { return transposeNoteSymbolList(this.color, this.rise(root)); }
    getPriority(root: string): NoteSymbol[] { return transposeNoteSymbolList(this.priority, this.rise(root)); }

    getSpellMIDIarray(root: string): number[] { return noteSymbolListToMIDIarray(this.getSpell(root)); }
    getColorMIDIarray(root: string): number[] { return noteSymbolListToMIDIarray(this.getColor(root)); }
    getPriorityMIDIarray(root: string): number[] { return noteSymbolListToMIDIarray(this.getPriority(root)); }

    /**
     * 第一个音阶的 pitch classes,移到指定 root(ChordForm.getFirstScaleTones)。
     * 无音阶 / 音阶表未注入 → null(消费方退化为"任意音")。
     */
    getFirstScalePCs(root: string): number[] | null {
        if (this.scales.length === 0) return null;
        return this.scalePCsByName(this.scales[0]!, root);
    }

    /** 候选音阶名列表(vocab 手工挂的有序清单),如 ['major','lydian','bebop major',...] */
    getScaleNames(): string[] {
        return this.scales.map(s => s.slice(1).join(' '));
    }

    /** 第 n 条候选音阶移到 root 的 PCs;越界/未知返 null */
    getScalePCsByIndex(n: number, root: string): number[] | null {
        const s = this.scales[n];
        return s ? this.scalePCsByName(s, root) : null;
    }

    /** 按音阶名(忽略 vocab 里的 'C' 前缀根)取该 root 下的 PCs;清单里没有则 null */
    getScalePCsByType(type: string, root: string): number[] | null {
        const hit = this.scales.find(s => s.slice(1).join(' ') === type);
        return hit ? this.scalePCsByName(hit, root) : null;
    }

    /** 全部候选音阶的 PCs(有序,与 getScaleNames 对齐)*/
    getAllScalePCs(root: string): number[][] {
        return this.scales.map(s => this.scalePCsByName(s, root)).filter((x): x is number[] => x !== null);
    }

    /** avoid 音的 pitch classes(移到 root);无则空数组 */
    getAvoidPCs(root: string): number[] {
        const rise = this.riseFor(root);
        if (rise === null) return [];
        return this.avoid.map(ns => (((ns.getSemitones() + rise) % 12) + 12) % 12);
    }

    /** 全部 approach tone 的 pitch classes(扁平、去重、移到 root)— 快速"是否 approach 音"判断;无则空数组 */
    getApproachPCs(root: string): number[] {
        const rise = this.riseFor(root);
        if (rise === null) return [];
        const set = new Set<number>();
        for (const entry of this.approach) {
            for (const ns of entry.approaches) set.add((((ns.getSemitones() + rise) % 12) + 12) % 12);
        }
        return [...set];
    }

    /** 结构化 approach 表(移到 root):每条 = 目标和弦音 PC + 引向它的 approach tone PCs — 旋律生成器查"什么引向和弦音 X" */
    getApproachMap(root: string): Array<{ targetPc: number; approachPcs: number[] }> {
        const rise = this.riseFor(root);
        if (rise === null) return [];
        return this.approach.map(entry => ({
            targetPc: (((entry.target.getSemitones() + rise) % 12) + 12) % 12,
            approachPcs: entry.approaches.map(ns => (((ns.getSemitones() + rise) % 12) + 12) % 12),
        }));
    }

    private riseFor(root: string): number | null {
        const idx = pitchClassIndexFromName(root);
        return idx === null ? null : findRiseFromC(idx);
    }

    /** vocab scale 项 ['C','major'] / 'C major' 形式 → 移到 root 的 PCs。
     *  注意:scale 项第一个 atom 是 vocab 写死的根(可能是 G,如 'G major pentatonic'),
     *  PC 集已含该根偏移,这里再按目标 root 相对 C 平移。 */
    private scalePCsByName(scaleEntry: string[], root: string): number[] | null {
        const type = scaleEntry.slice(1).join(' ');
        const cPCs = getScalePCs(type);
        if (!cPCs) return null;
        // vocab 里 scale 项的根(scaleEntry[0],如 'C'/'G'):相对 C 的偏移要叠加
        const scaleRootIdx = pitchClassIndexFromName(scaleEntry[0] ?? 'C');
        const scaleRootRise = scaleRootIdx === null ? 0 : findRiseFromC(scaleRootIdx);
        const rise = this.riseFor(root);
        if (rise === null) return null;
        const total = rise + scaleRootRise;
        return cPCs.map(pc => (((pc + total) % 12) + 12) % 12);
    }
}

// ------------------------------------------------------------
// My.voc 文本 → ChordForm map
// ------------------------------------------------------------

/** 在 Polylist 里找 head 为 key 的子 list(对应 Java Polylist.assoc) */
function assoc(list: Polylist, key: string): Polylist | null {
    for (const el of list) {
        if (Array.isArray(el) && el.length > 0 && el[0] === key) return el;
    }
    return null;
}

/** 子 list 去掉 head 关键字后的 atom 串 → NoteSymbol[](忽略非字符串项) */
function noteSymbolList(sub: Polylist | null): NoteSymbol[] {
    if (!sub) return [];
    const out: NoteSymbol[] = [];
    for (let i = 1; i < sub.length; i++) {
        const item = sub[i];
        if (typeof item === 'string') {
            const ns = makeNoteSymbol(item);
            if (ns) out.push(ns);
        }
        // 含概率标注的嵌套形式(罕见)Phase 1 先跳过
    }
    return out;
}

/** (approach (target a1 a2 …) …) → ApproachEntry[]。每个内层 list = target + approach tones。无/空则 [] */
function approachList(sub: Polylist | null): ApproachEntry[] {
    if (!sub) return [];
    const out: ApproachEntry[] = [];
    for (let i = 1; i < sub.length; i++) {
        const inner = sub[i];
        if (!Array.isArray(inner) || inner.length === 0) continue;
        const tones = noteSymbolList(['_', ...inner]);  // 复用 noteSymbolList(它跳过 head),整条都是 tone
        if (tones.length === 0) continue;
        out.push({ target: tones[0]!, approaches: tones.slice(1) });
    }
    return out;
}

function makeChordForm(form: Polylist): ChordForm | null {
    const nameEl = assoc(form, 'name');
    if (!nameEl || typeof nameEl[1] !== 'string') return null;

    const sameEl = assoc(form, 'same');
    const same = sameEl && typeof sameEl[1] === 'string' ? sameEl[1] : null;

    const familyEl = assoc(form, 'family');
    const family = familyEl && typeof familyEl[1] === 'string' ? familyEl[1] : 'other';

    const scalesEl = assoc(form, 'scales');
    const scales: string[][] = scalesEl
        ? scalesEl.slice(1).filter(Array.isArray).map(s => (s as Polylist).filter((x): x is string => typeof x === 'string'))
        : [];

    return new ChordForm({
        name: nameEl[1],
        family,
        same,
        spell: noteSymbolList(assoc(form, 'spell')),
        color: noteSymbolList(assoc(form, 'color')),
        priority: noteSymbolList(assoc(form, 'priority')),
        scales,
        avoid: noteSymbolList(assoc(form, 'avoid')),
        approach: approachList(assoc(form, 'approach')),
    });
}

/** 解析 My.voc 全文 → ChordForm map(只取 `(chord ...)` 顶层 form) */
export function parseVocab(vocText: string): Map<string, ChordForm> {
    const map = new Map<string, ChordForm>();
    const forms = readMultiSexpr(vocText);
    for (const form of forms) {
        if (form.length > 0 && form[0] === 'chord') {
            const cf = makeChordForm(form);
            if (cf) map.set(cf.name, cf);
        }
    }
    return map;
}

/**
 * 解析 My.voc 的 `(scale (name C major)(spell c d e …))` → Map<type, PCs(in C)>。
 * type = name 去掉首词 C(如 "major"/"melodic minor");(same C X) 别名解析到目标。
 */
export function parseScales(vocText: string): Map<string, number[]> {
    const map = new Map<string, number[]>();
    const aliases: Array<[string, string]> = [];
    const forms = readMultiSexpr(vocText);
    for (const form of forms) {
        if (form.length === 0 || form[0] !== 'scale') continue;
        const nameEl = assoc(form, 'name');
        if (!nameEl) continue;
        const type = nameEl.slice(2).filter((x): x is string => typeof x === 'string').join(' ');
        if (!type) continue;
        const sameEl = assoc(form, 'same');
        if (sameEl) {
            aliases.push([type, sameEl.slice(2).filter((x): x is string => typeof x === 'string').join(' ')]);
            continue;
        }
        const spellEl = assoc(form, 'spell');
        if (!spellEl) continue;
        const pcs = new Set<number>();
        for (let i = 1; i < spellEl.length; i++) {
            const item = spellEl[i];
            if (typeof item === 'string') {
                const ns = makeNoteSymbol(item);
                if (ns && !ns.isRest()) pcs.add(ns.getSemitones());
            }
        }
        if (pcs.size > 0) map.set(type, [...pcs].sort((a, b) => a - b));
    }
    for (const [type, target] of aliases) {
        const tgt = map.get(target);
        if (tgt && !map.has(type)) map.set(type, tgt);
    }
    return map;
}

// ------------------------------------------------------------
// 活动词汇(由 vocab-rom.ts 或测试注入)
// ------------------------------------------------------------

let _active: Map<string, ChordForm> | null = null;
let _scales: Map<string, number[]> | null = null;

export function setActiveVocab(map: Map<string, ChordForm>): void { _active = map; }

/** 注入音阶表(可选;未注入时 SCALE 约束退化为"任意音") */
export function setActiveScales(map: Map<string, number[]>): void { _scales = map; }

/** 取某音阶 type 的 pitch classes(C 根);未注入或未知返 null */
export function getScalePCs(type: string): number[] | null {
    return _scales?.get(type) ?? null;
}

export function isVocabReady(): boolean { return _active !== null; }

/**
 * 取 ChordForm(跟随 `same` 别名链到真正定义)。传入 C 版名字,如 "CM7"/"Cmaj7"/"Cm7"。
 * 词汇未初始化时抛错(app 需 import vocab-rom;测试需 setActiveVocab)。
 */
export function getChordForm(cVersionName: string): ChordForm | null {
    if (_active === null) {
        throw new Error('ImproCore vocab 未初始化:app 请 import ./vocab-rom,测试请先 setActiveVocab');
    }
    let f = _active.get(cVersionName) ?? null;
    const seen = new Set<string>();
    while (f && f.same && !seen.has(f.name)) {
        seen.add(f.name);
        f = _active.get(f.same) ?? null;
    }
    return f ?? null;
}

/** 全部 C 版和弦名(调试/UI 用) */
export function allChordFormNames(): string[] {
    return _active ? [..._active.keys()].sort() : [];
}
