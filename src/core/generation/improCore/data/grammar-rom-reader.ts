// ============================================================
// grammar-rom-reader.ts — 读 grammars.rom 二进制,还原 GrammarData[]
// ============================================================
//
// 由 scripts/precompile-grammars.mjs 生成的 .rom 二进制(无损 representation
// of 85 .grammar Lisp 文件)在 web 端通过 base64 inline TS module
// (grammars-rom-bytes.ts)同步加载,解码成跟原 parseGrammar() 输出
// byte-exact 等价的 GrammarData 结构。
//
// API:
//   ALL_GRAMMAR_DATA_MAP    — Map<grammarName, GrammarData>(grammarName 已去 .grammar 后缀)
//   ALL_GRAMMAR_DATA_NAMES  — sorted name list
//   getGrammarData(name)    — lookup helper
//
// ROM Schema 见 scripts/precompile-grammars.mjs 底部 ROM_LAYOUT 注释。
// ============================================================

import { GRAMMARS_ROM_BASE64 } from './grammars-rom-bytes';
import type { GrammarData, GrammarRule, GrammarToken } from './grammar-parser';

// ─────────────────────────────────────────────────────────────────
// base64 → Uint8Array(浏览器 + Node 共用,Vite 同构)
// ─────────────────────────────────────────────────────────────────
function base64ToBytes(b64: string): Uint8Array {
    // atob 在浏览器原生,Node 18+ 也有
    const binStr = atob(b64);
    const out = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) out[i] = binStr.charCodeAt(i);
    return out;
}

// ─────────────────────────────────────────────────────────────────
// 字节读取 helpers(Little Endian)
// ─────────────────────────────────────────────────────────────────
const utf8Decoder = new TextDecoder('utf-8');

function readU16(buf: Uint8Array, off: number): number {
    return buf[off]! | (buf[off + 1]! << 8);
}
function readU24(buf: Uint8Array, off: number): number {
    return buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16);
}
function readU32(buf: Uint8Array, off: number): number {
    // 用 DataView 避免 >>> 0 corner case
    return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}
function readF32(buf: Uint8Array, off: number): number {
    const view = new DataView(buf.buffer, buf.byteOffset + off, 4);
    return view.getFloat32(0, true);
}
function readStrU8Len(buf: Uint8Array, off: number): { s: string; next: number } {
    const len = buf[off]!;
    const slice = buf.subarray(off + 1, off + 1 + len);
    return { s: utf8Decoder.decode(slice), next: off + 1 + len };
}

// 同 grammar-parser.ts 的 atomToValue(私有 helper,这里 inline 一份)
function atomToValue(s: string): string | number | boolean {
    if (s === 'true') return true;
    if (s === 'false') return false;
    const n = parseFloat(s);
    if (!isNaN(n) && /^-?\d+(\.\d+)?$/.test(s)) return n;
    return s;
}

// LISP atom string → number(if int/float string)or 原 string
function maybeNum(s: string): string | number {
    const n = Number(s);
    if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(s)) return n;
    return s;
}

