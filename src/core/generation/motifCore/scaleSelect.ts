// ============================================================
// motifCore — 在音阶上选音(生成时约束,非事后吸附)
// ============================================================
//
// 与 mask.ts 的根本区别:
//   mask  = 先随机生成 → 事后把跑调音掰回音阶(修补)
//   这里  = 直接用 mg 给每个和弦推荐的音阶(chordScaleFor/forcedScale)当音池,
//           motif 的每个音「出生即落在音阶上」。轮廓(方向/音程)保留,
//           落点量化到音阶音。强拍再用 mg 的 isAvoidNote 过滤掉 avoid。
//
// 数据来源:Song.analysis[i].scalePCs(mg 权威音阶,songSource 透传)。
//   无 analysis(默认 ii-V)时本原语不介入,调用方回退 mask。
// ============================================================

import type { SlotNote } from '../improCore/engine';
import { isAvoidNote } from '../mgEngine/musicTheory';
import type { Song, ChordAnalysis } from './songSource';

const BAR = 480;

/** 找到 slot 落在哪个和弦分析段(按 startBeat→slot 区间) */
function analysisAtSlot(song: Song, slot: number): ChordAnalysis | null {
    const ana = song.analysis;
    if (!ana || ana.length === 0) return null;
    const beat = slot / 120; // 120 slot/拍
    let hit: ChordAnalysis | null = null;
    for (const a of ana) {
        if (a.startBeat <= beat) hit = a; else break;
    }
    return hit;
}

/** 在音阶 PC 集里,找最接近 target 的 MIDI(同度优先,平手取低);限定音域 */
function nearestInScale(target: number, scalePCs: number[], lo: number, hi: number): number {
    const set = new Set(scalePCs.map(p => ((p % 12) + 12) % 12));
    let best = target, bestD = 99;
    for (let m = lo; m <= hi; m++) {
        if (!set.has(((m % 12) + 12) % 12)) continue;
        const d = Math.abs(m - target);
        if (d < bestD) { bestD = d; best = m; }
    }
    return best;
}

/** 强拍判定:beat1/3 或长音 */
function isStrong(slot: number, dur: number): boolean {
    const inBar = ((slot % BAR) + BAR) % BAR;
    return inBar === 0 || inBar === 240 || dur >= 240;
}

export interface ScaleSelectOpts {
    /** 音域 */
    lo?: number;
    hi?: number;
    /** 强拍是否额外避开 mg avoid note(默认 true) */
    avoidOnStrong?: boolean;
}

/**
 * 把一段旋律的每个音「重选」到所在和弦的 mg 推荐音阶上(保留轮廓)。
 * 返回新的 SlotNote[];无 mg analysis 的音返回原样(交给上游回退)。
 */
export function selectOnScale(notes: SlotNote[], song: Song, opts: ScaleSelectOpts = {}): SlotNote[] {
    const lo = opts.lo ?? 55;
    const hi = opts.hi ?? 84;
    const avoidOnStrong = opts.avoidOnStrong ?? true;

    return notes.map(n => {
        if (n.pitch < 0) return n; // 休止
        const a = analysisAtSlot(song, n.startSlot);
        if (!a || !a.scalePCs || a.scalePCs.length === 0) return n; // 无 mg 音阶 → 原样

        let pitch = nearestInScale(n.pitch, a.scalePCs, lo, hi);

        // 强拍:若落在 avoid 音上,挪到最近的非 avoid 音阶音
        if (avoidOnStrong && isStrong(n.startSlot, n.durationSlots) && a.scaleName) {
            const interval = (((pitch - a.chordRootPc) % 12) + 12) % 12;
            const isModal = a.scaleSource === 'forced'; // forcedScale 多为调式色彩
            if (isAvoidNote(interval, a.chordType, a.scaleName, isModal, a.func)) {
                pitch = nudgeOffAvoid(pitch, a, lo, hi);
            }
        }
        return { ...n, pitch };
    });
}

/** 在音阶内把音挪离 avoid:先上一个音阶音,不行再下一个 */
function nudgeOffAvoid(pitch: number, a: ChordAnalysis, lo: number, hi: number): number {
    const set = new Set((a.scalePCs ?? []).map(p => ((p % 12) + 12) % 12));
    const isModal = a.scaleSource === 'forced';
    const ok = (m: number) => {
        if (m < lo || m > hi) return false;
        if (!set.has(((m % 12) + 12) % 12)) return false;
        const iv = (((m - a.chordRootPc) % 12) + 12) % 12;
        return !isAvoidNote(iv, a.chordType, a.scaleName ?? '', isModal, a.func);
    };
    for (let d = 1; d <= 7; d++) {
        if (ok(pitch + d)) return pitch + d;
        if (ok(pitch - d)) return pitch - d;
    }
    return pitch;
}
