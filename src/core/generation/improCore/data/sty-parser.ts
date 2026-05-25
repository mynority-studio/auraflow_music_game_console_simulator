// ============================================================
// sty-parser.ts — .sty 文件 → StyleData
// ============================================================
//
// 解析 Impro-Visor .sty 文件结构(已通过 sexpr-reader → Polylist):
//
//   (style
//     (name ballad)
//     (bass-high c)
//     (bass-low g--)
//     (bass-base c--)
//     (swing 0.55)
//     (comp-swing 0.60)
//     (voicing-type open)
//     (chord-high b)
//     (chord-low b--)
//     (comments )
//     (bass-pattern (rules B4. R8 C4. R8)(weight 8.0))     ; 可多条
//     (chord-pattern (rules X1)(weight 10.0))              ; 可多条
//     (drum-pattern                                          ; 可多条
//       (drum Ride_Cymbal_1 X4 X8 X8)
//       (drum Closed_Hi-Hat R4 X4)
//       (weight 10.0))
//   )
//
// 注:
//   B 选(共识 4):忽略 voicing-type 字段(closed/open/quartal/shell),
//   不读 .voc 的内置 voicing 库,统一走 VoicingGenerator + .fv preset。
//   voicing-type 字段仍存到 StyleData 作 metadata,但运行时不消费。
// ============================================================

import type { Polylist } from './polylist';
import { isList, isAtom, findAllTagged, singleValue } from './polylist';
import { readSexpr } from './sexpr-reader';

export type VoicingTypeRef = 'open' | 'closed' | 'quartal' | 'shell' | 'custom' | 'unknown';

export interface BassPattern {
  /** 单元 rule token,如 ['B4.', 'R8', 'C4.', 'R8'] */
  rules: string[];
  weight: number;
}

export interface ChordPattern {
  /** 单元 rule token,如 ['X1'] / ['X4', 'R8', 'X4+8'] */
  rules: string[];
  weight: number;
}

export interface DrumInstrument {
  /** GM drum 名,如 'Ride_Cymbal_1' / 'Closed_Hi-Hat' / 'Bass_Drum_1' */
  drum: string;
  /** rule tokens,如 ['X4', 'X8', 'X8'] */
  rules: string[];
}

export interface DrumPattern {
  drums: DrumInstrument[];
  weight: number;
}

export interface StyleData {
  name: string;
  /** Note name string,如 'c' / 'g--' / 'c-'(`-` 表示 1 octave 下,`--` 表 2 octave 下) */
  bassHigh: string;
  bassLow: string;
  bassBase: string;
  /** swing 比例(0.5 直拍 / 0.66 三连音 / 0.55 微 swing) */
  swing: number;
  /** comp(伴奏)swing 比例,可独立于 bass swing */
  compSwing: number;
  /** Impro-Visor 用 closed/open/quartal/shell,但 ImproEngine 不消费(B 选) */
  voicingType: VoicingTypeRef;
  chordHigh: string;
  chordLow: string;
  /** weighted random 抽样池 */
  bassPatterns: BassPattern[];
  chordPatterns: ChordPattern[];
  drumPatterns: DrumPattern[];
}

function atomAsString(value: Polylist | string | null): string {
  if (value === null) return '';
  if (isAtom(value)) return value;
  return '';
}

function atomAsFloat(value: Polylist | string | null, fallback: number): number {
  const s = atomAsString(value);
  if (!s) return fallback;
  const n = parseFloat(s);
  return isNaN(n) ? fallback : n;
}

function parseVoicingType(s: string): VoicingTypeRef {
  if (s === 'open' || s === 'closed' || s === 'quartal' || s === 'shell' || s === 'custom') return s;
  return 'unknown';
}

function parsePattern(rulesNode: Polylist | null, weightNode: Polylist | string | null): { rules: string[]; weight: number } {
  const rules: string[] = [];
  if (rulesNode) {
    // (rules B4. R8 C4. R8) → rulesNode 包含 head 'rules' + 后续 atom
    for (let i = 1; i < rulesNode.length; i++) {
      const t = rulesNode[i]!;
      if (isAtom(t)) rules.push(t);
    }
  }
  const weight = atomAsFloat(weightNode ?? null, 1.0);
  return { rules, weight };
}

function parseBassOrChordPattern(node: Polylist): { rules: string[]; weight: number } {
  // node = (bass-pattern (rules ...) (weight 10.0))
  let rulesNode: Polylist | null = null;
  let weightNode: Polylist | string | null = null;
  for (let i = 1; i < node.length; i++) {
    const child = node[i]!;
    if (!isList(child)) continue;
    const head = child[0];
    if (isAtom(head) && head === 'rules') rulesNode = child;
    else if (isAtom(head) && head === 'weight') {
      weightNode = child.length > 1 ? (child[1] ?? null) : null;
    }
  }
  return parsePattern(rulesNode, weightNode);
}

function parseDrumPattern(node: Polylist): DrumPattern {
  // node = (drum-pattern (drum Ride_Cymbal_1 X4 X8 X8) (drum Closed_Hi-Hat R4 X4) (weight 10.0))
  const drums: DrumInstrument[] = [];
  let weight = 1.0;
  for (let i = 1; i < node.length; i++) {
    const child = node[i]!;
    if (!isList(child)) continue;
    const head = child[0];
    if (!isAtom(head)) continue;
    if (head === 'drum') {
      // (drum DrumName X4 X8 ...)
      if (child.length < 2) continue;
      const drumName = isAtom(child[1]!) ? (child[1] as string) : '';
      if (!drumName) continue;
      const rules: string[] = [];
      for (let k = 2; k < child.length; k++) {
        const t = child[k]!;
        if (isAtom(t)) rules.push(t);
      }
      drums.push({ drum: drumName, rules });
    } else if (head === 'weight') {
      weight = atomAsFloat(child.length > 1 ? (child[1] ?? null) : null, 1.0);
    }
  }
  return { drums, weight };
}

/**
 * 解析 .sty 字符串 → StyleData。
 * @throws Error 顶层不是 (style ...) 或字段缺失关键项
 */
export function parseStyle(src: string): StyleData {
  const root = readSexpr(src);
  if (!isList(root) || root.length < 1) throw new Error('Not a style file');
  const head = root[0];
  if (!isAtom(head) || head !== 'style') throw new Error(`Expected (style ...), got ${String(head)}`);

  const name = atomAsString(singleValue(root, 'name'));
  if (!name) throw new Error('style missing (name ...)');

  return {
    name,
    bassHigh: atomAsString(singleValue(root, 'bass-high')),
    bassLow: atomAsString(singleValue(root, 'bass-low')),
    bassBase: atomAsString(singleValue(root, 'bass-base')),
    swing: atomAsFloat(singleValue(root, 'swing'), 0.5),
    compSwing: atomAsFloat(singleValue(root, 'comp-swing'), 0.5),
    voicingType: parseVoicingType(atomAsString(singleValue(root, 'voicing-type'))),
    chordHigh: atomAsString(singleValue(root, 'chord-high')),
    chordLow: atomAsString(singleValue(root, 'chord-low')),
    bassPatterns: findAllTagged(root, 'bass-pattern').map(parseBassOrChordPattern),
    chordPatterns: findAllTagged(root, 'chord-pattern').map(parseBassOrChordPattern),
    drumPatterns: findAllTagged(root, 'drum-pattern').map(parseDrumPattern),
  };
}