// ─────────────────────────────────────────────────────────────────
// Decode ROM
// ─────────────────────────────────────────────────────────────────
function decodeRom(rom: Uint8Array): GrammarData[] {
    // Header(16 B):'GRM1' + version + sectionCount + totalRules
    const magic = utf8Decoder.decode(rom.subarray(0, 4));
    if (magic !== 'GRM1') throw new Error(`[ImproCore] Bad ROM magic: ${magic}`);
    const sectionCount = readU32(rom, 8);
    const totalRules = readU32(rom, 12);

    // Section table
    const sections = new Map<number, { offset: number; length: number }>();
    for (let i = 0; i < sectionCount; i++) {
        const off = 16 + i * 12;
        sections.set(readU32(rom, off), {
            offset: readU32(rom, off + 4),
            length: readU32(rom, off + 8),
        });
    }
    const getSect = (id: number) => {
        const s = sections.get(id);
        if (!s) throw new Error(`[ImproCore] Missing section ${id}`);
        return s;
    };

    // Section 1: TOKEN_TABLE
    const tokens: string[] = [];
    {
        let off = getSect(1).offset;
        const num = readU32(rom, off); off += 4;
        for (let i = 0; i < num; i++) {
            const r = readStrU8Len(rom, off);
            tokens.push(r.s);
            off = r.next;
        }
    }

    // Section 2: BODY_OFFSET(cumulative u24 + sentinel)
    const bodyOffsets: number[] = [];
    {
        let off = getSect(2).offset;
        const num = readU32(rom, off); off += 4;
        for (let i = 0; i <= num; i++) {
            bodyOffsets.push(readU24(rom, off));
            off += 3;
        }
    }

    // Section 3: BODY_DATA(view base)
    const bodyDataStart = getSect(3).offset;

    // Section 4: HEAD_NAME
    const headNames: string[] = [];
    {
        let off = getSect(4).offset;
        const num = readU16(rom, off); off += 2;
        for (let i = 0; i < num; i++) {
            const r = readStrU8Len(rom, off);
            headNames.push(r.s);
            off = r.next;
        }
    }

    // Section 5: BUILTIN_NAME
    const builtinNames: (string | null)[] = [];
    {
        let off = getSect(5).offset;
        const num = rom[off++]!;
        for (let i = 0; i < num; i++) {
            const r = readStrU8Len(rom, off);
            builtinNames.push(r.s === '' ? null : r.s);
            off = r.next;
        }
    }

    // Section 6: WEIGHT_TABLE
    const weights: number[] = [];
    {
        let off = getSect(6).offset;
        const num = rom[off++]!;
        for (let i = 0; i < num; i++) {
            weights.push(readF32(rom, off));
            off += 4;
        }
    }

    // Section 7: PARAM_KEY_TABLE
    const paramKeys: string[] = [];
    {
        let off = getSect(7).offset;
        const num = rom[off++]!;
        for (let i = 0; i < num; i++) {
            const r = readStrU8Len(rom, off);
            paramKeys.push(r.s);
            off = r.next;
        }
    }

    // Section 10: HEAD_SIG
    const PARAM_PATTERN_FROM_ID = ['', 'Z', 'Y'];
    const headSigs: { head: string; headParams: string[] }[] = [];
    {
        let off = getSect(10).offset;
        const num = readU16(rom, off); off += 2;
        for (let i = 0; i < num; i++) {
            const headNameId = readU16(rom, off); off += 2;
            const ppId = rom[off++]!;
            const ps = PARAM_PATTERN_FROM_ID[ppId]!;
            headSigs.push({
                head: headNames[headNameId]!,
                headParams: ps === '' ? [] : [ps],
            });
        }
    }

    // Section 8: GRAMMAR_INDEX
    type GrammarMeta = {
        filename: string;
        startSymbol: string;
        parameters: [string, string][];
        ruleStart: number;
        ruleEnd: number;
    };
    const grammarMeta: GrammarMeta[] = [];
    {
        let off = getSect(8).offset;
        const num = readU16(rom, off); off += 2;
        for (let i = 0; i < num; i++) {
            const f1 = readStrU8Len(rom, off); off = f1.next;
            const f2 = readStrU8Len(rom, off); off = f2.next;
            const numParams = rom[off++]!;
            const params: [string, string][] = [];
            for (let p = 0; p < numParams; p++) {
                const keyId = rom[off++]!;
                const v = readStrU8Len(rom, off); off = v.next;
                params.push([paramKeys[keyId]!, v.s]);
            }
            const ruleStart = readU32(rom, off); off += 4;
            const ruleEnd = readU32(rom, off); off += 4;
            grammarMeta.push({
                filename: f1.s,
                startSymbol: f2.s,
                parameters: params,
                ruleStart,
                ruleEnd,
            });
        }
    }

    // Section 11: TERMINALS(per-grammar,positional;v2+。缺失 → 全部 [] 优雅降级)
    const terminalsPerGrammar: string[][] = [];
    if (sections.has(11)) {
        let off = getSect(11).offset;
        const num = readU16(rom, off); off += 2;
        for (let i = 0; i < num; i++) {
            const count = rom[off++]!;
            const list: string[] = [];
            for (let t = 0; t < count; t++) {
                const r = readStrU8Len(rom, off);
                list.push(r.s);
                off = r.next;
            }
            terminalsPerGrammar.push(list);
        }
    }

    // Section 9: RULE_INDEX(9 B/rule)
    type RuleHeader = {
        head: string;
        params: string[];
        headFixedArg: number | undefined;
        bodyId: number;
        builtin: { type: string; name: string } | undefined;
        weight: number;
        isBase: boolean;
    };
    const ruleHeaders: RuleHeader[] = new Array(totalRules);
    {
        let off = getSect(9).offset;
        for (let i = 0; i < totalRules; i++) {
            const sigId = readU16(rom, off); off += 2;
            const fixedArgRaw = readU16(rom, off); off += 2;
            const bodyId = readU24(rom, off); off += 3;
            const builtinId = rom[off++]!;
            const wFlags = rom[off++]!;
            const sig = headSigs[sigId]!;
            const builtinStr = builtinNames[builtinId];
            let builtin: { type: string; name: string } | undefined;
            if (builtinStr !== null && builtinStr !== undefined) {
                const colonIdx = builtinStr.indexOf(':');
                builtin = {
                    type: colonIdx >= 0 ? builtinStr.slice(0, colonIdx) : builtinStr,
                    name: colonIdx >= 0 ? builtinStr.slice(colonIdx + 1) : '',
                };
            }
            ruleHeaders[i] = {
                head: sig.head,
                params: sig.headParams,
                headFixedArg: fixedArgRaw === 0xffff ? undefined : fixedArgRaw,
                bodyId,
                builtin,
                weight: weights[wFlags & 0x7f]!,
                isBase: (wFlags & 0x80) !== 0,
            };
        }
    }

    // Decode bodies(varint stream → token IDs → token strings → Lisp AST)
    function decodeVarint(buf: Uint8Array, start: number, end: number, out: number[]): void {
        let off = start;
        while (off < end) {
            let n = 0;
            let shift = 0;
            while (true) {
                const b = buf[off++]!;
                n |= (b & 0x7f) << shift;
                if ((b & 0x80) === 0) break;
                shift += 7;
            }
            out.push(n);
        }
    }
    function tokensToAst(toks: string[]): GrammarToken {
        let i = 0;
        function parse(): GrammarToken {
            const t = toks[i++]!;
            if (t === 'L_EMPTY') return [];
            if (t === 'L_START') {
                const list: GrammarToken[] = [];
                while (toks[i] !== 'L_END') list.push(parse());
                i++;
                return list;
            }
            if (t.startsWith('X:')) {
                const parts = t.split(':');
                return ['X', String(maybeNum(parts[1]!)), String(maybeNum(parts[2]!))] as GrammarToken[];
            }
            if (t.startsWith('SLOPE:')) {
                const parts = t.split(':');
                const list: GrammarToken[] = ['slope', String(parts[1]!), String(parts[2]!)];
                while (toks[i] !== 'SLOPE_END') list.push(parse());
                i++;
                return list;
            }
            if (t.startsWith('L:')) {
                const firstAtom = t.slice(2);
                const list: GrammarToken[] = [String(maybeNum(firstAtom))];
                while (toks[i] !== 'L_END') list.push(parse());
                i++;
                return list;
            }
            return String(maybeNum(t));
        }
        return parse();
    }

    // 决策:GrammarToken 是 string | GrammarToken[]。原 parser 也是把 number 当 string 存
    // (因为 readMultiSexpr 不区分);所以这里也都 String() 化。

    const bodies: GrammarToken[] = new Array(bodyOffsets.length - 1);
    for (let bid = 0; bid < bodyOffsets.length - 1; bid++) {
        const start = bodyDataStart + bodyOffsets[bid]!;
        const end = bodyDataStart + bodyOffsets[bid + 1]!;
        const tokIds: number[] = [];
        decodeVarint(rom, start, end, tokIds);
        const tokStrs = tokIds.map((id) => tokens[id]!);
        bodies[bid] = tokensToAst(tokStrs);
    }

    // 装配 GrammarData(含 rulesByHead / baseRulesByHead / headSet 后置 index)
    const out: GrammarData[] = [];
    for (let gi = 0; gi < grammarMeta.length; gi++) {
        const gm = grammarMeta[gi]!;
        const grammarName = gm.filename.replace(/\.grammar$/, '');
        const parametersMap = new Map<string, string | number | boolean>();
        for (const [k, v] of gm.parameters) parametersMap.set(k, atomToValue(v));

        const rules: GrammarRule[] = [];
        const baseRules: GrammarRule[] = [];
        for (let i = gm.ruleStart; i < gm.ruleEnd; i++) {
            const rh = ruleHeaders[i]!;
            const body = bodies[rh.bodyId]!;
            // body 是顶层 list(GrammarToken[]),原 parseGrammar 也是这么存
            const ruleObj: GrammarRule = {
                head: rh.head,
                params: rh.params,
                body: Array.isArray(body) ? body : [body],
                weight: rh.weight,
                ...(rh.builtin ? { builtin: rh.builtin } : {}),
                ...(rh.headFixedArg !== undefined ? { headFixedArg: rh.headFixedArg } : {}),
                ...(rh.isBase ? { isBase: true } : {}),
            };
            if (rh.isBase) baseRules.push(ruleObj);
            else rules.push(ruleObj);
        }

        // 同 grammar-parser.ts 的 by-head 索引 + headSet
        const rulesByHead = new Map<string, GrammarRule[]>();
        const baseRulesByHead = new Map<string, GrammarRule[]>();
        const headSet = new Set<string>();
        for (const r of rules) {
            let arr = rulesByHead.get(r.head);
            if (!arr) { arr = []; rulesByHead.set(r.head, arr); }
            arr.push(r);
            headSet.add(r.head);
        }
        for (const r of baseRules) {
            let arr = baseRulesByHead.get(r.head);
            if (!arr) { arr = []; baseRulesByHead.set(r.head, arr); }
            arr.push(r);
            headSet.add(r.head);
        }

        out.push({
            name: grammarName,
            parameters: parametersMap,
            startSymbol: gm.startSymbol,
            terminals: terminalsPerGrammar[gi] ?? [],
            rules,
            baseRules,
            rulesByHead,
            baseRulesByHead,
            headSet,
        });
    }

    return out;
}

// ─────────────────────────────────────────────────────────────────
// Module-init:解码一次,缓存
// ─────────────────────────────────────────────────────────────────
const decoded: GrammarData[] = decodeRom(base64ToBytes(GRAMMARS_ROM_BASE64));

export const ALL_GRAMMAR_DATA_MAP: ReadonlyMap<string, GrammarData> = new Map(
    decoded.map((g) => [g.name, g] as const),
);

export const ALL_GRAMMAR_DATA_NAMES: ReadonlyArray<string> = Array.from(ALL_GRAMMAR_DATA_MAP.keys()).sort();

export function getGrammarData(name: string): GrammarData | undefined {
    return ALL_GRAMMAR_DATA_MAP.get(name);
}
