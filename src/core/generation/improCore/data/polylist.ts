// ============================================================
// polylist.ts — Impro-Visor Polylist 移植(简化 cons cell → TS array)
// ============================================================
//
// Impro-Visor 自家 Lisp cons cell 实现(Polylist.first() / rest())。
// 在 TS 直接用 `Array` 模拟 — 习惯性 + 性能更好。
//
// Atom 全存 string(数字字符串 parser caller 自己 parseFloat)。
// list 元素可以是 Atom 或 nested Polylist。
//
// Helpers:
//   isList(x), isAtom(x)            — 类型守卫
//   first(p), rest(p)               — Lisp first/rest 仿写
//   tagged(list, tag)               — 取 (tag value...) 形式的 value... 部分
//   findTagged(parent, tag)         — 从 list of (tag ...) 找指定 tag
//   findAllTagged(parent, tag)      — 找所有 tag 匹配的(用于 bass-pattern 等多条目)
// ============================================================

export type Atom = string;
export type Polylist = readonly (Atom | Polylist)[];

export function isList(x: Atom | Polylist): x is Polylist {
  return Array.isArray(x);
}

export function isAtom(x: Atom | Polylist): x is Atom {
  return typeof x === 'string';
}

export function first(p: Polylist): Atom | Polylist | undefined {
  return p[0];
}

export function rest(p: Polylist): Polylist {
  return p.slice(1);
}

/**
 * 从 `(tag value1 value2 ...)` 形式取 [value1, value2, ...]。
 * 不匹配返 null。
 */
export function tagged(list: Polylist, tag: string): Polylist | null {
  if (list.length < 1) return null;
  const head = list[0];
  if (!isAtom(head) || head !== tag) return null;
  return list.slice(1);
}

/**
 * 从 `((tag1 v1) (tag2 v2) ...)` 形式找匹配 tag 的子 list。
 * 返子 list 本身(含 tag 头),无匹配返 null。
 */
export function findTagged(parent: Polylist, tag: string): Polylist | null {
  for (const child of parent) {
    if (!isList(child)) continue;
    if (child.length < 1) continue;
    const head = child[0];
    if (isAtom(head) && head === tag) return child;
  }
  return null;
}

/**
 * 同 findTagged 但返所有匹配(用于 bass-pattern / chord-pattern 等可重复条目)。
 */
export function findAllTagged(parent: Polylist, tag: string): Polylist[] {
  const out: Polylist[] = [];
  for (const child of parent) {
    if (!isList(child)) continue;
    if (child.length < 1) continue;
    const head = child[0];
    if (isAtom(head) && head === tag) out.push(child);
  }
  return out;
}

/**
 * 取 `(tag single-value)` 的 single-value(常用单值字段如 (name ballad))。
 * 单值是 atom 返 string,是 list 返 list,缺失返 null。
 */
export function singleValue(parent: Polylist, tag: string): Atom | Polylist | null {
  const node = findTagged(parent, tag);
  if (!node || node.length < 2) return null;
  return node[1] ?? null;
}
