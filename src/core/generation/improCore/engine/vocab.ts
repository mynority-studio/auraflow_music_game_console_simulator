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

export class ChordForm {
    readonly name: string;
    readonly family: string;
    readonly same: string | null;
    readonly spell: NoteSymbol[];      // 以 C 表示
    readonly color: NoteSymbol[];
    readonly priority: NoteSymbol[];
    readonly scales: string[][];       // 每项如 ['C','major'](Phase 3 再解析成实际音阶)

    constructor(init: {
        name: string; family: string; same: string | null;
        spell: NoteSymbol[]; color: NoteSymbol[]; priority: NoteSymbol[]; scales: string[][];
    }) {
        this.name = init.name;
        this.family = init.family;
        this.same = init.same;
        this.spell = init.spell;
        this.color = init.color;
        this.priority = init.priority;
        this.scales = init.scales;
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
        const type = this.scales[0]!.slice(1).join(' ');
        const cPCs = getScalePCs(type);
        if (!cPCs) return null;
        const idx = pitchClassIndexFromName(root);
        if (idx === null) return null;
        const rise = findRiseFromC(idx);
        return cPCs.map(pc => (((pc + rise) % 12) + 12) % 12);
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
