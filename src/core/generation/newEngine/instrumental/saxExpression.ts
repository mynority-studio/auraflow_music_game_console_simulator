// ============================================================
// newEngine · instrumental · Sax expression MIDI CC plan
// ------------------------------------------------------------
// Sax 的真实感先放在器配/表演层:不改音源、不拼接样本,只给 lead sax 轨写标准 MIDI CC。
// CC11 是主响度包络,CC2 给 breath controller 兼容实现。
// 小型 SF2 在 CC1 上常把 vibrato 映射成明显音高摆动,会被听成跑调;音准优先,不自动发 CC1。
// ============================================================

import { ticks, type Ticks } from '../foundation';
import type { NoteIR } from '../ir/MusicalIR';

export const SAX_CC = {
  modulation: 1,
  breath: 2,
  portamentoTime: 5,
  expression: 11,
  portamentoOn: 65,
  portamentoControl: 84,
} as const;

export interface SaxCcEvent {
  atTick: Ticks;
  controller: number;
  value: number;
}

export interface SaxPitchBendEvent {
  atTick: Ticks;
  value: number; // 14-bit MIDI pitch wheel,center=8192.
}

export interface SaxExpressionOptions {
  ppq?: number;
  maxConnectIoiTicks?: number;
  overlapTicks?: number;
}

const clampCc = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));
const clampVelocity = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

function clampInsideNote(tick: number, start: number, end: number): number {
  return Math.max(start, Math.min(Math.max(start, end - 1), Math.round(tick)));
}

function stableAccent(note: NoteIR, index: number): number {
  const start = note.startTick as number;
  const pitch = note.pitch as number;
  return ((((start * 31 + pitch * 17 + index * 13) >>> 0) % 9) - 4);
}

function sustainExpression(note: NoteIR, index: number): number {
  const pitch = note.pitch as number;
  const lowBody = pitch <= 58 ? 4 : pitch >= 70 ? -2 : 0;
  return clampCc(94 + (note.velocity - 64) * 0.34 + lowBody + stableAccent(note, index));
}

function breathFromExpression(expr: number): number {
  return clampCc(expr - 8);
}

function controllerSort(a: SaxCcEvent, b: SaxCcEvent): number {
  if ((a.atTick as number) !== (b.atTick as number)) return (a.atTick as number) - (b.atTick as number);
  return a.controller - b.controller;
}

function noteStart(note: NoteIR): number { return note.startTick as number; }
function noteDur(note: NoteIR): number { return note.durationTicks as number; }
function noteEnd(note: NoteIR): number { return noteStart(note) + noteDur(note); }

function connectedPair(prev: NoteIR, next: NoteIR, opts: SaxExpressionOptions): boolean {
  if (prev.pitch === next.pitch) return false;
  const ppq = opts.ppq ?? 480;
  const maxIoi = opts.maxConnectIoiTicks ?? Math.round(ppq * 1.10);
  const joinGap = Math.max(1, Math.round(ppq * 0.12));
  const ioi = noteStart(next) - noteStart(prev);
  if (ioi <= 0 || ioi > maxIoi) return false;
  return noteStart(next) - noteEnd(prev) <= joinGap;
}

/** GM sax family:64 soprano,65 alto,66 tenor,67 baritone. */
export function isSaxProgram(program: number): boolean {
  return program >= 64 && program <= 67;
}

/** Sax 连吹换指:不同音高的连续音允许极短 overlap,让采样器少一点逐音断裂感。 */
export function shapeSaxLegatoNotes(notes: readonly NoteIR[], opts: SaxExpressionOptions = {}): NoteIR[] {
  const ppq = opts.ppq ?? 480;
  const maxIoi = opts.maxConnectIoiTicks ?? Math.round(ppq * 1.10);
  const overlap = opts.overlapTicks ?? Math.max(1, Math.round(ppq * 0.02));
  const out = notes.map((n) => ({ ...n }));
  const order = out.map((_, i) => i).sort((a, b) => noteStart(out[a]) - noteStart(out[b]));
  const connectedTargets = new Set<number>();

  for (let k = 0; k < order.length - 1; k++) {
    const i = order[k], j = order[k + 1];
    const ioi = noteStart(out[j]) - noteStart(out[i]);
    if (ioi <= 0 || ioi > maxIoi) continue;
    if (out[i].pitch === out[j].pitch) {
      const cap = Math.max(1, ioi - 1);
      if (noteDur(out[i]) > cap) out[i].durationTicks = ticks(cap);
      continue;
    }
    const target = ioi + overlap;
    if (noteDur(out[i]) < target) out[i].durationTicks = ticks(target);
    connectedTargets.add(j);
  }
  for (const idx of connectedTargets) {
    const dur = noteDur(out[idx]);
    const scale = dur <= Math.round(ppq * 0.35) ? 0.84 : 0.9;
    out[idx].velocity = clampVelocity(out[idx].velocity * scale);
  }
  return out;
}

