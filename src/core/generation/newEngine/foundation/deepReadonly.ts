// ============================================================
// newEngine · foundation · 深不可变
// ------------------------------------------------------------
// 架构定稿 Part 2.0 / 附录 B2-B3 / H1。
//   DeepReadonly  : 编译期挡写。
//   deepFreeze    : 运行期递归冻结(plain object / array),cycle-safe,返回同一引用。
// ★ H1:primitive / branded primitive / function 当 leaf 短路,绝不进对象映射
//   (否则 branded number 会被映射成 { __brand } 而类型崩、函数会丢可调用性)。
// ============================================================

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

export type DeepReadonly<T> =
  T extends Primitive ? T :                                   // ★ H1:基元 / branded 基元 = leaf
  T extends Function ? T :                                    // 函数 = leaf(保可调用)
  T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepReadonly<U>> :
  { readonly [K in keyof T]: DeepReadonly<T[K]> };

/**
 * 递归冻结 plain object / array。先冻自身以破循环引用;返回同一引用,
 * 类型收窄为 DeepReadonly<T>。基元/函数直接返回(leaf)。
 */
export function deepFreeze<T>(obj: T): DeepReadonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj as DeepReadonly<T>;            // 基元 leaf
  }
  if (Object.isFrozen(obj)) {
    return obj as DeepReadonly<T>;            // 已冻(也是破环出口)
  }
  Object.freeze(obj);                         // 先冻自身,破循环引用
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj as DeepReadonly<T>;
}
