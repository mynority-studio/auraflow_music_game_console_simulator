// ============================================================
// sexpr-reader.ts — Lisp S-expression → Polylist 解析器
// ============================================================
//
// 输入 Impro-Visor 风格 Lisp 源码:
//   (style
//     (name ballad)
//     (bass-pattern (rules B4. R8 C4. R8)(weight 8.0))
//     ...)
//
// 输出 Polylist 嵌套数组:
//   ['style',
//    ['name', 'ballad'],
//    ['bass-pattern', ['rules', 'B4.', 'R8', 'C4.', 'R8'], ['weight', '8.0']],
//    ...]
//
// 支持:
//   - `(` `)` 嵌套
//   - 空白(空格 / tab / 换行)分隔 atom
//   - atom = 连续非空白非括号字符串(所有数字也存 string)
//   - 不支持:string literal(双引号)/ char literal / quote `'` / dotted pair / 注释
//     Impro-Visor .sty / .fv / .voc 不用这些特性,简化解析器
//
// 实现:two-pass — tokenize + recursive descent parse
// ============================================================

import type { Polylist } from './polylist';

type Token = { type: 'lparen' | 'rparen' } | { type: 'atom'; value: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    // atom — 读到下一个 ws / paren
    let j = i;
    while (j < n) {
      const cc = src[j]!;
      if (cc === '(' || cc === ')' || cc === ' ' || cc === '\t' || cc === '\n' || cc === '\r') break;
      j++;
    }
    tokens.push({ type: 'atom', value: src.slice(i, j) });
    i = j;
  }
  return tokens;
}

function parseExpr(tokens: Token[], idx: number): { node: string | Polylist; nextIdx: number } {
  const t = tokens[idx];
  if (!t) throw new Error(`Unexpected end of tokens at idx ${idx}`);
  switch (t.type) {
    case 'lparen': {
      const list: (string | Polylist)[] = [];
      let i = idx + 1;
      while (i < tokens.length && tokens[i]!.type !== 'rparen') {
        const sub = parseExpr(tokens, i);
        list.push(sub.node);
        i = sub.nextIdx;
      }
      if (i >= tokens.length) throw new Error('Unclosed paren');
      return { node: list as Polylist, nextIdx: i + 1 }; // skip rparen
    }
    case 'rparen':
      throw new Error(`Unexpected ) at token ${idx}`);
    case 'atom':
      return { node: t.value, nextIdx: idx + 1 };
  }
}

/**
 * 解析 Lisp S-expression 字符串,返顶层 Polylist。
 * 期望源码恰好一个顶层 list(如 (style ...) 或 (LH-lower-limit 50))。
 * 多顶层 list 时返第一个;无 list 时抛错。
 */
export function readSexpr(src: string): Polylist {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new Error('Empty input');
  const result = parseExpr(tokens, 0);
  if (typeof result.node === 'string') {
    throw new Error('Top-level expected a list, got atom');
  }
  return result.node;
}

/**
 * 解析 Lisp 源码,返多顶层 list 数组(.fv 文件每行一个 `(LH-lower-limit 50)`,无总 wrap)。
 */
export function readMultiSexpr(src: string): Polylist[] {
  const tokens = tokenize(src);
  const out: Polylist[] = [];
  let idx = 0;
  while (idx < tokens.length) {
    const result = parseExpr(tokens, idx);
    if (typeof result.node === 'string') {
      throw new Error(`Top-level atom not allowed at token ${idx}: ${result.node}`);
    }
    out.push(result.node);
    idx = result.nextIdx;
  }
  return out;
}