/** 默认 Jazz sax 连奏只模拟换指,不自动发 portamento glide;滑音需由明确 ornament 另行触发。 */
export function buildSaxPortamentoCcEvents(notes: readonly NoteIR[], opts: SaxExpressionOptions = {}): SaxCcEvent[] {
  void notes;
  void opts;
  return [];
}

/**
 * 默认不对 bebop 连线写 pitch bend。真实 sax 快速线条更像同一口气内换指,
 * 不是每个音程都滑过去;pitch bend 只应留给明确 scoop/fall/blue-note 装饰音。
 */
export function buildSaxPitchBendEvents(notes: readonly NoteIR[], opts: SaxExpressionOptions = {}): SaxPitchBendEvent[] {
  void notes;
  void opts;
  return [];
}

/**
 * 生成 sax 的吹奏包络:
 * - 每个音从较低气压爬到 sustain,避免采样一触即满导致的刺/硬。
 * - 中长音在尾部收气,减少机械 note-off。
 * - 不发 CC1 vibrato,避免小容量 SF2 的 LFO pitch 映射造成音准漂移。
 */
export function buildSaxBreathCcEvents(notes: readonly NoteIR[], opts: SaxExpressionOptions = {}): SaxCcEvent[] {
  const ppq = opts.ppq ?? 480;
  const maxIoi = opts.maxConnectIoiTicks ?? Math.round(ppq * 1.10);
  const joinGap = Math.max(1, Math.round(ppq * 0.08));
  const raw: SaxCcEvent[] = [];
  const push = (atTick: number, controller: number, value: number): void => {
    raw.push({ atTick: ticks(Math.max(0, Math.round(atTick))), controller, value: clampCc(value) });
  };

  const sorted = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  sorted.forEach((note, index) => {
    const start = note.startTick as number;
    const dur = Math.max(1, note.durationTicks as number);
    const end = start + dur;
    const prev = index > 0 ? sorted[index - 1] : undefined;
    const next = index + 1 < sorted.length ? sorted[index + 1] : undefined;
    const prevIoi = prev ? start - (prev.startTick as number) : Infinity;
    const nextIoi = next ? (next.startTick as number) - start : Infinity;
    const fromPrev = !!prev && prev.pitch !== note.pitch && prevIoi > 0 && prevIoi <= maxIoi && start - noteEnd(prev) <= joinGap;
    const toNext = !!next && next.pitch !== note.pitch && nextIoi > 0 && nextIoi <= maxIoi && (next.startTick as number) - end <= joinGap;
    const sustain = sustainExpression(note, index);
    const shortNote = dur < ppq * 0.22;
    const attackTicks = shortNote ? 0 : Math.min(Math.round(ppq * 0.16), Math.max(1, Math.round(dur * 0.34)));
    const releaseTicks = Math.min(Math.round(ppq * 0.18), Math.max(1, Math.round(dur * 0.28)));
    const startExpr = fromPrev ? sustain - 3 : shortNote ? sustain - 8 : sustain - 24;
    const releaseExpr = sustain - (dur >= ppq * 0.65 ? 20 : 12);

    push(start, SAX_CC.expression, startExpr);
    push(start, SAX_CC.breath, breathFromExpression(startExpr));

    if (!shortNote && !fromPrev) {
      const attackAt = clampInsideNote(start + attackTicks, start, end);
      push(attackAt, SAX_CC.expression, sustain);
      push(attackAt, SAX_CC.breath, breathFromExpression(sustain));
    }

    if (dur >= ppq * 0.35 && !toNext) {
      const releaseAt = clampInsideNote(end - releaseTicks, start, end);
      push(releaseAt, SAX_CC.expression, releaseExpr);
      push(releaseAt, SAX_CC.breath, breathFromExpression(releaseExpr));
    }
  });

  raw.sort(controllerSort);
  const byTickController = new Map<string, SaxCcEvent>();
  for (const event of raw) byTickController.set(`${event.atTick as number}:${event.controller}`, event);
  return [...byTickController.values()].sort(controllerSort);
}
