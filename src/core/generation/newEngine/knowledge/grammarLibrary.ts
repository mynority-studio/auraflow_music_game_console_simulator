// ============================================================
// newEngine · knowledge · GrammarLibrary(变体引擎)
// ------------------------------------------------------------
// 架构定稿 Part 4 / 铁律13:grammar = 变体/发展工具。取代手搓 DEV_STEPS。
// 真变体算子(clean-room):transform(transpose/invert/retrograde)+ divide(节奏细分)。
// 每个 grammar = per-development-stage(逐小节)算子序列;不同 grammar → 不同发展。
// (85 grammar 资产的 data-port 是后续子步;此处是变体【机制】,规则驱动非常数。)
// 操作通用 DevNote[](scaleDegree/timeOffset/duration 皆 number),不依赖 render 类型。
// ============================================================

export interface DevNote {
  scaleDegree: number;
  timeOffset: number;
  duration: number;
}

export interface VariationOp {
  kind: 'identity' | 'transpose' | 'invert' | 'retrograde' | 'divide';
  arg?: number;
}

// 每个 grammar 首位 = identity(保 bar0 动机原形 + head 身份)
const GRAMMARS: Record<string, readonly VariationOp[]> = {
  develop: [{ kind: 'identity' }, { kind: 'transpose', arg: 2 }, { kind: 'invert', arg: 4 }, { kind: 'transpose', arg: -1 }],
  sequence: [{ kind: 'identity' }, { kind: 'transpose', arg: 1 }, { kind: 'transpose', arg: 2 }, { kind: 'divide' }],
  answer: [{ kind: 'identity' }, { kind: 'retrograde' }, { kind: 'invert', arg: 5 }, { kind: 'transpose', arg: -2 }],
};
const NAMES = ['develop', 'sequence', 'answer'];

export const GRAMMAR_NAMES: readonly string[] = NAMES;

function wrap7(d: number): number {
  return (((d - 1) % 7) + 7) % 7 + 1;
}

/** 由 motifId 确定性选 grammar(不同 motif 可不同 → 不同发展)。 */
export function pickGrammarName(motifId: string): string {
  let h = 0;
  for (let i = 0; i < motifId.length; i++) h = (h * 31 + motifId.charCodeAt(i)) | 0;
  return NAMES[(((h % NAMES.length) + NAMES.length) % NAMES.length)];
}

function applyOp(notes: DevNote[], op: VariationOp): DevNote[] {
  switch (op.kind) {
    case 'transpose':
      return notes.map((n) => ({ ...n, scaleDegree: wrap7(n.scaleDegree + (op.arg ?? 0)) }));
    case 'invert': {
      const p = op.arg ?? 4;
      return notes.map((n) => ({ ...n, scaleDegree: wrap7(2 * p - n.scaleDegree) }));
    }
    case 'retrograde': {
      const degs = notes.map((n) => n.scaleDegree).reverse();
      return notes.map((n, i) => ({ ...n, scaleDegree: degs[i] }));
    }
    case 'divide': {
      // 最长音切两半(同度 + 上邻音)→ 节奏细分
      const out: DevNote[] = [];
      let maxIdx = 0;
      for (let i = 1; i < notes.length; i++) if (notes[i].duration > notes[maxIdx].duration) maxIdx = i;
      notes.forEach((n, i) => {
        if (i === maxIdx && n.duration >= 1) {
          const half = n.duration / 2;
          out.push({ scaleDegree: n.scaleDegree, timeOffset: n.timeOffset, duration: half });
          out.push({ scaleDegree: wrap7(n.scaleDegree + 1), timeOffset: n.timeOffset + half, duration: half });
        } else {
          out.push({ ...n });
        }
      });
      return out;
    }
    default:
      return notes.map((n) => ({ ...n }));
  }
}

/** 按 grammar 在第 bar 个发展阶段变体 base 动机。 */
export function developBar(base: DevNote[], grammarName: string, bar: number): DevNote[] {
  const g = GRAMMARS[grammarName] ?? GRAMMARS.develop;
  return applyOp(base, g[bar % g.length]);
}
