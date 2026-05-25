// ============================================================
// CollisionDamper v1.1 — 撞音检测 + accomp damp
// ============================================================
//
// 原 Reconciler.dampAccompForCollisions(2026-05-25 拆 plugin)。
//
// 优先级 melody > bass > accomp > pad > drums,只 damp accomp:
//   1. accomp.pitch < 60 且与 bass 同 onset±0.05 + 同 pitch class
//      → damp(让 bass 主导低频)
//   2. accomp.pitch >= 60 且与 melody 同 onset±0.05 + 同 pitch class
//      → damp(让 melody 主导顶音)
//
// Damp 方式:velocity × 0.5。melody / bass 是主输出,不修改。
//
// 性能:onset-bucket 把 per-query 从 O(n×m) 降到近似 O(k)
// (k ≈ 3 桶内 event 数,通常 < 5)。
// ============================================================

import type { NoteData } from '../../../types';
import type { ReconcilerPluginMeta } from './types';

/** 撞音时间窗口(beat):accomp event 与 bass/melody 的 onset 差 < 此值视为同 onset */
const COLLISION_TIME_WINDOW = 0.05;
/** Bass 低音区上限(pitch),accomp event pitch 低于此值才检测 vs bass 撞音 */
const BASS_REGION_PITCH_MAX = 60;
/** Melody 区下限,accomp event pitch 高于此值才检测 vs melody 撞音 */
const MELODY_REGION_PITCH_MIN = 60;
/** 撞音 damp 因子(accomp velocity × 此值) */
const COLLISION_DAMP_FACTOR = 0.5;

function pitchClass(pitch: number): number {
    return ((pitch % 12) + 12) % 12;
}

function buildOnsetBuckets(events: NoteData[]): Map<number, NoteData[]> {
    const buckets = new Map<number, NoteData[]>();
    for (const ev of events) {
        const key = Math.floor(ev.onset / COLLISION_TIME_WINDOW);
        const arr = buckets.get(key);
        if (arr) arr.push(ev);
        else buckets.set(key, [ev]);
    }
    return buckets;
}

function hasCollisionBucketed(
    accompEvent: NoteData,
    buckets: Map<number, NoteData[]>,
): boolean {
    const accompPc = pitchClass(accompEvent.pitch);
    const baseKey = Math.floor(accompEvent.onset / COLLISION_TIME_WINDOW);
    for (let k = baseKey - 1; k <= baseKey + 1; k++) {
        const candidates = buckets.get(k);
        if (!candidates) continue;
        for (const cn of candidates) {
            if (Math.abs(cn.onset - accompEvent.onset) > COLLISION_TIME_WINDOW) continue;
            if (pitchClass(cn.pitch) === accompPc) return true;
        }
    }
    return false;
}

export const CollisionDamper: ReconcilerPluginMeta & {
    apply(accomp: NoteData[], bass: NoteData[], melody: NoteData[]): NoteData[];
} = {
    name: 'CollisionDamper',
    version: 'v1.1',
    prngConsumption: 'zero',
    description: 'Accomp 撞 bass(低频)/ melody(顶音)同 PC + 同 onset 时 velocity × 0.5',

    apply(accomp, bass, melody) {
        if (accomp.length === 0) return accomp;

        const bassBuckets = buildOnsetBuckets(bass);
        const melodyBuckets = buildOnsetBuckets(melody);

        const out: NoteData[] = new Array(accomp.length);
        for (let i = 0; i < accomp.length; i++) {
            const ev = accomp[i];
            let damped = false;

            if (ev.pitch < BASS_REGION_PITCH_MAX && hasCollisionBucketed(ev, bassBuckets)) {
                damped = true;
            } else if (ev.pitch >= MELODY_REGION_PITCH_MIN && hasCollisionBucketed(ev, melodyBuckets)) {
                damped = true;
            }

            out[i] = damped
                ? { ...ev, velocity: ev.velocity * COLLISION_DAMP_FACTOR }
                : { ...ev };
        }
        return out;
    },
};
