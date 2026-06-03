// ============================================================
// newEngine · foundation · branded 基元 + 集中构造器
// ------------------------------------------------------------
// 架构定稿 Part 2.0 / 附录 C3:pitch + time 全 branded,挡 off-by-12 /
// octave / tick-beat 混用。构造器是【唯一合法创建入口】,内部 validate、
// fail-closed(越界即抛 RangeError),不静默归一。
// ============================================================

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type PitchClass = Brand<number, 'PitchClass'>; // 0..11
export type Midi = Brand<number, 'Midi'>;             // 0..127
export type Beats = Brand<number, 'Beats'>;           // 四分音符 = 1.0,可分数(容三连音)
export type Ticks = Brand<number, 'Ticks'>;           // PPQ 整数网格

function assertRange(cond: boolean, msg: string): void {
  if (!cond) throw new RangeError(msg);
}

/** 严格音级:整数 0..11。越界/非整数/非有限数 → 抛。 */
export function pc(n: number): PitchClass {
  assertRange(Number.isInteger(n) && n >= 0 && n <= 11, `pc(): 期望整数 0..11,得到 ${n}`);
  return n as PitchClass;
}

/** 模 12 归一到 0..11(供整数音级运算)。非整数 → 抛(分数音级是错误)。 */
export function mod12(n: number): PitchClass {
  assertRange(Number.isInteger(n), `mod12(): 期望整数,得到 ${n}`);
  return (((n % 12) + 12) % 12) as PitchClass;
}

/** MIDI 音高:整数 0..127。越界 → 抛。 */
export function midi(n: number): Midi {
  assertRange(Number.isInteger(n) && n >= 0 && n <= 127, `midi(): 期望整数 0..127,得到 ${n}`);
  return n as Midi;
}

/** 拍:有限非负数(可分数)。负数/非有限数 → 抛。 */
export function beats(n: number): Beats {
  assertRange(Number.isFinite(n) && n >= 0, `beats(): 期望有限非负数,得到 ${n}`);
  return n as Beats;
}

/** tick:非负整数网格。负数/非整数 → 抛。 */
export function ticks(n: number): Ticks {
  assertRange(Number.isInteger(n) && n >= 0, `ticks(): 期望非负整数,得到 ${n}`);
  return n as Ticks;
}
